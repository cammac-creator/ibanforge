import { createHash, randomBytes } from 'node:crypto';
import { getStatsDB } from './db.js';

import { FREE_TIER_MONTHLY_LIMIT as DEFAULT_MONTHLY_LIMIT } from './tiers.js';
import {
  ANONYMOUS_CONTACT,
  ANONYMOUS_MONTHLY_LIMIT,
  FREE_TIER_MONTHLY_LIMIT as CLAIMED_LIMIT,
  type KeyTier,
} from './tiers.js';
import { normalizeEmail } from './email-norm.js';
import { recordKeyCreation } from './key-creation-guard.js';
import { recordKeyClaim, type KeyClaimMethod } from './key-claims.js';

/** Ré-export conservé pour les consommateurs du middleware. */
export { FREE_TIER_MONTHLY_LIMIT } from './tiers.js';
const KEY_PREFIX = 'ifk_';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Ce que le handler sait de la naissance d'une clé ; tout est facultatif. */
export interface KeyBirth {
  ipHash?: string | null;
  userAgent?: string | null;
}

/**
 * `issuedByUs` marks a key WE minted and handed over, as opposed to one its
 * holder asked for. It changes nothing about quota, billing or auth — see the
 * migration in lib/db.ts for the single reading it exists to correct.
 *
 * Depuis le lot 2 du chantier « clé sans e-mail » (15/09/2026), cette fonction
 * est LE SEUL point de frappe d'une clé libre, et elle écrit elle-même la
 * ligne de naissance dans `key_creations`, inconditionnellement. Avant, la
 * ligne n'était écrite que par la route publique : le mint administratif et
 * la frappe sous nonce à venir produisaient des clés invisibles au disjoncteur
 * et définitivement irrévocables. La sentinelle 'unknown' compte sans ancre ;
 * la garde par réseau interroge un hash précis et l'ignore d'elle-même.
 *
 * `email` peut être null : la clé naît alors au palier anonyme, avec la
 * sentinelle (sans arobase, donc inatteignable par tout chemin de mail) et un
 * plafond ÉCRIT de 25. Pas laissé NULL : un NULL se relit `?? 200` plus bas, ce
 * qui donnerait silencieusement à une clé anonyme exactement ce que le palier
 * existe pour ne pas donner.
 *
 * 🚨 La garde « une clé par adresse et par jour » ne s'exécute que si une
 * adresse est fournie : la sentinelle étant partagée, elle trouverait la clé
 * anonyme précédente et rendrait null — une seule clé anonyme par jour pour le
 * monde entier. Elle porte sur la forme normalisée (plus d'étiquette, points
 * retirés chez gmail), sinon you+1@ et y.o.u@ sont trois personnes pour la
 * base et une boîte pour leur porteur.
 */
export function generateApiKey(
  email: string | null,
  monthlyLimit?: number,
  source?: string,
  issuedByUs = false,
  birth?: KeyBirth,
): { api_key: string; key_prefix: string; key_hash: string } | null {
  const db = getStatsDB();
  const emailNorm = email ? normalizeEmail(email) : null;
  if (emailNorm) {
    const existing = db
      .prepare(
        "SELECT id FROM api_keys WHERE email_norm = ? AND created_at >= datetime('now', '-1 day')",
      )
      .get(emailNorm) as { id: number } | undefined;
    if (existing) return null;
  }
  const tier: KeyTier = email ? 'email' : 'anonymous';
  const limit = monthlyLimit ?? (email ? null : ANONYMOUS_MONTHLY_LIMIT);

  // Trois tentatives, puis on laisse remonter : à 2^32 préfixes possibles,
  // trois collisions d'affilée ne sont pas de la malchance, c'est un
  // générateur cassé, et une clé de plus dans ce cas serait pire qu'une erreur.
  // key_prefix sert de clé de lecture au rapport d'usage et au radar : deux
  // porteurs sous un même préfixe se liraient l'un l'autre.
  const clash = db.prepare('SELECT 1 AS one FROM api_keys WHERE key_prefix = ?');
  const insert = db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, monthly_limit, source, issued_by_us, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    if (clash.get(keyPrefix)) continue;
    // La clé et sa ligne de naissance dans la même transaction : l'invariant
    // « exactement une ligne par clé libre » ne souffre pas un crash entre les deux.
    db.transaction(() => {
      insert.run(
        keyHash,
        keyPrefix,
        email ?? ANONYMOUS_CONTACT,
        emailNorm,
        limit,
        source ?? null,
        issuedByUs ? 1 : 0,
        tier,
      );
      recordKeyCreation(birth?.ipHash ?? 'unknown', birth?.userAgent ?? null, keyPrefix);
    })();
    return { api_key: rawKey, key_prefix: keyPrefix, key_hash: keyHash };
  }
  throw new Error('key_prefix collided three times in a row: the key generator is broken');
}

