// Moved to the open-source library (t23), imported here under the npm alias
// `iban-core` (see package.json: this package is itself named "ibanforge", so a
// bare 'ibanforge' specifier would self-resolve to our own dist/index.js).
// Re-exported at the old path so the existing import sites keep working.
// Do not add logic in this file.
export {
  getCountryRisk,
  getSepaInfo,
  checkBBANStructure,
  getBBANFieldSpec,
  IBAN_LENGTHS,
  BBAN_STRUCTURE,
  BBAN_SPECS,
  COUNTRY_NAMES,
  EXAMPLE_IBANS,
} from 'iban-core';
export type { BBANStructure, BbanCheckResult, SepaScheme } from 'iban-core';

import { COUNTRY_NAMES as LIB_COUNTRY_NAMES } from 'iban-core';

// ---------------------------------------------------------------------------
// The one thing that did NOT move: getCountryName.
//

// ---------------------------------------------------------------------------
// The other thing that did NOT move: COUNTRY_RISK_AS_OF.
//
// It dates the two risk sets that now live in the library, and it is read by
// compliance-db.ts to stamp country_risk_as_of on the served response — a
// product concern, so it stays on this side of the boundary.
//
// Why the date matters (kept from the upstream commit that added it): the
// FATF axis and the country-risk axis are meant to STACK, not to be derived
// from one another — folding one into the other would DOWNGRADE sanctioned
// countries. The sets are deliberately not the FATF list. What was missing
// was simply this date: fatf_status carried one and this axis carried none,
// so a caller seeing the two disagree could not tell a considered editorial
// difference from a stale hardcoded list. Now both are dated and both state
// their scope.
//
// Review cadence: after each FATF plenary (3x/year), same as FATF_AS_OF.
// ---------------------------------------------------------------------------
export const COUNTRY_RISK_AS_OF = '2026-07';

// It resolves *any* ISO 3166-1 country, not just IBAN countries, because it
// names the countries of BIC records coming out of the database (seed.ts,
// enrich-bic-database.ts, mcp-resources.ts). That is a product concern —
// naming rows of our BIC base — not offline IBAN arithmetic, and the library
// deliberately ships no Intl-backed name resolution. It stays here.
// ---------------------------------------------------------------------------

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Resolve a country name from an ISO 3166-1 alpha-2 code.
 * First checks the library's IBAN country map, then falls back to
 * Intl.DisplayNames.
 */
export function getCountryName(code: string): string | null {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();

  // Fast path: IBAN country names shipped by the library
  if (LIB_COUNTRY_NAMES[upper]) return LIB_COUNTRY_NAMES[upper];

  // Fallback: Intl API covers all ISO 3166-1 codes
  try {
    const name = displayNames.of(upper);
    return name && name !== upper ? name : null;
  } catch {
    return null;
  }
}
