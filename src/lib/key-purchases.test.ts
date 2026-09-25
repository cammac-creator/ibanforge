/**
 * Le registre des achats et la référence de recharge (chantier « clé unique »,
 * lot B1, 25.09.2026). Chaque crédit sous transaction, rejouable sans double
 * crédit (`payment_ref` unique), jamais de paiement perdu, jamais de
 * réactivation.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { createHash } from 'node:crypto';
import { processStripeEvent } from '../routes/stripe-webhook.js';
import {
  generateApiKey,
  generateCreditKey,
  revokeApiKey,
  rotateApiKey,
  validateApiKey,
} from './api-keys.js';
import {
  clawbackPurchase,
  ensureTopupRef,
  findPurchaseByRef,
  resolveTopupRef,
  topupRefFor,
} from './key-purchases.js';
import { closeAll, getStatsDB } from './db.js';

afterAll(() => closeAll());

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

function freeKey(tag: string): { api_key: string; key_prefix: string; key_hash: string } {
  const k = generateApiKey(`${uniq(tag)}@alpha.example.net`);
  if (!k) throw new Error('frappe impossible');
  return k;
}

function hashOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Un évènement de paiement Stripe, réduit à ce que le webhook lit. */
function packEvent(opts: {
  id?: string;
  type?: string;
  sessionId: string;
  bundle?: string;
  ref?: string | null;
  email?: string | null;
  amountTotal?: number | null;
}): Stripe.Event {
  return {
    id: opts.id ?? `evt_${uniq('pack')}`,
    type: opts.type ?? 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { bundle: opts.bundle ?? '1k' },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: 'paid',
        amount_total: opts.amountTotal === undefined ? 400 : opts.amountTotal,
        currency: 'usd',
        client_reference_id: opts.ref ?? null,
        payment_intent: `pi_${opts.sessionId}`,
      },
    },
  } as unknown as Stripe.Event;
}

function purchasesOf(sessionId: string): number {
  return (
    getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM key_purchases WHERE payment_ref = ?')
      .get(`stripe:${sessionId}`) as { n: number }
  ).n;
}

describe('la référence de recharge', () => {
  it('n’est jamais dérivée de la clé : tirée au hasard, stable, une par lignée', () => {
    const a = freeKey('ref-a');
    const b = freeKey('ref-b');
    const ra = ensureTopupRef(a.key_hash)!;
    const rb = ensureTopupRef(b.key_hash)!;
    expect(ra).toMatch(/^ifr_[0-9a-f]{32}$/);
    expect(rb).toMatch(/^ifr_[0-9a-f]{32}$/);
    expect(ra).not.toBe(rb);
    // Rien de la clé, de son hash ni de son préfixe ne s'y lit.
    for (const piece of [a.api_key.slice(4, 36), a.key_hash.slice(0, 32), a.key_prefix.slice(4)]) {
      expect(ra).not.toContain(piece);
    }
    expect(ra.slice(4)).not.toBe(hashOf(ra.slice(4)).slice(0, 32));
    // Stable : une seconde demande rend la même, sans nouvelle ligne.
    expect(ensureTopupRef(a.key_hash)).toBe(ra);
    const rows = getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM key_topup_refs WHERE lineage_hash = ?')
      .get(a.key_hash) as { n: number };
    expect(rows.n).toBe(1);
  });

  it('suit la rotation : la même référence mène à la clé tournée', () => {
    const key = freeKey('rotate');
    const ref = ensureTopupRef(key.key_hash)!;
    const rotated = rotateApiKey(key.api_key)!;
    expect(topupRefFor(rotated.key_hash)).toBe(ref);
    const target = resolveTopupRef(ref);
    expect(target).toMatchObject({ ok: true, keyHash: rotated.key_hash });
    // Et un paiement par ce lien d'un ancien mail recharge la clé d'aujourd'hui.
    const session = `cs_test_${uniq('rot')}`;
    const result = processStripeEvent(packEvent({ sessionId: session, ref }));
    expect(result.body.topup).toMatchObject({
      key_prefix: rotated.key_prefix,
      outcome: 'credited',
    });
    expect(validateApiKey(rotated.api_key).creditsRemaining).toBe(1000);
    expect(validateApiKey(key.api_key).valid).toBe(false);
  });

  it('une forme inconnue n’est jamais résolue', () => {
    expect(resolveTopupRef('ifr_nope')).toEqual({ ok: false, reason: 'malformed_ref' });
    expect(resolveTopupRef(`ifr_${'0'.repeat(32)}`)).toEqual({
      ok: false,
      reason: 'unknown_ref',
    });
  });
});

