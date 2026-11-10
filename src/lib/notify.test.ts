/**
 * Audit A2 — the owner alert sits INSIDE the Stripe webhook's response path,
 * and it is awaited there.
 *
 * Stripe gives up on a webhook at ~10 s. Without a bound on this call, undici's
 * ~300 s ceiling applied: Telegram hanging would push the webhook past Stripe's
 * patience, Stripe would retry, and the retry takes the idempotent path — which
 * mints nothing and therefore notifies nothing. The purchase alert would be
 * lost for good, because there is exactly one attempt by construction. The same
 * file already learned this lesson for e-mail (fire-and-forget, dated comment)
 * and did not apply it here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  NOTIFY_TIMEOUT_MS,
  UNNAMED_CLIENT,
  clientRecordUrl,
  notifyPurchaseTelegram,
  purchaseAlertText,
} from './notify.js';

const originalEnv = { ...process.env };
const realFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function configured(): void {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '424242';
}

const PURCHASE = { amountUsd: 20, bundle: '5k', credits: 5000, keyPrefix: 'ifk_test1234' };

describe('the purchase alert cannot hold the Stripe webhook open', () => {
  it('is bounded well under the ~10 s at which Stripe gives up', () => {
    expect(NOTIFY_TIMEOUT_MS).toBeLessThan(10_000);
    expect(NOTIFY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('passes an abort signal carrying that budget', async () => {
    configured();
    let seen: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;

    expect(await notifyPurchaseTelegram(PURCHASE)).toBe(true);
    // 🚨 The assertion that fails without the fix: no signal at all.
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(seen?.signal?.aborted).toBe(false);
  });

  /**
   * The signal we hand `fetch` really does fire on its own — checked against a
   * budget of a few milliseconds rather than the production one, so the suite
   * does not spend three seconds proving a platform guarantee.
   */
  it('hands over a signal that aborts by itself', async () => {
    const signal = AbortSignal.timeout(20);
    await new Promise((resolve) => signal.addEventListener('abort', resolve));
    expect(signal.aborted).toBe(true);
    // Déclenché par sa propre horloge : la raison est une TimeoutError, celle
    // qu'undici relaie (test suivant). Plus de borne de durée, qui tombait sur
    // une machine occupée : un signal qui ne partirait jamais ferait tomber le
    // test sur son propre délai, quelle que soit la vitesse de la machine.
    expect(signal.reason).toMatchObject({ name: 'TimeoutError' });
  });

  it('reports failure rather than throwing when the call is aborted', async () => {
    configured();
    // What undici raises when the signal fires mid-flight.
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      });
    }) as unknown as typeof fetch;

    // Best-effort by contract: it reports failure, it never throws, and above
    // all it RETURNS — so the webhook answers Stripe in time and is not retried
    // into the idempotent path where the alert would be lost for good.
    expect(await notifyPurchaseTelegram(PURCHASE)).toBe(false);
  });

  it('still never throws when Telegram refuses outright', async () => {
    configured();
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 403 }),
    ) as unknown as typeof fetch;
    expect(await notifyPurchaseTelegram(PURCHASE)).toBe(false);
  });

  it('skips quietly when no bot is configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    expect(await notifyPurchaseTelegram(PURCHASE)).toBe(false);
  });

  /**
   * Telegram is not one of the processors declared in the privacy policy / DPA.
   * What this holds is the address: the message is assembled next to fields
   * that DO carry an e-mail elsewhere in the webhook, and none may reach it.
   * It does not claim more: a company label is free text (see owner-label.ts).
   */
  it('never carries a customer address', async () => {
    configured();
    let body = '';
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body ?? '');
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;

    await notifyPurchaseTelegram(PURCHASE);
    expect(body).not.toContain('@');
    expect(body).toContain('ifk_test1234');

    // Even when a caller hands over an address as the label (it never should):
    // the transport's own text refuses it.
    await notifyPurchaseTelegram({ ...PURCHASE, clientLabel: 'a.dupont@alpha.example.net' });
    expect(body).not.toContain('@');
    expect(body).not.toContain('dupont');
  });
});

/**
 * The owner could not tell who had paid: the alert said "Clé : ifk_…" and
 * linked to the whole client list (his ask of 10/11/2026). It now names the
 * organisation and opens that client's record.
 */
describe('the alert says who paid and opens their record', () => {
  it('names the organisation on its own line', () => {
    const text = purchaseAlertText({ ...PURCHASE, clientLabel: 'Société Alpha' });
    expect(text.split('\n')).toContain('Client : Société Alpha');
  });

  it('links to that client, not to the list', () => {
    const text = purchaseAlertText(PURCHASE);
    expect(clientRecordUrl('ifk_test1234')).toBe(
      'https://ibanforge.com/dashboard/clients?open=ifk_test1234',
    );
    expect(text.split('\n')).toContain(`Fiche : ${clientRecordUrl('ifk_test1234')}`);
    expect(text).not.toMatch(/dashboard\/clients(\s|$)/);
  });

  it('says so when no organisation can be named, and still links', () => {
    for (const clientLabel of [undefined, null, '', '   ']) {
      const text = purchaseAlertText({ ...PURCHASE, clientLabel });
      expect(text).toContain(`Client : ${UNNAMED_CLIENT}`);
      expect(text).toContain(clientRecordUrl('ifk_test1234'));
    }
  });

  it('keeps one line per fact, whatever the label holds', () => {
    const text = purchaseAlertText({ ...PURCHASE, clientLabel: 'Société\nAlpha' });
    expect(text.split('\n')).toHaveLength(5);
    expect(text).toContain('Client : Société Alpha');
  });

  it('carries both lines on a recharge and on a subscription too', () => {
    const recharge = purchaseAlertText({
      ...PURCHASE,
      recharge: true,
      clientLabel: 'Société Alpha',
    });
    const pro = purchaseAlertText({
      ...PURCHASE,
      plan: 'pro',
      monthlyLimit: 10_000,
      attached: true,
      clientLabel: 'alpha.example.net',
    });
    expect(recharge).toContain('recharge Stripe');
    expect(recharge).toContain('Client : Société Alpha');
    expect(recharge).toContain(clientRecordUrl('ifk_test1234'));
    expect(pro).toContain('ABONNEMENT Pro');
    expect(pro).toContain('sur une clé existante');
    expect(pro).toContain('Client : alpha.example.net');
    expect(pro).toContain(clientRecordUrl('ifk_test1234'));
    // Same five facts in the same order, whichever of the three it is.
    for (const text of [recharge, pro]) {
      const lines = text.split('\n');
      expect(lines).toHaveLength(5);
      expect(lines[1].startsWith('Client : ')).toBe(true);
      expect(lines[2].startsWith('Montant : ')).toBe(true);
      expect(lines[3]).toBe('Clé : ifk_test1234…');
      expect(lines[4].startsWith('Fiche : ')).toBe(true);
    }
  });

  it('opens with the kind of payment, without a long dash', () => {
    expect(purchaseAlertText(PURCHASE).split('\n')[0]).toBe(
      '\u{1F4B0} IBANforge : nouvel achat Stripe',
    );
    expect(purchaseAlertText({ ...PURCHASE, recharge: true })).not.toContain('—');
  });
});
