import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';

/**
 * Per-EMAIL activation picture. The unit is deliberately the email, never the
 * key: a paying customer holds their pack on a separate credit key whose
 * monthly `used` counter stays at zero (credit keys burn credits_remaining
 * instead), so any per-key reading shows the exact wrong thing — a buyer
 * rendered as "unused". Every consumer of usage MUST go through this module
 * or repeat that mistake.
 */

export interface ActivationClient {
  email: string;
  keys: Array<{ key_prefix: string; role: 'free' | 'paid'; active: number }>;
  signup_at: string;
  source: string;
  first_call_at: string | null;
  last_seen_at: string | null;
  calls_90d: number;
  free_used_month: number;
  free_quota: number;
  paywall_hits: number;
  credits_total: number;
  credits_remaining: number;
  packs: number;
  status: 'new' | 'active' | 'at-limit' | 'paying' | 'dormant' | 'silent';
}

export interface ActivationFunnel {
  period_days: number;
  signed_up: number;
  first_call: number;
  hit_limit: number;
  purchased: number;
  median_hours_signup_to_first_call: number | null;
  median_hours_first_call_to_purchase: number | null;
}

export interface ActivationSourceRow {
  source: string;
  signups: number;
  called: number;
  paying: number;
}

export interface ActivationCohort {
  week_start: string;
  signups: number;
  called_pct: number;
  paid_pct: number;
}

export interface ActivationResponse {
  clients: ActivationClient[];
  funnel: ActivationFunnel;
  sources: ActivationSourceRow[];
  cohorts: ActivationCohort[];
}

interface KeyRow {
  email: string;
  key_prefix: string;
  key_hash: string;
  created_at: string;
  active: number;
  monthly_limit: number | null;
  credits_total: number | null;
  credits_remaining: number | null;
  source: string | null;
}

interface LogAgg {
  key_prefix: string;
  first_call_at: string | null;
  last_seen_at: string | null;
  calls_90d: number;
  paywall_hits: number;
}

/**
 * Datetimes in these tables come in two shapes: SQLite defaults write
 * 'YYYY-MM-DD HH:MM:SS' (UTC, no marker) while application inserts store full
 * ISO strings. Normalizing here is what keeps mondayOf() from producing an
 * Invalid Date on the second shape (a double-Z crashed this module's first
 * production run).
 */
