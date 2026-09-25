/**
 * Le webhook carte du lot B1 (chantier « clé unique », 25.09.2026) : un pack
 * payé avec la référence d'une clé la recharge, et seules les issues réelles
 * produisent une notification.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { Hono } from 'hono';
import { processStripeEvent, STRIPE_BUNDLES } from './stripe-webhook.js';
import { stripeRetrieve } from './stripe-retrieve.js';
import { generateApiKey, validateApiKey } from '../lib/api-keys.js';
import { ensureTopupRef, findPurchaseByRef } from '../lib/key-purchases.js';
import { closeAll, getStatsDB } from '../lib/db.js';

afterAll(() => closeAll());

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

function packEvent(opts: {
  sessionId: string;
  bundle?: string;
  ref?: string | null;
  email?: string | null;
  amountTotal?: number | null;
  currency?: string;
}): Stripe.Event {
  return {
    id: `evt_${uniq('topup')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { bundle: opts.bundle ?? '1k' },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: 'paid',
        amount_total: opts.amountTotal === undefined ? 400 : opts.amountTotal,
        currency: opts.currency ?? 'usd',
        client_reference_id: opts.ref ?? null,
        payment_intent: `pi_${opts.sessionId}`,
      },
    },
  } as unknown as Stripe.Event;
}

describe('recharge par référence', () => {
  it('crédite la clé de la référence, sans en frapper une neuve', () => {
    const key = generateApiKey(`${uniq('card')}@alpha.example.net`)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const keysBefore = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }
    ).n;
    const session = `cs_test_${uniq('card')}`;
    const result = processStripeEvent(
      packEvent({ sessionId: session, ref, bundle: '5k', amountTotal: 2000 }),
    );
    expect(result.status).toBe(200);
    expect(result.body.topup).toEqual({
      key_prefix: key.key_prefix,
      credits_added: 5000,
      outcome: 'credited',
    });
    expect(result.body.key_prefix).toBeUndefined();
    expect(result.notify).toBeUndefined();
    expect(
      (getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }).n,
    ).toBe(keysBefore);
    const v = validateApiKey(key.api_key);
    expect(v.creditsRemaining).toBe(5000);
    // Règle A : une clé gratuite rechargée garde son gratuit.
    expect(v.monthlyLimit).toBe(200);
    const p = findPurchaseByRef(`stripe:${session}`)!;
    expect(p).toMatchObject({
      outcome: 'credited',
      rail: 'card',
      amount_minor: 2000,
      stripe_payment_intent: `pi_${session}`,
      topup_ref: ref,
    });
  });

  it('une clé anonyme rechargée par carte passe au palier payant, sans gratuit', () => {
    const key = generateApiKey(null)!;
    const ref = ensureTopupRef(key.key_hash)!;
    processStripeEvent(packEvent({ sessionId: `cs_test_${uniq('anon')}`, ref }));
    const row = getStatsDB()
      .prepare(
        'SELECT tier, monthly_limit, no_recredit, claim_method, credits_remaining FROM api_keys WHERE key_hash = ?',
      )
      .get(key.key_hash);
    expect(row).toEqual({
      tier: 'paid',
      monthly_limit: 0,
      no_recredit: 0,
      claim_method: 'stripe',
      credits_remaining: 1000,
    });
  });
});

describe('notification seulement sur insertion réelle', () => {
  it('une recharge annonce une fois, un rejeu jamais', () => {
    const key = generateApiKey(`${uniq('notify')}@alpha.example.net`)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const event = packEvent({ sessionId: `cs_test_${uniq('notify')}`, ref });
    const first = processStripeEvent(event);
    expect(first.recharge).toMatchObject({
      keyPrefix: key.key_prefix,
      creditsAdded: 1000,
      balance: 1000,
      bundle: '1k',
    });
    // Le contact de service : l'adresse joignable de la clé.
    expect(first.recharge?.to).toContain('@alpha.example.net');
    const again = processStripeEvent(event);
    expect(again.recharge).toBeUndefined();
    expect(again.notify).toBeUndefined();
  });

  it('une clé sans adresse joignable reçoit la recharge à l’adresse du payeur', () => {
    const key = generateApiKey(null)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const result = processStripeEvent(
      packEvent({ sessionId: `cs_test_${uniq('payer')}`, ref, email: 'acme@example.com' }),
    );
    expect(result.recharge?.to).toBe('acme@example.com');
  });
});

describe('montant de la notification = amount_total (constat C3)', () => {
  it('annonce ce que Stripe a encaissé, pas un tarif', () => {
    expect(STRIPE_BUNDLES['1k'].price_usd).toBe(4);
    const minted = processStripeEvent(
      packEvent({ sessionId: `cs_test_${uniq('c3')}`, amountTotal: 350 }),
    );
    expect(minted.notify?.priceUsd).toBe(3.5);
    const key = generateApiKey(`${uniq('c3r')}@alpha.example.net`)!;
    const recharged = processStripeEvent(
      packEvent({
        sessionId: `cs_test_${uniq('c3r')}`,
        ref: ensureTopupRef(key.key_hash)!,
        amountTotal: 400,
      }),
    );
    expect(recharged.recharge?.amountUsd).toBe(4);
    // Une devise autre que le dollar : le prix du pack, faute de mieux.
    const eur = processStripeEvent(
      packEvent({ sessionId: `cs_test_${uniq('c3e')}`, amountTotal: 380, currency: 'eur' }),
    );
    expect(eur.notify?.priceUsd).toBe(4);
  });
});

describe('bundle inconnu : alerte (constat C6)', () => {
  it('répond comme avant, ne frappe rien, et lance une alerte sans donnée client', () => {
    const before = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }
    ).n;
    const result = processStripeEvent(
      packEvent({
        sessionId: `cs_test_${uniq('c6')}`,
        bundle: 'mystery',
        email: 'acme@example.com',
      }),
    );
    expect(result.body).toMatchObject({
      received: true,
      error: 'unknown_bundle',
      bundle: 'mystery',
    });
    expect(result.alert?.key).toMatch(/^stripe:unknown-bundle:/);
    expect(result.alert?.detail).not.toContain('acme@example.com');
    expect(result.alert?.detail).not.toContain('cs_test_');
    expect(
      (getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }).n,
    ).toBe(before);
  });
});

describe('la page de succès reçoit recharged', () => {
  it('sert le préfixe et les crédits ajoutés, jamais la clé ni le solde', async () => {
    const key = generateApiKey(`${uniq('success')}@alpha.example.net`)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const session = `cs_test_${uniq('success')}`;
    processStripeEvent(packEvent({ sessionId: session, ref }));
    const app = new Hono();
    app.route('/', stripeRetrieve);
    const res = await app.request(`/v1/stripe/key/${session}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      recharged: true,
      key_prefix: key.key_prefix,
      credits_added: 1000,
    });
    expect(body.api_key).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('credits_remaining');
    expect(JSON.stringify(body)).not.toContain(key.api_key);
    // Relisible : aucun secret n'y est, la page peut se recharger.
    expect((await app.request(`/v1/stripe/key/${session}`)).status).toBe(200);
  });

  it('une clé neuve reste servie une seule fois, comme avant', async () => {
    const session = `cs_test_${uniq('fresh')}`;
    processStripeEvent(packEvent({ sessionId: session }));
    const app = new Hono();
    app.route('/', stripeRetrieve);
    const first = (await (await app.request(`/v1/stripe/key/${session}`)).json()) as {
      api_key?: string;
      plan?: string;
    };
    expect(first.api_key).toMatch(/^ifk_/);
    expect(first.plan).toBe('credits');
    expect((await app.request(`/v1/stripe/key/${session}`)).status).toBe(404);
  });
});
