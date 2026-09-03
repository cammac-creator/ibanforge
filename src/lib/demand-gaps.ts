import type { Statement } from 'better-sqlite3';
import { validate } from 'iban-core';
import { getStatsDB } from './db.js';
import { TEXTBOOK_IBANS } from './textbook-ibans.js';

/**
 * The demand ledger: what callers asked for that we could not answer.
 *
 * ## The organ this adds
 *
 * Every other feedback channel here requires someone to SPEAK — send_feedback,
 * an email, a forum thread. But the most honest signal of what the tool should
 * learn next is silent and constant: the lookups it failed. A German BLZ we
 * do not hold, a Lithuanian bank code with no register behind it, a BIC of
 * valid shape that resolves to nothing. Until 01/09/2026 those answers were
 * served and forgotten — `recordOperation` keeps a truncated errorDetail, but
 * nothing aggregated by CODE, so "which register should we plug in next" was
 * decided by supposition while the traffic answered it daily.
 *
 * This table is that answer: one row per (kind, country, code, outcome),
 * counted. The reader ranks by hits and the monthly data decision follows
 * DEMAND. It is the third loop of the living tool — supply (the monthly
 * refresh rebuilds the base), feedback (send_feedback), and now demand.
 *
 * ## What is deliberately NOT stored
 *
 * No IBANs, no account parts, no caller identity, no timestamps per event.
 * A bank code, a BIC, an IID are public register keys — the same strings the
 * registers themselves publish — and that is the ONLY grain kept. Every
 * recorder shape-gates its input so a garbage path segment (or an email pasted
 * into the :code param) can never reach storage. The row-cap below bounds the
 * table against a scanner spraying valid-shaped keys.
 *
 * Same failure doctrine as stats.ts: recording must never break the API, but
 * a broken write is logged rather than swallowed silently.
 */

export type DemandGapKind = 'bank_code' | 'bic' | 'ch_clearing';

/**
 * Shape gates, one per kind. A key that fails its gate is dropped, not
 * normalised: the point is that ONLY register-key-shaped strings exist in
 * this table, so its content is publishable and joinable by construction.
 */
const KEY_SHAPE: Record<DemandGapKind, RegExp> = {
  // Positional slice of a checksum-valid IBAN: alphanumeric, bounded. The
  // caller passes the value the verdict was ABOUT (hit.checked / value), which
  // national registers keep within 2-8 chars everywhere we parse.
  bank_code: /^[A-Z0-9]{1,10}$/i,
  // ISO 9362 after validateBIC: this only re-states what already passed.
  bic: /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/i,
  // Swiss IID after normalizeIid.
  ch_clearing: /^\d{1,5}$/,
};

const COUNTRY_SHAPE = /^[A-Z]{2}$/;

/**
 * Hard bound on DISTINCT rows. Existing rows keep counting past it; new keys
 * are dropped. 50k distinct register keys is far beyond any legitimate
 * traffic (all national registers we parse together hold fewer codes) and
 * small enough that a spray attack cannot bloat stats.sqlite.
 */
const MAX_ROWS = 50_000;

let ensured = false;
let stmtUpsert: Statement | null = null;
let stmtCount: Statement | null = null;
/**
 * undefined = not read yet, a number = the live row count, maintained on the
 * write path. The distinction matters for the same reason it does in
 * bic-lookup's lastUpdatedCache: confusing "unknown" with a real value would
 * either re-count on every write or never notice the cap.
 */
let rowCountCache: number | undefined;

