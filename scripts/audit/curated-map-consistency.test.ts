import { describe, it, expect } from 'vitest';
import { auditCuratedMap } from './curated-map-consistency.js';
import { findImpostors } from './curated-map-impostors.js';

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

  it('never names a bank under a BIC that is not that bank', () => {
    // The third assertion, and the only one that can catch a WRONG answer
    // rather than a missing one. The two above cannot: a BIC can be perfectly
    // formed, of the right country, and simply belong to another institution.
    //
    // Found by the data audit of 01/09/2026 (DATA-01 / DATA-01b): five entries,
    // one of them serving the live Italian ABI 03268 as "Banca Monte dei Paschi
    // di Siena" under SARDIT2S, a BIC absent from our own 121,773-row
    // directory, while MPS was already correctly keyed at IT:01030. A payment
    // pre-flight received a false bank name and an unroutable BIC with
    // `authoritative: false` for its only warning.
    //
    // The conjunction behind the detector, and why it is not a name-equality
    // check, is documented in curated-map-impostors.ts. No exception list: the
    // five hits were all defects, all five are corrected, and an entry that
    // trips this is telling you the same thing they did.
    const impostors = findImpostors();
    expect(
      impostors.map((i) => `${i.key} serves ${i.bic} for "${i.bank_name}" (directory: ${i.resolvesAs.join(', ')})`),
      'a curated entry names an institution the directory resolves under a different BIC8',
    ).toEqual([]);
  });

  it('still covers the countries the map claims to cover', () => {
    // The header comment in bic-lookup.ts read "6907 entries, 40+ countries"
    // against 24,069 and 75 — stale by a factor of three. Pin the floor so the
    // prose and the file cannot drift that far apart again unnoticed.
    expect(audit.total).toBeGreaterThan(20_000);
    expect(audit.countries).toBeGreaterThan(70);
  });
});