function parseSqlUtc(sql: string): Date {
  const iso = sql.includes('T') ? sql : sql.replace(' ', 'T');
  const marked = /(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`;
  return new Date(marked);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, z) => a - z);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
}

function hoursBetween(fromSql: string, toSql: string): number {
  return (parseSqlUtc(toSql).getTime() - parseSqlUtc(fromSql).getTime()) / 3_600_000;
}

/** Monday (UTC) of the week containing the given SQL datetime. */
function mondayOf(sqlDate: string): string | null {
  const d = parseSqlUtc(sqlDate);
  if (Number.isNaN(d.getTime())) return null;
  const shift = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export function getActivation(days = 30): ActivationResponse {
  const db = getStatsDB();

  const keyRows = db
    .prepare(
      `SELECT email, key_prefix, key_hash, created_at, active, monthly_limit, credits_total, credits_remaining, source
       FROM api_keys ORDER BY email, created_at`,
    )
    .all() as KeyRow[];

  const external = keyRows.filter((k) => !isInternalEmail(k.email));

  // One batched aggregate over request_log for every external prefix; the
  // first/last call windows are unbounded on purpose (a first call is a fact
  // about the whole relationship — request_log's own 12-month retention is the
  // only horizon), while volume and paywall counts are 90-day.
  const prefixes = [...new Set(external.map((k) => k.key_prefix))];
  const logByPrefix = new Map<string, LogAgg>();
  if (prefixes.length > 0) {
    const placeholders = prefixes.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT key_prefix,
           MIN(created_at) AS first_call_at,
           MAX(created_at) AS last_seen_at,
           SUM(CASE WHEN created_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS calls_90d,
           SUM(CASE WHEN status IN (402, 429) AND created_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS paywall_hits
         FROM request_log
         WHERE key_prefix IN (${placeholders})
         GROUP BY key_prefix`,
      )
      .all(...prefixes) as LogAgg[];
    for (const r of rows) logByPrefix.set(r.key_prefix, r);
  }

  const usageByHash = new Map<string, number>();
  for (const r of db
    .prepare(`SELECT key_hash, count FROM api_usage WHERE month = strftime('%Y-%m', 'now')`)
    .all() as Array<{ key_hash: string; count: number }>) {
    usageByHash.set(r.key_hash, r.count);
  }

  const byEmail = new Map<string, KeyRow[]>();
  for (const k of external) {
    const list = byEmail.get(k.email) ?? [];
    list.push(k);
    byEmail.set(k.email, list);
  }

  const nowMs = Date.now();
  const ageDays = (sql: string) => (nowMs - parseSqlUtc(sql).getTime()) / 86_400_000;

  const clients: ActivationClient[] = [];
  for (const [email, list] of byEmail) {
    const freeKeys = list.filter((k) => k.credits_total == null);
    const paidKeys = list.filter((k) => k.credits_total != null);

    let firstCall: string | null = null;
    let lastSeen: string | null = null;
    let calls90 = 0;
    let paywall = 0;
    for (const k of list) {
      const agg = logByPrefix.get(k.key_prefix);
      if (!agg) continue;
      if (agg.first_call_at && (!firstCall || agg.first_call_at < firstCall)) firstCall = agg.first_call_at;
      if (agg.last_seen_at && (!lastSeen || agg.last_seen_at > lastSeen)) lastSeen = agg.last_seen_at;
      calls90 += agg.calls_90d ?? 0;
      paywall += agg.paywall_hits ?? 0;
    }

    const signupAt = list.reduce((min, k) => (k.created_at < min ? k.created_at : min), list[0].created_at);
    const freeUsed = freeKeys.reduce((a, k) => a + (usageByHash.get(k.key_hash) ?? 0), 0);
    const freeQuota = freeKeys.reduce((a, k) => a + (k.monthly_limit ?? 200), 0);
    const creditsTotal = paidKeys.reduce((a, k) => a + (k.credits_total ?? 0), 0);
    const creditsRemaining = paidKeys.reduce((a, k) => a + (k.credits_remaining ?? 0), 0);

    // Paid state is decided FIRST: a buyer can never fall through to the
    // free-tier labels, whatever their counters look like.
    let status: ActivationClient['status'];
    if (paidKeys.length > 0) {
      status = lastSeen !== null && ageDays(lastSeen) <= 14 ? 'paying' : 'dormant';
    } else if (firstCall === null) {
      status = ageDays(signupAt) < 3 ? 'new' : 'silent';
    } else if ((freeQuota > 0 && freeUsed >= freeQuota) || paywall > 0) {
      status = 'at-limit';
    } else if (ageDays(lastSeen ?? firstCall) <= 14) {
      status = 'active';
    } else {
      status = 'silent';
    }

    clients.push({
      email,
      keys: list.map((k) => ({
        key_prefix: k.key_prefix,
        role: k.credits_total != null ? 'paid' : 'free',
        active: k.active,
      })),
      signup_at: signupAt,
      source: list.map((k) => k.source).find((s) => s != null) ?? 'direct',
      first_call_at: firstCall,
      last_seen_at: lastSeen,
      calls_90d: calls90,
      free_used_month: freeUsed,
      free_quota: freeQuota,
      paywall_hits: paywall,
      credits_total: creditsTotal,
      credits_remaining: creditsRemaining,
      packs: paidKeys.length,
      status,
    });
  }

  clients.sort((a, z) => {
    if ((a.packs > 0) !== (z.packs > 0)) return a.packs > 0 ? -1 : 1;
    return (z.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '');
  });

  // ---- funnel: signups of the period, each step = "ever reached that state"
  const cutoffMs = nowMs - days * 86_400_000;
  const inPeriod = clients.filter((c) => parseSqlUtc(c.signup_at).getTime() >= cutoffMs);
  const called = inPeriod.filter((c) => c.first_call_at !== null);
  const limited = inPeriod.filter(
    (c) => c.paywall_hits > 0 || (c.free_quota > 0 && c.free_used_month >= c.free_quota),
  );
  const buyers = inPeriod.filter((c) => c.packs > 0);

  const purchaseAt = (c: ActivationClient): string | null => {
    const paid = byEmail
      .get(c.email)!
      .filter((k) => k.credits_total != null)
      .map((k) => k.created_at)
      .sort()[0];
    return paid ?? null;
  };

  const funnel: ActivationFunnel = {
    period_days: days,
    signed_up: inPeriod.length,
    first_call: called.length,
    hit_limit: limited.length,
    purchased: buyers.length,
    median_hours_signup_to_first_call: median(
      called.map((c) => hoursBetween(c.signup_at, c.first_call_at!)).filter((h) => h >= 0),
    ),
    median_hours_first_call_to_purchase: median(
      buyers
        .filter((c) => c.first_call_at !== null && purchaseAt(c) !== null)
        .map((c) => hoursBetween(c.first_call_at!, purchaseAt(c)!))
        .filter((h) => h >= 0),
    ),
  };

  // ---- sources: same population as the funnel, so the two read together
  const bySource = new Map<string, ActivationSourceRow>();
  for (const c of inPeriod) {
    const row = bySource.get(c.source) ?? { source: c.source, signups: 0, called: 0, paying: 0 };
    row.signups += 1;
    if (c.first_call_at !== null) row.called += 1;
    if (c.packs > 0) row.paying += 1;
    bySource.set(c.source, row);
  }
  const sources = [...bySource.values()].sort((a, z) => z.signups - a.signups);

  // ---- cohorts: last 8 full ISO weeks (current week included), all clients
  const currentMonday = mondayOf(new Date(nowMs).toISOString())!;
  const weekStarts: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(`${currentMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekStarts.push(d.toISOString().slice(0, 10));
  }
  const cohortMap = new Map<string, { signups: number; called: number; paid: number }>(
    weekStarts.map((w) => [w, { signups: 0, called: 0, paid: 0 }]),
  );
  for (const c of clients) {
    const monday = mondayOf(c.signup_at);
    const bucket = monday ? cohortMap.get(monday) : undefined;
    if (!bucket) continue;
    bucket.signups += 1;
    if (c.first_call_at !== null) bucket.called += 1;
    if (c.packs > 0) bucket.paid += 1;
  }
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const cohorts: ActivationCohort[] = weekStarts.map((w) => {
    const b = cohortMap.get(w)!;
    return { week_start: w, signups: b.signups, called_pct: pct(b.called, b.signups), paid_pct: pct(b.paid, b.signups) };
  });

  return { clients, funnel, sources, cohorts };
}
