import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeIpForGuard,
  keyCreationSource,
  countKeyCreations,
  recordKeyCreation,
  createVerificationChallenge,
  checkVerificationCode,
  VERIFICATION_MAX_ATTEMPTS,
  challengeSendAllowed,
  recordVerificationSend,
  markVerificationOutcome,
  verificationDelivery,
  purgeExpiredVerifications,
  VERIFICATION_SENDS_PER_EMAIL_DAY,
  VERIFICATION_SENDS_PER_SOURCE_DAY,
} from './key-creation-guard.js';
import { getStatsDB } from './db.js';

const RUN = Date.now();

describe('normalizeIpForGuard', () => {
  it('passes IPv4 through unchanged', () => {
    expect(normalizeIpForGuard('203.0.113.87')).toBe('203.0.113.87');
  });

  it('collapses IPv6 to its /64 — one subscriber must not get millions of identities', () => {
    expect(normalizeIpForGuard('2001:db8:aaaa:bbbb:1111:2222:3333:4444')).toBe('2001:db8:aaaa:bbbb');
    expect(normalizeIpForGuard('2001:DB8:AAAA:BBBB:9999:8888:7777:6666')).toBe('2001:db8:aaaa:bbbb');
  });

  it('returns null source when the IP is unknown — the guard fails open, never bricks signups', () => {
    expect(keyCreationSource(null)).toBeNull();
    expect(keyCreationSource(undefined)).toBeNull();
  });
});

describe('creation counting', () => {
  it('counts only the window asked for', () => {
    const src = `guard-test-${RUN}`;
    expect(countKeyCreations(src, 24)).toBe(0);
    recordKeyCreation(src);
    recordKeyCreation(src);
    expect(countKeyCreations(src, 24)).toBe(2);
    // Backdate one row past the window: it must stop counting.
    getStatsDB()
      .prepare("UPDATE key_creations SET created_at = datetime('now', '-2 days') WHERE ip_hash = ? AND id = (SELECT MIN(id) FROM key_creations WHERE ip_hash = ?)")
      .run(src, src);
    expect(countKeyCreations(src, 24)).toBe(1);
    expect(countKeyCreations(src, 24 * 7)).toBe(2);
  });

  it('stores the client library string and minted prefix when given', () => {
    const src = `guard-ua-${RUN}`;
    recordKeyCreation(src, 'demo-http-client/9.9.9', 'ifk_testpref1');
    const row = getStatsDB()
      .prepare('SELECT user_agent, key_prefix FROM key_creations WHERE ip_hash = ? ORDER BY id DESC LIMIT 1')
      .get(src) as { user_agent: string | null; key_prefix: string | null };
    expect(row.user_agent).toBe('demo-http-client/9.9.9');
    expect(row.key_prefix).toBe('ifk_testpref1');
  });

  it('keeps the older two-argument shape working — both new fields default to null', () => {
    const src = `guard-legacy-${RUN}`;
    recordKeyCreation(src);
    const row = getStatsDB()
      .prepare('SELECT user_agent, key_prefix FROM key_creations WHERE ip_hash = ? ORDER BY id DESC LIMIT 1')
      .get(src) as { user_agent: string | null; key_prefix: string | null };
    expect(row.user_agent).toBeNull();
    expect(row.key_prefix).toBeNull();
  });
});

