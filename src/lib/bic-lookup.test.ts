import { describe, it, expect, afterAll } from 'vitest';
import {
  lookup,
  lookupByBic8,
  lookupByBic11,
  getEntryCount,
  getLastUpdated,
  getReferenceAsOf,
} from './bic-lookup.js';
import { getBicDB, closeAll } from './db.js';

afterAll(() => {
  closeAll();
});

describe('getEntryCount', () => {
  it('returns a positive number of BIC entries', () => {
    const count = getEntryCount();
    expect(count).toBeGreaterThan(0);
  });
});

describe('lookupByBic11', () => {
  it('finds UBS by full 11-char BIC UBSWCHZH80A', () => {
    const row = lookupByBic11('UBSWCHZH80A');
    expect(row).not.toBeNull();
    expect(row!.bic11).toBe('UBSWCHZH80A');
    expect(row!.bic8).toBe('UBSWCHZH');
    expect(row!.country_code).toBe('CH');
  });

  it('returns null for an unknown 11-char BIC', () => {
    const row = lookupByBic11('XXXXXX11XXX');
    expect(row).toBeNull();
  });
});

describe('lookupByBic8', () => {
  it('returns at least one result for known bic8 UBSWCHZH', () => {
    const rows = lookupByBic8('UBSWCHZH');
    expect(rows).toBeInstanceOf(Array);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].bic8).toBe('UBSWCHZH');
    expect(rows[0].country_code).toBe('CH');
  });

  it('returns an empty array for unknown bic8', () => {
    const rows = lookupByBic8('XXXXXX11');
    expect(rows).toBeInstanceOf(Array);
    expect(rows.length).toBe(0);
  });

  it('each returned row has the expected fields', () => {
    const rows = lookupByBic8('UBSWCHZH');
    for (const row of rows) {
      expect(row).toHaveProperty('bic8');
      expect(row).toHaveProperty('bic11');
      expect(row).toHaveProperty('country_code');
      expect(row).toHaveProperty('source');
    }
  });
});

describe('lookup (generic)', () => {
  it('looks up by 11-char BIC and finds UBS', () => {
    const row = lookup('UBSWCHZH80A');
    expect(row).not.toBeNull();
    expect(row!.bic8).toBe('UBSWCHZH');
  });

  it('looks up by 8-char BIC and returns first match', () => {
    const row = lookup('UBSWCHZH');
    expect(row).not.toBeNull();
    expect(row!.bic8).toBe('UBSWCHZH');
  });

  it('returns null for an unknown BIC', () => {
    const row = lookup('XXXXXX11');
    expect(row).toBeNull();
  });

  it('returns null for an input that is neither 8 nor 11 chars', () => {
    const row = lookup('UBSW');
    expect(row).toBeNull();
  });
});

describe('getLastUpdated — cached, and still the right answer', () => {
  it('agrees with the query it replaces', () => {
    // The cache exists because MAX(updated_at) has no index and scans ~121k
    // rows: 12.6 ms measured 23/08/2026, called twice per enrichment. Speed is
    // worthless if the value drifts, so pin it against the live query.
    const direct = (
      getBicDB().prepare('SELECT MAX(updated_at) AS v FROM bic_entries').get() as { v: string | null }
    ).v;
    expect(getLastUpdated()).toBe(direct);
    expect(getLastUpdated()).toBe(direct); // second call comes from the cache
  });

  it('derives as_of as the year-month of that date', () => {
    const full = getLastUpdated();
    expect(getReferenceAsOf()).toBe((full ?? '').slice(0, 7));
    expect(getReferenceAsOf()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('answers in well under a millisecond once warm', () => {
    // The regression this guards is a caller reintroducing the scan — for
    // instance by clearing the cache in the hot path. The threshold is loose
    // on purpose: it must fail on a full scan (12 ms) and pass on anything
    // sane, on any machine.
    getLastUpdated();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 500; i++) getLastUpdated();
    const perCall = Number(process.hrtime.bigint() - t0) / 1e6 / 500;
    expect(perCall, `${perCall.toFixed(3)} ms per call — the table scan is back`).toBeLessThan(0.5);
  });
});
