import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  validateApiKey,
  checkAndIncrementQuota,
  getUsage,
  decrementQuota,
  revokeApiKey,
  rotateApiKey,
  recordQuotaNotice,
} from './api-keys.js';
import { buildQuotaWarningEmail } from './email.js';
import { getStatsDB } from './db.js';

// Use a unique suffix per test run to avoid rate-limit conflicts across runs
const RUN_ID = Date.now();

describe('API Keys', () => {
  it('generates a key with ifk_ prefix', () => {
    const result = generateApiKey(`gen-${RUN_ID}@example.com`);
    expect(result).not.toBeNull();
    expect(result!.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(result!.key_prefix.startsWith('ifk_')).toBe(true);
  });

  it('validates a generated key', () => {
    const result = generateApiKey(`val-${RUN_ID}@example.com`);
    const v = validateApiKey(result!.api_key);
    expect(v.valid).toBe(true);
    expect(v.email).toBe(`val-${RUN_ID}@example.com`);
  });

  it('rejects invalid key', () => {
    expect(validateApiKey('ifk_invalid').valid).toBe(false);
  });

  it('rejects non-ifk key', () => {
    expect(validateApiKey('sk_something').valid).toBe(false);
  });

  it('revokeApiKey deactivates a key (and is idempotent)', () => {
    const r = generateApiKey(`revoke-${RUN_ID}@example.com`)!;
    expect(validateApiKey(r.api_key).valid).toBe(true);
    expect(revokeApiKey(r.api_key)).toBe(true); // first revoke succeeds
    expect(validateApiKey(r.api_key).valid).toBe(false); // key is dead
    expect(revokeApiKey(r.api_key)).toBe(false); // second is a no-op
  });

  it('rotateApiKey issues a fresh key and kills the old one', () => {
    const r = generateApiKey(`rotate-${RUN_ID}@example.com`)!;
    const rotated = rotateApiKey(r.api_key)!;
    expect(rotated).not.toBeNull();
    expect(rotated.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(rotated.api_key).not.toBe(r.api_key);
    // old key dead, new key valid, plan carried over
    expect(validateApiKey(r.api_key).valid).toBe(false);
    const v = validateApiKey(rotated.api_key);
    expect(v.valid).toBe(true);
    expect(v.email).toBe(`rotate-${RUN_ID}@example.com`);
  });

  it('rotateApiKey returns null for an invalid key', () => {
    expect(rotateApiKey('ifk_nope')).toBeNull();
  });

  it('tracks usage and enforces quota', () => {
    const result = generateApiKey(`quota-${RUN_ID}@example.com`);
    const v = validateApiKey(result!.api_key);
    const q = checkAndIncrementQuota(v.keyHash);
    expect(q.allowed).toBe(true);
    expect(q.used).toBe(1);
    expect(q.remaining).toBe(199);
  });

  it('measures the ceiling against every month once the monthly reset is off', () => {
    const result = generateApiKey(`norecredit-${RUN_ID}@example.com`);
    const v = validateApiKey(result!.api_key);
    const db = getStatsDB();
    // Stand in for an allowance already spent in an earlier month.
    db.prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)').run(
      v.keyHash,
      '2000-01',
      200,
    );

    // On the normal monthly basis the new month starts clean.
    expect(checkAndIncrementQuota(v.keyHash, 200, 1, false).allowed).toBe(true);

    // Opted out of the reset, the same key is already at its ceiling.
    const q = checkAndIncrementQuota(v.keyHash, 200, 1, true);
    expect(q.allowed).toBe(false);
    expect(q.used).toBeGreaterThanOrEqual(200);
    expect(q.remaining).toBe(0);
  });

  it('reads the opt-out flag back through validateApiKey', () => {
    const result = generateApiKey(`norecredit-flag-${RUN_ID}@example.com`);
    expect(validateApiKey(result!.api_key).noRecredit).toBe(false);
    getStatsDB()
      .prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_prefix = ?')
      .run(result!.key_prefix);
    expect(validateApiKey(result!.api_key).noRecredit).toBe(true);
  });

  it('rotation cannot be used to clear the opt-out flag or reset usage', () => {
    const result = generateApiKey(`norecredit-rotate-${RUN_ID}@example.com`);
    const v = validateApiKey(result!.api_key);
    const db = getStatsDB();
    db.prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_prefix = ?').run(result!.key_prefix);
    checkAndIncrementQuota(v.keyHash, 200, 50, true); // 50 units already spent

    const rotated = rotateApiKey(result!.api_key);
    const nv = validateApiKey(rotated!.api_key);
    // The flag survives the rotation...
    expect(nv.noRecredit).toBe(true);
    // ...and so does the usage: the new key sees the 50 already spent, not 0.
    const q = checkAndIncrementQuota(nv.keyHash, 200, 1, true);
    expect(q.used).toBeGreaterThanOrEqual(51);
  });

  it('returns usage stats', () => {
    const result = generateApiKey(`usage-${RUN_ID}@example.com`);
    const v = validateApiKey(result!.api_key);
    checkAndIncrementQuota(v.keyHash);
    checkAndIncrementQuota(v.keyHash);
    const usage = getUsage(v.keyHash);
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(198);
  });

  it('decrementQuota refunds a consumed slot', () => {
    const result = generateApiKey(`refund-${RUN_ID}@example.com`);
    const v = validateApiKey(result!.api_key);
    checkAndIncrementQuota(v.keyHash);
    checkAndIncrementQuota(v.keyHash);
    decrementQuota(v.keyHash);
    const usage = getUsage(v.keyHash);
    expect(usage.used).toBe(1);
  });

  it('decrementQuota never drops below zero', () => {
    const result = generateApiKey(`refund-floor-${RUN_ID}@example.com`);
    const v = validateApiKey(result!.api_key);
    decrementQuota(v.keyHash);
    decrementQuota(v.keyHash);
    const usage = getUsage(v.keyHash);
    expect(usage.used).toBe(0);
  });
});

