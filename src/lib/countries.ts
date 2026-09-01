// Moved to the open-source library (t23), imported here under the npm alias
// `iban-core` (see package.json: this package is itself named "ibanforge", so a
// bare 'ibanforge' specifier would self-resolve to our own dist/index.js).
// Re-exported at the old path so the existing import sites keep working.
// Do not add logic in this file.
export {
  getCountryRisk,
  checkBBANStructure,
  getBBANFieldSpec,
  IBAN_LENGTHS,
  BBAN_STRUCTURE,
  BBAN_SPECS,
  COUNTRY_NAMES,
  EXAMPLE_IBANS,
} from 'iban-core';
export type { BBANStructure, BbanCheckResult, SepaScheme } from 'iban-core';

import { COUNTRY_NAMES as LIB_COUNTRY_NAMES, getSepaInfo as libGetSepaInfo } from 'iban-core';
import type { SepaScheme } from 'iban-core';

type SepaInfo = ReturnType<typeof libGetSepaInfo>;

// ---------------------------------------------------------------------------
// The one exception to "no logic in this file": the SEPA membership the
// library's frozen SEPA_MEMBERS set predates.
//
// Found by the data audit of 01/09/2026 (DATA-03). The EPC scheme registers we
// SHIP in data/compliance.sqlite carry 66 banks from five countries that
// `getSepaInfo` answers `member: false` for, so the product was contradicting
// its own data: `AL47212110090000000235698741` came back
// `sepa: {member: false, schemes: []}` and `risk_indicators.sepa_reachable:
// false` — "a SEPA transfer to Albania is out of scope" — while the register
// beside it listed thirteen reachable Albanian banks.
//
// Measured in the shipped register on 01/09/2026 (the count IS the evidence;
// re-measured by the test beside this file, so the table below cannot rot in
// silence):
//
//   AL 13 banks SCT, SDD, SCT_INST | MK 14 SCT, SCT_INST
//   RS 19 SCT | ME 12 SCT | MD 8 SCT
//
// The governing list is the EPC's own register of SEPA scheme countries and
// territories (EPC409-09), which admitted these five after the library's set
// was written; it is named as the authority, not quoted — it was not fetched
// here, and the schemes below come from the register we ship, not from memory.
// `schemes` is a COUNTRY-grain answer (which schemes are reachable in this
// country at all); the bank-grain answer is served per BIC from the same
// register in enrich.ts, see DATA-02.
//
// The five are not in the euro area and not in the EU/EEA, so the Instant
// Payments Regulation's VoP duty does not reach their PSPs: vop_required stays
// false, exactly as it is for CH, GB and GI.
//
// Deliberately NOT derived from a live query here: this module is the offline
// country table every route imports, and giving it a database dependency would
// put a disk read behind `/v1/iban/structure`. The table is dated instead, and
// the test cross-checks it against the register.
// ---------------------------------------------------------------------------

/** When the table below was last measured against the shipped EPC register. */
export const SEPA_MEMBERS_EXTRA_AS_OF = '2026-09';

/**
 * SEPA members the library's `SEPA_MEMBERS` set does not carry yet, with the
 * schemes their banks are registered for. Country grain.
 */
export const SEPA_MEMBERS_EXTRA: Readonly<Record<string, readonly SepaScheme[]>> = {
  AL: ['SCT', 'SDD', 'SCT_INST'],
  MD: ['SCT'],
  ME: ['SCT'],
  MK: ['SCT', 'SCT_INST'],
  RS: ['SCT'],
};

/**
 * SEPA membership and schemes for a country.
 *
 * A thin wrapper over the library's own `getSepaInfo`, which stays the answer
 * for the 36 countries it knows about. Note for whoever reads
 * iban-core-contract.test.ts: that file imports this facade on purpose, to
 * exercise route -> facade -> library. Its CH / DE / BR assertions still reach
 * the library untouched; only the five countries above are answered here.
 *
 * The real home for this is the library's SEPA_MEMBERS set. Until it ships,
 * answering `member: false` for a country whose banks are in the register we
 * sell access to is the worse of the two.
 */
export function getSepaInfo(countryCode: string): SepaInfo {
  const extra = SEPA_MEMBERS_EXTRA[countryCode];
  if (!extra) return libGetSepaInfo(countryCode);
  return { member: true, schemes: [...extra], vop_required: false };
}

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
