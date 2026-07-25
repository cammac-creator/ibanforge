import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';
import type { RejectReason } from './input-normalize.js';
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
      'INSERT INTO request_log (method, path, status, response_ms, hour, day_of_week, client_kind, ip_hash, user_agent, key_prefix) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
  }
  return _insertRequest;
}

const IP_HASH_SECRET = process.env.IP_HASH_SECRET ?? process.env.SESSION_SECRET ?? 'ibanforge-default-salt-change-me';

/**
 * Truncated salted SHA-256 of a client IP, used to cluster requests from the
 * same source without retaining the original address. The 16-hex-char prefix
 * gives 2^64 buckets — collision-resistant in practice and not reversible
 * without the server-side secret.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip === 'unknown') return null;
  return createHash('sha256').update(`${IP_HASH_SECRET}:${ip}`).digest('hex').slice(0, 16);
}

/**
 * Extract the client IP from a Hono request behind a trusted reverse proxy
 * (Railway).
 *
 * Security: a client can send any `X-Forwarded-For` it wants, so the FIRST
 * segment is attacker-controlled and must NOT be trusted — keying rate-limits or
 * IP hashes off it lets an attacker rotate the key per request (bypass) or
 * poison another IP's bucket. The trusted proxy appends the real peer address as
 * the LAST segment, so we read that. `x-real-ip` (set by the proxy itself) is
 * preferred when present.
 */
export function extractClientIp(headers: { 'x-forwarded-for'?: string | null; 'x-real-ip'?: string | null }): string | null {
  const realIp = headers['x-real-ip']?.trim();
  if (realIp) return realIp;
  const xff = headers['x-forwarded-for'];
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return null;
}

/**
 * Provenance bucket for an incoming request, used to attribute traffic to the
 * MCP / REST / discovery / browser channels in the dashboard.
 *
 * - `mcp_http`  : hit on /mcp* (Smithery, remote Claude clients, agent gateways)
 * - `mcp_stdio` : npm package ibanforge-mcp run locally — User-Agent: ibanforge-mcp/*
 * - `bot`       : known crawlers/probes (Decixa, x402scan, Glama, GoogleBot, etc.)
 * - `web`       : interactive browser session (UA contains Mozilla + WebKit/Gecko)
 * - `api`       : everything else (REST direct, programmatic, server-to-server)
 */
export type ClientKind = 'mcp_http' | 'mcp_stdio' | 'bot' | 'web' | 'api';

// Indexers / catalogs / search engine crawlers — non-paying, non-monetizable
// but useful to track for distribution attribution.
const BOT_PATTERNS = [
  'decixa',
  'x402scan',
  'glama',
  'smithery',
  'mcp.so',
  'pulsemcp',
  'agentic.market',
  'bazaar',
  'cdp-bot',
  'googlebot',
  'bingbot',
  'duckduckbot',
  'yandex',
  'baiduspider',
  'crawl',
  'spider',
  'wget',
];

// Known AI agent / LLM clients — these are MCP and REST consumers we do
// monetize (or want to monetize). Detected separately from generic bots so
// the dashboard can distinguish "agent traffic" from "indexer traffic".
//
// Sources:
//   - openai.com/gptbot / OpenAI's "ChatGPT-User" UA for inline tool use
//   - Anthropic publishes "Claude-User" / "ClaudeBot" UAs for fetches inside
//     conversation context, plus claude.ai/code "Claude Code" agent
//   - Cursor / Cline / Continue / Windsurf / Aider / Cody (Sourcegraph)
//   - Perplexity ("PerplexityBot"), You.com ("YouBot")
const AGENT_PATTERNS = [
  'chatgpt-user',
  'gptbot',
  'oai-searchbot',
  'claudebot',
  'claude-user',
  'claude-web',
  'anthropic',
  'cursor',
  'cline',
  'continue',
  'windsurf',
  'aider',
  'cody',
  'perplexitybot',
  'perplexity',
  'youbot',
];

/**
 * Classify the origin of an HTTP request into one of 5 buckets so the
 * dashboard can attribute traffic and revenue per channel.
 *
 * Order matters: we check `/mcp` path first (highest signal), then known
 * client UAs (most specific), then bots (catch-all crawlers), then the
 * loose "browser" heuristic, then fallback to `api`.
 */
