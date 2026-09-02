import { getStatsDB } from './db.js';
import { buildBillableFilter } from './stats.js';
import { isInternalEmail, registerInternalEmailFn } from './internal-accounts.js';

/**
 * Everything the Monday digest writer is allowed to say, computed HERE in
 * tested TS. The writer (an LLM on the VPS) copies these numbers verbatim
 * into French prose; it is never trusted with arithmetic — a draft once
 * turned 727 into "726", so the rule is: the model narrates, this module
 * counts.
 */

export interface WeeklyMetric {
  current: number;
  previous: number;
  /** Percent change, 1 decimal; null when previous is 0 (no invented %). */
  delta_pct: number | null;
}

export interface WeeklyFacts {
  week: string;
  range: { from: string; to: string };
  requests: WeeklyMetric;
  billable_ok: WeeklyMetric;
  paywall_hits: WeeklyMetric;
  server_errors: { current: number; previous: number };
  signups: WeeklyMetric;
  first_calls: WeeklyMetric;
  purchases: WeeklyMetric;
  revenue_usdc_attempted: { current: number; previous: number };
  top_sources: Array<{ source: string; signups: number }>;
  top_countries: Array<{ country: string; count: number }>;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday 00:00 UTC of the week containing d. */
function mondayOf(d: Date): Date {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
  return m;
}

function isoWeekLabel(monday: Date): string {
  // ISO week = the week of its Thursday; week 1 holds January 4th.
  const thu = new Date(monday);
  thu.setUTCDate(thu.getUTCDate() + 3);
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function metric(current: number, previous: number): WeeklyMetric {
  return {
    current,
    previous,
    delta_pct: previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
  };
}

export function getWeeklyFacts(now: Date = new Date()): WeeklyFacts {
  const db = getStatsDB();

  const thisMonday = mondayOf(now);
  const from = new Date(thisMonday);
  from.setUTCDate(from.getUTCDate() - 7); // last full week's Monday
  const prevFrom = new Date(from);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - 7);

  // SQL windows are [start, end) on 'YYYY-MM-DD' bounds; created_at strings
  // in both SQL and ISO shape sort correctly against them.
  const curStart = isoDate(from);
  const curEnd = isoDate(thisMonday);
  const prevStart = isoDate(prevFrom);

  const billable = buildBillableFilter();

  // Business counters (billable_ok, paywall_hits) exclude internal keys the
  // same way the business funnel does — probe traffic once inflated a week by
  // hundreds of calls and the digest read the probe's silence as a collapse.
  // Anonymous traffic (NULL prefix) stays counted: x402 demand is market
  // signal. `requests` and `server_errors` stay raw on purpose, they are
  // technical metrics.
  // The exclusion used to be an IN list with one bound parameter per internal
  // key, interpolated twice — so the statement carried 2N parameters and threw
  // "too many SQL variables" past SQLite's 2000-parameter ceiling (measured on
  // both better-sqlite3 11 and 13). Production sits far below that today, but
  // the ceiling is a function of how many keys exist, which only ever grows:
  // a burst of automated signups is precisely the moment the weekly digest
  // must not go dark.
  //
  // The rule stays in TypeScript — INTERNAL_EMAIL_RE is the single source of
  // truth and must not be re-expressed as LIKE patterns that would drift from
  // it. It is exposed to SQLite as a function instead, so the filter becomes a
  // subquery with zero parameters, whatever the number of keys.
  registerInternalEmailFn(db);
  const notInternal =
    'AND (key_prefix IS NULL OR key_prefix NOT IN ' +
    '(SELECT key_prefix FROM api_keys WHERE is_internal_email(email)))';

  const reqWindow = (start: string, end: string) =>
    db
      .prepare(
        `SELECT COUNT(*) AS requests,
           SUM(CASE WHEN status >= 200 AND status < 300 AND (${billable.sql}) ${notInternal} THEN 1 ELSE 0 END) AS billable_ok,
           SUM(CASE WHEN status IN (402, 429) ${notInternal} THEN 1 ELSE 0 END) AS paywall_hits,
           SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS server_errors
         FROM request_log
         WHERE created_at >= ? AND created_at < ?`,
      )
      .get(...billable.params, start, end) as {
      requests: number;
      billable_ok: number | null;
      paywall_hits: number | null;
      server_errors: number | null;
    };

  const cur = reqWindow(curStart, curEnd);
  const prev = reqWindow(prevStart, curStart);

  // Signups / first calls / purchases per window, internal accounts excluded.
  const keys = db
    .prepare(`SELECT email, key_prefix, created_at, credits_total FROM api_keys`)
    .all() as Array<{
    email: string;
    key_prefix: string;
    created_at: string;
    credits_total: number | null;
  }>;
  const external = keys.filter((k) => !isInternalEmail(k.email));

  const inWindow = (sql: string, start: string, end: string) => {
    const day = sql.slice(0, 10);
    return day >= start && day < end;
  };

  // A signup week is the week of the client's FIRST key, so a buyer whose
  // pack key arrives later is one signup and one purchase, not two signups.
  const firstKeyByEmail = new Map<string, string>();
  for (const k of external) {
    const seen = firstKeyByEmail.get(k.email);
    if (!seen || k.created_at < seen) firstKeyByEmail.set(k.email, k.created_at);
  }
  const signupsIn = (start: string, end: string) =>
    [...firstKeyByEmail.values()].filter((d) => inWindow(d, start, end)).length;

  const purchasesIn = (start: string, end: string) =>
    external.filter((k) => k.credits_total != null && inWindow(k.created_at, start, end)).length;

  // First calls: per external prefix, the earliest request_log row; the
  // client's first call is the earliest across their prefixes.
  const prefixes = external.map((k) => k.key_prefix);
  const firstCallByPrefix = new Map<string, string>();
  if (prefixes.length > 0) {
    const rows = db
      .prepare(
        `SELECT key_prefix, MIN(created_at) AS first_at FROM request_log
         WHERE key_prefix IN (${prefixes.map(() => '?').join(',')})
         GROUP BY key_prefix`,
      )
      .all(...prefixes) as Array<{ key_prefix: string; first_at: string }>;
    for (const r of rows) firstCallByPrefix.set(r.key_prefix, r.first_at);
  }
  const firstCallByEmail = new Map<string, string>();
  for (const k of external) {
    const at = firstCallByPrefix.get(k.key_prefix);
    if (!at) continue;
    const seen = firstCallByEmail.get(k.email);
    if (!seen || at < seen) firstCallByEmail.set(k.email, at);
  }
  const firstCallsIn = (start: string, end: string) =>
    [...firstCallByEmail.values()].filter((d) => inWindow(d, start, end)).length;

  const revenueIn = (start: string, end: string) =>
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(revenue_usdc), 0) AS total FROM daily_stats WHERE date >= ? AND date < ?`,
        )
        .get(start, end) as { total: number }
    ).total;

  const topSources = db
    .prepare(
      `SELECT COALESCE(source, 'direct') AS source, COUNT(*) AS signups FROM api_keys
       WHERE created_at >= ? AND created_at < ?
       GROUP BY COALESCE(source, 'direct') ORDER BY signups DESC LIMIT 5`,
    )
    .all(curStart, curEnd) as Array<{ source: string; signups: number }>;

  const topCountries = db
    .prepare(
      `SELECT country_code AS country, COUNT(*) AS count FROM operations
       WHERE country_code IS NOT NULL AND created_at >= ? AND created_at < ?
       GROUP BY country_code ORDER BY count DESC LIMIT 5`,
    )
    .all(curStart, curEnd) as Array<{ country: string; count: number }>;

  const endInclusive = new Date(thisMonday);
  endInclusive.setUTCDate(endInclusive.getUTCDate() - 1);

  return {
    week: isoWeekLabel(from),
    range: { from: curStart, to: isoDate(endInclusive) },
    requests: metric(cur.requests, prev.requests),
    billable_ok: metric(cur.billable_ok ?? 0, prev.billable_ok ?? 0),
    paywall_hits: metric(cur.paywall_hits ?? 0, prev.paywall_hits ?? 0),
    server_errors: { current: cur.server_errors ?? 0, previous: prev.server_errors ?? 0 },
    signups: metric(signupsIn(curStart, curEnd), signupsIn(prevStart, curStart)),
    first_calls: metric(firstCallsIn(curStart, curEnd), firstCallsIn(prevStart, curStart)),
    purchases: metric(purchasesIn(curStart, curEnd), purchasesIn(prevStart, curStart)),
    revenue_usdc_attempted: {
      current: revenueIn(curStart, curEnd),
      previous: revenueIn(prevStart, curStart),
    },
    top_sources: topSources,
    top_countries: topCountries,
  };
}

// ---------------------------------------------------------------- digest rows

export interface DigestRow {
  week: string;
  created_at: string;
  body_fr: string;
}

/** Upsert by week: the Monday cron can re-run without duplicating. */
export function saveWeeklyDigest(week: string, bodyFr: string, factsJson: string): void {
  getStatsDB()
    .prepare(
      `INSERT INTO weekly_digest (week, body_fr, facts_json) VALUES (?, ?, ?)
       ON CONFLICT(week) DO UPDATE SET body_fr = excluded.body_fr, facts_json = excluded.facts_json, created_at = datetime('now')`,
    )
    .run(week, bodyFr, factsJson);
}

export function getWeeklyDigests(limit = 8): DigestRow[] {
  return getStatsDB()
    .prepare(`SELECT week, created_at, body_fr FROM weekly_digest ORDER BY week DESC LIMIT ?`)
    .all(Math.max(1, Math.min(52, limit))) as DigestRow[];
}
