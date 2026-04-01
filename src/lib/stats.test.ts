import { describe, it, expect, afterAll } from 'vitest';
import { recordOperation, recordBatch, getStats, getQuickStats, getStatsHistory } from './stats.js';
import { closeAll } from './db.js';

afterAll(() => {
  closeAll();
});

describe('recordOperation', () => {
  it('does not throw when recording a successful IBAN validation', () => {
    expect(() => recordOperation('iban_validate', 'CH', true, 0.005)).not.toThrow();
  });

  it('does not throw when recording a failed BIC lookup', () => {
    expect(() => recordOperation('bic_lookup', null, false, 0.003)).not.toThrow();
  });

  it('does not throw when country_code is null', () => {
    expect(() => recordOperation('iban_batch', null, true, 0.020)).not.toThrow();
  });
});

describe('recordBatch', () => {
  it('does not throw when recording a batch', () => {
    expect(() => recordBatch(5, 4, 0.020)).not.toThrow();
  });
});

describe('getStats', () => {
  it('returns an object with total_operations', () => {
    const stats = getStats();
    expect(stats).toHaveProperty('total_operations');
    expect(typeof stats.total_operations).toBe('number');
  });

  it('total_operations is >= 0', () => {
    const stats = getStats();
    expect(stats.total_operations).toBeGreaterThanOrEqual(0);
  });

  it('has by_type with iban_validate, iban_batch and bic_lookup keys', () => {
    const stats = getStats();
    expect(stats.by_type).toHaveProperty('iban_validate');
    expect(stats.by_type).toHaveProperty('iban_batch');
    expect(stats.by_type).toHaveProperty('bic_lookup');
  });

  it('iban_validate stats have total, valid_count and success_rate', () => {
    const stats = getStats();
    const iv = stats.by_type.iban_validate;
    expect(typeof iv.total).toBe('number');
    expect(typeof iv.valid_count).toBe('number');
    expect(typeof iv.success_rate).toBe('number');
  });

  it('bic_lookup stats have total, found_count and hit_rate', () => {
    const stats = getStats();
    const bl = stats.by_type.bic_lookup;
    expect(typeof bl.total).toBe('number');
    expect(typeof bl.found_count).toBe('number');
    expect(typeof bl.hit_rate).toBe('number');
  });

  it('total_revenue_usdc is a number >= 0', () => {
    const stats = getStats();
    expect(typeof stats.total_revenue_usdc).toBe('number');
    expect(stats.total_revenue_usdc).toBeGreaterThanOrEqual(0);
  });

  it('top_countries is an array', () => {
    const stats = getStats();
    expect(Array.isArray(stats.top_countries)).toBe(true);
  });

  it('last_7_days is an array', () => {
    const stats = getStats();
    expect(Array.isArray(stats.last_7_days)).toBe(true);
  });

  it('reflects recorded operations (total_operations increases after recordOperation)', () => {
    const before = getStats().total_operations;
    recordOperation('iban_validate', 'DE', true, 0.005);
    const after = getStats().total_operations;
    expect(after).toBe(before + 1);
  });
});

describe('getQuickStats', () => {
  it('returns total_operations, iban_validations, bic_lookups and success_rate', () => {
    const qs = getQuickStats();
    expect(qs).toHaveProperty('total_operations');
    expect(qs).toHaveProperty('iban_validations');
    expect(qs).toHaveProperty('bic_lookups');
    expect(qs).toHaveProperty('success_rate');
  });

  it('all fields are numbers', () => {
    const qs = getQuickStats();
    expect(typeof qs.total_operations).toBe('number');
    expect(typeof qs.iban_validations).toBe('number');
    expect(typeof qs.bic_lookups).toBe('number');
    expect(typeof qs.success_rate).toBe('number');
  });

  it('total_operations >= 0', () => {
    const qs = getQuickStats();
    expect(qs.total_operations).toBeGreaterThanOrEqual(0);
  });

  it('success_rate is between 0 and 100', () => {
    const qs = getQuickStats();
    expect(qs.success_rate).toBeGreaterThanOrEqual(0);
    expect(qs.success_rate).toBeLessThanOrEqual(100);
  });
});

describe('getStatsHistory', () => {
  it('returns an array', () => {
    const history = getStatsHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it('returns an array with default 7-day window', () => {
    const history = getStatsHistory();
    expect(history.length).toBeLessThanOrEqual(7);
  });

  it('accepts a custom number of days', () => {
    const history = getStatsHistory(30);
    expect(history.length).toBeLessThanOrEqual(30);
  });

  it('each entry has date, iban_validate, iban_batch, bic_lookup and revenue_usdc fields', () => {
    // Record at least one op to guarantee at least one row today
    recordOperation('iban_validate', 'FR', true, 0.005);
    const history = getStatsHistory(1);
    if (history.length > 0) {
      const entry = history[0];
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('iban_validate');
      expect(entry).toHaveProperty('iban_batch');
      expect(entry).toHaveProperty('bic_lookup');
      expect(entry).toHaveProperty('revenue_usdc');
    }
  });
});