/**
 * Bundle credits — a key that consumes from a prepaid pool of N credits instead
 * of the monthly subscription model. Created after a successful x402 payment
 * on /v1/credits/buy. No daily-rate-limit on creation (the payment already
 * provided abuse-resistance).
 *
 * 🚨 `paymentRef` is what makes this rail survivable, and it is the reason the
 * card rail was safe while this one was not. `generateStripeKey` has always
 * written the raw key to `raw_key_one_time_view` and keyed it on the checkout
 * session, so a buyer whose success page never loaded can still fetch the key
 * once. This path stored NOTHING: the $5-to-$80 key existed only inside the
 * HTTP response, and a connection dropped after settlement left a buyer who
 * had paid and had nothing — with no way for us to hand it back either, since
 * we keep only the hash. It now behaves like the card rail:
 *
 *   - the raw key is retrievable exactly once, via GET /v1/credits/recover/:ref;
 *   - a second call carrying the SAME settlement mints nothing and returns the
 *     first key's prefix, so one payment can never become two packs.
 *
 * `paymentRef` stays optional so a caller with no payment header (free mode,
 * tests, dev bypass) still gets a key — just not a recoverable one, which is
 * correct: nothing was paid.
 */
export function generateCreditKey(
  email: string | null,
  credits: number,
  paymentRef?: string | null,
): { api_key: string; key_prefix: string; credits: number } {
  const db = getStatsDB();
  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  // Use 'credits-buyer' as a non-personal placeholder if no email provided —
  // x402 callers don't always have an email and we don't want to gate the
  // bundle behind one.
  const storedEmail = email && email.includes('@') ? email : 'credits-buyer';
  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, monthly_limit, credits_remaining, credits_total, x402_payment_ref, raw_key_one_time_view, tier) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)',
  ).run(
    keyHash,
    keyPrefix,
    storedEmail,
    normalizeEmail(storedEmail),
    credits,
    credits,
    paymentRef ?? null,
    paymentRef ? rawKey : null,
    'paid',
  );
  return { api_key: rawKey, key_prefix: keyPrefix, credits };
}

/**
 * The pack this settlement already bought, if it bought one.
 *
 * Kept separate from `generateCreditKey` so that function keeps returning a key
 * and only a key — the caller asks "was this already paid for?" before asking
 * for a mint, instead of every existing call site having to handle a null key.
 *
 * One settlement, one pack: without this check a buyer replaying a request
 * whose response they never saw would be handed a SECOND $80 pack for a single
 * payment.
 */
export function findCreditKeyByPaymentRef(paymentRef: string): { key_prefix: string } | null {
  const row = getStatsDB()
    .prepare('SELECT key_prefix FROM api_keys WHERE x402_payment_ref = ?')
    .get(paymentRef) as { key_prefix: string } | undefined;
  return row ?? null;
}

/**
 * Stripe-paid credits — equivalent to generateCreditKey but also stores the
 * Stripe Checkout session id (for webhook idempotency) and the raw key in a
 * one-time-view column the success page can fetch via consumeOneTimeKey().
 *
 * Idempotent: if a key already exists for this stripe_session_id, returns
 * the existing key_prefix (without the raw key, since it was either already
 * consumed by the buyer or is still pending consumption — either way we
 * MUST NOT regenerate, as that would double-mint credits).
 */
export function generateStripeKey(
  email: string | null,
  credits: number,
  stripeSessionId: string,
): { api_key: string | null; key_prefix: string; credits: number; idempotent: boolean } {
  const db = getStatsDB();
  const existing = db
    .prepare('SELECT key_prefix FROM api_keys WHERE stripe_session_id = ?')
    .get(stripeSessionId) as { key_prefix: string } | undefined;
  if (existing) {
    return { api_key: null, key_prefix: existing.key_prefix, credits, idempotent: true };
  }

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const storedEmail = email && email.includes('@') ? email : 'stripe-buyer';

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, monthly_limit, credits_remaining, credits_total, stripe_session_id, raw_key_one_time_view, tier) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)',
  ).run(
    keyHash,
    keyPrefix,
    storedEmail,
    normalizeEmail(storedEmail),
    credits,
    credits,
    stripeSessionId,
    rawKey,
    'paid',
  );

  return { api_key: rawKey, key_prefix: keyPrefix, credits, idempotent: false };
}

