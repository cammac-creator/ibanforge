/**
 * L'abonnement sur la même clé (chantier « clé unique », lot B2, 25.09.2026 ;
 * décisions de Claude-Alain du 24.09.2026, règle A et phrases Q11) :
 *
 *  - le lien Pro porteur de la référence de recharge d'une clé pose
 *    l'abonnement sur CETTE clé (T4), l'allocation Pro remplace l'allocation
 *    propre pendant l'abonnement, puis viennent les crédits (règle B) ;
 *  - la fin de l'abonnement ne désactive plus la clé (T5) : elle retrouve ce
 *    qu'elle avait avant (0 pour une clé née de lui, qui répond alors 402 avec
 *    ses liens), garde ses crédits et son identifiant d'abonnement ;
 *  - jamais deux abonnements vivants sur une clé (ZG10), la pierre tombale
 *    tient l'ordre des évènements, une clé tournée est retrouvée par sa lignée.
 *
 * Adresses inventées, sur alpha.example.net (example.com est rangé parmi les
 * comptes internes, exclus des revenus).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { processStripeEvent } from './stripe-webhook.js';
import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import {
  generateApiKey,
  PRO_MONTHLY_LIMIT,
  revokeApiKey,
  rotateApiKey,
  validateApiKey,
} from '../lib/api-keys.js';
import { ensureTopupRef, findPurchaseByRef } from '../lib/key-purchases.js';
import {
  buildSubscriptionAttachedEmail,
  buildSubscriptionEndedEmail,
  buildProKeyEmail,
  PRO_CANCELLATION_SENTENCE,
} from '../lib/email.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { startFakeFacilitator, type FakeFacilitator } from '../test-support/fake-facilitator.js';

const VALID_IBAN = 'CH9300762011623852957';
const MONTH = () => new Date().toISOString().slice(0, 7);
let facilitator: FakeFacilitator;
const originalEnv = { ...process.env };
let ip = 0;
let seq = 0;

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

function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

function keyCount(): number {
  return (getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }).n;
}

function freeKey(tag: string) {
  const key = generateApiKey(`${uniq(tag)}@alpha.example.net`);
  if (!key) throw new Error('frappe impossible');
  return key;
}

/** Un abonnement payé au Checkout, réduit à ce que le webhook lit. */
function proCheckout(opts: {
  sessionId: string;
  subscriptionId: string | null;
  ref?: string | null;
  email?: string | null;
  plan?: 'pro' | 'oem';
  paymentIntent?: string | null;
}): Stripe.Event {
  return {
    id: `evt_${uniq('sub')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { plan: opts.plan ?? 'pro' },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: 'paid',
        mode: 'subscription',
        subscription: opts.subscriptionId,
        amount_total: opts.plan === 'oem' ? 14900 : 2900,
        currency: 'usd',
        client_reference_id: opts.ref ?? null,
        // Une session d'abonnement n'a pas d'intention de paiement : c'est la
        // facture qui en porte une.
        payment_intent: opts.paymentIntent ?? null,
      },
    },
  } as unknown as Stripe.Event;
}

function packCheckout(opts: { sessionId: string; ref: string }): Stripe.Event {
  return {
    id: `evt_${uniq('pack')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { bundle: '1k' },
        customer_email: null,
        customer_details: null,
        payment_status: 'paid',
        amount_total: 400,
        currency: 'usd',
        client_reference_id: opts.ref,
        payment_intent: `pi_${opts.sessionId}`,
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionDeleted(subscriptionId: string): Stripe.Event {
  return {
    id: `evt_${uniq('deleted')}`,
    type: 'customer.subscription.deleted',
    data: { object: { id: subscriptionId } },
  } as unknown as Stripe.Event;
}

function renewalPaid(subscriptionId: string): Stripe.Event {
  return {
    id: `evt_${uniq('invoice')}`,
    type: 'invoice.paid',
    created: 1893456000,
    data: {
      object: {
        id: `in_${uniq('invoice')}`,
        object: 'invoice',
        billing_reason: 'subscription_cycle',
        amount_paid: 2900,
        currency: 'usd',
        status: 'paid',
        status_transitions: { paid_at: 1893459600 },
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: subscriptionId, metadata: {} },
          quote_details: null,
        },
      },
    },
  } as unknown as Stripe.Event;
}

function keyRow(keyHash: string) {
  return getStatsDB()
    .prepare(
      `SELECT active, monthly_limit, no_recredit, tier, stripe_subscription_id,
              subscription_ended_at, credits_remaining
         FROM api_keys WHERE key_hash = ?`,
    )
    .get(keyHash) as {
    active: number;
    monthly_limit: number | null;
    no_recredit: number;
    tier: string;
    stripe_subscription_id: string | null;
    subscription_ended_at: string | null;
    credits_remaining: number | null;
  };
}

async function call(key: string) {
  ip += 1;
  return buildApp().request('https://api.ibanforge.com/v1/iban/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'x-real-ip': `198.51.100.${(ip % 250) + 1}`,
    },
    body: JSON.stringify({ iban: VALID_IBAN }),
  });
}