describe('le webhook carte et le registre', () => {
  it('une session rejouée ne crédite qu’une fois', () => {
    const key = freeKey('replay');
    const ref = ensureTopupRef(key.key_hash)!;
    const session = `cs_test_${uniq('replay')}`;
    const event = packEvent({ sessionId: session, ref });
    const first = processStripeEvent(event);
    expect(first.body.topup).toMatchObject({ outcome: 'credited', credits_added: 1000 });
    expect(first.recharge).toBeDefined();
    // Stripe rejoue le même évènement : la barrière des évènements traités.
    const second = processStripeEvent(event);
    expect(second.body.idempotent).toBe(true);
    expect(second.recharge).toBeUndefined();
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
    expect(purchasesOf(session)).toBe(1);
  });

  it('async_payment_succeeded après completed ne crédite pas deux fois', () => {
    const key = freeKey('async');
    const ref = ensureTopupRef(key.key_hash)!;
    const session = `cs_test_${uniq('async')}`;
    processStripeEvent(packEvent({ sessionId: session, ref }));
    // Même session, AUTRE identifiant d'évènement : la barrière des évènements
    // ne l'arrête pas, le registre si.
    const late = processStripeEvent(
      packEvent({ sessionId: session, ref, type: 'checkout.session.async_payment_succeeded' }),
    );
    expect(late.body.idempotent).toBe(true);
    expect(late.recharge).toBeUndefined();
    expect(late.notify).toBeUndefined();
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
    expect(purchasesOf(session)).toBe(1);
  });

  it('référence inconnue : une clé neuve, remise au payeur, et une alerte', () => {
    const session = `cs_test_${uniq('unknown')}`;
    const result = processStripeEvent(
      packEvent({ sessionId: session, ref: `ifr_${'1'.repeat(32)}`, email: 'acme@example.com' }),
    );
    expect(result.body.topup).toMatchObject({
      outcome: 'minted_fallback',
      fallback_reason: 'unknown_ref',
    });
    expect(result.notify?.rawKey).toMatch(/^ifk_/);
    expect(result.alert?.key).toMatch(/^stripe:topup-fallback:/);
    // Ni adresse ni référence dans le texte de l'alerte (Telegram n'est pas un
    // sous-traitant déclaré).
    expect(result.alert?.detail).not.toContain('acme@example.com');
    expect(result.alert?.detail).not.toContain('ifr_');
    expect(findPurchaseByRef(`stripe:${session}`)?.outcome).toBe('minted_fallback');
  });

  it('référence mal formée : traitée comme absente, une clé neuve et aucune alerte (relecture de la PR 259, D8)', () => {
    const session = `cs_test_${uniq('malformed')}`;
    // N'importe quel payeur peut retoucher l'URL du lien de paiement : ce n'est
    // pas un paiement perdu, seulement une référence qui ne désigne rien.
    const result = processStripeEvent(packEvent({ sessionId: session, ref: 'ifr_retouchee' }));
    expect(result.alert).toBeUndefined();
    expect(result.notify?.rawKey).toMatch(/^ifk_/);
    const row = findPurchaseByRef(`stripe:${session}`)!;
    expect(row.outcome).toBe('minted');
    expect(row.topup_ref).toBeNull();
  });

  it('clé révoquée : une clé neuve, et la révoquée n’est jamais réactivée', () => {
    const key = freeKey('revoked');
    const ref = ensureTopupRef(key.key_hash)!;
    expect(revokeApiKey(key.api_key)).toBe(true);
    const session = `cs_test_${uniq('revoked')}`;
    const result = processStripeEvent(packEvent({ sessionId: session, ref }));
    expect(result.body.topup).toMatchObject({
      outcome: 'minted_fallback',
      fallback_reason: 'no_active_key',
    });
    expect(validateApiKey(key.api_key).valid).toBe(false);
    const row = getStatsDB()
      .prepare('SELECT active, credits_remaining FROM api_keys WHERE key_hash = ?')
      .get(key.key_hash) as { active: number; credits_remaining: number | null };
    expect(row).toEqual({ active: 0, credits_remaining: null });
  });

  it('deux clés actives sur une lignée : repli, jamais un crédit deviné', () => {
    const a = freeKey('twin-a');
    const b = freeKey('twin-b');
    // Une anomalie fabriquée : deux clés actives revendiquent la même lignée.
    getStatsDB()
      .prepare('UPDATE api_keys SET lineage_hash = ? WHERE key_hash = ?')
      .run(a.key_hash, b.key_hash);
    const ref = ensureTopupRef(a.key_hash)!;
    expect(resolveTopupRef(ref)).toEqual({ ok: false, reason: 'ambiguous' });
    const result = processStripeEvent(packEvent({ sessionId: `cs_test_${uniq('twin')}`, ref }));
    expect(result.body.topup).toMatchObject({
      outcome: 'minted_fallback',
      fallback_reason: 'ambiguous',
    });
    expect(validateApiKey(a.api_key).creditsRemaining).toBeUndefined();
    expect(validateApiKey(b.api_key).creditsRemaining).toBeUndefined();
  });

  it('une recharge par carte n’écrit jamais l’adresse du payeur dans la clé', () => {
    const key = freeKey('payer');
    const before = getStatsDB()
      .prepare('SELECT email, email_norm FROM api_keys WHERE key_hash = ?')
      .get(key.key_hash);
    const ref = ensureTopupRef(key.key_hash)!;
    const session = `cs_test_${uniq('payer')}`;
    processStripeEvent(packEvent({ sessionId: session, ref, email: 'acme@example.com' }));
    expect(
      getStatsDB()
        .prepare('SELECT email, email_norm FROM api_keys WHERE key_hash = ?')
        .get(key.key_hash),
    ).toEqual(before);
    expect(findPurchaseByRef(`stripe:${session}`)?.payer_email).toBe('acme@example.com');
  });
});

