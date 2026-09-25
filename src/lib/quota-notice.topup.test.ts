/**
 * Les deux alertes après une recharge de la même clé (chantier « clé unique »,
 * lot B1, 25.09.2026). L'expéditeur est remplacé par un enregistreur ; le
 * verrou, le seuil et le contact sont le chemin de production.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; remaining: number; total: number; topupRef: unknown }>,
}));

vi.mock('./email.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./email.js')>();
  return {
    ...mod,
    sendCreditsWarningEmail: vi.fn(
      async (p: { to: string; remaining: number; total: number; topupRef?: unknown }) => {
        sent.push({ to: p.to, remaining: p.remaining, total: p.total, topupRef: p.topupRef });
        return true;
      },
    ),
  };
});

import { Hono } from 'hono';
import type Stripe from 'stripe';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import { ibanValidate } from '../routes/iban-validate.js';
import { processStripeEvent } from '../routes/stripe-webhook.js';
import { buildQuotaWarningEmail } from './email.js';
import {
  generateApiKey,
  generateCreditKey,
  recordQuotaNotice,
  validateApiKey,
} from './api-keys.js';
import { ensureTopupRef } from './key-purchases.js';
import { crossesCreditsNotice, maybeSendCreditsWarning, serviceContact } from './quota-notice.js';
import { closeAll, getStatsDB } from './db.js';
import type { HonoEnv } from '../types.js';

afterAll(() => closeAll());

beforeEach(() => {
  sent.length = 0;
});

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

/** Une recharge par carte, par la référence de la clé. */
function rechargeByCard(keyHash: string, bundle: '1k' | '5k' = '1k'): void {
  const ref = ensureTopupRef(keyHash)!;
  processStripeEvent({
    id: `evt_${uniq('notice')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${uniq('notice')}`,
        metadata: { bundle },
        customer_email: null,
        customer_details: null,
        payment_status: 'paid',
        amount_total: bundle === '1k' ? 400 : 2000,
        currency: 'usd',
        client_reference_id: ref,
        payment_intent: null,
      },
    },
  } as unknown as Stripe.Event);
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('l’alerte des 10 % après une recharge', () => {
  it('verrou inchangé pour un pack déjà averti', async () => {
    const pack = generateCreditKey(`${uniq('locked')}@alpha.example.net`, 1000);
    const hash = validateApiKey(pack.api_key).keyHash;
    // Le verrou d'avant ce lot : `credits-<taille du pack>`, déjà pris.
    expect(recordQuotaNotice(hash, 'credits-1000')).toBe(true);
    const outcome = await maybeSendCreditsWarning({
      keyHash: hash,
      email: `${uniq('locked')}@alpha.example.net`,
      keyPrefix: pack.key_prefix,
      remaining: 100,
      total: 1000,
    });
    expect(outcome).toBe('already_notified');
    expect(sent).toHaveLength(0);
  });

  it('une recharge réarme l’alerte', async () => {
    const email = `${uniq('rearm')}@alpha.example.net`;
    const pack = generateCreditKey(email, 1000);
    const hash = validateApiKey(pack.api_key).keyHash;
    expect(recordQuotaNotice(hash, 'credits-1000')).toBe(true);
    rechargeByCard(hash);
    const v = validateApiKey(pack.api_key);
    expect(v.creditsTotal).toBe(2000);
    const outcome = await maybeSendCreditsWarning({
      keyHash: hash,
      email,
      keyPrefix: pack.key_prefix,
      remaining: 200,
      total: v.creditsTotal!,
      base: v.creditsNoticeBase,
    });
    expect(outcome).toBe('sent');
    // Les liens du mail rechargent CETTE clé.
    expect(sent[0].topupRef).toMatch(/^ifr_[0-9a-f]{32}$/);
  });

  it('seuil sur le solde d’après recharge, pas sur le cumul', async () => {
    const email = `${uniq('base')}@alpha.example.net`;
    const pack = generateCreditKey(email, 1000);
    const hash = validateApiKey(pack.api_key).keyHash;
    getStatsDB().prepare('UPDATE api_keys SET credits_remaining = 50 WHERE key_hash = ?').run(hash);
    rechargeByCard(hash);
    const v = validateApiKey(pack.api_key);
    expect(v.creditsRemaining).toBe(1050);
    expect(v.creditsTotal).toBe(2000);
    expect(v.creditsNoticeBase).toBe(1050);
    // 10 % de 1 050 font 105 : le seuil. Sur le cumul (2 000), il vaudrait 200.
    expect(crossesCreditsNotice(106, 105, v.creditsNoticeBase!)).toBe(true);
    expect(crossesCreditsNotice(201, 200, v.creditsNoticeBase!)).toBe(false);

    // Et par le vrai middleware : l'appel qui passe sous 105 envoie, une fois.
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 106 WHERE key_hash = ?')
      .run(hash);
    const app = new Hono<HonoEnv>();
    app.use('/v1/*', apiKeyMiddleware());
    app.route('/', ibanValidate);
    for (let i = 0; i < 2; i++) {
      await app.request('/v1/iban/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pack.api_key}` },
        body: JSON.stringify({ iban: 'CH9300762011623852957' }),
      });
      await settle();
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email, remaining: 105, total: 1050 });
  });

  it('une clé no_recredit qui a acheté n’est pas une ferme', async () => {
    const email = `${uniq('farm')}@alpha.example.net`;
    const key = generateApiKey(email)!;
    getStatsDB()
      .prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_hash = ?')
      .run(key.key_hash);
    const notPaid = await maybeSendCreditsWarning({
      keyHash: key.key_hash,
      email,
      keyPrefix: key.key_prefix,
      remaining: 10,
      total: 100,
    });
    expect(notPaid).toBe('flagged_cohort');
    rechargeByCard(key.key_hash);
    const paid = await maybeSendCreditsWarning({
      keyHash: key.key_hash,
      email,
      keyPrefix: key.key_prefix,
      remaining: 100,
      total: 1000,
    });
    expect(paid).toBe('sent');
  });
});