/** Monthly request allowance attached to an Editor/OEM subscription key. */
export const OEM_MONTHLY_LIMIT = 50_000;

/**
 * Pro subscription: the PUBLIC monthly tier (2026-09-02, market study of 02/09:
 * the category enters at $20 to $99 a month). Same mechanics as OEM, a monthly
 * allowance that resets on the 1st and a key that dies with its subscription,
 * for a fifth of the allowance, no SLA and no embedding rights. The price
 * lives in Stripe and in src/lib/payment-links.ts; only the allowance is
 * decided here.
 */
export const PRO_MONTHLY_LIMIT = 10_000;

/**
 * Stripe-paid Editor/OEM subscription key — monthly_limit-based (NOT credits):
 * the subscription buys embedding rights + a high monthly allowance that
 * resets on the 1st, not a prepaid pool. Same one-time-view delivery as
 * generateStripeKey. Stores the Stripe subscription id so a
 * customer.subscription.deleted webhook can deactivate the key.
 *
 * Idempotent per checkout session: Stripe retries webhooks and we must not
 * mint twice.
 */
export function generateOemKey(
  email: string | null,
  monthlyLimit: number,
  stripeSessionId: string,
  stripeSubscriptionId: string | null,
): { api_key: string | null; key_prefix: string; monthly_limit: number; idempotent: boolean } {
  const db = getStatsDB();
  const existing = db
    .prepare('SELECT key_prefix FROM api_keys WHERE stripe_session_id = ?')
    .get(stripeSessionId) as { key_prefix: string } | undefined;
  if (existing) {
    return {
      api_key: null,
      key_prefix: existing.key_prefix,
      monthly_limit: monthlyLimit,
      idempotent: true,
    };
  }

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const storedEmail = email && email.includes('@') ? email : 'oem-subscriber';

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, monthly_limit, stripe_session_id, stripe_subscription_id, raw_key_one_time_view, tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    keyHash,
    keyPrefix,
    storedEmail,
    normalizeEmail(storedEmail),
    monthlyLimit,
    stripeSessionId,
    stripeSubscriptionId,
    rawKey,
    'paid',
  );

  return { api_key: rawKey, key_prefix: keyPrefix, monthly_limit: monthlyLimit, idempotent: false };
}

/**
 * Deactivate the key tied to a canceled Stripe subscription. Returns the
 * key_prefix when an active key was deactivated, null when nothing matched
 * (already deactivated, or a subscription we never minted for). Idempotent.
 */
export function deactivateBySubscription(stripeSubscriptionId: string): string | null {
  const db = getStatsDB();
  const row = db
    .prepare('SELECT key_prefix FROM api_keys WHERE stripe_subscription_id = ? AND active = 1')
    .get(stripeSubscriptionId) as { key_prefix: string } | undefined;
  if (!row) return null;
  db.prepare(
    "UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE stripe_subscription_id = ?",
  ).run(stripeSubscriptionId);
  return row.key_prefix;
}

/**
 * Read the raw API key for a Stripe session ONCE, then null the column so it
 * can never be retrieved again. Returns null if the session was already
 * consumed or the webhook hasn't created the key yet.
 *
 * Why one-time-view: the raw key would otherwise have to be returned by every
 * GET on /v1/stripe/key/:session_id, but the session_id leaks into browser
 * history and could be sniffed. One-shot retrieval limits the attack window.
 */
export function consumeOneTimeKey(stripeSessionId: string): {
  api_key: string;
  credits_total: number | null;
  credits_remaining: number | null;
  monthly_limit: number | null;
  email: string | null;
} | null {
  const db = getStatsDB();
  const row = db
    .prepare(
      'SELECT raw_key_one_time_view, credits_total, credits_remaining, monthly_limit, email FROM api_keys WHERE stripe_session_id = ? AND raw_key_one_time_view IS NOT NULL AND active = 1',
    )
    .get(stripeSessionId) as
    | {
        raw_key_one_time_view: string;
        credits_total: number | null;
        credits_remaining: number | null;
        monthly_limit: number | null;
        email: string;
      }
    | undefined;

  if (!row) return null;

  db.prepare('UPDATE api_keys SET raw_key_one_time_view = NULL WHERE stripe_session_id = ?').run(
    stripeSessionId,
  );

  return {
    api_key: row.raw_key_one_time_view,
    credits_total: row.credits_total,
    credits_remaining: row.credits_remaining,
    monthly_limit: row.monthly_limit,
    email: row.email === 'stripe-buyer' || row.email === 'oem-subscriber' ? null : row.email,
  };
}

