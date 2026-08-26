/**
 * Quality diff between the BIC database committed at HEAD and the one the
 * seeders just produced in the working tree.
 *
 * =====================================================================
 * CLI CONTRACT — this block is the interface. Everything below is detail.
 * =====================================================================
 *
 *   npx tsx scripts/refresh-diff.ts
 *
 * Arguments: none. Configuration is by environment variable only.
 *
 *   BIC_DIFF_AFTER   path to the database to judge.
 *                    Default: data/bic.sqlite (what the seeders just wrote).
 *   BIC_DIFF_BEFORE  path to the database to compare against.
 *                    Default: unset, which means `git show HEAD:data/bic.sqlite`
 *                    — the state committed before this run. Set it to rehearse
 *                    the guard against a deliberately damaged copy without
 *                    touching the tracked database.
 *
 * Exit codes:
 *   0  OK — the delta is within the measured bands. Safe to commit.
 *   1  REFUSED — at least one blocking anomaly, or the guard could not read one
 *      of the two databases. Do NOT commit; the previous database still stands.
 *
 * Output: a summary on stdout, blocking anomalies on stderr. Both are meant to
 * be read in a workflow log.
 *
 * Where to run it: after the seeders and BEFORE `git add`, and before the test
 * suite, so a data problem is reported as a data problem rather than as an
 * unrelated test failure.
 *
 * =====================================================================
 *
 * WHY THIS EXISTS
 *
 * refresh-bic.yml runs `npm run db:seed` (GLEIF) and `npm run bic:enrich`
 * (SwiftCodes, Bundesbank, SIX, OeNB, NBP, EBA Step2) and then commits
 * data/bic.sqlite. src/db/seed.ts drops bic_entries unconditionally and neither
 * of those two scripts has a sanity floor — unlike seed-bc-nummer.ts (800),
 * seed-blz.ts (2800) and seed-national.ts (AT 700 / BE 650). The only gate
 * before the commit is `npm run test`, whose strongest assertion on this table
 * is `expect(count).toBeGreaterThan(0)` (src/lib/bic-lookup.test.ts). A source
 * that answers with a truncated file therefore commits silently, and Railway
 * deploys on push.
 *
 * WHERE THE PREVIOUS STATE COMES FROM
 *
 * data/bic.sqlite is a tracked file, so `git show HEAD:data/bic.sqlite` is the
 * pre-refresh state, for free, with no artifact cache and no counts file that
 * can drift out of sync with the database it describes.
 *
 * This works under actions/checkout@v7 defaults, which are shallow but
 * blob-complete at HEAD. If the checkout ever moves to a blobless partial clone
 * (`filter: blob:none`), `git show` would have to fetch the 33 MB blob and this
 * guard would start failing on a network error rather than on a data problem —
 * set `fetch-depth: 1` without a filter, or fetch the blob explicitly.
 *
 * THE THRESHOLDS ARE MEASURED, NOT GUESSED
 *
 * Between the 01/07 and 01/08 crons the total moved 121,610 -> 121,716
 * (+0.09 %) and every country holding at least 200 rows moved inside
 * -1.46 % .. +2.35 %. The bands below sit an order of magnitude outside that,
 * so they fire on breakage, not on normal churn. Small sources move by whole
 * units (eba_step2 199 -> 189 -> 183) where a percentage is noise, so they are
 * guarded by an absolute delta instead.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';

// The two paths are overridable so the guard can be rehearsed against a
// deliberately damaged copy without touching the tracked database.
const DB = process.env.BIC_DIFF_AFTER ?? 'data/bic.sqlite';
const BEFORE = process.env.BIC_DIFF_BEFORE ?? null;

/** Relative drop that fails the run, for a population big enough to have a rate. */
const MAX_DROP_PCT = 10;
/** Below this many rows a percentage is noise; an absolute delta is used instead. */
const SMALL = 200;
/** Absolute drop that fails the run for a small population. */
const MAX_DROP_ABS = 25;
/**
 * A disappearance blocks only above this population: one country holding a
 * single row can legitimately lose it. Sources and whole tables always block.
 */
const MIN_POPULATION_TO_BLOCK_DISAPPEARANCE = 10;

interface Counts {
  total: number;
  bySource: Map<string, number>;
  byCountry: Map<string, number>;
  chClearing: number;
  deBlz: number;
  national: Map<string, number>;
  psd: number;
  psdByCountry: Map<string, number>;
}

function read(path: string): Counts {
  const db = new Database(path, { readonly: true });
  // Both helpers tolerate a table that does not exist in the older snapshot:
  // a table added since the previous commit must read as "new", never crash the
  // guard — a guard that throws is a guard that gets removed.
  const group = (sql: string): Map<string, number> => {
    try {
      return new Map(
        (db.prepare(sql).all() as Array<{ k: string; n: number }>).map((r) => [r.k, r.n]),
      );
    } catch {
      return new Map();
    }
  };
  const scalar = (sql: string): number => {
    try {
      return (db.prepare(sql).get() as { n: number }).n;
    } catch {
      return 0;
    }
  };
  const counts: Counts = {
    total: scalar('SELECT COUNT(*) AS n FROM bic_entries'),
    bySource: group('SELECT source AS k, COUNT(*) AS n FROM bic_entries GROUP BY source'),
    byCountry: group('SELECT country_code AS k, COUNT(*) AS n FROM bic_entries GROUP BY country_code'),
    chClearing: scalar('SELECT COUNT(*) AS n FROM ch_clearing'),
    deBlz: scalar('SELECT COUNT(*) AS n FROM de_blz'),
    national: group('SELECT country AS k, COUNT(*) AS n FROM national_bank_codes GROUP BY country'),
    psd: scalar('SELECT COUNT(*) AS n FROM psd_entities'),
    // Per country as well as in total: the EBA copy is one file for 30
    // competent authorities, so a national feed that stops arriving shrinks one
    // country to zero while the total barely moves. Spain is the country this
    // data is actually served for, and it is 112 of 4,416 rows — a drop there
    // would hide entirely inside a tolerance on the total.
    psdByCountry: group('SELECT country AS k, COUNT(*) AS n FROM psd_entities GROUP BY country'),
  };
  db.close();
  return counts;
}

