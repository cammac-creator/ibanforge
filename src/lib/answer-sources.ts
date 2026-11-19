/**
 * 🚨 NEVER JOINED, NEVER CROSSED. `answer_sources_daily` is not joined or crossed with
 * `operations`, `request_log` or any table that carries a key, an IP address or a time —
 * not in SQL, not in a script, not in a page. The two are read separately. On a quiet day
 * a cell of 1 would otherwise tie a source family to a key prefix, which Claude-Alain's
 * decision of 19 November 2026 ruled out. `answer-sources-isolation.test.ts` holds the SQL
 * of `src/` and `scripts/` to it.
 *
 * Where the bank named by a validation came from: an anonymous daily count, by
 * country and by family of source (19 November 2026).
 *
 * ## The question it answers
 *
 * Every validation already says, in its own payload, where the bank it names
 * came from (`bank_code_holder`, `bank_code_check.authoritative`, `bic.basis`,
 * `bic.source`, `bic.source_as_of`). Nothing added those answers up, so nobody
 * could say for which countries the service still leans on the frozen 2018
 * copy of the SWIFT directory, or finds no bank at all — the countries where a
 * fresher source is worth looking for. This table is that sum.
 *
 * ## What a row carries, and what it never carries
 *
 * `answer_sources_daily (day, country, family, count)`, primary key
 * `(day, country, family)`, incremented by upsert. `day` is the UTC date alone.
 * A row NEVER carries a key or its prefix, an IP address or its hash, a user
 * agent, a time of day, an IBAN (even truncated), a bank code, a BIC or a bank
 * name — and no `created_at` either, which would store the hour of the first
 * count of the day. `answer-sources.test.ts` holds the exact column list. This
 * is the line of the Privacy Policy that names these totals (section 1,
 * "Aggregated statistics", revision 1.13): anonymous, kept indefinitely.
 *
 * It is deliberately NOT in `PAID_STATE_TABLES` (src/lib/paid-state.ts): it is
 * no state a paying customer needs back, like `daily_stats`, and a lost volume
 * loses it the same way.
 *
 * ## What is counted
 *
 * Each VALID IBAN served by `POST /v1/iban/validate`, `POST /v1/iban/batch`
 * (one per IBAN) and the hosted MCP tools `validate_iban` and
 * `batch_validate_iban` (src/routes/mcp-http.ts, one per IBAN), whatever paid
 * for it. An invalid IBAN names no bank and is not counted. A keyless call
 * signed by one of our own tools (`INTERNAL_TOOL_UA_PREFIX`) is not counted,
 * the rule `NOT_INTERNAL_TOOL_SQL` applies to `request_log`: a key always
 * speaks louder than the agent. Calls made with a key of one of our own
 * accounts ARE counted: the table holds no key to filter on afterwards, and
 * the MCP meter does not hand the key's owner to the tool.
 *
 * The stdio MCP server (src/mcp/server.ts) is not wired: it runs in its own
 * process on someone else's machine, against that machine's database.
 */
import type Database from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { sourceName } from './bic-lookup.js';
import { sourceVintage } from './source-vintage.js';
import { INTERNAL_TOOL_UA_PREFIX } from './stats.js';
import type { IBANValidationResult } from '../types.js';

/**
 * The families, from the most settled source to no bank at all. The first five
 * are the ones Claude-Alain chose on 19 November 2026; `other_current` takes
 * the answers that come from neither GLEIF nor the 2018 copy, so that none of
 * them is filed under a source it did not come from.
 *
 * - `national_register` — a national register read in full named the holder of
 *   the bank code (`bank_code_holder: confirmed` with
 *   `bank_code_check.authoritative: true`: Bundesbank, SIX BankMaster, OeNB,
 *   NBB, BNB, NBS, ČNB…).
 * - `partial_list` — a register or list that covers only part of the country
 *   named the holder (`confirmed`, `authoritative: false`: San Marino, Finland,
 *   Luxembourg, Greece, Estonia, Montenegro, Serbia, Israel, Mongolia, Russia,
 *   Denmark…), or printed the BIC beside the code (`bic.basis:
 *   national_register` without an authoritative verdict).
 * - `gleif` — the prefix fallback read a GLEIF row (`bic.basis:
 *   directory_prefix`, `bic.source` GLEIF), refreshed every month.
 * - `swift_2018` — the row that describes the bank comes from the frozen copy
 *   of the SWIFT directory, January 2018: the answer carries `bic.source_as_of`
 *   (src/lib/source-vintage.ts), whether the curated map or the prefix fallback
 *   reached it.
 * - `other_current` — any other bank found: our curated map where the row
 *   behind it is not the 2018 copy, a prefix match on a Bundesbank, SIX, STEP2,
 *   NBP or OeNB row, a published structural rule.
 * - `none` — no bank: no BIC and no register naming a holder, a code the
 *   national register says nobody holds (`not_allocated`), or a reference
 *   lookup that could not run.
 */
export const ANSWER_SOURCE_FAMILIES = [
  'national_register',
  'partial_list',
  'gleif',
  'swift_2018',
  'other_current',
  'none',
] as const;

export type AnswerSourceFamily = (typeof ANSWER_SOURCE_FAMILIES)[number];

/** The source name `bic.source` carries for a GLEIF row, read from the one table that names it. */
const GLEIF_SOURCE = sourceName('gleif');
/** The month the frozen copy describes, read from source-vintage.ts, never written here. */
const SWIFT_2018_AS_OF = sourceVintage('swiftcodes')?.as_of ?? null;

/**
 * The family of the bank a served answer names, read from that answer alone:
 * no second lookup. `null` for an invalid IBAN, which is not counted.
 */