function ensureTable(): void {
  if (ensured) return;
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS lookup_gaps (
      kind TEXT NOT NULL,
      country TEXT,
      code TEXT NOT NULL,
      outcome TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, country, code, outcome)
    );
    CREATE INDEX IF NOT EXISTS idx_lookup_gaps_last_seen ON lookup_gaps(last_seen);
  `);
  purgeTextbookRows();
  ensured = true;
}

/**
 * Rows the textbook IBANs left behind before the recording site learned to
 * skip them (03/09/2026: CH 00762 thirteen times in two days, LT 10000, the
 * Turkish example's 00061). Deleting by (country, bank_code) of each textbook
 * IBAN, at every boot, is idempotent and costs one statement per entry on a
 * table of at most 50k rows; it also covers a textbook IBAN added later, whose
 * old rows would otherwise sit at the top of the ledger for a month.
 *
 * Same failure doctrine as the recorder: a failed purge is logged, never fatal.
 */
function purgeTextbookRows(): void {
  try {
    const del = getStatsDB().prepare(
      `DELETE FROM lookup_gaps WHERE kind = 'bank_code' AND country = ? AND code = ?`,
    );
    for (const iban of TEXTBOOK_IBANS) {
      const parsed = validate(iban);
      const code = parsed.bban?.bank_code;
      if (!parsed.valid || !code) continue;
      del.run(iban.slice(0, 2), code.toUpperCase());
    }
  } catch (err) {
    console.error('[demand-gaps] textbook purge failed:', err);
  }
}

function upsert(): Statement {
  if (!stmtUpsert) {
    ensureTable();
    stmtUpsert = getStatsDB().prepare(
      `INSERT INTO lookup_gaps (kind, country, code, outcome)
       VALUES (@kind, @country, @code, @outcome)
       ON CONFLICT(kind, country, code, outcome)
       DO UPDATE SET hits = hits + 1, last_seen = datetime('now')`,
    );
  }
  return stmtUpsert;
}

function countRows(): number {
  if (!stmtCount) {
    ensureTable();
    stmtCount = getStatsDB().prepare('SELECT COUNT(*) AS n FROM lookup_gaps');
  }
  return (stmtCount.get() as { n: number }).n;
}

/**
 * Record one unanswerable lookup. Never throws; never stores an off-shape key.
 *
 * The outcome string is `status` or `status:reason` from the verdict that was
 * actually served (`not_in_register:not_allocated`, `unavailable:lookup_failed`,
 * `not_found`), so the reader can split real demand (the register answered
 * "no such code") from our own outages (the register could not be read) —
 * both are worth counting, only the first ranks data gaps.
 */
export function recordDemandGap(
  kind: DemandGapKind,
  country: string | null,
  code: string,
  outcome: string,
): void {
  try {
    if (!KEY_SHAPE[kind].test(code)) return;
    // No country, no row. Every caller can name one (the IBAN's, the BIC's
    // chars 5-6, 'CH'), a gap without one is not rankable — and SQLite's
    // legacy quirk admits NULL into a non-integer PRIMARY KEY, where
    // NULL ≠ NULL would turn the upsert into one fresh row per hit.
    if (!country || !COUNTRY_SHAPE.test(country)) return;
    const cc = country.toUpperCase();
    const key = code.toUpperCase();
    const oc = outcome.slice(0, 60);
    if (rowCountCache === undefined) rowCountCache = countRows();
    // One indexed point read decides insert-vs-count: it keeps the row cap
    // honest without re-counting the table, and costs a primary-key probe on
    // a path that already runs several per request.
    const exists = getStatsDB()
      .prepare(
        'SELECT 1 FROM lookup_gaps WHERE kind = ? AND country = ? AND code = ? AND outcome = ? LIMIT 1',
      )
      .get(kind, cc, key, oc);
    if (!exists && rowCountCache >= MAX_ROWS) return;
    upsert().run({ kind, country: cc, code: key, outcome: oc });
    if (!exists) rowCountCache += 1;
  } catch (err) {
    console.error('[demand-gaps] record failed:', err);
  }
}

export interface DemandGapRow {
  kind: string;
  country: string | null;
  code: string;
  outcome: string;
  hits: number;
  first_seen: string;
  last_seen: string;
}

export interface DemandGapSummary {
  period_days: number;
  /** Distinct keys and total hits per country, real-demand outcomes only. */
  by_country: Array<{ country: string | null; distinct_codes: number; hits: number }>;
  /** The ranked ledger itself, most-asked first. */
  top: DemandGapRow[];
  /** Outages (unavailable:*) kept apart so they cannot inflate a data gap. */
  outages: DemandGapRow[];
}

/** When the ledger started counting (oldest first_seen), or null when empty. */
export function ledgerSince(): string | null {
  ensureTable();
  const row = getStatsDB().prepare('SELECT MIN(first_seen) AS since FROM lookup_gaps').get() as
    { since: string | null } | undefined;
  return row?.since ?? null;
}

/**
 * The reader behind /v1/admin/demand-gaps. `days` windows on last_seen, so a
 * gap nobody has hit for months ages out of the ranking without being erased.
 */
export function getDemandGaps(days: number): DemandGapSummary {
  ensureTable();
  const db = getStatsDB();
  const cutoff = `-${Math.max(1, Math.min(365, Math.floor(days)))} days`;
  const demandFilter = `last_seen >= datetime('now', ?) AND outcome NOT LIKE 'unavailable%'`;
  const by_country = db
    .prepare(
      `SELECT country, COUNT(*) AS distinct_codes, SUM(hits) AS hits
       FROM lookup_gaps WHERE ${demandFilter}
       GROUP BY country ORDER BY hits DESC`,
    )
    .all(cutoff) as DemandGapSummary['by_country'];
  const top = db
    .prepare(
      `SELECT kind, country, code, outcome, hits, first_seen, last_seen
       FROM lookup_gaps WHERE ${demandFilter}
       ORDER BY hits DESC, last_seen DESC LIMIT 100`,
    )
    .all(cutoff) as DemandGapRow[];
  const outages = db
    .prepare(
      `SELECT kind, country, code, outcome, hits, first_seen, last_seen
       FROM lookup_gaps
       WHERE last_seen >= datetime('now', ?) AND outcome LIKE 'unavailable%'
       ORDER BY hits DESC LIMIT 50`,
    )
    .all(cutoff) as DemandGapRow[];
  return { period_days: Math.max(1, Math.min(365, Math.floor(days))), by_country, top, outages };
}

/** Test hook, same contract as resetStatements(): forget the cached database. */
export function resetDemandGaps(): void {
  ensured = false;
  stmtUpsert = null;
  stmtCount = null;
  rowCountCache = undefined;
}
