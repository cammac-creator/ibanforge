import { describe, it, expect } from 'vitest';
import { lookupByCountryBank } from './bic-lookup.js';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';

/**
 * The BIC block was the only served field with no provenance at all.
 *
 * `bank_code_check` carries register / authoritative / as_of and
 * `modulus_check` carries source / table_fetched_on, while `bic` carried
 * `{code, bank_name, city}` and nothing else — although the rows behind it come
 * from sources of very different standing (measured 20/08/2026: about two
 * thirds from a redistributed SWIFT directory scrape, about one third from
 * GLEIF). Telling those apart is exactly what an auditor or an agent weighing
 * the answer needs, and it was impossible from the response.
 */
describe('the BIC block says where it comes from', () => {
  it('credits the curated map for a pairing the curated map made', () => {
    const hit = lookupByCountryBank('DE', '37040044');
    expect(hit).not.toBeNull();
    expect(hit!.match).toBe('register');
    // Not "GLEIF": the directory only supplied the details, the curated map
    // decided WHICH institution this bank code belongs to.
    expect(hit!.source).toBe('IBANforge curated bank-code map');
    expect(hit!.as_of).toMatch(/^\d{4}-\d{2}$/);
  });

  it('names the directory dataset when the prefix fallback read it', () => {
    // Where a bank code may open on a letter, a code absent from the curated
    // map falls through to the `bic8 LIKE code%` search, and there the row
    // really is the source. Several candidates rather than one: the directory
    // is reseeded monthly, and a test pinned to a single institution would go
    // red on ordinary churn instead of on a regression.
    const candidates = [['IE', 'MONZ'], ['GB', 'AUGT'], ['NL', 'MOXR'], ['IE', 'KLRN']] as const;
    const hits = candidates
      .map(([cc, code]) => lookupByCountryBank(cc, code))
      .filter((h) => h?.match === 'prefix');
    expect(hits.length, 'no prefix-resolved bank code left in the directory').toBeGreaterThan(0);

    for (const hit of hits) {
      expect(hit!.source).toBeTruthy();
      // A human name, never the raw column value: "swiftcodes" means nothing to
      // a caller, and shortening it to "SWIFT" would claim a feed we do not
      // have.
      expect(hit!.source).not.toBe('swiftcodes');
      expect(hit!.source).not.toBe('gleif');
      expect(hit!.as_of).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('reaches the served response, not just the lookup', () => {
    const r = validateIBAN('DE89370400440532013000');
    enrichResult(r);
    expect(r.bic).toBeTruthy();
    // Germany answers from the Bundesbank register, and the provenance follows
    // the answer rather than describing the fallback that was not used.
    expect(r.bic!.source).toContain('Bundesbank');
    expect(r.bic!.as_of).toMatch(/^\d{4}-\d{2}$/);
  });

  it('never invents a provenance for an unresolved bank code', () => {
    const r = validateIBAN('CH9300762011623852957');
    enrichResult(r);
    expect(r.bic).toBeNull();
  });
});
