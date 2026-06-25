import { describe, it, expect } from 'vitest';
import { getBicDB } from '../lib/db.js';
import { getCountryName } from '../lib/countries.js';

/**
 * Structural data-integrity gates for the committed `data/bic.sqlite`.
 *
 * These run inside `npm run test`, which the monthly refresh cron
 * (.github/workflows/refresh-bic.yml) executes AFTER re-seeding but BEFORE the
 * commit/push step. So a future importer that reintroduces one of these
 * defects fails the refresh and the bad data is never shipped.
 *
 * Assertions are STRUCTURAL (derivable from any correct dataset), never
 * coupled to specific values or row counts — those drift with each data
 * refresh and would turn the gate into a recurring false alarm.
 */
describe('bic_entries data integrity (monthly refresh gate)', () => {
  const db = getBicDB();

  /**
   * GATE 1 — the "wrong country" bug class (the INGBNL2AXXX → CH defect a
   * paying customer reported). country_code MUST equal the ISO country embedded
   * in BIC positions 5-6 (ISO 9362 §4). The SIX import once hardcoded 'CH' for
   * every row, so foreign euroSIC participants (ING/NL, Starling/GB, all LI
   * banks…) inherited the wrong country. Deriving country from BIC 5-6 fixed it;
   * this gate makes the fix permanent across all six import sources.
   */
  it('country_code matches BIC positions 5-6 for every row', () => {
    const bad = db
      .prepare(
        `SELECT bic11, country_code, substr(bic11, 5, 2) AS bic_cc, source
           FROM bic_entries
          WHERE upper(country_code) != upper(substr(bic11, 5, 2))
          LIMIT 20`,
      )
      .all() as Array<{ bic11: string; country_code: string; bic_cc: string; source: string }>;

    expect(bad, `rows whose country_code != BIC[5-6]: ${JSON.stringify(bad)}`).toEqual([]);
  });

  /**
   * GATE 2 — country_name must be populated wherever the code is resolvable.
   * The EBA Step2 importer wrote an empty string and the enricher only backfilled
   * NULLs, so 199 BICs shipped with a blank country.
   *
   * Tolerant by design: a future BIC whose position 5-6 is a code that
   * Intl.DisplayNames cannot resolve (a brand-new territory, an exotic code) is
   * allowed to keep a blank name — we only fail when a RESOLVABLE code was left
   * blank. No counts, so the gate never false-fires on legitimate data churn.
   */
  it('country_name is populated wherever the country_code resolves', () => {
    const blankCodes = db
      .prepare(
        `SELECT DISTINCT country_code
           FROM bic_entries
          WHERE country_name IS NULL OR country_name = ''`,
      )
      .all() as Array<{ country_code: string }>;

    const resolvableButBlank = blankCodes
      .map((r) => r.country_code)
      .filter((cc) => getCountryName(cc) !== null);

    expect(
      resolvableButBlank,
      `resolvable country codes left with a blank country_name: ${resolvableButBlank.join(', ')}`,
    ).toEqual([]);
  });
});
