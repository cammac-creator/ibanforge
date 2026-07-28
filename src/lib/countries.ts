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
