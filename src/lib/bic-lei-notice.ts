/**
 * The notice the BIC/LEI Mapping Table licence asks for, with the version date.
 *
 * GLEIF publishes the BIC-to-LEI relationship file ("Mapping Table"), developed
 * by SWIFT, under the BIC/LEI Mapping Table License Agreement (Annex II,
 * 21 December 2017). The licence is royalty-free for any purpose provided that
 * any copy of the Mapping Table, in whole or in part, carries the notice below,
 * with the month and year of the Mapping Table version. Until 25/09/2026 the
 * served text said "This service uses the BIC to LEI relationship file. The
 * mapping table has been developed by SWIFT", which is not that notice and
 * carried no version.
 *
 * ## Where the version comes from
 *
 * The seeder does not store the version: it downloads GLEIF's "latest" file at
 * the monthly refresh (cron on the 1st of each month, 03:00 UTC,
 * .github/workflows/refresh-bic.yml), and the rows carry the load date only.
 * GLEIF publishes the file near the end of each month, so a load on the 1st is
 * the version of the month before: loaded on 1 September 2026 from
 * LEI-BIC-20260828.zip, the August 2026 version (NOTICE). The version is
 * therefore read from the load date of the `gleif` rows, never typed, so the
 * notice follows the monthly refresh without anyone editing it.
 *
 * ⚠️ One known gap, stated rather than hidden: a manual refresh run between
 * GLEIF's publication and the end of the same month would load that month's
 * file, and this rule would name the month before. The cron never runs then.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * "2026-09-01 03:22:21" (load date of the gleif rows) -> "August 2026".
 * Null when there is no load date: no gleif row, no copy, no notice.
 */
export function mappingVersionFromLoad(loadedAt: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(loadedAt ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1..12, the load month
  const versionMonth = month === 1 ? 12 : month - 1;
  const versionYear = month === 1 ? year - 1 : year;
  return `${MONTHS[versionMonth - 1]} ${versionYear}`;
}

/** The notice, word for word as the licence gives it, for one version. */
export function bicLeiMappingNotice(version: string): string {
  return (
    `SWIFT © and database rights ${version}. All rights reserved. ` +
    'This Mapping Table has been developed by SWIFT. Any use of the Mapping Table, in whole or in part, ' +
    "is subject to the BIC/LEI Mapping Table License Agreement as published with the Mapping Table available on GLEIF's website. " +
    'The Mapping Table is updated monthly. For the latest BIC information and updates, always refer to www.swift.com/bic.'
  );
}
