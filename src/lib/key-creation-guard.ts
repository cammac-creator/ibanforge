import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getStatsDB } from './db.js';
import { hashIp } from './stats.js';

/**
 * Free-key creation guard.
 *
 * 2026-08-17: one script created 41 free keys in 19 seconds from a single IP
 * (invented gmail addresses) and consumed 7,449 free units — 54% of all free
 * usage ever served. The per-EMAIL limit (one key per address per day) was
 * useless against invented addresses; this guard counts per NETWORK instead.
 *
 * Two thresholds, one table:
 *  - hard cap: at most DAILY_KEY_CREATION_LIMIT keys per source per 24h;
 *  - identity step: from the SECOND key within VERIFY_WINDOW_DAYS, the caller
 *    must prove it can read the mailbox (6-digit code sent by mail). The
 *    FIRST key stays one-step — instant activation is the product bet, we
 *    only tax the multiplication.
 *
 * The "source" is the salted IP hash the stats pipeline already uses —
 * IPv6 collapsed to its /64 first (one subscriber = one /64; counting full
 * addresses would hand every IPv6 caller millions of free identities).
 * No raw IP ever touches disk here either.
 */

export const DAILY_KEY_CREATION_LIMIT = 3;
export const VERIFY_WINDOW_DAYS = 7;
export const VERIFICATION_TTL_MINUTES = 15;
export const VERIFICATION_MAX_ATTEMPTS = 5;

/** Collapse an IPv6 address to its /64 prefix; IPv4 passes through. */
export function normalizeIpForGuard(ip: string): string {
  if (!ip.includes(':')) return ip;
  // Expand "::" enough to take the first four hextets verbatim when present.
  const groups = ip.split(':').filter((g) => g.length > 0);
  return groups.slice(0, 4).join(':').toLowerCase();
}

/** Salted hash of the guard-normalized source. null when the IP is unknown. */
export function keyCreationSource(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return hashIp(normalizeIpForGuard(ip));
}

/** How many keys this source created in the last `hours` hours. */
export function countKeyCreations(source: string, hours: number): number {
  const row = getStatsDB()
    .prepare("SELECT COUNT(*) AS n FROM key_creations WHERE ip_hash = ? AND created_at >= datetime('now', ?)")
    .get(source, `-${hours} hours`) as { n: number };
  return row.n;
}

/** Record a successful creation; opportunistically prune rows older than 30 days. */
export function recordKeyCreation(source: string): void {
  const db = getStatsDB();
  db.prepare('INSERT INTO key_creations (ip_hash) VALUES (?)').run(source);
  db.prepare("DELETE FROM key_creations WHERE created_at < datetime('now', '-30 days')").run();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Issue (or replace) the verification challenge for this address and return
 * the plain code — the CALLER mails it; only the hash is stored.
 */
export function createVerificationChallenge(email: string, source: string | null): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  getStatsDB()
    .prepare(
      `INSERT INTO pending_verifications (email, code_hash, ip_hash, attempts, created_at, expires_at)
       VALUES (?, ?, ?, 0, datetime('now'), datetime('now', ?))
       ON CONFLICT(email) DO UPDATE SET
         code_hash = excluded.code_hash, ip_hash = excluded.ip_hash,
         attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    )
    .run(email, sha256(code), source, `+${VERIFICATION_TTL_MINUTES} minutes`);
  return code;
}

export type VerificationCheck =
  | { ok: true }
  | { ok: false; reason: 'no_challenge' | 'expired' | 'too_many_attempts' | 'wrong_code' };

/**
 * Check a submitted code. Deletes the challenge on success; counts attempts
 * on failure so the 6 digits cannot be brute-forced within the TTL.
 */
export function checkVerificationCode(email: string, code: string): VerificationCheck {
  const db = getStatsDB();
  const row = db
    .prepare('SELECT code_hash, attempts, expires_at FROM pending_verifications WHERE email = ?')
    .get(email) as { code_hash: string; attempts: number; expires_at: string } | undefined;
  if (!row) return { ok: false, reason: 'no_challenge' };

  const expired = db
    .prepare("SELECT datetime('now') > ? AS gone")
    .get(row.expires_at) as { gone: number };
  if (expired.gone) {
    db.prepare('DELETE FROM pending_verifications WHERE email = ?').run(email);
    return { ok: false, reason: 'expired' };
  }
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  const got = Buffer.from(sha256(code.trim()));
  const want = Buffer.from(row.code_hash);
  const match = got.length === want.length && timingSafeEqual(got, want);
  if (!match) {
    db.prepare('UPDATE pending_verifications SET attempts = attempts + 1 WHERE email = ?').run(email);
    return { ok: false, reason: 'wrong_code' };
  }
  db.prepare('DELETE FROM pending_verifications WHERE email = ?').run(email);
  return { ok: true };
}
