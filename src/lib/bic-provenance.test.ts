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
    const candidates = [
      ['IE', 'MONZ'],
      ['GB', 'AUGT'],
      ['NL', 'MOXR'],
      ['IE', 'KLRN'],
    ] as const;
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

describe('a retired code keeps its provenance and loses its licence', () => {
  /**
   * The Bankleitzahlendatei still publishes the BIC of a retired BLZ, and the
   * pairing really is the register's — but the register is saying "stop using
   * this code", sometimes naming a successor whose row carries a DIFFERENT
   * BIC. Serving authoritative: true there licensed settling against a code
   * the register itself withdrew (74 rows when the 29/08/2026 review measured
   * it). Both IBANs are mod-97 valid over real retired BLZ.
   */
  function enriched(iban: string) {
    const r = validateIBAN(iban);
    expect(r.valid).toBe(true);
    enrichResult(r);
    return r;
  }

  it('retired without a successor: national_register basis, authoritative false', () => {
    const r = enriched('DE09200698820000000001');
    expect(r.bank_code_check?.retired).toBe(true);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(false);
  });

  it('retired with a successor on a different BIC: same withdrawal', () => {
    const r = enriched('DE78130610880000000001');
    expect(r.bank_code_check?.retired).toBe(true);
    expect(r.bank_code_check?.superseded_by).toBeTruthy();
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(false);
  });

  it('a live BLZ keeps the settlement licence', () => {
    const r = enriched('DE89370400440532013000');
    expect(r.bank_code_check?.retired).toBeUndefined();
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });
});

describe('Iceland names the code its verdict is really about', () => {
  it('serves the two-digit bank grain as value, not the four-digit slice', () => {
    // The curated key is the bank (01 = Landsbankinn); the IBAN field carries
    // bank + branch. Serving value: "0133" would imply the branch digits were
    // checked — the Finnish `value` motif applies one country over.
    const r = validateIBAN('IS280133260076543589621599');
    expect(r.valid).toBe(true);
    enrichResult(r);
    expect(r.bic?.code).toBe('NBIIISRE');
    expect(r.bank_code_check?.value).toBe('01');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });
});