/**
 * The x402 twin of consumeOneTimeKey: read the raw key for a settlement ONCE,
 * then null the column. Same one-shot discipline and the same reason for it —
 * the reference travels in logs and retries, so the window must close after a
 * single read.
 */
export function consumeOneTimeKeyByPaymentRef(
  paymentRef: string,
): { api_key: string; credits_total: number | null; credits_remaining: number | null } | null {
  const db = getStatsDB();
  const row = db
    .prepare(
      'SELECT raw_key_one_time_view, credits_total, credits_remaining FROM api_keys WHERE x402_payment_ref = ? AND raw_key_one_time_view IS NOT NULL AND active = 1',
    )
    .get(paymentRef) as
    | {
        raw_key_one_time_view: string;
        credits_total: number | null;
        credits_remaining: number | null;
      }
    | undefined;
  if (!row) return null;
  db.prepare('UPDATE api_keys SET raw_key_one_time_view = NULL WHERE x402_payment_ref = ?').run(
    paymentRef,
  );
  return {
    api_key: row.raw_key_one_time_view,
    credits_total: row.credits_total,
    credits_remaining: row.credits_remaining,
  };
}

export interface ApiKeyValidation {
  valid: boolean;
  keyHash: string;
  email?: string;
  /** Le palier : 'anonymous' | 'email' | 'claimed' | 'paid'. Absent quand la clé est invalide. */
  tier?: KeyTier;
  monthlyLimit: number;
  /** When set, the key is a credit-based bundle key (NOT monthly subscription). */
  creditsRemaining?: number;
  creditsTotal?: number;
  /**
   * When true the monthly allowance does not start over on the 1st: the ceiling
   * is measured against usage across ALL months, so an allowance already spent
   * stays spent. Set on keys regrouped as one automated cohort.
   */
  noRecredit?: boolean;
}

/**
 * Self-service revocation: deactivate a key given the raw key itself. Returns
 * true if an active key was found and deactivated. A revoked key can never be
 * reactivated (rotate to get a fresh one). Idempotent: revoking twice returns
 * false the second time.
 */
export function revokeApiKey(key: string): boolean {
  if (!key.startsWith(KEY_PREFIX)) return false;
  const keyHash = hashKey(key);
  const result = getStatsDB()
    .prepare(
      "UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE key_hash = ? AND active = 1",
    )
    .run(keyHash);
  return result.changes > 0;
}

/**
 * Self-service rotation: given a valid raw key, mint a fresh key that inherits
 * the same email, monthly_limit and remaining credits, then revoke the old one
 * — atomically. A leaked key can thus be replaced without losing the plan or
 * the prepaid balance. Returns the new raw key, or null if the input key is
 * invalid/inactive.
 */
