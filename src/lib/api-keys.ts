import { createHash, randomBytes } from 'node:crypto';
import { getStatsDB } from './db.js';

const DEFAULT_MONTHLY_LIMIT = 200;
const KEY_PREFIX = 'ifk_';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(
  email: string,
  monthlyLimit?: number,
  source?: string,
): { api_key: string; key_prefix: string } | null {
  const db = getStatsDB();
  const existing = db
    .prepare("SELECT id FROM api_keys WHERE email = ? AND created_at >= datetime('now', '-1 day')")
    .get(email) as { id: number } | undefined;
  if (existing) return null;

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, source) VALUES (?, ?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, email, monthlyLimit ?? null, source ?? null);
  return { api_key: rawKey, key_prefix: keyPrefix };
}

/**
 * Bundle credits — a key that consumes from a prepaid pool of N credits instead
 * of the monthly subscription model. Created after a successful x402 payment
 * on /v1/credits/buy. No daily-rate-limit on creation (the payment already
 * provided abuse-resistance).
 */
export function generateCreditKey(
  email: string | null,
  credits: number,
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
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, credits_remaining, credits_total) VALUES (?, ?, ?, NULL, ?, ?)',
  ).run(keyHash, keyPrefix, storedEmail, credits, credits);
  return { api_key: rawKey, key_prefix: keyPrefix, credits };
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
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, credits_remaining, credits_total, stripe_session_id, raw_key_one_time_view) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, storedEmail, credits, credits, stripeSessionId, rawKey);

  return { api_key: rawKey, key_prefix: keyPrefix, credits, idempotent: false };
}

/** Monthly request allowance attached to an Editor/OEM subscription key. */
export const OEM_MONTHLY_LIMIT = 50_000;

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
    return { api_key: null, key_prefix: existing.key_prefix, monthly_limit: monthlyLimit, idempotent: true };
  }

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const storedEmail = email && email.includes('@') ? email : 'oem-subscriber';

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, stripe_session_id, stripe_subscription_id, raw_key_one_time_view) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, storedEmail, monthlyLimit, stripeSessionId, stripeSubscriptionId, rawKey);

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
  db.prepare("UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE stripe_subscription_id = ?").run(stripeSubscriptionId);
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
export function consumeOneTimeKey(
  stripeSessionId: string,
): { api_key: string; credits_total: number | null; credits_remaining: number | null; monthly_limit: number | null; email: string | null } | null {
  const db = getStatsDB();
  const row = db.prepare(
    'SELECT raw_key_one_time_view, credits_total, credits_remaining, monthly_limit, email FROM api_keys WHERE stripe_session_id = ? AND raw_key_one_time_view IS NOT NULL AND active = 1',
  ).get(stripeSessionId) as
    | { raw_key_one_time_view: string; credits_total: number | null; credits_remaining: number | null; monthly_limit: number | null; email: string }
    | undefined;

  if (!row) return null;

  db.prepare('UPDATE api_keys SET raw_key_one_time_view = NULL WHERE stripe_session_id = ?').run(stripeSessionId);

  return {
    api_key: row.raw_key_one_time_view,
    credits_total: row.credits_total,
    credits_remaining: row.credits_remaining,
    monthly_limit: row.monthly_limit,
    email: row.email === 'stripe-buyer' || row.email === 'oem-subscriber' ? null : row.email,
  };
}

export interface ApiKeyValidation {
  valid: boolean;
  keyHash: string;
  email?: string;
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
    .prepare("UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE key_hash = ? AND active = 1")
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
export function rotateApiKey(
  oldKey: string,
): { api_key: string; key_prefix: string; monthly_limit: number | null; credits_remaining: number | null } | null {
  if (!oldKey.startsWith(KEY_PREFIX)) return null;
  const db = getStatsDB();
  const oldHash = hashKey(oldKey);
  const row = db
    .prepare('SELECT email, monthly_limit, credits_remaining, credits_total FROM api_keys WHERE key_hash = ? AND active = 1')
    .get(oldHash) as
    | { email: string; monthly_limit: number | null; credits_remaining: number | null; credits_total: number | null }
    | undefined;
  if (!row) return null;

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const newHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, credits_remaining, credits_total) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(newHash, keyPrefix, row.email, row.monthly_limit, row.credits_remaining, row.credits_total);
    db.prepare("UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE key_hash = ?").run(oldHash);
  });
  tx();

  return {
    api_key: rawKey,
    key_prefix: keyPrefix,
    monthly_limit: row.monthly_limit,
    credits_remaining: row.credits_remaining,
  };
}

export function validateApiKey(key: string): ApiKeyValidation {
  if (!key.startsWith(KEY_PREFIX)) return { valid: false, keyHash: '', monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  const keyHash = hashKey(key);
  const row = getStatsDB()
    .prepare(
      'SELECT email, monthly_limit, credits_remaining, credits_total, no_recredit FROM api_keys WHERE key_hash = ? AND active = 1',
    )
    .get(keyHash) as
    | {
        email: string;
        monthly_limit: number | null;
        credits_remaining: number | null;
        credits_total: number | null;
        no_recredit: number | null;
      }
    | undefined;
  if (!row) return { valid: false, keyHash, monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  return {
    valid: true,
    keyHash,
    email: row.email,
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
  const result = db.prepare(
    'UPDATE api_keys SET credits_remaining = credits_remaining - ? WHERE key_hash = ? AND active = 1 AND credits_remaining >= ?',
  ).run(units, keyHash, units);
  const row = db.prepare('SELECT credits_remaining FROM api_keys WHERE key_hash = ?').get(keyHash) as { credits_remaining: number | null } | undefined;
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
  getStatsDB().prepare(
    'UPDATE api_keys SET credits_remaining = MIN(credits_remaining + ?, credits_total) WHERE key_hash = ? AND credits_remaining IS NOT NULL',
  ).run(units, keyHash);
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
  getStatsDB().prepare('DELETE FROM quota_notices WHERE key_hash = ? AND month = ?').run(keyHash, month);
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
  db.prepare(
    'INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 0) ON CONFLICT(key_hash, month) DO NOTHING',
  ).run(keyHash, month);
  const row = db.prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?').get(keyHash, month) as {
    count: number;
  };
  // What the ceiling is measured against. Normally the current month; for a key
  // opted out of the monthly reset, every month it has ever used.
  const measured = noRecredit
    ? (db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM api_usage WHERE key_hash = ?').get(keyHash) as { n: number }).n
    : row.count;
  if (measured + units > monthlyLimit) {
    return {
      allowed: false,
      used: measured,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - measured),
      month,
      crossedNoticeThreshold: false,
    };
  }
  db.prepare('UPDATE api_usage SET count = count + ? WHERE key_hash = ? AND month = ?').run(units, keyHash, month);
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

export function getUsage(
  keyHash: string,
  monthlyLimit: number = DEFAULT_MONTHLY_LIMIT,
): { used: number; limit: number; remaining: number; month: string } {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  const row = db.prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?').get(keyHash, month) as
    | { count: number }
    | undefined;
  const used = row?.count ?? 0;
  return { used, limit: monthlyLimit, remaining: monthlyLimit - used, month };
}

/**
 * Decrement the quota counter for this key+month. Used to refund consumed
 * slots when the underlying request failed with a client error (4xx) — we
 * should not punish callers for malformed input by eating their quota.
 */
export function decrementQuota(keyHash: string, units = 1): void {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  db.prepare(
    'UPDATE api_usage SET count = MAX(count - ?, 0) WHERE key_hash = ? AND month = ?',
  ).run(units, keyHash, month);
}
