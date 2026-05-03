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
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit) VALUES (?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, email, monthlyLimit ?? null);
  return { api_key: rawKey, key_prefix: keyPrefix };
}

/**
 * Bundle credits — a key that consumes from a prepaid pool of N calls instead
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

export interface ApiKeyValidation {
  valid: boolean;
  keyHash: string;
  email?: string;
  monthlyLimit: number;
  /** When set, the key is a credit-based bundle key (NOT monthly subscription). */
  creditsRemaining?: number;
  creditsTotal?: number;
}

export function validateApiKey(key: string): ApiKeyValidation {
  if (!key.startsWith(KEY_PREFIX)) return { valid: false, keyHash: '', monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  const keyHash = hashKey(key);
  const row = getStatsDB()
    .prepare('SELECT email, monthly_limit, credits_remaining, credits_total FROM api_keys WHERE key_hash = ? AND active = 1')
    .get(keyHash) as { email: string; monthly_limit: number | null; credits_remaining: number | null; credits_total: number | null } | undefined;
  if (!row) return { valid: false, keyHash, monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  return {
    valid: true,
    keyHash,
    email: row.email,
    monthlyLimit: row.monthly_limit ?? DEFAULT_MONTHLY_LIMIT,
    creditsRemaining: row.credits_remaining ?? undefined,
    creditsTotal: row.credits_total ?? undefined,
  };
}

/**
 * Atomically decrement credits_remaining when a credit-based key serves a call.
 * Returns the new remaining count. -1 if already exhausted (caller should
 * fall through to x402).
 */
export function decrementCredits(keyHash: string): number {
  const db = getStatsDB();
  const result = db.prepare(
    'UPDATE api_keys SET credits_remaining = credits_remaining - 1 WHERE key_hash = ? AND active = 1 AND credits_remaining > 0',
  ).run(keyHash);
  if (result.changes === 0) return -1;
  const row = db.prepare('SELECT credits_remaining FROM api_keys WHERE key_hash = ?').get(keyHash) as { credits_remaining: number } | undefined;
  return row?.credits_remaining ?? -1;
}

/**
 * Refund a previously-decremented credit when the downstream handler returned
 * a 4xx (client error — bad input). Mirrors decrementQuota for monthly keys.
 */
export function refundCredit(keyHash: string): void {
  getStatsDB().prepare(
    'UPDATE api_keys SET credits_remaining = credits_remaining + 1 WHERE key_hash = ? AND credits_remaining IS NOT NULL',
  ).run(keyHash);
}

export function checkAndIncrementQuota(
  keyHash: string,
  monthlyLimit: number = DEFAULT_MONTHLY_LIMIT,
): { allowed: boolean; used: number; limit: number; remaining: number; month: string } {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  db.prepare(
    'INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 0) ON CONFLICT(key_hash, month) DO NOTHING',
  ).run(keyHash, month);
  const row = db.prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?').get(keyHash, month) as {
    count: number;
  };
  if (row.count >= monthlyLimit) {
    return { allowed: false, used: row.count, limit: monthlyLimit, remaining: 0, month };
  }
  db.prepare('UPDATE api_usage SET count = count + 1 WHERE key_hash = ? AND month = ?').run(keyHash, month);
  return {
    allowed: true,
    used: row.count + 1,
    limit: monthlyLimit,
    remaining: monthlyLimit - row.count - 1,
    month,
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
 * Decrement the quota counter for this key+month. Used to refund a consumed
 * slot when the underlying request failed with a client error (4xx) — we
 * should not punish callers for malformed input by eating their quota.
 */
export function decrementQuota(keyHash: string): void {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  db.prepare(
    'UPDATE api_usage SET count = MAX(count - 1, 0) WHERE key_hash = ? AND month = ?',
  ).run(keyHash, month);
}
