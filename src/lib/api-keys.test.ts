import { describe, it, expect } from 'vitest';
import { generateApiKey, validateApiKey, checkAndIncrementQuota, getUsage, decrementQuota, revokeApiKey, rotateApiKey } from './api-keys.js';

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
    expect(revokeApiKey(r.api_key)).toBe(true);     // first revoke succeeds
    expect(validateApiKey(r.api_key).valid).toBe(false); // key is dead
    expect(revokeApiKey(r.api_key)).toBe(false);    // second is a no-op
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
