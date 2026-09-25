/**
 * Le résumé d'affaires lit le montant d'une clé RECHARGÉE au registre des
 * achats (chantier « clé unique », lot B1, 25.09.2026). Sans cela, un cumul de
 * 2 000 crédits se lisait comme un pack de 2 000 qui n'existe pas (prix déduit,
 * pro rata), ou comme le seul premier achat de la clé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { Hono } from 'hono';
import { adminBusiness } from './admin-business.js';
import { processStripeEvent } from './stripe-webhook.js';
import { generateApiKey } from '../lib/api-keys.js';
import { ensureTopupRef } from '../lib/key-purchases.js';
import { closeAll } from '../lib/db.js';

const TOKEN = 'stats-token-for-business-registry-test';
const original = process.env.STATS_TOKEN;

beforeAll(() => {
  process.env.STATS_TOKEN = TOKEN;
});

afterAll(() => {
  process.env.STATS_TOKEN = original;
  closeAll();
});

function pay(session: string, ref: string, bundle: string, amount: number): void {
  processStripeEvent({
    id: `evt_${session}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: session,
        metadata: { bundle },
        customer_email: null,
        customer_details: null,
        payment_status: 'paid',
        amount_total: amount,
        currency: 'usd',
        client_reference_id: ref,
        payment_intent: null,
      },
    },
  } as unknown as Stripe.Event);
}

describe('/admin/business-summary et une clé rechargée', () => {
  it('additionne ce que la lignée a réellement payé, sans déduction', async () => {
    const key = generateApiKey(`business-${Date.now()}@alpha.example.net`)!;
    const ref = ensureTopupRef(key.key_hash)!;
    pay(`cs_test_business_a_${Date.now()}`, ref, '1k', 400);
    pay(`cs_test_business_b_${Date.now()}`, ref, '1k', 400);
    const app = new Hono();
    app.route('/', adminBusiness);
    const res = await app.request('/admin/business-summary', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      credits: {
        accounts: Array<{ key_prefix: string; sold: number; usd: number; amount_source: string }>;
      };
    };
    const account = body.credits.accounts.find((a) => a.key_prefix === key.key_prefix);
    expect(account).toMatchObject({ sold: 2000, usd: 8, amount_source: 'measured' });
  });
});
