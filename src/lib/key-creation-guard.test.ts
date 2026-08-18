import { describe, it, expect } from 'vitest';
import {
  normalizeIpForGuard,
  keyCreationSource,
  countKeyCreations,
  recordKeyCreation,
  createVerificationChallenge,
  checkVerificationCode,
  VERIFICATION_MAX_ATTEMPTS,
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