// The upsell has to fire on the trajectory, not on the wall. The case in the
// funnel audit burned nearly its whole monthly allowance in a matter of
// minutes: a daily cron would have seen a barely touched quota one morning and
// an exhausted one the next, many hours too late. Detection must live in the
// increment itself.
describe('quota upsell threshold', () => {
  it('flags the call that takes usage across 80% of the monthly limit', () => {
    const key = generateApiKey(`q80-${RUN_ID}@example.com`, 10)!;
    const { keyHash } = validateApiKey(key.api_key);

    const crossings = Array.from(
      { length: 10 },
      () => checkAndIncrementQuota(keyHash, 10).crossedNoticeThreshold,
    );

    expect(crossings.filter(Boolean)).toHaveLength(1);
    expect(crossings[7]).toBe(true); // 8th call → 8/10 = 80%
  });

  it('flags the crossing even when a batch jumps straight over the threshold', () => {
    const key = generateApiKey(`q80-batch-${RUN_ID}@example.com`, 10)!;
    const { keyHash } = validateApiKey(key.api_key);

    const jump = checkAndIncrementQuota(keyHash, 10, 9); // 0 → 9/10, skips 8

    expect(jump.allowed).toBe(true);
    expect(jump.crossedNoticeThreshold).toBe(true);
  });

  it('records the notice for a key and month exactly once', () => {
    const key = generateApiKey(`q80-once-${RUN_ID}@example.com`, 10)!;
    const { keyHash } = validateApiKey(key.api_key);

    expect(recordQuotaNotice(keyHash, '2026-07')).toBe(true);
    expect(recordQuotaNotice(keyHash, '2026-07')).toBe(false);
    expect(recordQuotaNotice(keyHash, '2026-08')).toBe(true); // new month re-arms
  });
});

describe('quota warning email', () => {
  it('leads with a card checkout link and the real numbers', () => {
    const mail = buildQuotaWarningEmail({
      used: 160,
      limit: 200,
      month: '2026-07',
      keyPrefix: 'ifk_da8cb9b9',
    });

    expect(mail.text).toContain('https://buy.stripe.com/');
    expect(mail.text).toContain('160');
    expect(mail.text).toContain('200');
    expect(mail.subject).toContain('80%');
  });

  it('never suggests minting a second free key', () => {
    const mail = buildQuotaWarningEmail({
      used: 160,
      limit: 200,
      month: '2026-07',
      keyPrefix: 'ifk_x',
    });

    expect(mail.text).not.toContain('/v1/keys/generate');
    expect(mail.html).not.toContain('/v1/keys/generate');
  });
});
