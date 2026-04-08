import { describe, it, expect } from 'vitest';
import { generateApiKey, validateApiKey, checkAndIncrementQuota, getUsage } from './api-keys.js';

describe('API Keys', () => {
  it('generates a key with ifk_ prefix', () => {
    const result = generateApiKey('gen-test@example.com');
    expect(result).not.toBeNull();
    expect(result!.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(result!.key_prefix.startsWith('ifk_')).toBe(true);
  });

  it('validates a generated key', () => {
    const result = generateApiKey('val-test@example.com');
    const v = validateApiKey(result!.api_key);
    expect(v.valid).toBe(true);
    expect(v.email).toBe('val-test@example.com');
  });

  it('rejects invalid key', () => {
    expect(validateApiKey('ifk_invalid').valid).toBe(false);
  });

  it('rejects non-ifk key', () => {
    expect(validateApiKey('sk_something').valid).toBe(false);
  });

  it('tracks usage and enforces quota', () => {
    const result = generateApiKey('quota-test@example.com');
    const v = validateApiKey(result!.api_key);
    const q = checkAndIncrementQuota(v.keyHash);
    expect(q.allowed).toBe(true);
    expect(q.used).toBe(1);
    expect(q.remaining).toBe(199);
  });

  it('returns usage stats', () => {
    const result = generateApiKey('usage-test@example.com');
    const v = validateApiKey(result!.api_key);
    checkAndIncrementQuota(v.keyHash);
    checkAndIncrementQuota(v.keyHash);
    const usage = getUsage(v.keyHash);
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(198);
  });
});
