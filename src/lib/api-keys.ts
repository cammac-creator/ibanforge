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

export function validateApiKey(
  key: string,
): { valid: boolean; keyHash: string; email?: string; monthlyLimit: number } {
  if (!key.startsWith(KEY_PREFIX)) return { valid: false, keyHash: '', monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  const keyHash = hashKey(key);
  const row = getStatsDB()
    .prepare('SELECT email, monthly_limit FROM api_keys WHERE key_hash = ? AND active = 1')
    .get(keyHash) as { email: string; monthly_limit: number | null } | undefined;
  if (!row) return { valid: false, keyHash, monthlyLimit: DEFAULT_MONTHLY_LIMIT };
  return { valid: true, keyHash, email: row.email, monthlyLimit: row.monthly_limit ?? DEFAULT_MONTHLY_LIMIT };
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
