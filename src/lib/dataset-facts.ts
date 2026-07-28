import { getChClearingCount, getEntryCount, getLeiEnrichedCount } from './bic-lookup.js';
import { IBAN_LENGTHS } from './countries.js';

/**
 * The size of what we ship, said once.
 *
 * ## Why this exists
 *
 * The audit of 28/07/2026 counted the same figure written by hand across two
 * dozen served surfaces, in four different values. The Swiss clearing table
 * held 1,165 rows while the product announced "~1,200" sixty-one times,
 * "1190+" once and "1,000+" four times. The BIC table held 121,610 while the
 * copy said "121k+" and "121,000+" interchangeably.
 *
 * None of those numbers were checked against anything, because nothing could
 * check them: they were string literals in twenty-four files. The repository's
 * own CLAUDE.md already forbids hardcoding these counts in served surfaces and
 * the counting helpers already existed. They were simply never reached for.
 *
 * ## The rounding rule, which is the whole point
 *
 * Every formatted figure below rounds **down** to a round number. That is not
 * cosmetic. A claim rounded up ("~1,200" for 1,165) is false the day it is
 * written and stays false; a claim rounded down ("1,100+") is true today and
 * remains true through the next monthly refresh unless the dataset actually
 * shrinks past a threshold — at which point the guard test fails and someone
 * looks. An understated claim degrades safely; an overstated one does not.
 *
 * This mirrors the direction-of-error principle the compliance fix rests on:
 * when unsure, err towards the answer that cannot mislead a buyer.
 */

/** Round down to a readable step: 121,610 -> 121,000 ; 1,165 -> 1,100. */
function floorTo(n: number, step: number): number {
  return Math.floor(n / step) * step;
}

/** Thousands separator, matching the copy style already in use ("121,000+"). */
function group(n: number): string {
  return n.toLocaleString('en-US');
}

export interface DatasetFacts {
  /** Exact live counts. Use for /stats, /health and anything reporting state. */
  bicEntries: number;
  leiEnriched: number;
  chClearing: number;
  ibanCountries: number;
  /**
   * Understated, human-readable claims. Use in descriptions, marketing copy,
   * tool descriptions and discovery documents — anywhere the number is a claim
   * rather than a reading.
   */
  claim: {
    /** e.g. "121,000+" */
    bic: string;
    /** e.g. "39,000+" */
    lei: string;
    /** e.g. "1,100+" */
    chClearing: string;
    /** e.g. "89" — exact, because it is a closed list, not a growing dataset. */
    countries: string;
  };
}

/**
 * Read once per process. These tables are read-only at runtime and refreshed by
 * redeploy, so a per-call query would buy nothing and put SQLite on the path of
 * every 402 discovery response.
 */
let cached: DatasetFacts | null = null;

export function datasetFacts(): DatasetFacts {
  if (cached) return cached;
  const bicEntries = getEntryCount();
  const leiEnriched = getLeiEnrichedCount();
  const chClearing = getChClearingCount();
  const ibanCountries = Object.keys(IBAN_LENGTHS).length;
  cached = {
    bicEntries,
    leiEnriched,
    chClearing,
    ibanCountries,
    claim: {
      bic: `${group(floorTo(bicEntries, 1_000))}+`,
      lei: `${group(floorTo(leiEnriched, 1_000))}+`,
      chClearing: `${group(floorTo(chClearing, 100))}+`,
      countries: String(ibanCountries),
    },
  };
  return cached;
}

/** Test seam: the counts change between fixtures and the shipped database. */
export function resetDatasetFacts(): void {
  cached = null;
}
