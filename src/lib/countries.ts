/**
 * IBANforge — Country data: IBAN lengths (ISO 13616), BBAN structures, and name resolution
 */

// ---------------------------------------------------------------------------
// IBAN lengths per country (ISO 13616)
// ---------------------------------------------------------------------------

export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22,
  BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22,
  DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18,
  FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30,
  KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21,
  LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
  NI: 28, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19,
  SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20,
};

// ---------------------------------------------------------------------------
// BBAN structures — [startIndex, length]
// ---------------------------------------------------------------------------

export interface BBANStructure {
  bankCode: [number, number];
  branchCode?: [number, number];
  accountNumber: [number, number];
}

export const BBAN_STRUCTURE: Record<string, BBANStructure> = {
  AD: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 12] },
  AT: { bankCode: [0, 5], accountNumber: [5, 11] },
  BE: { bankCode: [0, 3], accountNumber: [3, 7] },
  CH: { bankCode: [0, 5], accountNumber: [5, 12] },
  CZ: { bankCode: [0, 4], accountNumber: [4, 16] },
  DE: { bankCode: [0, 8], accountNumber: [8, 10] },
  DK: { bankCode: [0, 4], accountNumber: [4, 10] },
  ES: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 12] },
  FI: { bankCode: [0, 3], accountNumber: [3, 11] },
  FR: { bankCode: [0, 5], branchCode: [5, 5], accountNumber: [10, 13] },
  GB: { bankCode: [0, 4], branchCode: [4, 6], accountNumber: [10, 8] },
  GR: { bankCode: [0, 3], branchCode: [3, 4], accountNumber: [7, 16] },
  HR: { bankCode: [0, 7], accountNumber: [7, 10] },
  HU: { bankCode: [0, 3], branchCode: [3, 4], accountNumber: [7, 17] },
  IE: { bankCode: [0, 4], branchCode: [4, 6], accountNumber: [10, 8] },
  IT: { bankCode: [1, 5], branchCode: [6, 5], accountNumber: [11, 12] },
  LI: { bankCode: [0, 5], accountNumber: [5, 12] },
  LU: { bankCode: [0, 3], accountNumber: [3, 13] },
  MC: { bankCode: [0, 5], branchCode: [5, 5], accountNumber: [10, 13] },
  NL: { bankCode: [0, 4], accountNumber: [4, 10] },
  NO: { bankCode: [0, 4], accountNumber: [4, 7] },
  PL: { bankCode: [0, 3], branchCode: [3, 5], accountNumber: [8, 16] },
  PT: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 13] },
  SE: { bankCode: [0, 3], accountNumber: [3, 17] },
  SI: { bankCode: [0, 2], branchCode: [2, 3], accountNumber: [5, 10] },
  SK: { bankCode: [0, 4], accountNumber: [4, 16] },
  SM: { bankCode: [1, 5], branchCode: [6, 5], accountNumber: [11, 12] },
};

// ---------------------------------------------------------------------------
// Country names — hardcoded map for IBAN countries
// ---------------------------------------------------------------------------

export const COUNTRY_NAMES: Record<string, string> = {
  AD: 'Andorra', AE: 'United Arab Emirates', AL: 'Albania', AT: 'Austria',
  AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BE: 'Belgium', BG: 'Bulgaria',
  BH: 'Bahrain', BR: 'Brazil', BY: 'Belarus', CH: 'Switzerland',
  CR: 'Costa Rica', CY: 'Cyprus', CZ: 'Czech Republic', DE: 'Germany',
  DJ: 'Djibouti', DK: 'Denmark', DO: 'Dominican Republic', EE: 'Estonia',
  EG: 'Egypt', ES: 'Spain', FI: 'Finland', FK: 'Falkland Islands',
  FO: 'Faroe Islands', FR: 'France', GB: 'United Kingdom', GE: 'Georgia',
  GI: 'Gibraltar', GL: 'Greenland', GR: 'Greece', GT: 'Guatemala',
  HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IL: 'Israel',
  IQ: 'Iraq', IS: 'Iceland', IT: 'Italy', JO: 'Jordan',
  KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon', LC: 'Saint Lucia',
  LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia',
  LY: 'Libya', MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro',
  MK: 'North Macedonia', MR: 'Mauritania', MT: 'Malta', MU: 'Mauritius',
  NI: 'Nicaragua', NL: 'Netherlands', NO: 'Norway', PK: 'Pakistan',
  PL: 'Poland', PS: 'Palestine', PT: 'Portugal', QA: 'Qatar',
  RO: 'Romania', RS: 'Serbia', RU: 'Russia', SA: 'Saudi Arabia',
  SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden', SI: 'Slovenia',
  SK: 'Slovakia', SM: 'San Marino', SO: 'Somalia', ST: 'Sao Tome and Principe',
  SV: 'El Salvador', TL: 'East Timor', TN: 'Tunisia', TR: 'Turkey',
  UA: 'Ukraine', VA: 'Vatican City', VG: 'British Virgin Islands', XK: 'Kosovo',
};