/** Une clé gratuite (200 par mois), rechargée d'un pack de 1 000 crédits, puis Pro par sa référence. */
function freeKeyWithPackThenPro(tag: string) {
  const key = freeKey(tag);
  const ref = ensureTopupRef(key.key_hash)!;
  processStripeEvent(packCheckout({ sessionId: `cs_test_${uniq(`${tag}-pack`)}`, ref }));
  const sessionId = `cs_test_${uniq(`${tag}-pro`)}`;
  const subscriptionId = `sub_test_${uniq(tag)}`;
  const keysBeforePro = keyCount();
  const attached = processStripeEvent(proCheckout({ sessionId, subscriptionId, ref }));
  return { key, ref, sessionId, subscriptionId, attached, keysBeforePro };
}

describe('Pro sur une clé existante (T4)', () => {
  it('Pro sur clé gratuite : 10 000 puis crédits', async () => {
    const { key, ref, sessionId, subscriptionId, attached, keysBeforePro } =
      freeKeyWithPackThenPro('attach');
    expect(attached.status).toBe(200);
    expect(attached.body.attached).toEqual({ key_prefix: key.key_prefix, outcome: 'attached' });
    expect(attached.body.monthly_limit).toBe(PRO_MONTHLY_LIMIT);
    // Aucune clé frappée, aucune clé brute à remettre.
    expect(attached.notify).toBeUndefined();
    expect(keyCount()).toBe(keysBeforePro);
    expect(attached.subscription).toMatchObject({
      kind: 'attached',
      keyPrefix: key.key_prefix,
      plan: 'pro',
      monthlyLimit: PRO_MONTHLY_LIMIT,
      amountUsd: 29,
    });
    expect(attached.subscription?.to).toContain('@alpha.example.net');

    const v = validateApiKey(key.api_key);
    expect(v.monthlyLimit).toBe(PRO_MONTHLY_LIMIT);
    expect(v.creditsRemaining).toBe(1000);
    expect(keyRow(key.key_hash)).toMatchObject({
      stripe_subscription_id: subscriptionId,
      subscription_ended_at: null,
      no_recredit: 0,
      active: 1,
    });
    // La photo : ce que la clé avait AVANT l'abonnement, que la fin rendra.
    expect(findPurchaseByRef(`stripe:${sessionId}`)).toMatchObject({
      kind: 'subscription',
      outcome: 'attached',
      prev_monthly_limit: 200,
      prev_no_recredit: 0,
      stripe_subscription_id: subscriptionId,
      topup_ref: ref,
      amount_minor: 2900,
    });

    // Règle B : l'allocation Pro d'abord, puis les crédits.
    const first = await call(key.api_key);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-charged-from')).toBe('allowance');
    getStatsDB()
      .prepare(
        `INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)
         ON CONFLICT (key_hash, month) DO UPDATE SET count = excluded.count`,
      )
      .run(key.key_hash, MONTH(), PRO_MONTHLY_LIMIT);
    const second = await call(key.api_key);
    expect(second.status).toBe(200);
    expect(second.headers.get('x-charged-from')).toBe('credits');
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(999);
  });

  it('un rejeu de la même session ne pose rien de plus et n’annonce rien', () => {
    const { key, sessionId, subscriptionId } = freeKeyWithPackThenPro('attach-replay');
    const again = processStripeEvent(
      proCheckout({ sessionId, subscriptionId, ref: ensureTopupRef(key.key_hash) }),
    );
    expect(again.body.idempotent).toBe(true);
    expect(again.subscription).toBeUndefined();
    expect(again.notify).toBeUndefined();
  });

  it('clé anonyme : elle quitte le palier anonyme sans gratuit, et sa fin la laisse à 0', () => {
    const key = generateApiKey(null)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const subscriptionId = `sub_test_${uniq('anon')}`;
    const attached = processStripeEvent(
      proCheckout({ sessionId: `cs_test_${uniq('anon')}`, subscriptionId, ref }),
    );
    expect(attached.body.attached).toMatchObject({ outcome: 'attached' });
    expect(keyRow(key.key_hash)).toMatchObject({
      tier: 'paid',
      monthly_limit: PRO_MONTHLY_LIMIT,
    });
    const ended = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(ended.body).toMatchObject({ outcome: 'ended', allowance_restored_to: 0 });
    expect(validateApiKey(key.api_key)).toMatchObject({ valid: true, monthlyLimit: 0 });
  });

  it('référence mal formée : traitée comme absente, une clé neuve et aucune alerte', () => {
    const result = processStripeEvent(
      proCheckout({
        sessionId: `cs_test_${uniq('malformed')}`,
        subscriptionId: `sub_test_${uniq('malformed')}`,
        ref: 'pas-une-reference',
      }),
    );
    expect(result.notify?.rawKey).toMatch(/^ifk_/);
    expect(result.alert).toBeUndefined();
    expect(result.body.attached).toBeUndefined();
  });

  it('clé révoquée : une clé neuve et une alerte, jamais une réactivation', () => {
    const key = freeKey('revoked');
    const ref = ensureTopupRef(key.key_hash)!;
    expect(revokeApiKey(key.api_key)).toBe(true);
    const result = processStripeEvent(
      proCheckout({
        sessionId: `cs_test_${uniq('revoked')}`,
        subscriptionId: `sub_test_${uniq('revoked')}`,
        ref,
      }),
    );
    expect(result.notify?.rawKey).toMatch(/^ifk_/);
    expect(result.body.attached).toMatchObject({
      outcome: 'minted_fallback',
      fallback_reason: 'no_active_key',
    });
    expect(result.alert?.key).toMatch(/^stripe:subscription-fallback:/);
    expect(validateApiKey(key.api_key).valid).toBe(false);
  });
});