export function rotateApiKey(oldKey: string): {
  api_key: string;
  key_prefix: string;
  key_hash: string;
  monthly_limit: number | null;
  credits_remaining: number | null;
  tier: KeyTier;
  no_recredit: number;
} | null {
  if (!oldKey.startsWith(KEY_PREFIX)) return null;
  const db = getStatsDB();
  const oldHash = hashKey(oldKey);
  const row = db
    .prepare(
      `SELECT key_prefix, email, email_norm, monthly_limit, credits_remaining, credits_total, no_recredit,
              stripe_subscription_id, source, issued_by_us, tier, claimed_at, claim_method,
              shield_episode, origin_prefix
         FROM api_keys WHERE key_hash = ? AND active = 1`,
    )
    .get(oldHash) as
    | {
        key_prefix: string;
        email: string;
        email_norm: string | null;
        monthly_limit: number | null;
        credits_remaining: number | null;
        credits_total: number | null;
        no_recredit: number | null;
        stripe_subscription_id: string | null;
        source: string | null;
        issued_by_us: number | null;
        tier: KeyTier;
        claimed_at: string | null;
        claim_method: string | null;
        shield_episode: string | null;
        origin_prefix: string | null;
      }
    | undefined;
  if (!row) return null;

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const newHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  const tx = db.transaction(() => {
    // Carry the opt-out flag across — without it, a key the cohort radar took
    // off the monthly reset would clear itself in one self-service /rotate call.
    // Conserver le lien d'abonnement : sa résiliation doit révoquer la nouvelle clé.
    //
    // Le palier, la preuve (claimed_at, claim_method), l'adresse normalisée et
    // l'épisode de bouclier voyagent pour la même raison que no_recredit : une
    // clé tournée qui retomberait sur le DEFAULT 'email' se lirait comme
    // réclamée sans jamais l'avoir été, et une clé dégradée remonterait à 200.
    //
    // 🚨 origin_prefix : le préfixe de la clé d'ORIGINE, celle dont la naissance
    // a une ligne dans key_creations, stable à travers N rotations. C'est ce qui
    // garde une clé tournée dans le rayon du radar. Aucune ligne key_creations
    // n'est recopiée sous le nouveau préfixe : le disjoncteur COMPTE ces lignes,
    // et une copie à chaque /rotate (route sans plafond) offrirait un moyen de
    // l'armer à volonté, donc de dégrader les clés que les autres créent.
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, monthly_limit, credits_remaining, credits_total,
                             no_recredit, stripe_subscription_id, source, issued_by_us, tier, claimed_at, claim_method,
                             shield_episode, origin_prefix)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newHash,
      keyPrefix,
      row.email,
      row.email_norm,
      row.monthly_limit,
      row.credits_remaining,
      row.credits_total,
      row.no_recredit ?? 0,
      row.stripe_subscription_id,
      row.source,
      row.issued_by_us ?? 0,
      row.tier,
      row.claimed_at,
      row.claim_method,
      row.shield_episode,
      row.origin_prefix ?? row.key_prefix,
    );
    // Move the usage ledger to the new key hash too. Otherwise the lifetime sum
    // (and the plain monthly count) restart at zero on rotation — which would
    // make rotation a one-call quota reset for anyone, flagged or not.
    db.prepare('UPDATE api_usage SET key_hash = ? WHERE key_hash = ?').run(newHash, oldHash);
    // Et le journal de paiement : sinon une clé tournée repart d'un cumul de 0
    // et peut racheter la promotion à 1 $ autant de fois qu'elle tourne.
    db.prepare('UPDATE key_settlements SET key_hash = ?, key_prefix = ? WHERE key_hash = ?').run(
      newHash,
      keyPrefix,
      oldHash,
    );
    db.prepare(
      "UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE key_hash = ?",
    ).run(oldHash);
  });
  tx();

  return {
    api_key: rawKey,
    key_prefix: keyPrefix,
    key_hash: newHash,
    monthly_limit: row.monthly_limit,
    credits_remaining: row.credits_remaining,
    tier: row.tier,
    no_recredit: row.no_recredit ?? 0,
  };
}

