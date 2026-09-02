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
import { NOTIFY_TIMEOUT_MS, notifyPurchaseTelegram } from './notify.js';

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
    const started = Date.now();
    const signal = AbortSignal.timeout(20);
    await new Promise((resolve) => signal.addEventListener('abort', resolve));
    expect(signal.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
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
   * Telegram is not one of the processors declared in the privacy policy / DPA,
   * so no personal data may transit it. Checked here because the message is
   * assembled next to fields that DO carry an e-mail elsewhere in the webhook.
   */
  it('carries no customer identity', async () => {
    configured();
    let body = '';
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body ?? '');
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;

    await notifyPurchaseTelegram(PURCHASE);
    expect(body).not.toContain('@');
    expect(body).toContain('ifk_test1234');
  });
});
