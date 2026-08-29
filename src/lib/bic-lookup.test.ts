import { describe, it, expect, afterAll } from 'vitest';
import {
  lookup,
  lookupByBic8,
  lookupByBic11,
  lookupByCountryBank,
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

/**
 * Two countries whose keys were unreachable from their own IBANs, measured
 * 29/08/2026 over the entire code space of each.
 */
describe('lookupByCountryBank — Monaco stays Monegasque', () => {
  it('resolves a Monegasque CIB under its own country key', () => {
    // The CIB space is allocated by the Banque de France for both countries,
    // and for years the fourteen Monegasque institutions were keyed under FR:
    // only — reachable from a French IBAN, invisible from a Monegasque one.
    const hit = lookupByCountryBank('MC', '12739');
    expect(hit?.code).toBe('CFMOMCMX');
    expect(hit?.match).toBe('register');
  });

  it('never borrows a French pairing for a Monegasque IBAN', () => {
    // FR:30004 exists in the map. A fallback MC->FR would resolve a French
    // BIC for a Monegasque account — cross-border by construction, and wrong
    // for every institution that operates on both sides.
    expect(lookupByCountryBank('MC', '30004')).toBeNull();
  });
});

describe('lookupByCountryBank — Iceland answers at the bank grain', () => {
  it('reaches the two-digit key from the four-digit bank code', () => {
    // 0133: bank 01 (Landsbankinn), branch 33. The curated keys are two
    // digits; the IBAN carries four. Before the truncation, no Icelandic key
    // was reachable at all.
    const hit = lookupByCountryBank('IS', '0133');
    expect(hit?.code).toBe('NBIIISRE');
    // And the hit says which code it really consulted, so the verdict can
    // serve it as `value` instead of implying the branch digits were checked.
    expect(hit?.checked).toBe('01');
  });

  it('still answers nothing for a bank the map does not carry', () => {
    // 99 is held by nobody; the truncation must widen reach, not certainty.
    expect(lookupByCountryBank('IS', '9933')).toBeNull();
  });
});
