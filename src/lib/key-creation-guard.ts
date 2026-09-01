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

/**
 * Verification codes are mailed to an address the CALLER supplies, so the send
 * path is a mail-bombing vector: the daily key-creation cap only counts
 * SUCCESSFUL creations (recordKeyCreation), while a code is mailed on the
 * challenge branch that returns 403 before ever creating a key. So the send is
 * bounded here instead, on its own append-only ledger:
 *   - per RECIPIENT: nobody needs a 4th code in a day — this kills targeting
 *     one victim's inbox;
 *   - per SOURCE: generous enough for a shared NAT (an office/university sits
 *     behind one public IP) yet a hard ceiling on a distributed spray.
 */
export const VERIFICATION_SENDS_PER_EMAIL_DAY = 3;
export const VERIFICATION_SENDS_PER_SOURCE_DAY = 15;

/**
 * Collapse an IPv6 address to its /64 prefix; IPv4 passes through.
 *
 * The point of the /64 is that a residential IPv6 customer is handed a whole
 * prefix and can pick a new address inside it for free — so the cap has to
 * count the prefix, not the address. Until 2026-09-01 the compressed groups
 * were merely DROPPED before taking the first four, which broke that in both
 * directions: `2001:db8::1` and `2001:db8::2` are the same /64 and landed in
 * two different buckets, and the same machine changed bucket depending on
 * whether it wrote its address compressed or in full (SEC-05, audit
 * 2026-09-01). Expanding "::" back to the zero groups it stands for, then
 * writing each hextet one canonical way, gives one bucket per /64 and one form
 * per machine.
 *
 * The counters restart once after this ships: the bucket keys change shape.
 */