export function validateApiKey(key: string): ApiKeyValidation {
  if (!key.startsWith(KEY_PREFIX))
    return { valid: false, keyHash: '', monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  const keyHash = hashKey(key);
  const row = getStatsDB()
    .prepare(
      'SELECT email, monthly_limit, credits_remaining, credits_total, no_recredit, tier FROM api_keys WHERE key_hash = ? AND active = 1',
    )
    .get(keyHash) as
    | {
        email: string;
        monthly_limit: number | null;
        credits_remaining: number | null;
        credits_total: number | null;
        no_recredit: number | null;
        tier: KeyTier;
      }
    | undefined;
  if (!row) return { valid: false, keyHash, monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  return {
    valid: true,
    keyHash,
    email: row.email,
    tier: row.tier,
    monthlyLimit: row.monthly_limit ?? DEFAULT_MONTHLY_LIMIT,
    creditsRemaining: row.credits_remaining ?? undefined,
    creditsTotal: row.credits_total ?? undefined,
    noRecredit: row.no_recredit === 1,
  };
}

/**
 * Atomically decrement credits_remaining when a credit-based key serves a call.
 * `units` is the number of credits this request bills — 1 for every endpoint
 * except batch validation, which bills 1 credit per IBAN.
 *
 * All-or-nothing: when the balance is smaller than `units`, nothing is debited
 * and ok=false, so the caller can answer 402 with the exact shortfall instead
 * of silently draining a balance that can't cover the request.
 */
export function decrementCredits(keyHash: string, units = 1): { ok: boolean; remaining: number } {
  const db = getStatsDB();
  const result = db
    .prepare(
      'UPDATE api_keys SET credits_remaining = credits_remaining - ? WHERE key_hash = ? AND active = 1 AND credits_remaining >= ?',
    )
    .run(units, keyHash, units);
  const row = db
    .prepare('SELECT credits_remaining FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { credits_remaining: number | null } | undefined;
  return { ok: result.changes > 0, remaining: Math.max(0, row?.credits_remaining ?? 0) };
}

/**
 * Refund previously-decremented credits when the downstream handler returned
 * a 4xx (client error — bad input). Mirrors decrementQuota for monthly keys.
 */
export function refundCredit(keyHash: string, units = 1): void {
  // Cap the refund at credits_total so a stray double-refund can never inflate
  // the balance above what was purchased (mirrors the MAX(count-N,0) clamp in
  // decrementQuota).
  getStatsDB()
    .prepare(
      'UPDATE api_keys SET credits_remaining = MIN(credits_remaining + ?, credits_total) WHERE key_hash = ? AND credits_remaining IS NOT NULL',
    )
    .run(units, keyHash);
}

/**
 * `units` is the number of quota slots this request consumes — 1 for every
 * endpoint except batch validation, which consumes 1 slot per IBAN.
 * All-or-nothing: a batch that doesn't fit in the remaining allowance is
 * refused without consuming anything (`remaining` then tells the caller how
 * big a batch would still fit this month).
 */
/**
 * Share of the monthly allowance at which the holder is warned they are about
 * to be cut off. 80% leaves enough runway to pay before the wall — the point
 * is to convert BEFORE the block, not to apologize after it.
 */
export const QUOTA_NOTICE_RATIO = 0.8;

/**
 * Age of a key in hours, from api_keys.created_at (stored in UTC by
 * datetime('now')). null when the key or the timestamp is missing — callers
 * must treat null as "unknown", not as "old".
 */
export function getKeyAgeHours(keyHash: string): number | null {
  const row = getStatsDB()
    .prepare('SELECT created_at FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { created_at?: string } | undefined;
  if (!row?.created_at) return null;
  const t = Date.parse(row.created_at.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

/**
 * Whether this key has been marked as belonging to a key farm.
 *
 * `no_recredit` is set by the cohort radar when a burst of keys is recognised
 * as one operator. The flag already stops the monthly re-credit; it should also
 * stop the mail, and until now it did not.
 *
 * What that cost, measured on 19/08/2026: a cohort was relabelled to
 * `@cohorte.invalid` and so became unroutable, but a farm key not yet grouped
 * still passed every filter, and the verification path mailed invented
 * addresses at a reputable domain. Nearly every incoming message in the
 * business mailbox over those three days was our own bounce.
 *
 * Returns false when the key is unknown: a caller must not be able to silence
 * mail by presenting a hash that does not exist.
 */
export function isNoRecredit(keyHash: string): boolean {
  const row = getStatsDB()
    .prepare('SELECT no_recredit FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { no_recredit?: number } | undefined;
  return row?.no_recredit === 1;
}

/**
 * Claim the right to warn this key once for this month. Returns true exactly
 * once per (key, month): the PRIMARY KEY makes the second caller a no-op, so a
 * burst of calls above the threshold cannot produce a burst of emails.
 */
export function recordQuotaNotice(keyHash: string, month: string): boolean {
  const result = getStatsDB()
    .prepare('INSERT OR IGNORE INTO quota_notices (key_hash, month) VALUES (?, ?)')
    .run(keyHash, month);
  return result.changes > 0;
}

/**
 * Release a claimed notice so it can be retried — used when the warning email
 * failed to leave, otherwise a transient SMTP outage would burn the single
 * warning that key gets this month.
 */
export function clearQuotaNotice(keyHash: string, month: string): void {
  getStatsDB()
    .prepare('DELETE FROM quota_notices WHERE key_hash = ? AND month = ?')
    .run(keyHash, month);
}

export function checkAndIncrementQuota(
  keyHash: string,
  monthlyLimit: number = DEFAULT_MONTHLY_LIMIT,
  units = 1,
  /**
   * When true, the ceiling is compared against usage summed over ALL months
   * rather than the current one, so the allowance does not start over on the
   * 1st. Usage is still written to the current month's row, which keeps every
   * existing per-month reading (CRM, stats, notices) unchanged.
   */
  noRecredit = false,
): {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  month: string;
  /**
   * True on the single call that carries usage from below QUOTA_NOTICE_RATIO to
   * at or above it. Detected here, in the increment, rather than by a daily
   * cron: the 2026-07-25 funnel audit measured a client burn nearly its whole
   * monthly allowance in a matter of minutes, a window no scheduled job can
   * catch.
   */
  crossedNoticeThreshold: boolean;
} {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  // Read the counter and write it back in ONE transaction.
  //
  // The read and the write were two separate statements. better-sqlite3 is
  // synchronous and no `await` sits between them, so within this process the
  // pair is already indivisible — but `stats.sqlite` has writers outside it
  // (the admin scripts this codebase names in src/middleware/api-key.ts), and
  // against a second writer the pair is a classic read-modify-write race: two
  // callers read the same count, both find room, both write, and one call is
  // served free. The credit path was already guarded (`decrementCredits` is a
  // single conditional UPDATE); this aligns the quota path with it. SEC-09,
  // audit 2026-09-01.
  //
  // A transaction rather than a guarded UPDATE because the ceiling is not
  // always the row being written: on the `noRecredit` basis it is a SUM over
  // every month while the write lands on the current one, which no single
  // WHERE clause expresses.
  const decide = db.transaction((): { measured: number; allowed: boolean } => {
    db.prepare(
      'INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 0) ON CONFLICT(key_hash, month) DO NOTHING',
    ).run(keyHash, month);
    const row = db
      .prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?')
      .get(keyHash, month) as {
      count: number;
    };
    // What the ceiling is measured against. Normally the current month; for a key
    // opted out of the monthly reset, every month it has ever used.
    const measuredNow = noRecredit
      ? (
          db
            .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM api_usage WHERE key_hash = ?')
            .get(keyHash) as { n: number }
        ).n
      : row.count;
    if (measuredNow + units > monthlyLimit) return { measured: measuredNow, allowed: false };
    db.prepare('UPDATE api_usage SET count = count + ? WHERE key_hash = ? AND month = ?').run(
      units,
      keyHash,
      month,
    );
    return { measured: measuredNow, allowed: true };
  });
  // IMMEDIATE takes the write lock at BEGIN instead of on the first write, so a
  // concurrent writer collides at the start rather than half way through.
  const { measured, allowed } = decide.immediate();
  if (!allowed) {
    return {
      allowed: false,
      used: measured,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - measured),
      month,
      crossedNoticeThreshold: false,
    };
  }
  // Reported on the same basis the ceiling was checked against, so `used` and
  // `remaining` stay coherent with the refusal above. Identical to the old
  // `row.count + units` for every key on the normal monthly basis.
  const used = measured + units;
  const threshold = Math.ceil(monthlyLimit * QUOTA_NOTICE_RATIO);
  return {
    allowed: true,
    used,
    limit: monthlyLimit,
    remaining: monthlyLimit - used,
    month,
    // A batch can leap over the threshold without landing on it, hence the
    // before/after comparison rather than an equality on `used`.
    crossedNoticeThreshold: measured < threshold && used >= threshold,
  };
}

/**
 * Count a call against this key's month WITHOUT testing any ceiling.
 *
 * 🚨 An observation counter, not a quota. A credit key never passes through
 * `checkAndIncrementQuota` — the middleware takes the `decrementCredits` branch
 * — so `api_usage` held nothing for it and every aggregate built on that ledger
 * (the CRM's months_by_key, the monthly sparkline, "how much did this customer
 * consume in July") read a paying customer as one who had never called.
 *
 * Why a separate function rather than a flag on `checkAndIncrementQuota`: that
 * one's job is to REFUSE, and a credit key's monthly_limit is NULL, which falls
 * back to DEFAULT_MONTHLY_LIMIT. One future reader away from capping a
 * 5,000-credit pack at 200 calls a month. There is no ceiling here to be
 * misread — no limit, no refusal, no notice threshold, no mail. The balance is
 * still the only thing that can turn a credit call away, and it is debited
 * exactly once, by decrementCredits.
 *
 * Returns the month the units landed on, so a 4xx refund crossing midnight on
 * the 1st decrements the row it incremented and not the fresh one.
 */
export function recordMonthlyObservation(keyHash: string, units = 1): string {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  db.prepare(
    'INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 0) ON CONFLICT(key_hash, month) DO NOTHING',
  ).run(keyHash, month);
  db.prepare('UPDATE api_usage SET count = count + ? WHERE key_hash = ? AND month = ?').run(
    units,
    keyHash,
    month,
  );
  return month;
}

export function getUsage(
  keyHash: string,
  monthlyLimit: number = DEFAULT_MONTHLY_LIMIT,
  noRecredit = false,
): { used: number; limit: number; remaining: number; month: string } {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  // Même base que le plafond : une clé hors du reset mensuel se mesure sur la
  // somme de vie, sinon /usage annoncerait un solde que le middleware refuse.
  const used = noRecredit
    ? (
        db
          .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM api_usage WHERE key_hash = ?')
          .get(keyHash) as { n: number }
      ).n
    : ((
        db
          .prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?')
          .get(keyHash, month) as { count: number } | undefined
      )?.count ?? 0);
  return { used, limit: monthlyLimit, remaining: Math.max(0, monthlyLimit - used), month };
}

/**
 * Decrement the quota counter for this key+month. Used to refund consumed
 * slots when the underlying request failed with a client error (4xx) — we
 * should not punish callers for malformed input by eating their quota.
 *
 * `month` should be the one the increment was billed to (the caller passes
 * `quota.month`): a refund at 00:00 on the 1st for a call billed at 23:59 on the
 * 31st must land on the OLD month's row, not create a −1-then-clamped-to-0 on the
 * fresh one. For a key on the lifetime basis that difference is permanent.
 */
export function decrementQuota(keyHash: string, units = 1, month?: string): void {
  const db = getStatsDB();
  const m = month ?? new Date().toISOString().slice(0, 7);
  db.prepare('UPDATE api_usage SET count = MAX(count - ?, 0) WHERE key_hash = ? AND month = ?').run(
    units,
    keyHash,
    m,
  );
}

// ---------------------------------------------------------------------------
// Paliers (chantier « clé sans e-mail », lot 2)
// ---------------------------------------------------------------------------

export interface KeyTierRow {
  tier: KeyTier;
  monthly_limit: number | null;
  claimed_at: string | null;
  claim_method: string | null;
  no_recredit: number;
  shield_episode: string | null;
  origin_prefix: string | null;
  key_prefix: string;
}

/** Le palier d'une clé, par hash. Un seul nom pour cette lecture. */
export function getKeyTier(keyHash: string): KeyTierRow | null {
  const row = getStatsDB()
    .prepare(
      'SELECT tier, monthly_limit, claimed_at, claim_method, no_recredit, shield_episode, origin_prefix, key_prefix FROM api_keys WHERE key_hash = ?',
    )
    .get(keyHash) as KeyTierRow | undefined;
  return row ?? null;
}

/**
 * Faire passer une clé anonyme à un palier supérieur. Idempotente par
 * construction : le WHERE ne retient que le palier anonyme, donc un second
 * appel touche zéro ligne et renvoie false. C'est ce qui rend la réclamation
 * implicite (un règlement au seuil) sûre à appeler depuis un middleware, où
 * elle peut se déclencher deux fois sur une requête rejouée.
 *
 * `key_hash` et non `key_prefix` : key_prefix ne portait aucune unicité dans
 * la base héritée, et un UPDATE sans LIMIT sur une colonne non unique promeut
 * TOUTES les lignes du préfixe.
 *
 * no_recredit, et c'est le point que le contrat de mesure du 15/09 tranche :
 *   - code vérifié (email_code), signature d'agent, geste admin : EFFACÉ. Une
 *     boîte prouvée est le signe de vie que ce drapeau existe pour exiger ;
 *     sans cela une clé née sous bouclier vaudrait 200 À VIE pendant qu'on lui
 *     annonce 200 par mois.
 *   - rails payants (x402, credits, stripe) : POSÉ. 200 unités une fois pour
 *     CLAIM_MIN_PAID_USD, c'est le prix catalogue exact. Récurrent, ce serait
 *     un cadeau qui se revend.
 * shield_episode est effacé dans les deux cas : la réclamation est précisément
 * la preuve que la dégradation ne visait pas cette clé.
 *
 * 🚨 La ligne key_claims s'écrit dans la MÊME transaction que l'UPDATE, avant
 * que le 200 ne parte : une promotion qui ne se journalise pas est invisible
 * au plafond par réseau et non mesurable après coup.
 */
export function claimKey(
  keyHash: string,
  method: KeyClaimMethod,
  opts: { email?: string | null; ipHash?: string | null } = {},
): boolean {
  const byMailbox = method === 'email_code' || method === 'agent_signature' || method === 'admin';
  const tier: KeyTier = byMailbox ? 'claimed' : 'paid';
  const email = opts.email ?? null;
  const emailNorm = email ? normalizeEmail(email) : null;
  const db = getStatsDB();
  const tx = db.transaction((): boolean => {
    const res = db
      .prepare(
        `UPDATE api_keys
            SET tier = ?, monthly_limit = ?, claimed_at = datetime('now'), claim_method = ?,
                no_recredit = ?, shield_episode = NULL,
                email = COALESCE(?, email),
                email_norm = COALESCE(?, email_norm)
          WHERE key_hash = ? AND tier = 'anonymous' AND active = 1`,
      )
      .run(tier, CLAIMED_LIMIT, method, byMailbox ? 0 : 1, email, emailNorm, keyHash);
    if (res.changes === 0) return false;
    const row = db.prepare('SELECT key_prefix FROM api_keys WHERE key_hash = ?').get(keyHash) as {
      key_prefix: string;
    };
    recordKeyClaim({
      event: 'claim',
      emailNorm,
      keyPrefix: row.key_prefix,
      keyHash,
      method,
      ipHash: opts.ipHash ?? null,
    });
    return true;
  });
  return tx();
}
