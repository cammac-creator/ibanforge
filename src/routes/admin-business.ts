/**
 * GET /admin/business-summary — the conversion half of the weekly report.
 *
 * Bearer STATS_TOKEN, same gate as /stats and /admin/revenue.
 *
 * The weekly market-watch runs in GitHub Actions and could only ever see
 * request counters, so it proposed more visibility every week while the thing
 * that was actually stuck was conversion. This endpoint gives it the other
 * half, computed here, inside the process that already holds the data.
 *
 * 🚨 Aggregates and masked labels only — key prefix and email domain, never an
 * address. The daily lifecycle radar was moved into this process precisely so
 * the customer ledger would stop transiting an external runner; whatever this
 * returns transits one, so it must stay at the radar's disclosure level. See
 * the header of src/lib/business-summary.ts before widening the payload.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { getStatsDB } from '../lib/db.js';
import { isInternal } from '../lib/lifecycle-radar.js';
import {
  buildBusinessSummary,
  type BusinessKeyRow,
  type ClientCall,
  type PathCount,
  type TrafficTotals,
} from '../lib/business-summary.js';

export const adminBusiness = new Hono();

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;
const SERIES_MONTHS = 6;

function checkAuth(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(authHeader);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

function monthKeys(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
    );
  }
  return out;
}

adminBusiness.get('/admin/business-summary', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json(
      { error: 'unauthorized', message: 'Admin endpoints require Bearer STATS_TOKEN.' },
      403,
    );
  }

  const raw = parseInt(c.req.query('days') ?? '', 10);
  const windowDays =
    Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;

  const db = getStatsDB();
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const months = monthKeys(now, SERIES_MONTHS);

  // Both ledgers, same reason as GET /v1/admin/keys: a credit key never writes
  // api_usage (the middleware decrements credits instead), so reading only the
  // quota table shows a paying customer who has spent thousands of units as one
  // who has never called.
  const rows = db
    .prepare(
      `SELECT k.key_hash, k.key_prefix, k.email, k.monthly_limit,
              k.credits_total, k.credits_remaining,
              COALESCE(u.count, 0) AS used,
              COALESCE(t.total, 0)
                + MAX(COALESCE(k.credits_total, 0) - COALESCE(k.credits_remaining, 0), 0)
                AS used_all_time
         FROM api_keys k
         LEFT JOIN api_usage u ON u.key_hash = k.key_hash AND u.month = ?
         LEFT JOIN (SELECT key_hash, SUM(count) AS total FROM api_usage GROUP BY key_hash) t
                ON t.key_hash = k.key_hash`,
    )
    .all(month) as Array<{
    key_hash: string;
    key_prefix: string;
    email: string;
    monthly_limit: number | null;
    credits_total: number | null;
    credits_remaining: number | null;
    used: number;
    used_all_time: number;
  }>;

  const usage = db
    .prepare('SELECT key_hash, month, count FROM api_usage WHERE month >= ?')
    .all(months[0]) as Array<{ key_hash: string; month: string; count: number }>;
  const byHash = new Map<string, Map<string, number>>();
  for (const u of usage) {
    let m = byHash.get(u.key_hash);
    if (!m) byHash.set(u.key_hash, (m = new Map()));
    m.set(u.month, u.count);
  }

  const callRows = db
    .prepare(
      `SELECT key_prefix, substr(created_at, 1, 7) AS month, COUNT(*) AS calls
         FROM request_log
        WHERE key_prefix IS NOT NULL AND created_at >= ?
        GROUP BY 1, 2`,
    )
    .all(`${months[0]}-01`) as Array<{ key_prefix: string; month: string; calls: number }>;
  const byPrefix = new Map<string, Map<string, number>>();
  for (const r of callRows) {
    let m = byPrefix.get(r.key_prefix);
    if (!m) byPrefix.set(r.key_prefix, (m = new Map()));
    m.set(r.month, r.calls);
  }

  const keys: BusinessKeyRow[] = rows.map((r) => {
    const quota = byHash.get(r.key_hash);
    const calls = byPrefix.get(r.key_prefix);
    const source = !quota && calls ? calls : quota;
    return {
      key_prefix: r.key_prefix,
      email: r.email,
      monthly_limit: r.monthly_limit,
      credits_total: r.credits_total,
      credits_remaining: r.credits_remaining,
      used: r.used,
      used_all_time: r.used_all_time,
      series: months.map((mo) => source?.get(mo) ?? 0),
    };
  });

  const since = `-${windowDays} days`;
  const traffic = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 402 THEN 1 ELSE 0 END) AS s402,
              SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) AS s4xx,
              SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS s5xx
         FROM request_log
        WHERE created_at >= datetime('now', ?)`,
    )
    .get(since) as TrafficTotals;

  const paths = db
    .prepare(
      `SELECT path, COUNT(*) AS count
         FROM request_log
        WHERE created_at >= datetime('now', ?)
        GROUP BY path`,
    )
    .all(since) as PathCount[];

  // Authenticated callers only, and operator keys dropped: a weekly total is
  // meant to answer "how many customers", and our own playground would answer
  // it wrong.
  const internalPrefixes = new Set(
    rows.filter((r) => isInternal(r.email)).map((r) => r.key_prefix),
  );
  const clients = (
    db
      .prepare(
        `SELECT key_prefix, COUNT(*) AS calls, COUNT(DISTINCT date(created_at)) AS active_days
           FROM request_log
          WHERE key_prefix IS NOT NULL AND created_at >= datetime('now', ?)
          GROUP BY key_prefix`,
      )
      .all(since) as ClientCall[]
  ).filter((r) => !internalPrefixes.has(r.key_prefix));

  return c.json({
    ...buildBusinessSummary({
      keys,
      traffic: {
        total: traffic.total ?? 0,
        s402: traffic.s402 ?? 0,
        s4xx: traffic.s4xx ?? 0,
        s5xx: traffic.s5xx ?? 0,
      },
      paths,
      clients,
      windowDays,
    }),
    docs:
      'Pass Bearer STATS_TOKEN. Aggregated conversion figures for the weekly report: ' +
      'credit packs sold vs consumed, free-tier wall, steady unpaid users, client ' +
      'concentration, and traffic split (402 and catalog reads separated out). ' +
      'Accounts are identified by key prefix and email domain only — never an address. ' +
      'Window via ?days=N (1-90, default 7).',
  });
});
