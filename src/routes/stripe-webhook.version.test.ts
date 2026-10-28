import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Stripe from 'stripe';
import { stripeWebhook, resetStripeClient } from './stripe-webhook.js';
import { stripeRetrieve } from './stripe-retrieve.js';
import { closeAll, getStatsDB } from '../lib/db.js';

const secret = 'whsec_fictif_sans_compte';
const signer = new Stripe('sk_test_fictif_sans_compte');
const app = new Hono().route('/', stripeWebhook).route('/', stripeRetrieve);
let sequence = 0;

function event(version: string, method: 'card' | 'crypto', paid = true) {
  sequence += 1;
  return {
    id: `evt_test_version_${sequence}`,
    object: 'event',
    api_version: version,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_version_${sequence}`,
        object: 'checkout.session',
        mode: 'payment',
        payment_method_types: [method],
        allowed_payment_method_types: null,
        metadata: { bundle: '1k' },
        payment_status: paid ? 'paid' : 'unpaid',
        payment_intent: `pi_test_version_${sequence}`,
        amount_total: 400,
        currency: 'usd',
        customer_email: 'acme@example.com',
      },
    },
  };
}

async function send(value: ReturnType<typeof event>, timestamp?: number, tampered = false) {
  const payload = JSON.stringify(value);
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret, timestamp });
  return app.request('/v1/stripe/webhook', {
    method: 'POST',
    body: tampered ? `${payload} ` : payload,
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fictif_sans_compte');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Réseau interdit dans ce test'))),
  );
  resetStripeClient();
});
afterEach(() => {
  resetStripeClient();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => closeAll());

describe('Webhooks signés Dahlia et Endive, sans compte Stripe', () => {
  it.each([
    ['2026-08-26.dahlia', 'card'],
    ['2026-08-26.dahlia', 'crypto'],
    ['2026-09-30.endive', 'card'],
    ['2026-09-30.endive', 'crypto'],
  ] as const)('livre une seule clé pour %s / %s, même après rejeu', async (version, method) => {
    const value = event(version, method);
    const first = await send(value);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ credits_minted: 1000 });
    const replay = await send(value);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ idempotent: true });
    const path = `/v1/stripe/key/${value.data.object.id}`;
    const delivered = await app.request(path);
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toMatchObject({
      api_key: expect.stringMatching(/^ifk_/),
      credits_total: 1000,
    });
    expect((await app.request(path)).status).toBe(404);
    expect(
      getStatsDB()
        .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE stripe_session_id = ?')
        .get(value.data.object.id),
    ).toEqual({ n: 1 });
  });

  it('attend la confirmation d’un paiement crypto avant de livrer', async () => {
    const value = event('2026-09-30.endive', 'crypto', false);
    const pending = await send(value);
    expect(pending.status).toBe(200);
    const path = `/v1/stripe/key/${value.data.object.id}`;
    expect((await app.request(path)).status).toBe(404);
    value.id += '_paid';
    value.type = 'checkout.session.async_payment_succeeded';
    value.data.object.payment_status = 'paid';
    expect((await send(value)).status).toBe(200);
    expect((await app.request(path)).status).toBe(200);
    expect((await app.request(path)).status).toBe(404);
  });

  it.each(['ancienne', 'altérée'] as const)(
    'refuse une signature %s avant toute livraison',
    async (kind) => {
      const value = event('2026-09-30.endive', 'card');
      const response = await send(
        value,
        kind === 'ancienne' ? Math.floor(Date.now() / 1000) - 600 : undefined,
        kind === 'altérée',
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_signature' });
      expect(
        getStatsDB()
          .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE stripe_session_id = ?')
          .get(value.data.object.id),
      ).toEqual({ n: 0 });
      expect(
        getStatsDB()
          .prepare('SELECT COUNT(*) AS n FROM processed_webhooks WHERE stripe_event_id = ?')
          .get(value.id),
      ).toEqual({ n: 0 });
    },
  );
});