// ---------------------------------------------------------------------------
// SEPA zone data
// ---------------------------------------------------------------------------

/** Eurozone countries — SCT_INST mandatory since IPR Oct 2025 */
const EUROZONE = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
  // Microstates using EUR through monetary agreements
  'AD', 'MC', 'SM', 'VA',
]);

/** All SEPA member countries (EU27 + EEA + CH/GB + microstates + territories) */
const SEPA_MEMBERS = new Set([
  ...EUROZONE,
  // EU non-eurozone
  'BG', 'CZ', 'DK', 'HU', 'PL', 'RO', 'SE',
  // EEA non-EU
  'IS', 'LI', 'NO',
  // Other SEPA participants
  'CH', 'GB', 'GI',
  // Associated territories (through DK)
  'FO', 'GL',
]);

/** Non-eurozone EEA/EU states — VoP mandatory from July 2027 */
const VOP_DEFERRED = new Set([
  'BG', 'CZ', 'DK', 'HU', 'PL', 'RO', 'SE',
  'IS', 'LI', 'NO',
]);

export type SepaScheme = 'SCT' | 'SDD' | 'SCT_INST';

export interface SepaInfo {
  member: boolean;
  schemes: SepaScheme[];
  vop_required: boolean;
}

/**
 * Get SEPA membership, available schemes, and VoP status for a country code.
 *
 * VoP (Verification of Payee) timeline:
 * - Eurozone PSPs: mandatory since 9 Oct 2025
 * - Non-eurozone EEA: mandatory from July 2027
 * - Non-SEPA: not applicable
 * - CH, GB, GI: not covered by EU VoP regulation
 */
export function getSepaInfo(countryCode: string): SepaInfo {
  if (!SEPA_MEMBERS.has(countryCode)) {
    return { member: false, schemes: [], vop_required: false };
  }

  // CH, GB, GI are SEPA participants but not subject to EU VoP regulation
  const nonEuSepa = new Set(['CH', 'GB', 'GI']);

  if (EUROZONE.has(countryCode)) {
    return { member: true, schemes: ['SCT', 'SDD', 'SCT_INST'], vop_required: true };
  }
  if (VOP_DEFERRED.has(countryCode)) {
    // VoP mandatory from July 2027 for these — flag as required (regulation adopted)
    return { member: true, schemes: ['SCT', 'SDD'], vop_required: true };
  }
  // CH, GB, GI, FO, GL — SEPA but no EU VoP obligation
  return { member: true, schemes: ['SCT', 'SDD'], vop_required: !nonEuSepa.has(countryCode) };
}

// ---------------------------------------------------------------------------
// Country risk classification (AML/CFT perspective)
// Based on FATF grey/black lists and EU high-risk third countries.
// Conservative: only flags countries with known AML concerns.
// ---------------------------------------------------------------------------

export type CountryRisk = 'standard' | 'elevated' | 'high';

/** FATF black list / EU high-risk third countries (updated periodically) */
const HIGH_RISK = new Set([
  'RU', // Russia — FATF countermeasures
  'BY', // Belarus — FATF countermeasures
  'LY', // Libya
  'SO', // Somalia
  'SD', // Sudan
]);

/**
 * FATF grey list (increased monitoring) and jurisdictions with
 * elevated AML risk per EBA opinions.
 */
const ELEVATED_RISK = new Set([
  'AL', // Albania
  'BA', // Bosnia and Herzegovina
  'EG', // Egypt
  'IQ', // Iraq
  'JO', // Jordan
  'KZ', // Kazakhstan
  'LB', // Lebanon
  'MR', // Mauritania
  'MU', // Mauritius
  'PK', // Pakistan
  'PS', // Palestine
  'SC', // Seychelles
  'TN', // Tunisia
  'TR', // Turkey
  'UA', // Ukraine (conflict zone)
  'VG', // British Virgin Islands
]);

export function getCountryRisk(countryCode: string): CountryRisk {
  if (HIGH_RISK.has(countryCode)) return 'high';
  if (ELEVATED_RISK.has(countryCode)) return 'elevated';
  return 'standard';
}

// ---------------------------------------------------------------------------
// Dynamic country name resolution via Intl API (for BIC lookups with any code)
// ---------------------------------------------------------------------------

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Resolve a country name from an ISO 3166-1 alpha-2 code.
 * First checks the hardcoded IBAN map, then falls back to Intl.DisplayNames.
 */
export function getCountryName(code: string): string | null {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();

  // Fast path: hardcoded IBAN country names
  if (COUNTRY_NAMES[upper]) return COUNTRY_NAMES[upper];

  // Fallback: Intl API covers all ISO 3166-1 codes
  try {
    const name = displayNames.of(upper);
    return name && name !== upper ? name : null;
  } catch {
    return null;
  }
}
