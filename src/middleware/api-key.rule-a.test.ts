/**
 * La règle A (décision du 24.09.2026, chantier « clé unique », lot B1) : quand
 * le client cesse de payer, la clé reste valable. Née d'un achat, elle répond
 * « paiement requis » (402) avec les liens pour la recharger ELLE-MÊME ; si elle
 * avait un gratuit ouvert par une adresse, elle le retrouve. Un achat ne crée
 * jamais de gratuit.
 *
 * Par l'application assemblée, en mode payant : c'est le seul endroit où le
 * 402 réel (corps enrichi, en-têtes) se lit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { buildApp } from '../app.js';
import { resetX402Paywall } from './x402.js';
import {
  creditKeyInTx,
  generateApiKey,
  generateCreditKey,
  validateApiKey,
} from '../lib/api-keys.js';
import { ensureTopupRef } from '../lib/key-purchases.js';
import { processStripeEvent } from '../routes/stripe-webhook.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { startFakeFacilitator, type FakeFacilitator } from '../test-support/fake-facilitator.js';

const VALID_IBAN = 'CH9300762011623852957';
const MONTH = () => new Date().toISOString().slice(0, 7);
let facilitator: FakeFacilitator;
const originalEnv = { ...process.env };
let ip = 0;

beforeAll(async () => {
  facilitator = await startFakeFacilitator();
});

afterAll(async () => {
  await facilitator.close();
  process.env = originalEnv;
  closeAll();
});

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = '0x00000000000000000000000000000000000000A1';
  process.env.FACILITATOR_URL = facilitator.url;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
});

async function call(key: string, path = '/v1/iban/validate', body: unknown = { iban: VALID_IBAN }) {
  ip += 1;
  return buildApp().request(`https://api.ibanforge.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'x-real-ip': `192.0.2.${(ip % 250) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

describe('la règle A', () => {
  it('clé née d’un achat à zéro : 402 avec les liens de CETTE clé', async () => {
    const pack = generateCreditKey(null, 1);
    expect((await call(pack.api_key)).status).toBe(200);
    const res = await call(pack.api_key);
    expect(res.status).toBe(402);
    const ref = ensureTopupRef(validateApiKey(pack.api_key).keyHash)!;
    expect(ref).toMatch(/^ifr_[0-9a-f]{32}$/);
    // Les en-têtes : un lien à ouvrir, pas une phrase à analyser.
    expect(res.headers.get('x-credits-exhausted')).toBe('true');
    expect(res.headers.get('x-credits-remaining')).toBe('0');
    expect(res.headers.get('x-credits-total')).toBe('1');
    expect(res.headers.get('x-credits-topup-url')).toBe(
      `https://buy.stripe.com/bJe3coeZb31P6CsamK8so05?client_reference_id=${ref}`,
    );
    expect(res.headers.get('x-credits-topup-hint')).toMatch(/the credits land on this key/);
    const body = (await res.json()) as {
      cause: { reason: string; detail: string; credits: { topup: string; total: number } };
      credit_packs: { topup_this_key: { by_card: Record<string, string> }; pay_by_card: string };
    };
    expect(body.cause.reason).toBe('credits_exhausted');
    expect(body.cause.detail).toContain('Recharge THIS key');
    expect(body.cause.detail).toContain(`client_reference_id=${ref}`);
    expect(body.cause.detail).toContain('The key stays valid');
    expect(body.cause.credits.topup).toContain(ref);
    expect(body.credit_packs.topup_this_key.by_card['5k']).toContain(ref);
    // `pay_by_card` garde son sens : un achat sans référence, une clé neuve.
    expect(body.credit_packs.pay_by_card).not.toContain('client_reference_id');
  });

  it('clé gratuite rechargée à zéro : retombe sur son gratuit', async () => {
    const free = generateApiKey(`rule-a-${Date.now()}@alpha.example.net`)!;
    const db = getStatsDB();
    db.transaction(() => creditKeyInTx(db, free.key_hash, 1))();
    // Allocation épuisée : le crédit paie l'appel.
    db.prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 200)').run(
      free.key_hash,
      MONTH(),
    );
    const onCredit = await call(free.api_key);
    expect(onCredit.status).toBe(200);
    expect(onCredit.headers.get('x-charged-from')).toBe('credits');
    expect(validateApiKey(free.api_key).creditsRemaining).toBe(0);
    // Crédits à zéro, allocation épuisée : le mur mensuel, avec les liens de la
    // clé. Le 1er du mois suivant, son gratuit revient.
    const wall = await call(free.api_key);
    expect(wall.status).toBe(402);
    const body = (await wall.json()) as {
      cause: { reason: string; detail: string; quota: { limit: number } };
    };
    expect(body.cause.reason).toBe('monthly_quota_exhausted');
    expect(body.cause.quota.limit).toBe(200);
    expect(body.cause.detail).toContain('it resets on the 1st of next month');
    expect(body.cause.detail).toContain('Recharge THIS key');
    // Et le mois suivant (simulé en vidant le mois courant), le gratuit sert.
    db.prepare('UPDATE api_usage SET count = 0 WHERE key_hash = ? AND month = ?').run(
      free.key_hash,
      MONTH(),
    );
    const nextMonth = await call(free.api_key);
    expect(nextMonth.status).toBe(200);
    expect(nextMonth.headers.get('x-charged-from')).toBe('allowance');
  });

  it('clé anonyme payante : pas de 25 par mois, 409 à la réclamation', async () => {
    const anon = generateApiKey(null)!;
    const ref = ensureTopupRef(anon.key_hash)!;
    const event = {
      id: `evt_rule_a_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_rule_a_${Date.now()}`,
          metadata: { bundle: '1k' },
          customer_email: null,
          customer_details: null,
          payment_status: 'paid',
          amount_total: 400,
          currency: 'usd',
          client_reference_id: ref,
          payment_intent: null,
        },
      },
    } as unknown as Stripe.Event;
    processStripeEvent(event);
    const v = validateApiKey(anon.api_key);
    expect(v.tier).toBe('paid');
    expect(v.monthlyLimit).toBe(0);
    expect(v.creditsRemaining).toBe(1000);
    // Vidée, elle ne retombe sur aucun gratuit (ZG1) : 402 crédits épuisés.
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 0 WHERE key_hash = ?')
      .run(anon.key_hash);
    const res = await call(anon.api_key);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { cause: { reason: string } };
    expect(body.cause.reason).toBe('credits_exhausted');
    // La réclamation par code lui est fermée (ZG7) : elle a quitté le palier anonyme.
    ip += 1;
    const claim = await buildApp().request('https://api.ibanforge.com/v1/keys/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon.api_key}`,
        'x-real-ip': `192.0.2.${(ip % 250) + 1}`,
      },
      body: JSON.stringify({ email: 'acme@example.com' }),
    });
    expect(claim.status).toBe(409);
    expect(((await claim.json()) as { error: string }).error).toBe('already_claimed');
  });

  it('une clé anonyme qui n’a pas payé voit l’avertissement avant d’acheter', async () => {
    const anon = generateApiKey(null)!;
    getStatsDB()
      .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 25)')
      .run(anon.key_hash, MONTH());
    const res = await call(anon.api_key);
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      credit_packs: { topup_this_key: { note?: string } };
    };
    expect(body.credit_packs.topup_this_key.note).toMatch(/Claim it by e-mail first/);
  });
});
