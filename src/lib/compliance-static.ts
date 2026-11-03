/**
 * IBANforge — Static compliance reference lists.
 *
 * FATF jurisdiction lists and country-level sanction regimes. The FATF
 * publishes only HTML statements (no machine-readable feed), so these lists
 * are maintained here by hand and dated via FATF_AS_OF.
 *
 * ⚠️  RECALIBRATE after every FATF plenary — 3×/year (February, June, October).
 *     Last plenary reflected here: 28–30 October 2026 (fatf-gafi.org,
 *     "Jurisdictions under Increased Monitoring – 30 October 2026" and
 *     "High-Risk Jurisdictions subject to a Call for Action - 30 October 2026").
 *     NEXT plenary: February 2027 — update FATF_GREY_LIST, bump FATF_AS_OF,
 *     FATF_PLENARY_OPENED_ON AND FATF_ACCESSED_ON, then the citation on the
 *     static surfaces listed in
 *     src/routes/fatf-attribution.test.ts (the test fails until they match).
 *
 * Source: FATF "High-risk and other monitored jurisdictions" statements.
 */

/** Year-month (YYYY-MM) of the FATF plenary these lists reflect. */
export const FATF_AS_OF = '2026-10';

/**
 * First day (YYYY-MM-DD) of that plenary (28–30 October 2026). The FATF statements
 * cannot have been read before it opened: the attribution test holds
 * FATF_ACCESSED_ON to that.
 */
export const FATF_PLENARY_OPENED_ON = '2026-10-28';

/**
 * Day (YYYY-MM-DD) the FATF statements behind these lists were read on
 * fatf-gafi.org. The FATF's terms make it part of the credit ("accessed on
 * (date)"), so it is a licence term, not a freshness detail. 2026-11-03 is the
 * day the October 2026 plenary statements were read on fatf-gafi.org (in a
 * browser: the site answers 403 to scripts) and transcribed here.
 */
export const FATF_ACCESSED_ON = '2026-11-03';

/**
 * The credit the FATF's terms require for its data, in its own citation format:
 * "FATF (year), (dataset name), (data source) DOI or URL (accessed on (date))."
 * Built from the two dates above so it cannot drift from the lists it credits.
 * Surfaces that cannot call it (docs pages, NOTICE) are pinned to it by
 * src/routes/fatf-attribution.test.ts.
 */
export function fatfCitation(): string {
  const [year, month] = FATF_AS_OF.split('-').map(Number);
  const plenary = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const accessed = new Date(`${FATF_ACCESSED_ON}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    `FATF (${year}), High-Risk and Other Monitored Jurisdictions, ` +
    `FATF public statements of the ${plenary} plenary, https://www.fatf-gafi.org ` +
    `(accessed on ${accessed}).`
  );
}

/** FATF "Call for Action" — high-risk jurisdictions (the black list). */
export const FATF_BLACK_LIST: string[] = ['KP', 'IR', 'MM'];

/**
 * FATF "Jurisdictions under Increased Monitoring" (the grey list).
 * 30 October 2026 plenary — 18 jurisdictions.
 * October 2026 changes: − BG (Bulgaria), − CI (Côte d'Ivoire),
 * − CD (Democratic Republic of the Congo), − MC (Monaco) — all four removed
 * after successful on-site visits; no jurisdiction added.
 * June 2026 changes: + BA (Bosnia and Herzegovina), + IQ (Iraq);
 * − DZ (Algeria), − NA (Namibia).
 */
export const FATF_GREY_LIST: string[] = [
  'AO',
  'BA',
  'BO',
  'CM',
  'HT',
  'IQ',
  'KE',
  'KW',
  'LA',
  'LB',
  'NP',
  'PG',
  'SS',
  'SY',
  'VE',
  'VN',
  'VG',
  'YE',
];

/**
 * FATF members whose membership is SUSPENDED. Russia's membership has been
 * suspended since 24 February 2023 (unchanged through the October 2026 plenary).
 * A suspended member is NOT a member in good standing — reporting it as
 * `member` was factually wrong. Scoring treats `suspended` at least as
 * severely as `non_member`.
 */
export const FATF_SUSPENDED: string[] = ['RU'];

/** FATF member jurisdictions — stable; membership changes are rare. */
export const FATF_MEMBERS: string[] = [
  'AR',
  'AU',
  'AT',
  'BE',
  'BR',
  'CA',
  'CN',
  'DK',
  'FI',
  'FR',
  'DE',
  'GR',
  'HK',
  'IS',
  'IN',
  'IE',
  'IL',
  'IT',
  'JP',
  'KR',
  'LU',
  'MY',
  'MX',
  'NL',
  'NZ',
  'NO',
  'PT',
  'SA',
  'SG',
  'ZA',
  'ES',
  'SE',
  'CH',
  'TR',
  'GB',
  'US',
];

/** Countries under comprehensive sanctions regimes. */
export const SANCTIONED_COUNTRIES_COMPREHENSIVE: string[] = ['CU', 'IR', 'KP', 'SY', 'RU'];

/** Countries under sectoral / partial sanctions regimes. */
export const SANCTIONED_COUNTRIES_SECTORAL: string[] = [
  'BY',
  'VE',
  'ZW',
  'MM',
  'SD',
  'CF',
  'SO',
  'LY',
  'YE',
];