describe('l’alerte des 80 % d’une clé mixte', () => {
  it('dit que les crédits prennent le relais, avec les liens de la clé', () => {
    const ref = `ifr_${'c'.repeat(32)}`;
    const mixed = buildQuotaWarningEmail({
      used: 160,
      limit: 200,
      month: '2026-09',
      keyPrefix: 'ifk_12345678',
      creditsRemaining: 1000,
      topupRef: ref,
    });
    expect(mixed.text).toContain('then your 1,000 prepaid credits on this key take over');
    expect(mixed.text).not.toContain('stops until the 1st');
    expect(mixed.html).toContain('take over, without interruption');
    expect(mixed.text).toContain(`client_reference_id=${ref}`);
    expect(mixed.text).toContain('lands on this same key');
    // Une clé sans crédits garde le texte d'avant.
    const plain = buildQuotaWarningEmail({
      used: 160,
      limit: 200,
      month: '2026-09',
      keyPrefix: 'ifk_12345678',
    });
    expect(plain.text).toContain('stops until the 1st of next month');
    expect(plain.text).not.toContain('client_reference_id');
  });
});

/**
 * D6 de la relecture de sécurité de la PR 259. Le contact de service d'une clé
 * sans adresse joignable ne peut être que l'adresse saisie chez Stripe : celle
 * du corps d'un achat USDC n'est jamais vérifiée, et en faire un contact
 * laisserait n'importe qui diriger nos mails (préfixe, solde, liens de
 * recharge) vers n'importe quelle adresse.
 */
describe('le contact de service d’une clé sans adresse', () => {
  function purchaseRow(keyHash: string, keyPrefix: string, rail: 'card' | 'usdc', email: string) {
    getStatsDB()
      .prepare(
        `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix,
                                    credits, payer_email)
         VALUES (?, ?, 'pack', 'credited', ?, ?, ?, 1000, ?)`,
      )
      .run(
        `${rail === 'card' ? 'stripe' : 'x402'}:${uniq(rail)}`,
        rail,
        keyHash,
        keyHash,
        keyPrefix,
        email,
      );
  }

  it('jamais l’adresse non vérifiée d’un corps USDC', () => {
    const anon = generateApiKey(null)!;
    purchaseRow(anon.key_hash, anon.key_prefix, 'usdc', `${uniq('usdc')}@alpha.example.net`);
    expect(serviceContact(anon.key_hash, undefined)).toBeNull();
  });

  it('l’adresse saisie chez Stripe, oui', () => {
    const anon = generateApiKey(null)!;
    const email = `${uniq('card')}@alpha.example.net`;
    purchaseRow(anon.key_hash, anon.key_prefix, 'card', email);
    expect(serviceContact(anon.key_hash, undefined)).toBe(email);
  });
});