describe('double abonnement (ZG10)', () => {
  it('double abonnement : clé neuve et alerte', () => {
    const { key, ref, subscriptionId } = freeKeyWithPackThenPro('double');
    const second = processStripeEvent(
      proCheckout({
        sessionId: `cs_test_${uniq('double2')}`,
        subscriptionId: `sub_test_${uniq('double2')}`,
        ref,
      }),
    );
    expect(second.notify?.rawKey).toMatch(/^ifk_/);
    expect(second.body.attached).toMatchObject({
      outcome: 'minted_fallback',
      fallback_reason: 'double_subscription',
    });
    expect(second.alert?.key).toMatch(/^stripe:subscription-double:/);
    expect(second.alert?.detail).toContain('Deux abonnements sont facturés');
    expect(second.alert?.detail).not.toContain('@');
    // La clé d'origine garde SON abonnement.
    expect(keyRow(key.key_hash).stripe_subscription_id).toBe(subscriptionId);
  });
});

describe('la fin de l’abonnement (T5)', () => {
  it('résiliation : clé active, allocation d’avant rendue', () => {
    const { key, sessionId, subscriptionId } = freeKeyWithPackThenPro('end');
    const ended = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(ended.status).toBe(200);
    expect(ended.body).toMatchObject({
      subscription: subscriptionId,
      outcome: 'ended',
      key_prefix: key.key_prefix,
      allowance_restored_to: 200,
      key_deactivated: false,
    });
    expect(ended.subscription).toMatchObject({
      kind: 'ended',
      keyPrefix: key.key_prefix,
      allowance: 200,
      lifetime: false,
      creditsRemaining: 1000,
    });
    expect(ended.subscription?.to).toContain('@alpha.example.net');
    const v = validateApiKey(key.api_key);
    expect(v.valid).toBe(true);
    expect(v.monthlyLimit).toBe(200);
    expect(v.creditsRemaining).toBe(1000);
    const row = keyRow(key.key_hash);
    // L'identifiant reste : il retrouve la clé d'un renouvellement et la garde
    // hors du rayon du radar.
    expect(row.stripe_subscription_id).toBe(subscriptionId);
    expect(row.subscription_ended_at).not.toBeNull();
    expect(findPurchaseByRef(`stripe:${sessionId}`)?.ended_at).not.toBeNull();

    // Un rejeu sous un autre identifiant d'évènement : rien de plus, aucun mail.
    const again = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(again.body.outcome).toBe('already_ended');
    expect(again.subscription).toBeUndefined();
  });

  it('clé née de l’abonnement : 0 puis 402 avec liens', async () => {
    const sessionId = `cs_test_${uniq('born')}`;
    const subscriptionId = `sub_test_${uniq('born')}`;
    const minted = processStripeEvent(proCheckout({ sessionId, subscriptionId }));
    const rawKey = minted.notify!.rawKey;
    expect(validateApiKey(rawKey).monthlyLimit).toBe(PRO_MONTHLY_LIMIT);

    const ended = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(ended.body).toMatchObject({ outcome: 'ended', allowance_restored_to: 0 });
    const v = validateApiKey(rawKey);
    expect(v.valid).toBe(true);
    expect(v.monthlyLimit).toBe(0);

    const res = await call(rawKey);
    expect(res.status).toBe(402);
    const ref = ensureTopupRef(v.keyHash)!;
    expect(res.headers.get('x-credits-exhausted')).toBe('true');
    expect(res.headers.get('x-credits-topup-url')).toBe(
      `https://buy.stripe.com/bJe3coeZb31P6CsamK8so05?client_reference_id=${ref}`,
    );
  });

  it('résiliation avant rattachement : pierre tombale respectée', () => {
    const key = freeKey('tomb');
    const ref = ensureTopupRef(key.key_hash)!;
    const subscriptionId = `sub_test_${uniq('tomb')}`;
    const first = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(first.body).toMatchObject({ outcome: 'unknown', key_deactivated: false });
    const before = keyCount();
    const late = processStripeEvent(
      proCheckout({ sessionId: `cs_test_${uniq('tomb')}`, subscriptionId, ref }),
    );
    expect(late.body.skipped).toBe('subscription_already_canceled');
    expect(keyCount()).toBe(before);
    expect(keyRow(key.key_hash).stripe_subscription_id).toBeNull();
    expect(validateApiKey(key.api_key).monthlyLimit).toBe(200);
  });

  it('rotation puis résiliation : la clé tournée est retrouvée par la lignée', () => {
    const { key, subscriptionId } = freeKeyWithPackThenPro('rotated');
    const rotated = rotateApiKey(key.api_key)!;
    expect(validateApiKey(rotated.api_key).monthlyLimit).toBe(PRO_MONTHLY_LIMIT);
    const ended = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(ended.body).toMatchObject({ outcome: 'ended', key_prefix: rotated.key_prefix });
    expect(validateApiKey(rotated.api_key)).toMatchObject({ valid: true, monthlyLimit: 200 });
    expect(validateApiKey(key.api_key).valid).toBe(false);
  });

  it('une copie tournée qui avait perdu l’abonnement (avant la PR 177) est retrouvée et terminée', () => {
    const sessionId = `cs_test_${uniq('pr177')}`;
    const subscriptionId = `sub_test_${uniq('pr177')}`;
    const minted = processStripeEvent(proCheckout({ sessionId, subscriptionId }));
    const rotated = rotateApiKey(minted.notify!.rawKey)!;
    // L'ancienne rotation ne recopiait pas l'identifiant d'abonnement.
    getStatsDB()
      .prepare('UPDATE api_keys SET stripe_subscription_id = NULL WHERE key_hash = ?')
      .run(rotated.key_hash);
    const ended = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(ended.body).toMatchObject({ outcome: 'ended', key_prefix: rotated.key_prefix });
    expect(keyRow(rotated.key_hash)).toMatchObject({
      active: 1,
      monthly_limit: 0,
      stripe_subscription_id: subscriptionId,
    });
  });

  it('un deleted tardif d’un ancien abonnement ne coupe jamais le nouveau', () => {
    const { key, ref, subscriptionId: oldSub } = freeKeyWithPackThenPro('moved');
    expect(processStripeEvent(subscriptionDeleted(oldSub)).body.outcome).toBe('ended');
    const newSub = `sub_test_${uniq('moved-new')}`;
    const again = processStripeEvent(
      proCheckout({ sessionId: `cs_test_${uniq('moved-new')}`, subscriptionId: newSub, ref }),
    );
    expect(again.body.attached).toMatchObject({ outcome: 'attached' });
    expect(validateApiKey(key.api_key).monthlyLimit).toBe(PRO_MONTHLY_LIMIT);
    // Stripe renvoie la fin de l'ANCIEN abonnement sous un autre identifiant.
    const late = processStripeEvent(subscriptionDeleted(oldSub));
    expect(late.body.outcome).toBe('moved_on');
    expect(late.subscription).toBeUndefined();
    expect(validateApiKey(key.api_key).monthlyLimit).toBe(PRO_MONTHLY_LIMIT);
    expect(keyRow(key.key_hash).stripe_subscription_id).toBe(newSub);
    // Et la fin du NOUVEAU rend l'allocation d'avant lui : le gratuit.
    expect(processStripeEvent(subscriptionDeleted(newSub)).body).toMatchObject({
      outcome: 'ended',
      allowance_restored_to: 200,
    });
  });

  it('une clé révoquée pendant l’abonnement n’est jamais réactivée par sa fin', () => {
    const { key, subscriptionId } = freeKeyWithPackThenPro('revoked-end');
    expect(revokeApiKey(key.api_key)).toBe(true);
    const ended = processStripeEvent(subscriptionDeleted(subscriptionId));
    expect(ended.body.outcome).toBe('no_active_key');
    expect(ended.subscription).toBeUndefined();
    expect(keyRow(key.key_hash).active).toBe(0);
  });
});

