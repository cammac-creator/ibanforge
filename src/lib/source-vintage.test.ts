import { describe, it, expect } from 'vitest';
import { sourceVintage, effectiveAsOf } from './source-vintage.js';
import { getSourceFreshness, lookupByCountryBank } from './bic-lookup.js';

/**
 * Audit of 22/09/2026: /health answered `stale: false` about data from January
 * 2018.
 *
 * The refresh workflow re-clones the same frozen public repository every month,
 * so `updated_at` marched forward — 2026-09-01 on the committed database —
 * while the content behind two thirds of the directory had not moved since the
 * upstream stopped publishing. A freshness flag that reports whether the
 * MACHINERY ran, about goods that are eight years old, is worse than no flag:
 * it is the one an alert trusts.
 */
describe('a source that is re-imported is not thereby up to date', () => {
  it('knows the upstream vintage of the redistributed SWIFT directory', () => {
    const v = sourceVintage('swiftcodes');
    expect(v).not.toBeNull();
    expect(v!.as_of).toMatch(/^\d{4}-\d{2}$/);
    // Long before the monthly refresh that keeps stamping these rows.
    expect(v!.as_of < '2020-01').toBe(true);
    // The note has to carry what was read and when, or nobody can re-check it.
    expect(v!.note).toMatch(/\d{2}\/\d{2}\/\d{4}|\d{2}\.\d{2}\.\d{4}/);
  });

  it('answers null for a source whose import date really is its data date', () => {
    // Absence of evidence, and the code says so by answering null rather than
    // by certifying freshness.
    expect(sourceVintage('gleif')).toBeNull();
    expect(sourceVintage(null)).toBeNull();
    expect(effectiveAsOf('gleif', '2026-09-01 03:22:20')).toBe('2026-09-01 03:22:20');
    expect(effectiveAsOf('swiftcodes', '2026-09-01 03:22:23')).toBe(
      sourceVintage('swiftcodes')!.as_of,
    );
  });
});

describe('/health-grade freshness carries both dates and says which one is wrong', () => {
  it('marks the frozen upstream stale, with the reason, and shows its real date', () => {
    const sources = getSourceFreshness();
    const swift = sources.find((s) => s.source === 'swiftcodes');
    expect(swift, 'the committed database no longer carries a swiftcodes source').toBeTruthy();
    // The import date is kept — it is a true fact, it just answers a different
    // question — and the data date is served beside it.
    expect(swift!.last_updated).toBeTruthy();
    expect(swift!.source_as_of).toBe(sourceVintage('swiftcodes')!.as_of);
    expect(swift!.stale).toBe(true);
    expect(swift!.stale_reason).toBe('source_frozen');
    // And the prose stays OUT of a healthcheck polled every 30 s: the reason
    // is a token, the evidence lives in the module and in docs/data-sources.md.
    expect(JSON.stringify(swift)).not.toContain('22/09/2026');
  });

  it('leaves a genuinely refreshed register alone', () => {
    const gleif = getSourceFreshness().find((s) => s.source === 'gleif');
    expect(gleif).toBeTruthy();
    expect(gleif!.source_as_of).toBeNull();
    // Whatever its age, it must never be called stale for the WRONG reason:
    // the two causes are repaired by two different actions.
    expect(gleif!.stale_reason).not.toBe('source_frozen');
  });
});

describe('the served answer carries the second date too', () => {
  it('dates a prefix-resolved BIC by its content, not only by its import', () => {
    // Where a bank code may open on a letter, an unmapped code falls through to
    // the `bic8 LIKE code%` search and the directory row really is the source.
    // Several candidates rather than one: the set is reseeded monthly and a
    // test pinned to a single institution would go red on ordinary churn.
    const hits = (
      [
        ['IE', 'MONZ'],
        ['GB', 'AUGT'],
        ['NL', 'MOXR'],
        ['IE', 'KLRN'],
      ] as const
    )
      .map(([cc, code]) => lookupByCountryBank(cc, code))
      .filter((h) => h?.match === 'prefix');
    expect(hits.length, 'no prefix-resolved bank code left in the directory').toBeGreaterThan(0);

    const fromSwift = hits.filter((h) => (h!.source ?? '').includes('SwiftCodes'));
    for (const hit of fromSwift) {
      expect(hit!.as_of).toMatch(/^\d{4}-\d{2}$/);
      expect(hit!.source_as_of).toBe(sourceVintage('swiftcodes')!.as_of);
    }
    // A GLEIF-sourced row must NOT grow a second date out of nowhere.
    for (const hit of hits.filter((h) => (h!.source ?? '').includes('GLEIF'))) {
      expect(hit!.source_as_of).toBeUndefined();
    }
  });
});