/** Worst first, and the aggregate lines before the per-country detail. */
function severity(entry: { pct: number; label: string }): number {
  const rank = entry.label.startsWith('bic_entries') || entry.label.startsWith('source') ? -1000 : 0;
  return rank + entry.pct;
}

const rows: Array<{ pct: number; label: string; text: string; blocking: boolean }> = [];

function compare(label: string, before: number, after: number): void {
  if (before === 0) {
    if (after > 0) rows.push({ pct: 999, label, text: `${label}: new, ${after} rows`, blocking: false });
    return;
  }
  if (after === 0) {
    const isCountry = label.startsWith('country ');
    const blocking = !isCountry || before >= MIN_POPULATION_TO_BLOCK_DISAPPEARANCE;
    rows.push({ pct: -100, label, text: `${label}: ${before} -> 0 — disappeared entirely`, blocking });
    return;
  }
  const delta = after - before;
  const pct = (delta / before) * 100;
  const text = `${label}: ${before} -> ${after} (${delta >= 0 ? '+' : ''}${delta}, ${pct.toFixed(2)} %)`;
  const blocking = before >= SMALL ? pct < -MAX_DROP_PCT : delta < -MAX_DROP_ABS;
  if (blocking || Math.abs(pct) > 5) rows.push({ pct, label, text, blocking });
}

function compareMaps(kind: string, before: Map<string, number>, after: Map<string, number>): void {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    compare(`${kind} ${key}`, before.get(key) ?? 0, after.get(key) ?? 0);
  }
}

const tmp = mkdtempSync(resolve(tmpdir(), 'bicdiff-'));
const previousPath = resolve(tmp, 'previous.sqlite');
try {
  if (BEFORE) {
    copyFileSync(BEFORE, previousPath);
  } else {
    writeFileSync(
      previousPath,
      execFileSync('git', ['show', 'HEAD:data/bic.sqlite'], { maxBuffer: 512 * 1024 * 1024 }),
    );
  }
  const before = read(previousPath);
  const after = read(DB);

  compare('bic_entries total', before.total, after.total);
  compareMaps('source', before.bySource, after.bySource);
  compareMaps('country', before.byCountry, after.byCountry);
  compare('ch_clearing', before.chClearing, after.chClearing);
  compare('de_blz', before.deBlz, after.deBlz);
  compareMaps('national_bank_codes', before.national, after.national);
  compare('psd_entities', before.psd, after.psd);
  compareMaps('psd_entities country', before.psdByCountry, after.psdByCountry);

  console.log(`bic_entries: ${before.total} -> ${after.total}`);
  console.log(`sources: ${[...after.bySource].map(([k, n]) => `${k}=${n}`).join(' ')}`);
  console.log(`countries: ${before.byCountry.size} -> ${after.byCountry.size}`);
  // Only the head of each list is printed: a broken source moves every country
  // at once, and 200 lines of the same story hide the one line that names it.
  rows.sort((a, b) => severity(a) - severity(b));
  const failures = rows.filter((r) => r.blocking).map((r) => r.text);
  const notes = rows.filter((r) => !r.blocking).map((r) => r.text);

  if (notes.length) {
    console.log(`\nMoves worth a look, not blocking (${notes.length}):`);
    for (const n of notes.slice(0, 10)) console.log(`  - ${n}`);
    if (notes.length > 10) console.log(`  ... and ${notes.length - 10} more`);
  }
  if (failures.length) {
    console.error(`\nRefusing to commit ${DB}: ${failures.length} anomaly/anomalies`);
    for (const f of failures.slice(0, 12)) console.error(`  ! ${f}`);
    if (failures.length > 12) console.error(`  ... and ${failures.length - 12} more`);
    console.error(
      '\nA source answering with a truncated file looks exactly like this. ' +
        'Re-run once the sources are reachable; the previous database still stands.',
    );
    // exitCode rather than exit(): process.exit() does not unwind, so the
    // `finally` below would never run and every blocked run would leave its
    // temp copy of a 33 MB database behind on the runner.
    process.exitCode = 1;
  } else {
    console.log('\nQuality diff OK.');
  }
} catch (err) {
  // A guard that cannot read one of the two databases has not cleared the
  // refresh, so it must not exit 0. Reported distinctly from a data anomaly:
  // this is the branch that fires if `git show` cannot produce the blob.
  console.error(`\nRefusing to commit ${DB}: the quality diff could not run.`);
  console.error(`  ! ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