export function classifyClient(path: string, userAgent: string | undefined): ClientKind {
  if (path.startsWith('/mcp')) return 'mcp_http';
  if (!userAgent) return 'api';
  const ua = userAgent.toLowerCase();
  if (ua.startsWith('ibanforge-mcp/') || ua.includes('mcp-proxy') || ua.includes('mcp-stdio')) {
    return 'mcp_stdio';
  }
  // Known AI clients — bucket as `mcp_stdio` (semantically: an LLM-driven
  // client calling our REST surface, even when not via MCP transport).
  // This makes the "agent traffic" total in the dashboard reflect ALL
  // agent-originated calls, not just those via npm i ibanforge-mcp.
  if (AGENT_PATTERNS.some((p) => ua.includes(p))) return 'mcp_stdio';
  if (BOT_PATTERNS.some((p) => ua.includes(p))) return 'bot';
  if (ua.includes('mozilla') && (ua.includes('webkit') || ua.includes('gecko') || ua.includes('chrome') || ua.includes('safari') || ua.includes('firefox') || ua.includes('edge'))) {
    return 'web';
  }
  return 'api';
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

/**
 * Record any HTTP request (all traffic, not just business operations).
 *
 * `ipHash` and `userAgent` are optional and feed the /admin/scanners endpoint;
 * legacy callers that omit them still work (columns are nullable).
 */
export function recordRequest(
  method: string,
  path: string,
  status: number,
  responseMs: number,
  clientKind: ClientKind = 'api',
  ipHash: string | null = null,
  userAgent: string | null = null,
  keyPrefix: string | null = null,
) {
  try {
    const now = new Date();
    const hour = now.getUTCHours();
    const dow = (now.getUTCDay() + 6) % 7;
    // Normalize paths: /v1/bic/DEUTDEFF → /v1/bic/:code
    const normalizedPath = path
      .replace(/\/v1\/bic\/[A-Za-z0-9]+/, '/v1/bic/:code')
      .replace(/\/v1\/ch\/clearing\/\d+/, '/v1/ch/clearing/:iid');
    const truncatedUa = userAgent ? userAgent.slice(0, 256) : null;
    insertRequest().run(method, normalizedPath, status, Math.round(responseMs), hour, dow, clientKind, ipHash, truncatedUa, keyPrefix);
  } catch (err) {
    // Request tracking is non-critical and must never break the API, but a
    // silent swallow would hide a broken stats DB. Log without rethrowing.
    console.error('[stats] recordRequest failed:', err);
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
  } catch (err) {
    // Stats are non-critical — never crash the API, but log so a broken stats
    // DB is visible instead of silently dropping every operation.
    console.error('[stats] recordOperation failed:', err);
  }
}

/**
 * Un rejet de format n'atteint jamais recordOperation : les routes renvoient
 * 400 avant. Sans cette fonction, un rejet n'existe que comme un statut 400
 * anonyme dans request_log, et on ne peut pas dire ce qu'il faudrait tolérer.
 * On stocke la CATÉGORIE, jamais la valeur soumise (DPA).
 */
export function recordRejection(type: OperationType, reason: RejectReason): void {
  try {
    const db = getStatsDB();
    const now = new Date();
    db.prepare(
      'INSERT INTO operations (operation_type, country_code, success, hour, day_of_week, reject_reason) VALUES (?, NULL, 0, ?, ?, ?)',
    ).run(type, now.getUTCHours(), (now.getUTCDay() + 6) % 7, reason);
  } catch (err) {
    console.error('[stats] recordRejection failed:', err);
  }
}

export interface RejectionRow {
  operation_type: string;
  reject_reason: string;
  count: number;
}

export function getRejectionStats(days = 30): RejectionRow[] {
  const db = getStatsDB();
  return db
    .prepare(
      `SELECT operation_type, reject_reason, COUNT(*) AS count
       FROM operations
       WHERE reject_reason IS NOT NULL
         AND created_at >= datetime('now', ?)
       GROUP BY operation_type, reject_reason
       ORDER BY count DESC`,
    )
    .all(`-${days} days`) as RejectionRow[];
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
  } catch (err) {
    // Non-critical — log instead of swallowing so a broken stats DB is visible.
    console.error('[stats] recordBatch failed:', err);
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
// Provenance / channel attribution
// ---------------------------------------------------------------------------

export interface SourceStatsRow {
  client_kind: ClientKind;
  total: number;
  paid_calls: number;        // status 200 on paid /v1/* endpoints
  paywall_hits: number;      // status 402 (discovery probes + unauth attempts)
  errors: number;            // status >= 400, excluding 402
  avg_response_ms: number;
}

export interface SourceStatsResponse {
  period_days: number;
  total_requests: number;
  by_client_kind: SourceStatsRow[];
  paid_endpoints_breakdown: Array<{
    path: string;
    client_kind: ClientKind;
    total: number;
    success: number;
  }>;
}

/**
 * Aggregate request_log by client_kind over the last N days.
 * Powers the "MCP vs REST" attribution view: shows which channels actually
 * convert (200 on paid endpoints) vs which only ever hit the paywall (402).
 */
export function getSourceStats(days: number): SourceStatsResponse {
  const db = getStatsDB();

  const byKind = db.prepare(`
    SELECT
      COALESCE(client_kind, 'api') AS client_kind,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 200 AND path LIKE '/v1/%' AND path != '/v1/iban/format' THEN 1 ELSE 0 END) AS paid_calls,
      SUM(CASE WHEN status = 402 THEN 1 ELSE 0 END) AS paywall_hits,
      SUM(CASE WHEN status >= 400 AND status != 402 THEN 1 ELSE 0 END) AS errors,
      ROUND(AVG(response_ms), 1) AS avg_response_ms
    FROM request_log
    WHERE created_at >= datetime('now', ?)
    GROUP BY COALESCE(client_kind, 'api')
    ORDER BY total DESC
  `).all(`-${days} days`) as SourceStatsRow[];

  const breakdown = db.prepare(`
    SELECT
      path,
      COALESCE(client_kind, 'api') AS client_kind,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 200 THEN 1 ELSE 0 END) AS success
    FROM request_log
    WHERE created_at >= datetime('now', ?)
      AND path LIKE '/v1/%' AND path != '/v1/iban/format'
    GROUP BY path, COALESCE(client_kind, 'api')
    ORDER BY total DESC
    LIMIT 50
  `).all(`-${days} days`) as Array<{ path: string; client_kind: ClientKind; total: number; success: number }>;

  const total = byKind.reduce((acc, r) => acc + r.total, 0);

  return {
    period_days: days,
    total_requests: total,
    by_client_kind: byKind,
    paid_endpoints_breakdown: breakdown,
  };
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
    total_revenue_attempted_usdc: Math.round(revenue.total * 1000000) / 1000000,
    revenue_note:
      'total_revenue_usdc and total_revenue_attempted_usdc both reflect the SUM of revenue_usdc in daily_stats — these are x402 calls that PASSED the payment middleware verify step, NOT a confirmation of on-chain settlement. Authoritative settled USDC is /admin/revenue (Bearer STATS_TOKEN). Historical drift observed: ~0.226 USDC counted as attempted between 2026-04-08 and 2026-04-17 with no matching Base mainnet Transfer events to the seller wallet — likely facilitator settlement failures during the early x402 rollout.',
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
  /** @deprecated use revenue_attempted_usdc + /admin/revenue (on-chain source of truth) */
  revenue_usdc: number;
  revenue_attempted_usdc: number;
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
    const rev = opsMap.get(date)?.revenue_usdc ?? 0;
    return {
      date,
      iban_validate: opsMap.get(date)?.iban_validate ?? 0,
      iban_batch: opsMap.get(date)?.iban_batch ?? 0,
      bic_lookup: opsMap.get(date)?.bic_lookup ?? 0,
      revenue_usdc: rev,
      revenue_attempted_usdc: rev,
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
 * Daily business funnel: only counts requests that actually target a
 * billable endpoint with the RIGHT HTTP verb (anything else is scanner
 * noise or wrong-method and gets excluded). Categorises into signals
 * that matter for conversion: paid success, paywall hit (= money left
 * on the table), authenticated user hitting a hard error (quota / bad
 * input), and real server failures.
 */
export interface BusinessFunnelDay {
  date: string;
  /** 2xx on a billable endpoint with the expected method. */
  success: number;
  /** 402 Payment Required — agent wanted it but didn't pay / no key. */
  paywall: number;
  /** 401 Unauthorized or 429 Too Many Requests — convert opportunity. */
  auth_or_quota: number;
  /** 400 Bad Request on a billable endpoint. */
  bad_input: number;
  /** 5xx — real problems, must stay at 0. */
  server_error: number;
}

// (method, path-prefix) pairs that count as billable business traffic.
// Intentionally conservative: any path normalised to a billable family with
// the expected verb is in; everything else (scanner hitting POST on a GET
// route, or /robots.txt, /favicon.ico, /) is excluded.
const BILLABLE_RULES: Array<{ method: string; pathStartsWith: string }> = [
  { method: 'POST', pathStartsWith: '/v1/iban/validate' },
  { method: 'POST', pathStartsWith: '/v1/iban/batch' },
  { method: 'POST', pathStartsWith: '/v1/iban/compliance' },
  { method: 'GET', pathStartsWith: '/v1/bic/' },
  { method: 'GET', pathStartsWith: '/v1/ch/clearing/' },
];

function buildBillableFilter(): { sql: string; params: string[] } {
  // (method = ? AND path LIKE ?) OR (method = ? AND path LIKE ?) ...
  const clauses = BILLABLE_RULES.map(() => '(method = ? AND path LIKE ?)').join(' OR ');
  const params: string[] = [];
  for (const r of BILLABLE_RULES) {
    params.push(r.method);
    params.push(r.pathStartsWith + '%');
  }
  return { sql: clauses, params };
}

export function getBusinessFunnel(days: number = 30): BusinessFunnelDay[] {
  const db = getStatsDB();
  const filter = buildBillableFilter();
  // Keys owned by internal accounts (founder tests, Claude audits, playground)
  // produce real 2xx traffic that is NOT market signal — a perf audit once
  // showed up as "126 Paid success" on a day with zero real client calls.
  // Anonymous traffic (key_prefix NULL) stays counted: it can't be attributed,
  // and x402 demand is precisely what the funnel exists to measure.
  const internalPrefixes = (
    db.prepare('SELECT key_prefix, email FROM api_keys').all() as Array<{ key_prefix: string; email: string }>
  )
    .filter((k) => isInternalEmail(k.email))
    .map((k) => k.key_prefix);
  const internalFilter = internalPrefixes.length
    ? `AND (key_prefix IS NULL OR key_prefix NOT IN (${internalPrefixes.map(() => '?').join(',')}))`
    : '';
  // Exclude OpenAPI placeholder paths (%7B...%7D or literal {...}) — they match
  // the billable path-prefix but are never real business traffic, just scanners
  // or agents mis-substituting the OpenAPI spec template variables. Counting
  // them as "bad_input" made the funnel look 100% broken.
  const rows = db.prepare(`
    SELECT
      date(created_at) as date,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 402 THEN 1 ELSE 0 END) as paywall,
      SUM(CASE WHEN status = 401 OR status = 429 THEN 1 ELSE 0 END) as auth_or_quota,
      SUM(CASE WHEN status = 400 THEN 1 ELSE 0 END) as bad_input,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as server_error
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
      AND (${filter.sql})
      AND path NOT LIKE '%\\%7B%' ESCAPE '\\'
      AND path NOT LIKE '%{%'
      ${internalFilter}
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all(days, ...filter.params, ...internalPrefixes) as BusinessFunnelDay[];
  return rows;
}

/**
 * HTTP status-code breakdown per endpoint path over the last N days.
 *
 * Answers "where are the 4xx actually coming from?" — critical for
 * telling real-funnel signal (402 on /v1/* = agent hit the paywall)
 * from noise (404 on /wp-admin = scanner).
 */
export interface StatusByPathRow {
  path: string;
  total: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  avg_ms: number;
  /** Exact HTTP status code → count. Keys are stringified ints ("400", "402", "404"...). */
  by_status: Record<string, number>;
  /** HTTP method → count. Reveals e.g. "agent sent GET on a POST-only route". */
  by_method: Record<string, number>;
}

export function getStatusByPath(days: number = 30): StatusByPathRow[] {
  const db = getStatsDB();
  const aggregates = db.prepare(`
    SELECT
      path,
      COUNT(*) as total,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as s2xx,
      SUM(CASE WHEN status >= 300 AND status < 400 THEN 1 ELSE 0 END) as s3xx,
      SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) as s4xx,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as s5xx,
      ROUND(AVG(response_ms), 0) as avg_ms
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY path
    ORDER BY total DESC
    LIMIT 30
  `).all(days) as Array<Omit<StatusByPathRow, 'by_status'>>;

  if (aggregates.length === 0) return [];

  // Second pass: exact status × path for the paths we kept. One row per (path,
  // status) — cheaper than a GROUP_CONCAT and keeps the SQL portable.
  const pathPlaceholders = aggregates.map(() => '?').join(',');
  const detailRows = db.prepare(`
    SELECT path, status, COUNT(*) as n
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
      AND path IN (${pathPlaceholders})
    GROUP BY path, status
  `).all(days, ...aggregates.map(r => r.path)) as Array<{ path: string; status: number; n: number }>;

  const detailMap = new Map<string, Record<string, number>>();
  for (const r of detailRows) {
    const existing = detailMap.get(r.path) ?? {};
    existing[String(r.status)] = r.n;
    detailMap.set(r.path, existing);
  }

  const methodRows = db.prepare(`
    SELECT path, method, COUNT(*) as n
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
      AND path IN (${pathPlaceholders})
    GROUP BY path, method
  `).all(days, ...aggregates.map(r => r.path)) as Array<{ path: string; method: string; n: number }>;

  const methodMap = new Map<string, Record<string, number>>();
  for (const r of methodRows) {
    const existing = methodMap.get(r.path) ?? {};
    existing[r.method] = r.n;
    methodMap.set(r.path, existing);
  }

  return aggregates.map(r => ({
    ...r,
    by_status: detailMap.get(r.path) ?? {},
    by_method: methodMap.get(r.path) ?? {},
  }));
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

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Purge per-request metadata older than the retention window (12 months).
 * Aggregated tables (daily_stats, hourly_stats) hold no personal data and are
 * kept indefinitely. This backs the public privacy policy — keep both in sync.
 */
export function purgeOldRequestLog(months: number = 12): number {
  const db = getStatsDB();
  const result = db
    .prepare(`DELETE FROM request_log WHERE created_at < datetime('now', '-' || ? || ' months')`)
    .run(months);
  return result.changes;
}

// Placeholder emails used when a buyer had no address (x402/Stripe flows).
// Several unrelated customers share them, so "does this email still have an
// active key" is meaningless for these — their telemetry is purged per key.
const PLACEHOLDER_EMAILS = ['credits-buyer', 'stripe-buyer', 'oem-subscriber'];

/**
 * DPA clause 4.7 — telemetry deletion after termination, BY DEFAULT.
 * Deletes request_log rows attributable to API keys that were deactivated
 * more than `days` (default 30) ago AND whose customer has no active key
 * left. The "no active key left" guard keeps a security rotation (old key
 * deactivated, same email continues on a fresh key) from wiping the history
 * of a customer who never terminated. Placeholder emails skip that guard —
 * each of their keys is its own anonymous customer.
 */
export function purgeTerminatedKeyTelemetry(days: number = 30): number {
  const db = getStatsDB();
  const placeholders = PLACEHOLDER_EMAILS.map(() => '?').join(',');
  const result = db
    .prepare(
      `DELETE FROM request_log WHERE key_prefix IN (
         SELECT k.key_prefix FROM api_keys k
         WHERE k.active = 0
           AND k.deactivated_at IS NOT NULL
           AND k.deactivated_at < datetime('now', '-' || ? || ' days')
           AND (
             k.email IN (${placeholders})
             OR NOT EXISTS (SELECT 1 FROM api_keys a WHERE a.email = k.email AND a.active = 1)
           )
       )`,
    )
    .run(days, ...PLACEHOLDER_EMAILS);
  return result.changes;
}