describe('le rattrapage depuis api_keys', () => {
  it('est rejouable et n’invente aucun montant USDC', () => {
    const db = getStatsDB();
    const usdcRef = createHash('sha256').update(uniq('usdc')).digest('hex').slice(0, 32);
    const session = `cs_test_${uniq('legacy')}`;
    // Deux clés nées d'un achat avant le registre : aucune ligne pour elles.
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, tier, credits_remaining, credits_total,
                             x402_payment_ref, lineage_hash)
       VALUES (?, ?, 'credits-buyer', 'paid', 700, 1000, ?, ?)`,
    ).run('h-usdc-' + usdcRef, `ifk_u${usdcRef.slice(0, 7)}`, usdcRef, 'h-usdc-' + usdcRef);
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, tier, credits_remaining, credits_total,
                             stripe_session_id, amount_paid_minor, amount_paid_currency, lineage_hash)
       VALUES (?, ?, 'acme@example.com', 'paid', 5000, 5000, ?, 2000, 'usd', ?)`,
    ).run('h-card-' + session, `ifk_c${usdcRef.slice(7, 14)}`, session, 'h-card-' + session);
    // L'ouverture de la base rejoue la migration.
    closeAll();
    getStatsDB();
    const usdc = findPurchaseByRef(`x402:${usdcRef}`)!;
    expect(usdc).toMatchObject({
      rail: 'usdc',
      kind: 'pack',
      outcome: 'minted',
      credits: 1000,
      amount_minor: null,
      currency: null,
      quoted_amount_usd: null,
      backfilled: 1,
    });
    const card = findPurchaseByRef(`stripe:${session}`)!;
    expect(card).toMatchObject({
      rail: 'card',
      credits: 5000,
      amount_minor: 2000,
      currency: 'usd',
    });
    const count = () =>
      (getStatsDB().prepare('SELECT COUNT(*) AS n FROM key_purchases').get() as { n: number }).n;
    const before = count();
    closeAll();
    getStatsDB();
    expect(count()).toBe(before);
  });
});