describe('verification challenge', () => {
  it('accepts the right code exactly once', () => {
    const email = `verif-${RUN}@alpha-corp.example.net`;
    const code = createVerificationChallenge(email, 'src');
    expect(code).toMatch(/^\d{6}$/);
    expect(checkVerificationCode(email, code)).toEqual({ ok: true });
    // Consumed on success — replay must fail.
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('locks after too many wrong attempts — 6 digits must not be brute-forceable', () => {
    const email = `verif-lock-${RUN}@alpha-corp.example.net`;
    const code = createVerificationChallenge(email, 'src');
    for (let i = 0; i < VERIFICATION_MAX_ATTEMPTS; i++) {
      expect(checkVerificationCode(email, '000000').ok).toBe(false);
    }
    // Even the RIGHT code is refused once the lock is on.
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('refuses an expired code and clears it', () => {
    const email = `verif-exp-${RUN}@alpha-corp.example.net`;
    const code = createVerificationChallenge(email, 'src');
    getStatsDB()
      .prepare("UPDATE pending_verifications SET expires_at = datetime('now', '-1 minute') WHERE email = ?")
      .run(email);
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'expired' });
    expect(checkVerificationCode(email, code)).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('re-requesting a challenge replaces the previous code', () => {
    const email = `verif-re-${RUN}@alpha-corp.example.net`;
    const first = createVerificationChallenge(email, 'src');
    const second = createVerificationChallenge(email, 'src');
    if (first !== second) {
      expect(checkVerificationCode(email, first).ok).toBe(false);
    }
    expect(checkVerificationCode(email, second)).toEqual({ ok: true });
  });
});

describe('verification send limits (mail-bombing guard)', () => {
  it('caps sends per recipient — nobody needs a 4th code in a day', () => {
    const src = `send-src-${RUN}-a`;
    const email = `victim-${RUN}@bank.example.net`;
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      expect(challengeSendAllowed(src, email)).toEqual({ ok: true });
      recordVerificationSend(src, email);
    }
    // Even from a DIFFERENT source, the recipient is now protected.
    expect(challengeSendAllowed(`${src}-other`, email)).toEqual({ ok: false, reason: 'recipient' });
  });

  it('caps sends per source — bounds a distributed spray', () => {
    const src = `send-src-${RUN}-b`;
    // Fresh address each time so the recipient cap never fires first.
    for (let i = 0; i < VERIFICATION_SENDS_PER_SOURCE_DAY; i++) {
      const email = `spray-${RUN}-${i}@example.net`;
      expect(challengeSendAllowed(src, email)).toEqual({ ok: true });
      recordVerificationSend(src, email);
    }
    expect(challengeSendAllowed(src, `spray-${RUN}-final@example.net`)).toEqual({ ok: false, reason: 'source' });
  });

  it('a null source is still bounded by the recipient cap (fail-open on source only)', () => {
    const email = `nullsrc-${RUN}@example.net`;
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      expect(challengeSendAllowed(null, email)).toEqual({ ok: true });
      recordVerificationSend(null, email);
    }
    expect(challengeSendAllowed(null, email)).toEqual({ ok: false, reason: 'recipient' });
  });

  it('purges expired pending challenges and stale send rows', () => {
    const db = getStatsDB();
    const email = `purge-${RUN}@example.net`;
    // Insert directly in the target state — recordVerificationSend would itself
    // purge the expired pending row and defeat what we mean to test.
    db.prepare(
      "INSERT INTO pending_verifications (email, code_hash, ip_hash, attempts, created_at, expires_at) VALUES (?, 'h', 'src', 0, datetime('now','-20 minutes'), datetime('now','-1 minute'))",
    ).run(email);
    db.prepare(
      "INSERT INTO verification_sends (ip_hash, email_hash, created_at) VALUES ('purge-src', 'eh', datetime('now','-3 days'))",
    ).run();
    const removed = purgeExpiredVerifications();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pending_verifications WHERE email = ?').get(email)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM verification_sends WHERE ip_hash = 'purge-src'").get()).toEqual({ n: 0 });
  });
});

/**
 * The verification channel now records what the relay did with each code.
 * Before 21/08 it recorded only that a code had been sent, so a channel
 * refusing everything looked exactly like a channel working perfectly.
 */
describe('verificationDelivery', () => {
  beforeEach(() => {
    getStatsDB().prepare('DELETE FROM verification_sends').run();
  });

  it('reports nothing to judge when nothing was attempted', () => {
    const d = verificationDelivery(24);
    expect(d.attempted).toBe(0);
    // null, not 0: an idle channel has not proven itself healthy.
    expect(d.refused_ratio).toBeNull();
  });

  it('counts a refusal recorded against its own send', () => {
    const id = recordVerificationSend('net-hash', 'acme@example.com');
    markVerificationOutcome(id, false);
    const d = verificationDelivery(24);
    expect(d.attempted).toBe(1);
    expect(d.refused).toBe(1);
    expect(d.refused_ratio).toBe(1);
  });

  it('does not count an accepted send as refused', () => {
    markVerificationOutcome(recordVerificationSend('net-hash', 'acme@example.com'), true);
    const d = verificationDelivery(24);
    expect(d.refused).toBe(0);
    expect(d.refused_ratio).toBe(0);
  });

  it('counts an unknown outcome as attempted but never as refused', () => {
    // A row written before the column existed, or a crash between the two writes.
    recordVerificationSend('net-hash', 'acme@example.com');
    const d = verificationDelivery(24);
    expect(d.attempted).toBe(1);
    expect(d.refused).toBe(0);
  });

  it('ignores an id that never existed rather than touching another row', () => {
    markVerificationOutcome(recordVerificationSend('net-hash', 'acme@example.com'), true);
    markVerificationOutcome(0, false);
    markVerificationOutcome(-1, false);
    expect(verificationDelivery(24).refused).toBe(0);
  });

  it('mixes outcomes into a ratio', () => {
    markVerificationOutcome(recordVerificationSend('n', 'a@example.com'), false);
    markVerificationOutcome(recordVerificationSend('n', 'b@example.com'), false);
    markVerificationOutcome(recordVerificationSend('n', 'c@example.com'), true);
    markVerificationOutcome(recordVerificationSend('n', 'd@example.com'), true);
    expect(verificationDelivery(24).refused_ratio).toBe(0.5);
  });
});
