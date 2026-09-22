/**
 * When a source's DATA is from, as opposed to when we last imported it.
 *
 * ## The gap this closes
 *
 * `bic_entries.updated_at` is written by the seeder, so it dates the IMPORT.
 * For most sources that is a fair proxy for the data: the monthly workflow
 * downloads the publisher's current file, so a row stamped 2026-09-01 really
 * does carry what the Bundesbank published in September.
 *
 * One source breaks the proxy, and it is the largest. `swiftcodes` is a clone
 * of a public GitHub repository, and the refresh re-clones the same frozen
 * file every month: `last_updated` marches forward while the content does not
 * move at all. Measured against the repository on 22/09/2026 — its last
 * publication is dated 09.08.2019, and the commit that last changed the data
 * directory is "Update for 2018", dated 27.01.2018. Roughly two thirds of the
 * directory therefore describes the banking world of January 2018 behind a
 * date that reads as last month.
 *
 * ## Why a constant and not a column
 *
 * `data/bic.sqlite` is a tracked 35 MB binary that two branches cannot both
 * reseed (AGENTS.md rule 6), so adding a column would mean regenerating it.
 * And the fact being recorded is not a property of a row: it is a property of
 * the UPSTREAM, established by reading the publisher, and it only changes when
 * a human goes and reads the publisher again. That belongs in reviewed source
 * with its evidence beside it, not in a binary nobody can diff.
 *
 * ## The rule for adding an entry
 *
 * An entry here is a claim that the import date LIES about this source. Add
 * one only after reading the publisher, and write in `note` what was read and
 * when — a vintage nobody can re-derive is worse than none, because it stops
 * the next person from going to look.
 *
 * A source absent from this map is one whose import date is its data date, as
 * far as anyone has checked. That is an absence of evidence and the code says
 * so by answering `null` rather than "fresh".
 */

export interface SourceVintage {
  /** Year-month the upstream data itself describes (YYYY-MM). */
  as_of: string;
  /** What was read at the publisher, and when — so the claim can be re-checked. */
  note: string;
}

const SOURCE_VINTAGE: Record<string, SourceVintage> = {
  swiftcodes: {
    as_of: '2018-01',
    note: 'Cached copy of the public PeterNotenboom/SwiftCodes repository. Read on 22/09/2026: the repository has had no publication since 09.08.2019, and the last commit touching the data directory is "Update for 2018", dated 27.01.2018. The monthly refresh re-clones that same frozen file, so the import date says nothing about the data.',
  },
};

/** The upstream vintage of a source, or null when its import date is its data date. */
export function sourceVintage(source: string | null | undefined): SourceVintage | null {
  if (!source) return null;
  return SOURCE_VINTAGE[source] ?? null;
}

/**
 * The date to show for a source: its upstream vintage when the import date
 * lies, and the import date otherwise.
 *
 * Callers should show BOTH, not this alone — "imported 2026-09, data from
 * 2018-01" is the whole story and either half on its own is misleading. This
 * helper exists so the two surfaces that judge freshness judge the same thing.
 */
export function effectiveAsOf(
  source: string | null | undefined,
  lastUpdated: string | null,
): string | null {
  const vintage = sourceVintage(source);
  if (vintage) return vintage.as_of;
  return lastUpdated;
}