describe('la reprise d’un pack remboursé ou disputé', () => {
  it('est bornée aux crédits de cet achat, jamais sous zéro, et idempotente', () => {
    const key = freeKey('clawback');
    const ref = ensureTopupRef(key.key_hash)!;
    const s1 = `cs_test_${uniq('claw1')}`;
    const s2 = `cs_test_${uniq('claw2')}`;
    processStripeEvent(packEvent({ sessionId: s1, ref, bundle: '1k' }));
    processStripeEvent(packEvent({ sessionId: s2, ref, bundle: '5k', amountTotal: 2000 }));
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(6000);
    const first = findPurchaseByRef(`stripe:${s1}`)!;
    const result = clawbackPurchase(first.id, 'refunded');
    expect(result).toMatchObject({ status: 'clawed_back', removed: 1000 });
    const v = validateApiKey(key.api_key);
    expect(v.creditsRemaining).toBe(5000);
    // Le cumul baisse d'autant : « consommé = total − restant » reste juste.
    expect(v.creditsTotal).toBe(5000);
    expect(clawbackPurchase(first.id, 'refunded')).toMatchObject({ status: 'unchanged' });
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(5000);

    // Un solde entamé : jamais sous zéro, et seulement ce qui reste.
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 300 WHERE key_hash = ?')
      .run(key.key_hash);
    const second = findPurchaseByRef(`stripe:${s2}`)!;
    expect(clawbackPurchase(second.id, 'disputed')).toMatchObject({
      status: 'clawed_back',
      removed: 300,
    });
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(0);
    expect(validateApiKey(key.api_key).valid).toBe(true);
  });

  it('baisse aussi l’assiette de l’alerte des 10 % (relecture de la PR 259)', () => {
    const key = freeKey('claw-base');
    const ref = ensureTopupRef(key.key_hash)!;
    const s1 = `cs_test_${uniq('claw-base1')}`;
    const s2 = `cs_test_${uniq('claw-base2')}`;
    processStripeEvent(packEvent({ sessionId: s1, ref, bundle: '1k' }));
    processStripeEvent(packEvent({ sessionId: s2, ref, bundle: '5k', amountTotal: 2000 }));
    expect(validateApiKey(key.api_key).creditsNoticeBase).toBe(6000);
    clawbackPurchase(findPurchaseByRef(`stripe:${s2}`)!.id, 'refunded');
    const v = validateApiKey(key.api_key);
    expect(v.creditsRemaining).toBe(1000);
    // L'alerte se mesure sur ce qui reste vraiment acheté, pas sur un pack repris.
    expect(v.creditsNoticeBase).toBe(1000);
  });

  it('refuse un abonnement et un achat jamais réglé', () => {
    const k = generateCreditKey(null, 1000);
    void k;
    const db = getStatsDB();
    db.prepare(
      `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix)
       VALUES (?, 'usdc', 'pack', 'pending', 'l', 'h', 'ifk_pending')`,
    ).run(`x402:${uniq('pending')}`);
    const pending = db
      .prepare("SELECT id FROM key_purchases WHERE key_prefix = 'ifk_pending'")
      .get() as { id: number };
    expect(clawbackPurchase(pending.id, 'refunded')).toMatchObject({ status: 'not_settled' });
    db.prepare(
      `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix)
       VALUES (?, 'card', 'subscription', 'minted', 'l', 'h', 'ifk_subscri')`,
    ).run(`stripe:${uniq('sub')}`);
    const sub = db
      .prepare("SELECT id FROM key_purchases WHERE key_prefix = 'ifk_subscri'")
      .get() as { id: number };
    expect(clawbackPurchase(sub.id, 'refunded')).toMatchObject({ status: 'not_a_pack' });
  });
});
