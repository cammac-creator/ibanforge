import type Database from 'better-sqlite3';
import { getStatsDB } from './db.js';
import type { OperationType, StatsOverview, HourlyStatsResponse, ErrorStatsResponse, PatternStatsResponse } from '../types.js';

// ---------------------------------------------------------------------------
// Cached prepared statements
// ---------------------------------------------------------------------------

let _insertOp: Database.Statement | null = null;
let _upsertDaily: Database.Statement | null = null;
let _upsertHourly: Database.Statement | null = null;
let _insertRequest: Database.Statement | null = null;

function insertOp() {
  if (!_insertOp) {
    _insertOp = getStatsDB().prepare(
      'INSERT INTO operations (operation_type, country_code, success, hour, day_of_week, error_detail) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }
  return _insertOp;
}

function upsertDaily() {
  if (!_upsertDaily) {
    _upsertDaily = getStatsDB().prepare(`
      INSERT INTO daily_stats (date, operation_type, total, success_count, revenue_usdc)
      VALUES (date('now'), ?, ?, ?, ?)
      ON CONFLICT(date, operation_type) DO UPDATE SET
        total = total + excluded.total,
        success_count = success_count + excluded.success_count,
        revenue_usdc = revenue_usdc + excluded.revenue_usdc
    `);
  }
  return _upsertDaily;
}

function upsertHourly() {
  if (!_upsertHourly) {
    _upsertHourly = getStatsDB().prepare(`
      INSERT INTO hourly_stats (date, hour, day_of_week, operation_type, total, success_count)
      VALUES (date('now'), ?, ?, ?, ?, ?)
      ON CONFLICT(date, hour, operation_type) DO UPDATE SET
        total = total + excluded.total,
        success_count = success_count + excluded.success_count
    `);
  }
  return _upsertHourly;
}

function insertRequest() {
  if (!_insertRequest) {
    _insertRequest = getStatsDB().prepare(
      'INSERT INTO request_log (method, path, status, response_ms, hour, day_of_week) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }
  return _insertRequest;
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

/**
 * Record any HTTP request (all traffic, not just business operations)
 */
export function recordRequest(method: string, path: string, status: number, responseMs: number) {
  try {
    const now = new Date();
    const hour = now.getUTCHours();
    const dow = (now.getUTCDay() + 6) % 7;
    // Normalize paths: /v1/bic/DEUTDEFF → /v1/bic/:code
    const normalizedPath = path.replace(/\/v1\/bic\/[A-Za-z0-9]+/, '/v1/bic/:code');
    insertRequest().run(method, normalizedPath, status, Math.round(responseMs), hour, dow);
  } catch {
    // Non-critical
  }
}

/**
 * Record a single operation (IBAN validation, BIC lookup, etc.).
 *
 * `revenueUsdc` is the amount actually collected (NOT the posted price).
 * Pass 0 when the request was served for free (API-key auth, x402 disabled,
 * or dev-skip) so the dashboard reflects real revenue instead of phantom
 * earnings.
 */
export function recordOperation(
  type: OperationType,
  countryCode: string | null,
  success: boolean,
  revenueUsdc: number,
  errorDetail?: string,
) {
  try {
    const hour = new Date().getUTCHours();
    const dow = (new Date().getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
    const truncatedError = errorDetail ? errorDetail.slice(0, 12) : null;
    insertOp().run(type, countryCode, success ? 1 : 0, hour, dow, truncatedError);
    upsertDaily().run(type, 1, success ? 1 : 0, revenueUsdc);
    upsertHourly().run(hour, dow, type, 1, success ? 1 : 0);
  } catch {
    // Stats are non-critical — never crash the API
  }
}

/**
 * Record a batch of IBAN validations in one call
 */
export function recordBatch(count: number, validCount: number, revenueUsdc: number) {
  try {
    const hour = new Date().getUTCHours();
    const dow = (new Date().getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
    const db = getStatsDB();
    const tx = db.transaction(() => {
      const stmt = insertOp();
      for (let i = 0; i < validCount; i++) stmt.run('iban_batch', null, 1, hour, dow, null);
      for (let i = 0; i < count - validCount; i++) stmt.run('iban_batch', null, 0, hour, dow, null);
      upsertDaily().run('iban_batch', count, validCount, revenueUsdc);
      upsertHourly().run(hour, dow, 'iban_batch', count, validCount);
    });
    tx();
  } catch {
    // Non-critical
  }
}

/**
 * Reset cached statements (called when DB is closed)
 */
export function resetStatsStatements() {
  _insertOp = null;
  _upsertDaily = null;
  _upsertHourly = null;
  _insertRequest = null;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function typeStats(type: OperationType): { total: number; success_count: number } {
  const row = getStatsDB().prepare(
    'SELECT COUNT(*) as total, COALESCE(SUM(success), 0) as success_count FROM operations WHERE operation_type = ?'
  ).get(type) as { total: number; success_count: number };
  return row;
}

function rate(total: number, success: number): number {
  return total > 0 ? Math.round((success / total) * 10000) / 100 : 0;
}

/**
 * Full stats overview across all operation types
 */
export function getStats(): StatsOverview {
  const db = getStatsDB();

  const ibanVal = typeStats('iban_validate');
  const ibanBatch = typeStats('iban_batch');
  const bicLookup = typeStats('bic_lookup');

  const totalOps = ibanVal.total + ibanBatch.total + bicLookup.total;

  const revenue = db.prepare(
    'SELECT COALESCE(SUM(revenue_usdc), 0) as total FROM daily_stats'
  ).get() as { total: number };

  const topCountries = db.prepare(
    'SELECT country_code as country, COUNT(*) as count FROM operations WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count DESC LIMIT 10'
  ).all() as Array<{ country: string; count: number }>;

  const last7 = db.prepare(
    "SELECT date, SUM(total) as total, SUM(revenue_usdc) as revenue FROM daily_stats WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date DESC"
  ).all() as Array<{ date: string; total: number; revenue: number }>;

  // Total HTTP requests (all traffic)
  const totalRequests = db.prepare(
    'SELECT COUNT(*) as total FROM request_log'
  ).get() as { total: number };

  const requestsByPath = db.prepare(
    'SELECT path, COUNT(*) as count, ROUND(AVG(response_ms), 0) as avg_ms FROM request_log GROUP BY path ORDER BY count DESC LIMIT 15'
  ).all() as Array<{ path: string; count: number; avg_ms: number }>;

  const requestsByStatus = db.prepare(
    "SELECT CASE WHEN status >= 200 AND status < 300 THEN '2xx' WHEN status >= 300 AND status < 400 THEN '3xx' WHEN status >= 400 AND status < 500 THEN '4xx' ELSE '5xx' END as status_group, COUNT(*) as count FROM request_log GROUP BY status_group ORDER BY status_group"
  ).all() as Array<{ status_group: string; count: number }>;

  const requestsToday = db.prepare(
    "SELECT COUNT(*) as total FROM request_log WHERE created_at >= datetime('now', 'start of day')"
  ).get() as { total: number };

  return {
    total_requests: totalRequests.total,
    requests_today: requestsToday.total,
    requests_by_path: requestsByPath,
    requests_by_status: requestsByStatus,
    total_operations: totalOps,
    by_type: {
      iban_validate: {
        total: ibanVal.total,
        valid_count: ibanVal.success_count,
        success_rate: rate(ibanVal.total, ibanVal.success_count),
      },
      iban_batch: {
        total: ibanBatch.total,
        valid_count: ibanBatch.success_count,
        success_rate: rate(ibanBatch.total, ibanBatch.success_count),
      },
      bic_lookup: {
        total: bicLookup.total,
        found_count: bicLookup.success_count,
        hit_rate: rate(bicLookup.total, bicLookup.success_count),
      },
    },
    total_revenue_usdc: Math.round(revenue.total * 1000000) / 1000000,
    top_countries: topCountries,
    last_7_days: last7,
  };
}

/**
 * Historical daily stats for dashboard charts
 */
export function getStatsHistory(days: number = 7): Array<{
  date: string;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
  total_requests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
}> {
  const db = getStatsDB();
  // Business operations from daily_stats
  const opsRows = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN operation_type = 'iban_validate' THEN total ELSE 0 END) as iban_validate,
      SUM(CASE WHEN operation_type = 'iban_batch' THEN total ELSE 0 END) as iban_batch,
      SUM(CASE WHEN operation_type = 'bic_lookup' THEN total ELSE 0 END) as bic_lookup,
      SUM(revenue_usdc) as revenue_usdc
    FROM daily_stats
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date
    ORDER BY date ASC
  `).all(days) as Array<{
    date: string;
    iban_validate: number;
    iban_batch: number;
    bic_lookup: number;
    revenue_usdc: number;
  }>;

  // Total HTTP requests from request_log, broken down by status group
  const reqRows = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as total_requests,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as s2xx,
      SUM(CASE WHEN status >= 300 AND status < 400 THEN 1 ELSE 0 END) as s3xx,
      SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) as s4xx,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as s5xx
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(created_at)
  `).all(days) as Array<{ date: string; total_requests: number; s2xx: number; s3xx: number; s4xx: number; s5xx: number }>;

  const reqMap = new Map(reqRows.map(r => [r.date, r]));

  // Merge: use all dates from both sources
  const allDates = new Set([...opsRows.map(r => r.date), ...reqRows.map(r => r.date)]);
  const opsMap = new Map(opsRows.map(r => [r.date, r]));

  return Array.from(allDates).sort().map(date => {
    const req = reqMap.get(date);
    return {
      date,
      iban_validate: opsMap.get(date)?.iban_validate ?? 0,
      iban_batch: opsMap.get(date)?.iban_batch ?? 0,
      bic_lookup: opsMap.get(date)?.bic_lookup ?? 0,
      revenue_usdc: opsMap.get(date)?.revenue_usdc ?? 0,
      total_requests: req?.total_requests ?? 0,
      s2xx: req?.s2xx ?? 0,
      s3xx: req?.s3xx ?? 0,
      s4xx: req?.s4xx ?? 0,
      s5xx: req?.s5xx ?? 0,
    };
  });
}

/**
 * Quick counts for health endpoint
 */
export function getQuickStats(): { total_operations: number; iban_validations: number; bic_lookups: number; success_rate: number } {
  const db = getStatsDB();
  const row = db.prepare(
    'SELECT COUNT(*) as total, COALESCE(SUM(success), 0) as success_count FROM operations'
  ).get() as { total: number; success_count: number };

  const ibanCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM operations WHERE operation_type IN ('iban_validate', 'iban_batch')"
  ).get() as { cnt: number };

  const bicCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM operations WHERE operation_type = 'bic_lookup'"
  ).get() as { cnt: number };

  return {
    total_operations: row.total,
    iban_validations: ibanCount.cnt,
    bic_lookups: bicCount.cnt,
    success_rate: rate(row.total, row.success_count),
  };
}

/**
 * Hourly heatmap stats aggregated over the last N days
 */
export function getHourlyStats(days: number = 7): HourlyStatsResponse {
  const db = getStatsDB();

  // Aggregate by day_of_week + hour across the requested period
  const heatmapRows = db.prepare(`
    SELECT day_of_week as day, hour, SUM(total) as total
    FROM hourly_stats
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour
  `).all(days) as Array<{ day: number; hour: number; total: number }>;

  // Find peak 6-hour window by summing across all days
  const hourTotals: number[] = Array(24).fill(0);
  for (const row of heatmapRows) {
    hourTotals[row.hour] = (hourTotals[row.hour] ?? 0) + row.total;
  }

  let bestWindow = { start: 0, sum: 0 };
  for (let h = 0; h < 24; h++) {
    let windowSum = 0;
    for (let i = 0; i < 6; i++) {
      windowSum += hourTotals[(h + i) % 24] ?? 0;
    }
    if (windowSum > bestWindow.sum) {
      bestWindow = { start: h, sum: windowSum };
    }
  }
  const peakStart = bestWindow.start;
  const peakEnd = (peakStart + 6) % 24;

  // Determine peak days (above average total)
  const dayTotals: number[] = Array(7).fill(0);
  for (const row of heatmapRows) {
    dayTotals[row.day] = (dayTotals[row.day] ?? 0) + row.total;
  }
  const avgDayTotal = dayTotals.reduce((a, b) => a + b, 0) / 7;
  const peakDays = dayTotals.map((t, i) => ({ i, t })).filter(({ t }) => t > avgDayTotal).map(({ i }) => i);

  // Weekend drop %: compare Sat(5)+Sun(6) vs Mon(0)+Tue(1)+Wed(2)+Thu(3)+Fri(4)
  const weekdayTotal = [0, 1, 2, 3, 4].reduce((sum, d) => sum + (dayTotals[d] ?? 0), 0) / 5;
  const weekendTotal = [5, 6].reduce((sum, d) => sum + (dayTotals[d] ?? 0), 0) / 2;
  const weekendDropPct = weekdayTotal > 0 ? Math.round(((weekdayTotal - weekendTotal) / weekdayTotal) * 10000) / 100 : 0;

  return {
    heatmap: heatmapRows,
    peak_hours: { start: peakStart, end: peakEnd, days: peakDays },
    weekend_drop_pct: weekendDropPct,
  };
}

/**
 * Error rate stats for the last N days
 */
export function getErrorStats(days: number = 30): ErrorStatsResponse {
  const db = getStatsDB();

  // Overall error rates
  function typeErrorRate(opType: string): { rate: number; trend: number[] } {
    const overall = db.prepare(`
      SELECT COUNT(*) as total, COALESCE(SUM(success), 0) as success_count
      FROM operations
      WHERE operation_type = ? AND created_at >= datetime('now', '-' || ? || ' days')
    `).get(opType, days) as { total: number; success_count: number };
    const errorRate = overall.total > 0 ? Math.round(((overall.total - overall.success_count) / overall.total) * 10000) / 100 : 0;

    // Daily error rate trend for last 7 days
    const dailyRows = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as total, COALESCE(SUM(success), 0) as success_count
      FROM operations
      WHERE operation_type = ? AND created_at >= datetime('now', '-7 days')
      GROUP BY day
      ORDER BY day ASC
    `).all(opType) as Array<{ day: string; total: number; success_count: number }>;

    const trend = dailyRows.map(r =>
      r.total > 0 ? Math.round(((r.total - r.success_count) / r.total) * 10000) / 100 : 0
    );

    return { rate: errorRate, trend };
  }

  // Top 10 invalid IBAN prefixes from error_detail
  const topInvalidIbans = db.prepare(`
    SELECT
      error_detail as prefix,
      COALESCE(country_code, 'XX') as country,
      COUNT(*) as count
    FROM operations
    WHERE operation_type = 'iban_validate'
      AND success = 0
      AND error_detail IS NOT NULL
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY error_detail, country_code
    ORDER BY count DESC
    LIMIT 10
  `).all(days) as Array<{ prefix: string; country: string; count: number }>;

  // Top 10 missing BICs from error_detail
  const topMissingBics = db.prepare(`
    SELECT
      error_detail as bic,
      COALESCE(country_code, 'XX') as country,
      COUNT(*) as count
    FROM operations
    WHERE operation_type = 'bic_lookup'
      AND success = 0
      AND error_detail IS NOT NULL
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY error_detail, country_code
    ORDER BY count DESC
    LIMIT 10
  `).all(days) as Array<{ bic: string; country: string; count: number }>;

  // Errors by country
  const errorsByCountry = db.prepare(`
    SELECT COALESCE(country_code, 'XX') as country, COUNT(*) as count
    FROM operations
    WHERE success = 0
      AND country_code IS NOT NULL
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY country_code
    ORDER BY count DESC
    LIMIT 20
  `).all(days) as Array<{ country: string; count: number }>;

  return {
    error_rate: {
      iban_validate: typeErrorRate('iban_validate'),
      bic_lookup: typeErrorRate('bic_lookup'),
    },
    top_invalid_ibans: topInvalidIbans.map(r => ({ ...r, error_type: 'invalid' })),
    top_missing_bics: topMissingBics,
    errors_by_country: errorsByCountry,
  };
}

/**
 * Usage pattern stats: endpoint share trend + geo trend
 */
export function getPatternStats(days: number = 30): PatternStatsResponse {
  const db = getStatsDB();

  // Endpoint share trend (daily breakdown by type)
  const endpointTrend = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN operation_type = 'iban_validate' THEN total ELSE 0 END) as iban_validate,
      SUM(CASE WHEN operation_type = 'iban_batch' THEN total ELSE 0 END) as iban_batch,
      SUM(CASE WHEN operation_type = 'bic_lookup' THEN total ELSE 0 END) as bic_lookup
    FROM daily_stats
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date
    ORDER BY date ASC
  `).all(days) as Array<{ date: string; iban_validate: number; iban_batch: number; bic_lookup: number }>;

  // Top 5 countries by volume
  const topCountriesRows = db.prepare(`
    SELECT country_code as country, COUNT(*) as count
    FROM operations
    WHERE country_code IS NOT NULL
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY country_code
    ORDER BY count DESC
    LIMIT 5
  `).all(days) as Array<{ country: string; count: number }>;

  const topCountriesList = topCountriesRows.map(r => r.country);

  // Geo trend: daily counts for top 5 countries pivoted
  const geoRows = db.prepare(`
    SELECT date(created_at) as date, country_code as country, COUNT(*) as count
    FROM operations
    WHERE country_code IN (${topCountriesList.map(() => '?').join(', ')})
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(created_at), country_code
    ORDER BY date ASC
  `).all(...topCountriesList, days) as Array<{ date: string; country: string; count: number }>;

  // Pivot geo rows: { date, CH: 34, DE: 28, ... }
  const geoByDate: Map<string, Record<string, number | string>> = new Map();
  for (const row of geoRows) {
    if (!geoByDate.has(row.date)) {
      geoByDate.set(row.date, { date: row.date });
    }
    const entry = geoByDate.get(row.date)!;
    entry[row.country] = row.count;
  }
  const geoTrend = Array.from(geoByDate.values());

  return {
    endpoint_share_trend: endpointTrend,
    geo_trend: geoTrend,
    top_countries_list: topCountriesList,
  };
}
