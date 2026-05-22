/**
 * IBANforge — Static compliance reference lists.
 *
 * FATF jurisdiction lists and country-level sanction regimes. The FATF
 * publishes only HTML statements (no machine-readable feed), so these lists
 * are maintained here by hand and dated via FATF_AS_OF.
 *
 * ⚠️  RECALIBRATE after every FATF plenary — 3×/year (February, June, October).
 *     Last plenary reflected here: 13 February 2026.
 *     NEXT plenary: June 2026 — update FATF_GREY_LIST and bump FATF_AS_OF.
 *
 * Source: FATF "High-risk and other monitored jurisdictions" statements.
 */

/** Year-month (YYYY-MM) of the FATF plenary these lists reflect. */
export const FATF_AS_OF = '2026-02';

/** FATF "Call for Action" — high-risk jurisdictions (the black list). */
export const FATF_BLACK_LIST: string[] = ['KP', 'IR', 'MM'];

/**
 * FATF "Jurisdictions under Increased Monitoring" (the grey list).
 * 13 February 2026 plenary — 22 jurisdictions.
 */
export const FATF_GREY_LIST: string[] = [
  'DZ', 'AO', 'BO', 'BG', 'CM', 'CI', 'CD', 'HT', 'KE', 'KW', 'LA',
  'LB', 'MC', 'NA', 'NP', 'PG', 'SS', 'SY', 'VE', 'VN', 'VG', 'YE',
];

/** FATF member jurisdictions — stable; membership changes are rare. */
export const FATF_MEMBERS: string[] = [
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CN', 'DK', 'FI', 'FR',
  'DE', 'GR', 'HK', 'IS', 'IN', 'IE', 'IL', 'IT', 'JP', 'KR',
  'LU', 'MY', 'MX', 'NL', 'NZ', 'NO', 'PT', 'RU', 'SA', 'SG',
  'ZA', 'ES', 'SE', 'CH', 'TR', 'GB', 'US',
];

/** Countries under comprehensive sanctions regimes. */
export const SANCTIONED_COUNTRIES_COMPREHENSIVE: string[] = ['CU', 'IR', 'KP', 'SY', 'RU'];

/** Countries under sectoral / partial sanctions regimes. */
export const SANCTIONED_COUNTRIES_SECTORAL: string[] = [
  'BY', 'VE', 'ZW', 'MM', 'SD', 'CF', 'SO', 'LY', 'YE',
];