describe('renouvellement et contestation', () => {
  it('renouvellement invoice.paid attribué à la clé existante', () => {
    const { key, subscriptionId } = freeKeyWithPackThenPro('renewal');
    const result = processStripeEvent(renewalPaid(subscriptionId));
    expect(result.body).toMatchObject({ recorded: true, key_resolved: true });
    const row = getStatsDB()
      .prepare('SELECT key_hash FROM subscription_payments WHERE subscription_id = ?')
      .get(subscriptionId) as { key_hash: string | null };
    expect(row.key_hash).toBe(key.key_hash);
  });

  it('une contestation d’un paiement d’abonnement ne trouve aucun pack et ne reprend rien', () => {
    const { key, subscriptionId } = freeKeyWithPackThenPro('dispute');
    void subscriptionId;
    const dispute = processStripeEvent({
      id: `evt_${uniq('dispute')}`,
      type: 'charge.dispute.created',
      data: {
        object: {
          id: `du_${uniq('dispute')}`,
          object: 'dispute',
          amount: 2900,
          currency: 'usd',
          // L'intention de la FACTURE : la session d'abonnement n'en a pas.
          payment_intent: `pi_${uniq('invoice')}`,
          status: 'needs_response',
        },
      },
    } as unknown as Stripe.Event);
    expect(dispute.body).toMatchObject({ ignored: 'no_matching_purchase' });
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
    expect(validateApiKey(key.api_key).monthlyLimit).toBe(PRO_MONTHLY_LIMIT);
  });
});

