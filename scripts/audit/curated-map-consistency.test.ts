import { describe, it, expect } from 'vitest';
import { auditCuratedMap } from './curated-map-consistency.js';

/**
 * Guards on src/db/bic_data.json, which is hand-assembled and had nothing
 * watching it. The two assertions are deliberately different in kind.
 */
describe('curated bank-code map', () => {
  const audit = auditCuratedMap();

  it('never carries a malformed BIC', () => {
    // A hard invariant: a BIC that fails the shape check is a typo, not a
    // coverage gap, and it would be served to a caller as a routable code.
    // Zero today, and any hit is a real defect rather than a threshold to
    // renegotiate.
    expect(audit.malformed, 'a malformed BIC entered the curated map').toBe(0);
  });

  it('keeps the share of undescribable BICs from drifting upward', () => {
    // Soft guard, expressed as a SHARE and not a count: bic_entries is
    // refreshed monthly, so an absolute number would go red on a normal
    // refresh and stop meaning anything within two months.
    //
    // Measured 23/08/2026: 215 of 24,069, i.e. 0.9%. These are BICs the
    // directory cannot describe, not BICs that do not exist — all 215 are
    // well-formed with a real ISO country. The response already discloses the
    // uncertainty via bank_code_check.authoritative = false. The ceiling
    // exists so a bulk import that doubled the unmatched share would be
    // noticed rather than shipped.
    const share = audit.undescribable / audit.total;
    expect(
      share,
      `${audit.undescribable}/${audit.total} map entries resolve to a BIC the directory cannot describe`,
    ).toBeLessThan(0.02);
  });

  it('still covers the countries the map claims to cover', () => {
    // The header comment in bic-lookup.ts read "6907 entries, 40+ countries"
    // against 24,069 and 75 — stale by a factor of three. Pin the floor so the
    // prose and the file cannot drift that far apart again unnoticed.
    expect(audit.total).toBeGreaterThan(20_000);
    expect(audit.countries).toBeGreaterThan(70);
  });
});