export function normalizeIpForGuard(ip: string): string {
  if (!ip.includes(':')) return ip;
  // Zone index (fe80::1%eth0) identifies a local interface, never the peer.
  const bare = ip.split('%')[0].trim().toLowerCase();
  // ::ffff:192.0.2.1 is an IPv4 client wearing an IPv6 hat — the form Node
  // itself hands out on a dual-stack socket. Its first four hextets are zeros
  // for EVERY such address, so expanding it would drop every IPv4 caller into
  // one shared bucket and turn a per-source cap into a global one. Bucket it on
  // the address that actually identifies the machine.
  const lastGroup = bare.slice(bare.lastIndexOf(':') + 1);
  if (lastGroup.includes('.')) return lastGroup;
  const at = bare.indexOf('::');
  let groups: string[];
  if (at === -1) {
    groups = bare.split(':');
  } else {
    const head = bare.slice(0, at) ? bare.slice(0, at).split(':') : [];
    const tail = bare.slice(at + 2) ? bare.slice(at + 2).split(':') : [];
    const missing = Math.max(0, 8 - head.length - tail.length);
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  }
  // Leading zeros stripped rather than padded (RFC 5952's canonical text), so
  // `2001:0db8:…` and `2001:db8:…` are one bucket and the keys already in the
  // table keep the shape they have.
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
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

/**
 * Record a successful creation; opportunistically prune rows older than 30 days.
 * `userAgent` (the client library string) and `keyPrefix` (the minted key) are
 * captured so the same automated client rotating its network address can still
 * be linked into one cohort by its stable library string, and a matched cohort
 * traced back to its keys. Both default to null (older call sites, tests).
 */
export function recordKeyCreation(
  source: string,
  userAgent: string | null = null,
  keyPrefix: string | null = null,
): void {
  const db = getStatsDB();
  db.prepare('INSERT INTO key_creations (ip_hash, user_agent, key_prefix) VALUES (?, ?, ?)').run(
    source,
    userAgent ? userAgent.slice(0, 256) : null,
    keyPrefix ?? null,
  );
  db.prepare("DELETE FROM key_creations WHERE created_at < datetime('now', '-30 days')").run();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * May we mail a verification code for this (source, recipient) right now?
 * Both windows are 24h. Returns the reason so the caller can answer precisely.
 */
export type ChallengeSendCheck = { ok: true } | { ok: false; reason: 'recipient' | 'source' };
export function challengeSendAllowed(source: string | null, email: string): ChallengeSendCheck {
  const db = getStatsDB();
  const toEmail = (
    db
      .prepare("SELECT COUNT(*) AS n FROM verification_sends WHERE email_hash = ? AND created_at >= datetime('now', '-24 hours')")
      .get(sha256(email.trim().toLowerCase())) as { n: number }
  ).n;
  if (toEmail >= VERIFICATION_SENDS_PER_EMAIL_DAY) return { ok: false, reason: 'recipient' };
  // A null source (unknown IP) cannot be rate-limited by source, only by
  // recipient — same fail-open stance as the creation guard. In prod Railway
  // always supplies the IP, so source is never null there.
  if (source) {
    const fromSource = (
      db
        .prepare("SELECT COUNT(*) AS n FROM verification_sends WHERE ip_hash = ? AND created_at >= datetime('now', '-24 hours')")
        .get(source) as { n: number }
    ).n;
    if (fromSource >= VERIFICATION_SENDS_PER_SOURCE_DAY) return { ok: false, reason: 'source' };
  }
  return { ok: true };
}

/**
 * Log a code send (append-only) and opportunistically purge: old send rows
 * (past the 24h counting window) and expired pending challenges, so neither
 * table grows without bound between the daily retention runs.
 */
export function recordVerificationSend(source: string | null, email: string): number {
  const db = getStatsDB();
  const info = db.prepare('INSERT INTO verification_sends (ip_hash, email_hash) VALUES (?, ?)').run(
    source,
    sha256(email.trim().toLowerCase()),
  );
  db.prepare("DELETE FROM verification_sends WHERE created_at < datetime('now', '-2 days')").run();
  db.prepare("DELETE FROM pending_verifications WHERE expires_at < datetime('now')").run();
  return Number(info.lastInsertRowid);
}

/**
 * Record what the relay did with a verification code.
 *
 * `accepted` is what the relay said, not what the mailbox did: a 200 means
 * queued, and the hard bounce arrives later by a path nothing here can see.
 * Recording it anyway is the difference between a failure rate we can watch
 * and the silence that let three days of bounces go uncounted.
 */
export function markVerificationOutcome(id: number, accepted: boolean): void {
  if (!Number.isFinite(id) || id <= 0) return;
  getStatsDB().prepare('UPDATE verification_sends SET relay_accepted = ? WHERE id = ?').run(accepted ? 1 : 0, id);
}

export interface VerificationDelivery {
  window_hours: number;
  attempted: number;
  refused: number;
  /** Share refused by the relay, 0..1. `null` when nothing was attempted. */
  refused_ratio: number | null;
}

/**
 * How the verification channel is doing, over the last `hours`.
 *
 * Rows with a NULL outcome are counted as attempted but never as refused:
 * an unknown outcome is not a success and not a failure, and inventing either
 * would be the same mistake as calling a relay 200 a delivery.
 */
export function verificationDelivery(hours = 24): VerificationDelivery {
  const row = getStatsDB()
    .prepare(
      `SELECT COUNT(*) attempted,
              SUM(CASE WHEN relay_accepted = 0 THEN 1 ELSE 0 END) refused
         FROM verification_sends
        WHERE created_at >= datetime('now', ?)`,
    )
    .get(`-${hours} hours`) as { attempted: number; refused: number | null };
  const attempted = row?.attempted ?? 0;
  const refused = row?.refused ?? 0;
  return {
    window_hours: hours,
    attempted,
    refused,
    refused_ratio: attempted === 0 ? null : refused / attempted,
  };
}

/**
 * Retention backstop for the two verification tables, in case no send happens
 * to trigger the opportunistic purge above. Called from the daily cron.
 * Returns the number of rows removed.
 */
export function purgeExpiredVerifications(): number {
  const db = getStatsDB();
  const a = db.prepare("DELETE FROM verification_sends WHERE created_at < datetime('now', '-2 days')").run().changes;
  const b = db.prepare("DELETE FROM pending_verifications WHERE expires_at < datetime('now')").run().changes;
  return a + b;
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
