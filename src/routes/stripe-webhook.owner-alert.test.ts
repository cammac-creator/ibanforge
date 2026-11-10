/**
 * The owner alert, read where it is really sent: at the end of the Stripe
 * webhook route, once per recorded payment (10/11/2026).
 *
 * `notify.test.ts` holds the text and `owner-label.test.ts` the label; what
 * neither sees is whether the three sends of the route (new purchase, recharge
 * of the same key, subscription attached to an existing key) each hand the
 * label over, and whether a replay stays silent. This file goes through the
 * signed route for exactly that.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { resetStripeClient, stripeWebhook } from './stripe-webhook.js';
import { generateApiKey } from '../lib/api-keys.js';
import { upsertCompanyProfile } from '../lib/company-profiles.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import * as email from '../lib/email.js';
import { ensureTopupRef } from '../lib/key-purchases.js';
import { UNNAMED_CLIENT, clientRecordUrl } from '../lib/notify.js';

const SK = 'sk_test_fictif_sans_compte';
const WHSEC = 'whsec_fictif_sans_compte';
const realFetch = globalThis.fetch;

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

/** The text of each alert handed to Telegram, in order. */
let alerts: string[] = [];

beforeEach(() => {
  alerts = [];
  vi.stubEnv('STRIPE_SECRET_KEY', SK);
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WHSEC);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'jeton-fictif');
  vi.stubEnv('TELEGRAM_CHAT_ID', '424242');
  resetStripeClient();
  // No mail leaves a test: the three deliveries are replaced, and anything
  // else that reaches `fetch` is Telegram or a mistake the assertions catch.
  vi.spyOn(email, 'sendApiKeyEmail').mockResolvedValue(true);
  vi.spyOn(email, 'sendSubscriptionKeyEmail').mockResolvedValue(true);
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
      alerts.push((JSON.parse(String(init?.body ?? '{}')) as { text?: string }).text ?? '');
    }
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetStripeClient();
});

afterAll(() => closeAll());

function send(event: Stripe.Event): Promise<Response> {
  const payload = JSON.stringify(event);
  const signature = new Stripe(SK).webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  return Promise.resolve(
    stripeWebhook.request('/v1/stripe/webhook', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    }),
  );
}

function checkout(opts: {
  sessionId: string;
  email?: string | null;
  ref?: string | null;
  plan?: 'pro';
}): Stripe.Event {
  return {
    id: `evt_${uniq('alerte')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: opts.plan ? { plan: opts.plan } : { bundle: '5k' },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: 'paid',
        ...(opts.plan ? { mode: 'subscription', subscription: `sub_${uniq('alerte')}` } : {}),
        amount_total: opts.plan ? 2900 : 2000,
        currency: 'usd',
        client_reference_id: opts.ref ?? null,
        payment_intent: opts.plan ? null : `pi_${opts.sessionId}`,
      },
    },
  } as unknown as Stripe.Event;
}

function knownAs(address: string, company: string): void {
  getStatsDB()
    .prepare('INSERT INTO prospects (id, company, contact_email) VALUES (?, ?, ?)')
    .run(uniq('prospect'), company, address);
}

describe('the owner alert of the Stripe webhook route says who paid', () => {
  it('names the company of a new buyer and links to their record, once', async () => {
    const address = `${uniq('achats')}@alpha.example.net`;
    knownAs(address, 'Société Alpha');
    const event = checkout({ sessionId: `cs_test_${uniq('achat')}`, email: address });

    const res = await send(event);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key_prefix: string };
    expect(body.key_prefix).toMatch(/^ifk_[a-f0-9]{8}$/);

    expect(alerts).toHaveLength(1);
    const lines = alerts[0].split('\n');
    expect(lines[0]).toContain('nouvel achat Stripe');
    expect(lines).toContain('Client : Société Alpha');
    expect(lines).toContain(`Fiche : ${clientRecordUrl(body.key_prefix)}`);
    // The buyer's address is in the event and in the base: not in the alert.
    expect(alerts[0]).not.toContain('@');

    // A replay takes the idempotent path: nothing is minted, nothing is said.
    const replay = await send(event);
    expect(replay.status).toBe(200);
    expect(alerts).toHaveLength(1);
  });

  it('names the company on a recharge of the same key', async () => {
    const address = `${uniq('compta')}@beta.example.net`;
    upsertCompanyProfile({ email: address, company: 'Société Beta', source: 'site' });
    const key = generateApiKey(address)!;
    const ref = ensureTopupRef(key.key_hash)!;

    const res = await send(checkout({ sessionId: `cs_test_${uniq('recharge')}`, ref }));
    expect(res.status).toBe(200);

    expect(alerts).toHaveLength(1);
    const lines = alerts[0].split('\n');
    expect(lines[0]).toContain('recharge Stripe');
    expect(lines).toContain('Client : Société Beta');
    expect(lines).toContain(`Fiche : ${clientRecordUrl(key.key_prefix)}`);
    expect(alerts[0]).not.toContain('@');
  });

  it('names the company when a subscription lands on an existing key', async () => {
    const address = `${uniq('it')}@gamma.example.net`;
    const key = generateApiKey(address)!;
    const ref = ensureTopupRef(key.key_hash)!;

    const res = await send(checkout({ sessionId: `cs_test_${uniq('pro')}`, ref, plan: 'pro' }));
    expect(res.status).toBe(200);

    expect(alerts).toHaveLength(1);
    const lines = alerts[0].split('\n');
    expect(lines[0]).toContain('ABONNEMENT Pro');
    expect(lines[0]).toContain('sur une clé existante');
    // No company on file: the organisation's own domain stands in.
    expect(lines).toContain('Client : gamma.example.net');
    expect(lines).toContain(`Fiche : ${clientRecordUrl(key.key_prefix)}`);
    expect(alerts[0]).not.toContain('@');
  });

  it('still alerts, and says so, when the buyer cannot be named', async () => {
    const res = await send(
      checkout({ sessionId: `cs_test_${uniq('prive')}`, email: `${uniq('quelquun')}@gmail.com` }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key_prefix: string };

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(`Client : ${UNNAMED_CLIENT}`);
    expect(alerts[0]).toContain(clientRecordUrl(body.key_prefix));
    expect(alerts[0]).not.toContain('@');
    expect(alerts[0]).not.toContain('gmail');
  });
});