describe('les mails', () => {
  it('Pro rattaché : court, sans clé brute, sans tiret long', () => {
    const mail = buildSubscriptionAttachedEmail({
      keyPrefix: 'ifk_0123abcd',
      plan: 'pro',
      monthlyLimit: PRO_MONTHLY_LIMIT,
    });
    expect(mail.subject).toBe('IBANforge Pro active on key ifk_0123abcd');
    expect(mail.text).toContain('Nothing to change in your integration');
    expect(mail.text).toContain('Cancelling stops the next renewal. The key is not deactivated');
    for (const part of [mail.subject, mail.text, mail.html]) expect(part).not.toContain('—');
  });

  it('fin d’abonnement : la clé reste active, et une clé sans rien a ses liens', () => {
    const ref = `ifr_${'a'.repeat(32)}`;
    const empty = buildSubscriptionEndedEmail({
      keyPrefix: 'ifk_0123abcd',
      plan: 'pro',
      allowance: 0,
      creditsRemaining: null,
      topupRef: ref,
    });
    expect(empty.text).toContain('The key stays active');
    expect(empty.text).toContain('HTTP 402');
    expect(empty.text).toContain(`?client_reference_id=${ref}`);
    expect(empty.text).toContain(
      `https://buy.stripe.com/aFacMYaIVeKx1i87ay8so04?client_reference_id=${ref}`,
    );
    const free = buildSubscriptionEndedEmail({
      keyPrefix: 'ifk_0123abcd',
      plan: 'pro',
      allowance: 200,
      creditsRemaining: 1000,
      topupRef: ref,
    });
    expect(free.text).toContain('200 requests a month, then the 1,000 prepaid credits left on it');
    for (const part of [empty.subject, empty.text, empty.html, free.text]) {
      expect(part).not.toContain('—');
    }
  });

  it('le mail d’une clé Pro neuve dit la résiliation des conditions 1.9, mot pour mot', () => {
    const mail = buildProKeyEmail({ rawKey: 'ifk_test', monthlyLimit: PRO_MONTHLY_LIMIT });
    expect(mail.text).toContain(PRO_CANCELLATION_SENTENCE);
    expect(mail.text).not.toContain('keeps working until the end of the paid month');
  });
});