export function answerSourceFamily(result: IBANValidationResult): AnswerSourceFamily | null {
  if (!result.valid || !result.country?.code) return null;

  // A register named the holder: the register is the source, whatever the BIC
  // beside it came from (a Swiss IID without a BIC in BankMaster still names
  // its bank).
  if (result.bank_code_holder === 'confirmed') {
    return result.bank_code_check?.authoritative ? 'national_register' : 'partial_list';
  }

  const bic = result.bic;
  if (!bic) return 'none';
  if (bic.basis === 'national_register') {
    return result.bank_code_check?.authoritative ? 'national_register' : 'partial_list';
  }
  if (SWIFT_2018_AS_OF !== null && bic.source_as_of === SWIFT_2018_AS_OF) return 'swift_2018';
  if (bic.basis === 'directory_prefix' && bic.source === GLEIF_SOURCE) return 'gleif';
  return 'other_current';
}

/**
 * Whether a call comes from one of our own tools, keyless: the rule
 * `classifyClient` and `NOT_INTERNAL_TOOL_SQL` apply. A call with a key is
 * never one, whatever its agent says.
 */
export function isOwnToolCall(
  keyPresented: boolean,
  userAgent: string | null | undefined,
): boolean {
  if (keyPresented || !userAgent) return false;
  return userAgent.toLowerCase().startsWith(INTERNAL_TOOL_UA_PREFIX);
}

/** One statement per open database: a reopened database gets its own. */
const upserts = new WeakMap<Database.Database, Database.Statement>();

function upsertFor(db: Database.Database): Database.Statement {
  let stmt = upserts.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO answer_sources_daily (day, country, family, count)
      VALUES (date('now'), ?, ?, ?)
      ON CONFLICT(day, country, family) DO UPDATE SET count = count + excluded.count
    `);
    upserts.set(db, stmt);
  }
  return stmt;
}

/**
 * Count the served answers: one per valid IBAN, grouped first, so a batch of
 * a hundred IBANs of one bank is one upsert in one transaction.
 *
 * Returns false when the write failed, so `recordSafely` can count failures
 * and raise its alert. It never throws: a broken statistics database must not
 * turn a served validation into an error.
 */
export function recordAnswerSources(results: readonly IBANValidationResult[]): boolean {
  try {
    const cells = new Map<string, { country: string; family: AnswerSourceFamily; n: number }>();
    for (const result of results) {
      const family = answerSourceFamily(result);
      if (!family) continue;
      const country = result.country!.code;
      const key = `${country}|${family}`;
      const cell = cells.get(key);
      if (cell) cell.n += 1;
      else cells.set(key, { country, family, n: 1 });
    }
    if (cells.size === 0) return true;
    const db = getStatsDB();
    const stmt = upsertFor(db);
    db.transaction(() => {
      for (const { country, family, n } of cells.values()) stmt.run(country, family, n);
    })();
    return true;
  } catch (err) {
    console.error(
      '[stats] recordAnswerSources failed:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

export interface AnswerSourceShare {
  count: number;
  /** Fraction of the country's counted answers, 0 to 1, three decimals. */
  share: number;
}

export interface AnswerSourcesCountry {
  country: string;
  total: number;
  families: Record<AnswerSourceFamily, AnswerSourceShare>;
}

export interface AnswerSourcesReport {
  period_days: number;
  /** First UTC day of the window, today included in it. */
  since: string;
  families: readonly AnswerSourceFamily[];
  total: number;
  /** Largest country first. */
  by_country: AnswerSourcesCountry[];
}

const share = (count: number, total: number): number =>
  total > 0 ? Math.round((count / total) * 1000) / 1000 : 0;

/**
 * The share of each family, by country, over the last `days` calendar days in
 * UTC, today included. Numbers only.
 */
export function getAnswerSources(days: number): AnswerSourcesReport {
  const db = getStatsDB();
  const back = `-${Math.max(0, days - 1)} days`;
  const { since } = db.prepare(`SELECT date('now', ?) AS since`).get(back) as { since: string };
  const rows = db
    .prepare(
      `SELECT country, family, SUM(count) AS n
       FROM answer_sources_daily
       WHERE day >= ?
       GROUP BY country, family`,
    )
    .all(since) as Array<{ country: string; family: string; n: number }>;

  const byCountry = new Map<string, Record<AnswerSourceFamily, number>>();
  for (const row of rows) {
    if (!(ANSWER_SOURCE_FAMILIES as readonly string[]).includes(row.family)) continue;
    let counts = byCountry.get(row.country);
    if (!counts) {
      counts = Object.fromEntries(ANSWER_SOURCE_FAMILIES.map((f) => [f, 0])) as Record<
        AnswerSourceFamily,
        number
      >;
      byCountry.set(row.country, counts);
    }
    counts[row.family as AnswerSourceFamily] += row.n;
  }

  const countries: AnswerSourcesCountry[] = [...byCountry.entries()].map(([country, counts]) => {
    const total = ANSWER_SOURCE_FAMILIES.reduce((acc, f) => acc + counts[f], 0);
    const families = Object.fromEntries(
      ANSWER_SOURCE_FAMILIES.map((f) => [f, { count: counts[f], share: share(counts[f], total) }]),
    ) as Record<AnswerSourceFamily, AnswerSourceShare>;
    return { country, total, families };
  });
  countries.sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));

  return {
    period_days: days,
    since,
    families: ANSWER_SOURCE_FAMILIES,
    total: countries.reduce((acc, c) => acc + c.total, 0),
    by_country: countries,
  };
}
