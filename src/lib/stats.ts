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
      'INSERT INTO operations (operation_type, country_code, success, hour, day_of_week, error_detail, key_prefix) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

const IP_HASH_SECRET = process.env.IP_HASH_SECRET ?? process.env.SESSION_SECRET ?? '';

// Fail closed, like ensureWalletConfigured(): pseudonymising IPs with a salt
// that is public in this repository would make the privacy policy's "salted
// hash, never the raw address" promise brute-forceable. Refuse to boot.
if (!IP_HASH_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error(
    'IP_HASH_SECRET (or SESSION_SECRET) must be set in production — refusing to pseudonymise client IPs with a well-known default salt.',
  );
}
const EFFECTIVE_IP_SALT = IP_HASH_SECRET || 'ibanforge-default-salt-change-me';

/**
 * Truncated salted SHA-256 of a client IP, used to cluster requests from the
 * same source without retaining the original address. The 16-hex-char prefix
 * gives 2^64 buckets — collision-resistant in practice and not reversible
 * without the server-side secret.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip === 'unknown') return null;
  return createHash('sha256').update(`${EFFECTIVE_IP_SALT}:${ip}`).digest('hex').slice(0, 16);
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

// A submitted identifier must never reach `request_log`, which has twelve-month
// retention — that is the signed DPA clause, and the malformed-identifier
// traffic this instrumentation exists to measure is exactly the population that
// used to leak. Three shapes had to be closed:
//
//   /v1/bic/UBSW%20CHZH      → the old `[A-Za-z0-9]+` stopped at `%`, storing
//                              `/v1/bic/:code%20CHZH` (tail of the BIC kept).
//   /v1/ch/clearing/CH230    → the old `\d+` needed leading digits, so a
//                              non-numeric IID was stored raw and whole.
//   POST /CH93007620116238…  → no rule covered an unmatched path at all, so a
//                              404 could put a complete IBAN at rest.
//   /v1/bic/%7BCH930076…%7D  → an agent that substitutes the OpenAPI
//                              placeholder but keeps the braces. Not
//                              segment-shaped (it starts with `%`), and excused
//                              by the template rule below — a COMPLETE IBAN at
//                              rest, worse than the first case. See
//                              `redactSegment` for why the fix belongs there.

/**
 * The one shape a submitted value can take on ANY route, including one we never
 * registered: two letters, two check digits, then alphanumerics.
 *
 * Deliberately narrow. Checked against every path this API registers — `v1`,
 * `validate`, `clearing`, the `1k`/`5k`/`25k` bundle slugs, `cs_…` Stripe
 * session ids, 2-letter country codes — none has this shape, so the catch-all
 * cannot swallow a real endpoint and fragment the dashboard.
 */
const IBAN_SHAPED_TOKEN = /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{1,30}$/;

/**
 * What delimits an identifier inside a path segment, beyond `/`: a percent
 * escape or a brace.
 *
 * Testing whole segments is not enough. In `%7BCH9300762011623852957%7D` the
 * `B` of `%7B` glues onto the `CH`, so the segment matches nothing
 * identifier-shaped while still containing a complete IBAN. Splitting here (the
 * capture group keeps the delimiters, so the wrapper is rebuilt verbatim)
 * isolates the core and lets it be redacted in place.
 */
const IDENTIFIER_BOUNDARY = /(%[0-9A-Fa-f]{2}|[{}])/;

/**
 * OpenAPI template literals (`{code}`, `%7Bcode%7D`) are NOT submitted values —
 * they are an agent pasting the spec placeholder verbatim instead of
 * substituting it.
 *
 * They must stay verbatim: getBusinessFunnel() excludes them by matching
 * `{`/`%7B` in the stored path, and folding them into `:code` would silently
 * start counting them as `bad_input` — the exact regression that exclusion was
 * added to fix.
 *
 * This rule is only safe because `redactSegment` runs first and reaches INSIDE
 * the wrapper. On its own it is far too coarse: it would happily excuse
 * `%7BCH9300762011623852957%7D`, whose braces contain a real IBAN rather than a
 * placeholder name. Narrowing this predicate is the wrong repair — it would
 * only cover the two named route families, leave `/%7BCH93…%7D` on an unmatched
 * path open, and give the funnel regression back. Redaction is the layer that
 * has to be right.
 */
const SPEC_TEMPLATE_SEGMENT = /\{|%7[Bb]/;

/** Stands in for a redacted identifier. Contains no `{`/`%7B`, so it never
 *  trips the funnel's spec-template exclusion, and a wrapper redacted to
 *  `%7B:redacted%7D` still does. */
const REDACTED_SEGMENT = ':redacted';

/**
 * Strip any identifier out of one path segment, preserving everything around
 * it. `%7BCH9300762011623852957%7D` → `%7B:redacted%7D`: the wrapper survives
 * so the funnel keeps excluding the row, the identifier does not survive at all.
 */
function redactSegment(segment: string): string {
  return segment
    .split(IDENTIFIER_BOUNDARY)
    .map((token) => (IBAN_SHAPED_TOKEN.test(token) ? REDACTED_SEGMENT : token))
    .join('');
}

/**
 * Collapse a request path to a storable label: no submitted identifier, and a
 * stable bucket per route family so dashboards do not fragment.
 *
 * Takes a URL *pathname* (what the tracking middleware passes) — the route
 * patterns stop at `?` defensively, but query strings are not part of the
 * contract.
 *
 * Redaction runs FIRST, then the route labels. The privacy floor must not
 * depend on a route pattern being correct: if one is later narrowed, the
 * IBAN catch-all has already fired. On a path both rules touch
 * (`/v1/bic/CH9300762011623852957`) the two orders converge on `/v1/bic/:code`
 * — the ordering buys robustness against future edits, not a different result
 * today.
 */
export function normalizeRequestPath(path: string): string {
  const redacted = path.split('/').map(redactSegment).join('/');
  return redacted
    .replace(/\/v1\/bic\/[^/?]+/, (match) => (SPEC_TEMPLATE_SEGMENT.test(match) ? match : '/v1/bic/:code'))
    .replace(/\/v1\/ch\/clearing\/[^/?]+/, (match) =>
      SPEC_TEMPLATE_SEGMENT.test(match) ? match : '/v1/ch/clearing/:iid',
    );
}

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
    // Normalize paths: /v1/bic/DEUTDEFF → /v1/bic/:code, and redact any
    // identifier-shaped segment before it reaches storage (see above).
    const normalizedPath = normalizeRequestPath(path);
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
  keyPrefix?: string | null,
) {
  try {
    const hour = new Date().getUTCHours();
    const dow = (new Date().getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
    const truncatedError = errorDetail ? errorDetail.slice(0, 12) : null;
    insertOp().run(type, countryCode, success ? 1 : 0, hour, dow, truncatedError, keyPrefix ?? null);
    upsertDaily().run(type, 1, success ? 1 : 0, revenueUsdc);
    upsertHourly().run(hour, dow, type, 1, success ? 1 : 0);
  } catch (err) {
    // Stats are non-critical — never crash the API, but log so a broken stats
    // DB is visible instead of silently dropping every operation.
    console.error('[stats] recordOperation failed:', err);
  }
}

/**
 * The `daily_stats.operation_type` under which a prepaid pack sale is booked.
 *
 * NOT an `OperationType`: a purchase is not a validation, and the distinction
 * is load-bearing. `getStats()` builds `total_operations` and `by_type` from
 * three named types read out of the `operations` table, so this row adds
 * revenue to the daily line WITHOUT inflating any usage counter.
 */
export const CREDITS_PURCHASE_TYPE = 'credits_purchase';

/**
 * Book the sale of a prepaid credit pack.
 *
 * 🚨 The consumption endpoints have always recorded what they collected. The
 * routes that SELL recorded nothing at all — so the single largest ticket we
 * can take on the USDC rail ($5 to $80, against $0.002–$0.02 per call) left no
 * trace in `daily_stats`, and every revenue reading understated the business by
 * exactly the amount that mattered most. Audit B2.
 *
 * `settled` is false when no payment header was presented (explicit free mode,
 * dev bypass): the pack was handed over, but nothing was collected, and a
 * dashboard must never show money that did not move. Same rule as
 * `computeRevenue` applies to every other endpoint.
 */
export function recordCreditsPurchase(bundle: string, priceUsdc: number, settled: boolean): void {
  try {
    upsertDaily().run(CREDITS_PURCHASE_TYPE, 1, 1, settled ? priceUsdc : 0);
  } catch (err) {
    // Same discipline as every other writer here: a broken stats DB must never
    // turn a completed purchase into a 500, but it must be visible in the log.
    console.error('[stats] recordCreditsPurchase failed:', err, { bundle });
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
/**
 * `outcomes` carries one entry per IBAN in the batch, each with its own country
 * and verdict. Without it the batch wrote country_code NULL on every row, so a
 * customer who validates only through /v1/iban/batch appeared to check no
 * countries at all — invisible on the very panel meant to show what they look
 * at. It stays optional so a caller that cannot supply it still records
 * something, on the old count/validCount shape.
 */
export function recordBatch(
  count: number,
  validCount: number,
  revenueUsdc: number,
  keyPrefix?: string | null,
  outcomes?: Array<{ valid: boolean; country: string | null }>,
) {
  try {
    const hour = new Date().getUTCHours();
    const dow = (new Date().getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
    const db = getStatsDB();
    const key = keyPrefix ?? null;
    const tx = db.transaction(() => {
      const stmt = insertOp();
      if (outcomes) {
        for (const o of outcomes) stmt.run('iban_batch', o.country, o.valid ? 1 : 0, hour, dow, null, key);
      } else {
        for (let i = 0; i < validCount; i++) stmt.run('iban_batch', null, 1, hour, dow, null, key);
        for (let i = 0; i < count - validCount; i++) stmt.run('iban_batch', null, 0, hour, dow, null, key);
      }
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

// Rejection rows share the `operations` table but are a SEPARATE LANE: every
// reader below must exclude them with `reject_reason IS NULL`, and only
// getRejectionStats() reads them (`reject_reason IS NOT NULL`).
//
// Why: a rejection is a request that never reached the operation, not a failed
// operation. Counting it as success=0 would crater bic_lookup's hit rate to
// single digits the moment the routes start calling recordRejection —
// indistinguishable from an outage on a service that sells reliability — and it
// would corrupt the before/after funnel comparison the tolerance work exists to
// measure, making a real improvement impossible to tell from an accounting
// artefact. Historical rows predate the column and are NULL, so the predicate
// includes all of them.

/**
 * Operations billed to internal-labeled keys — our own tests, probes, and
 * regrouped abuse cohorts (…@cohorte.invalid). Public aggregates drop them
 * for the same reason the business funnel does: 7,449 farmed validations
 * once made ES the all-time #1 country on the public stats page. Anonymous
 * rows (key_prefix NULL) stay counted — they are the x402 demand signal.
 */
function internalOpPrefixes(): string[] {
  return (
    getStatsDB().prepare('SELECT key_prefix, email FROM api_keys').all() as Array<{
      key_prefix: string;
      email: string;
    }>
  )
    .filter((k) => isInternalEmail(k.email))
    .map((k) => k.key_prefix);
}

function excludePrefixClause(excluded: string[]): string {
  if (excluded.length === 0) return '';
  return ` AND (key_prefix IS NULL OR key_prefix NOT IN (${excluded.map(() => '?').join(',')}))`;
}

function typeStats(type: OperationType, excluded: string[] = []): { total: number; success_count: number } {
  const row = getStatsDB().prepare(
    'SELECT COUNT(*) as total, COALESCE(SUM(success), 0) as success_count FROM operations WHERE operation_type = ? AND reject_reason IS NULL' +
      excludePrefixClause(excluded)
  ).get(type, ...excluded) as { total: number; success_count: number };
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

  const excluded = internalOpPrefixes();
  const ibanVal = typeStats('iban_validate', excluded);
  const ibanBatch = typeStats('iban_batch', excluded);
  const bicLookup = typeStats('bic_lookup', excluded);

  const totalOps = ibanVal.total + ibanBatch.total + bicLookup.total;

  const revenue = db.prepare(
    'SELECT COALESCE(SUM(revenue_usdc), 0) as total FROM daily_stats'
  ).get() as { total: number };

  // The early x402 rollout (before 2026-04-18) recorded attempted payments
  // whose on-chain settlement never happened — see revenue_note below. The
  // clean figure starts after that drift so the dashboard can show a sum
  // that is not knowingly overstated.
  const revenueClean = db.prepare(
    "SELECT COALESCE(SUM(revenue_usdc), 0) as total FROM daily_stats WHERE date >= '2026-04-18'"
  ).get() as { total: number };

  // `days` is the field that makes this table usable for a decision, and its
  // absence made the raw counts actively misleading. A country seen 426 times
  // across two days is one caller in a burst; a country seen 494 times across
  // fifty days is a customer with the product wired in. Ranking coverage work
  // on `count` alone puts the burst first. `first_seen`/`last_seen` separate a
  // country that is still active from one that stopped months ago.
  const topCountries = db.prepare(
    'SELECT country_code as country, COUNT(*) as count,' +
      " COUNT(DISTINCT date(created_at)) as days," +
      ' MIN(date(created_at)) as first_seen, MAX(date(created_at)) as last_seen' +
      ' FROM operations WHERE country_code IS NOT NULL' +
      excludePrefixClause(excluded) +
      ' GROUP BY country_code ORDER BY count DESC LIMIT 30'
  ).all(...excluded) as Array<{
    country: string;
    count: number;
    days: number;
    first_seen: string;
    last_seen: string;
  }>;

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

  // Freshness witness: when the collector dies (auth broken, disk full,
  // middleware unplugged), every counter above reads zero — exactly like a
  // quiet day. The dashboard compares this timestamp to the clock instead of
  // trusting the zeros.
  const lastWrite = db.prepare(
    'SELECT MAX(created_at) as last FROM request_log'
  ).get() as { last: string | null };

  return {
    total_requests: totalRequests.total,
    requests_today: requestsToday.total,
    last_write_at: lastWrite.last,
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
    total_revenue_usdc_clean: Math.round(revenueClean.total * 1000000) / 1000000,
    total_revenue_attempted_usdc: Math.round(revenue.total * 1000000) / 1000000,
    revenue_note:
      'ATTEMPTED, NOT COLLECTED — total_revenue_usdc is a misnomer kept for contract stability: it and total_revenue_attempted_usdc are the SAME number, the SUM of revenue_usdc in daily_stats. A row is written when a call PASSED the payment middleware verify step; nothing here observes the chain, so a settle that failed AFTER verify still counts and can only inflate this figure — it structurally over-counts and never under-counts. Do not read it as earnings. The authoritative settled USDC is /admin/revenue (Bearer STATS_TOKEN), which reads Base mainnet Transfer events to the seller wallet. Scope: x402 pay-per-call AND prepaid credit packs bought with USDC (operation_type credits_purchase, added 2026-08-20 — before that date pack sales are missing from this sum entirely). Card purchases are NOT here: Stripe money never touches the wallet and is not USDC. Historical drift observed: ~0.226 USDC counted as attempted between 2026-04-08 and 2026-04-17 with no matching on-chain Transfer — likely facilitator settlement failures during the early x402 rollout; total_revenue_usdc_clean excludes that window.',
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
  /** min over up to 8 prior same-weekday totals — null under 3 samples. */
  expected_min: number | null;
  expected_max: number | null;
  /**
   * Served latency for the day, in milliseconds. Percentiles and not a mean:
   * one slow outlier moves a mean and moves no customer's experience.
   *
   * `null` rather than 0 on a day with too few measured requests — a
   * percentile over three samples is noise wearing a number's clothes, and on
   * a public status page a made-up figure is worse than a gap.
   */
  p50_ms: number | null;
  p95_ms: number | null;
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

  // Total HTTP requests from request_log, broken down by status group.
  // The window is widened by 8 weeks beyond the requested period: the extra
  // days never leave this function, they only feed the expected band (a
  // 7-day view has no same-weekday history of its own to compare against).
  const reqRows = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as total_requests,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as s2xx,
      SUM(CASE WHEN status >= 300 AND status < 400 THEN 1 ELSE 0 END) as s3xx,
      SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) as s4xx,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as s5xx
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(created_at)
  `).all(days + 56) as Array<{ date: string; total_requests: number; s2xx: number; s3xx: number; s4xx: number; s5xx: number }>;

  /**
   * Daily median and 95th percentile of served latency.
   *
   * Computed with window functions rather than by pulling every response_ms
   * into JS: the row count grows without bound and this feeds a page that
   * revalidates every five minutes.
   *
   * Only SERVED requests count. A 402 answered in two milliseconds because the
   * paywall refused it is not evidence that the service is fast, and letting
   * refusals into this figure would make the number improve every time a key
   * farm hammers the door.
   */
  const MIN_SAMPLES_FOR_PERCENTILE = 20;
  const latRows = db.prepare(`
    WITH ranked AS (
      SELECT date(created_at) AS d, response_ms,
             ROW_NUMBER() OVER (PARTITION BY date(created_at) ORDER BY response_ms) AS rn,
             COUNT(*)     OVER (PARTITION BY date(created_at)) AS n
        FROM request_log
       WHERE response_ms IS NOT NULL
         AND status < 400
         AND created_at >= datetime('now', '-' || ? || ' days')
    )
    SELECT d AS date, n,
           MAX(CASE WHEN rn = MAX(1, CAST(n * 0.50 AS INTEGER)) THEN response_ms END) AS p50,
           MAX(CASE WHEN rn = MAX(1, CAST(n * 0.95 AS INTEGER)) THEN response_ms END) AS p95
      FROM ranked
     GROUP BY d
  `).all(days) as Array<{ date: string; n: number; p50: number | null; p95: number | null }>;

  const latMap = new Map(
    latRows.map(r => [
      r.date,
      r.n >= MIN_SAMPLES_FOR_PERCENTILE
        ? { p50: r.p50 ?? null, p95: r.p95 ?? null }
        : { p50: null, p95: null },
    ]),
  );

  const reqMap = new Map(reqRows.map(r => [r.date, r]));

  // Expected band per date: min/max of the totals of up to 8 PRIOR dates
  // sharing its weekday. Under 3 samples the band is null — a band drawn
  // from one or two points would read as confidence nobody has.
  const band = (date: string): { min: number | null; max: number | null } => {
    const target = new Date(`${date}T00:00:00Z`);
    const samples: number[] = [];
    for (let w = 1; w <= 8; w++) {
      const prior = new Date(target);
      prior.setUTCDate(prior.getUTCDate() - w * 7);
      const row = reqMap.get(prior.toISOString().slice(0, 10));
      if (row) samples.push(row.total_requests);
    }
    if (samples.length < 3) return { min: null, max: null };
    return { min: Math.min(...samples), max: Math.max(...samples) };
  };

  // Merge: all dates from both sources, then slice back to the requested
  // period so the widened band window stays internal.
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const allDates = [...new Set([...opsRows.map(r => r.date), ...reqRows.map(r => r.date)])]
    .filter(d => d >= cutoff)
    .sort();
  const opsMap = new Map(opsRows.map(r => [r.date, r]));

  return allDates.map(date => {
    const req = reqMap.get(date);
    const rev = opsMap.get(date)?.revenue_usdc ?? 0;
    const b = band(date);
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
      expected_min: b.min,
      expected_max: b.max,
      p50_ms: latMap.get(date)?.p50 ?? null,
      p95_ms: latMap.get(date)?.p95 ?? null,
    };
  });
}

/**
 * Quick counts for health endpoint
 */
export function getQuickStats(): { total_operations: number; iban_validations: number; bic_lookups: number; success_rate: number } {
  const db = getStatsDB();
  const row = db.prepare(
    'SELECT COUNT(*) as total, COALESCE(SUM(success), 0) as success_count FROM operations WHERE reject_reason IS NULL'
  ).get() as { total: number; success_count: number };

  const ibanCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM operations WHERE operation_type IN ('iban_validate', 'iban_batch') AND reject_reason IS NULL"
  ).get() as { cnt: number };

  const bicCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM operations WHERE operation_type = 'bic_lookup' AND reject_reason IS NULL"
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

export function buildBillableFilter(): { sql: string; params: string[] } {
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

/** Everything one API key did, as one object. Feeds the CRM's Clients tab. */
export interface ClientProfile {
  key_prefix: string;
  first_seen: string | null;
  last_seen: string | null;
  /** Every request, whatever the verdict. The four counters below are subsets. */
  total: number;
  ok: number;
  paywall: number;
  bad_input: number;
  auth_or_quota: number;
  server_error: number;
  avg_ms: number;
  p95_ms: number;
  /**
   * The last time we served them, and the last time we turned them away. Two
   * instants rather than one flag, because "their quota is full right now" and
   * "they walked away at a wall and never came back" are different situations
   * and only the second one is a customer being lost. Raising a quota clears
   * the first and leaves the second exactly as it was.
   */
  last_success_at: string | null;
  last_refusal_at: string | null;
  endpoints: Array<{ path: string; count: number }>;
  /** ISO country codes they actually checked, busiest first. */
  countries: Array<{ code: string; count: number }>;
  user_agents: Array<{ ua: string; count: number }>;
  client_kinds: Array<{ kind: string; count: number }>;
  /** Distinct salted IP hashes: how many machines or environments call us. */
  distinct_ips: number;
  /** 24 UTC buckets. The shape of the day says more about a customer than a timezone field would. */
  hours: number[];
  /** Calls per day over the window, oldest first. `bad` = HTTP 400 that day —
   * what lets the panel say "38 % of this week's calls were bad input, last
   * week 4 %" instead of one flat window-wide ratio. */
  days: Array<{ day: string; count: number; bad?: number }>;
  /** What their inputs got rejected for, busiest first. */
  reject_reasons: Array<{ reason: string; count: number }>;
}

/**
 * One profile per API key that has actually called something, keyed by prefix.
 *
 * Built from request_log (who, when, how, how fast) joined to operations (what
 * countries). Keys that never called are absent rather than present-and-empty:
 * the caller decides how to present a customer with no activity, and an empty
 * object would look like a customer whose data failed to load.
 */
export function getClientProfiles(days = 90): Record<string, ClientProfile> {
  const db = getStatsDB();
  const since = `-${Math.max(1, Math.min(365, days))} days`;
  const out: Record<string, ClientProfile> = {};
  const ensure = (k: string): ClientProfile =>
    (out[k] ??= {
      key_prefix: k,
      first_seen: null,
      last_seen: null,
      total: 0,
      ok: 0,
      paywall: 0,
      bad_input: 0,
      auth_or_quota: 0,
      server_error: 0,
      avg_ms: 0,
      p95_ms: 0,
      last_success_at: null,
      last_refusal_at: null,
      endpoints: [],
      countries: [],
      user_agents: [],
      client_kinds: [],
      distinct_ips: 0,
      hours: Array(24).fill(0),
      days: [],
      reject_reasons: [],
    });

  const totals = db
    .prepare(
      `SELECT key_prefix,
              COUNT(*) total,
              SUM(status >= 200 AND status < 300) ok,
              SUM(status = 402) paywall,
              SUM(status = 400) bad_input,
              SUM(status = 401 OR status = 429) auth_or_quota,
              SUM(status >= 500) server_error,
              MIN(created_at) first_seen,
              MAX(created_at) last_seen,
              COUNT(DISTINCT ip_hash) distinct_ips,
              AVG(response_ms) avg_ms,
              MAX(CASE WHEN status >= 200 AND status < 300 THEN created_at END) last_success_at,
              MAX(CASE WHEN status IN (401, 402, 429) THEN created_at END) last_refusal_at
       FROM request_log WHERE key_prefix IS NOT NULL GROUP BY key_prefix`,
    )
    .all() as Array<Record<string, number | string | null>>;
  for (const r of totals) {
    const p = ensure(String(r.key_prefix));
    p.total = Number(r.total ?? 0);
    p.ok = Number(r.ok ?? 0);
    p.paywall = Number(r.paywall ?? 0);
    p.bad_input = Number(r.bad_input ?? 0);
    p.auth_or_quota = Number(r.auth_or_quota ?? 0);
    p.server_error = Number(r.server_error ?? 0);
    p.first_seen = (r.first_seen as string) ?? null;
    p.last_seen = (r.last_seen as string) ?? null;
    p.distinct_ips = Number(r.distinct_ips ?? 0);
    p.avg_ms = Math.round(Number(r.avg_ms ?? 0));
    p.last_success_at = (r.last_success_at as string) ?? null;
    p.last_refusal_at = (r.last_refusal_at as string) ?? null;
  }

  // p95 per key. SQLite has no percentile function, so it is an offset into the
  // key's own ordered latencies — the count is already known from the pass above.
  const p95 = db.prepare(
    `SELECT response_ms FROM request_log WHERE key_prefix = ? AND response_ms IS NOT NULL
     ORDER BY response_ms LIMIT 1 OFFSET ?`,
  );
  const nth = db.prepare(
    `SELECT COUNT(*) n FROM request_log WHERE key_prefix = ? AND response_ms IS NOT NULL`,
  );
  for (const p of Object.values(out)) {
    const n = Number((nth.get(p.key_prefix) as { n: number }).n);
    if (n === 0) continue;
    const row = p95.get(p.key_prefix, Math.min(n - 1, Math.floor(n * 0.95))) as { response_ms: number } | undefined;
    p.p95_ms = row ? Math.round(row.response_ms) : 0;
  }

  const push = <T>(list: T[], v: T, cap: number) => {
    if (list.length < cap) list.push(v);
  };
  for (const r of db
    .prepare(
      `SELECT key_prefix, path, COUNT(*) count FROM request_log
       WHERE key_prefix IS NOT NULL GROUP BY key_prefix, path ORDER BY key_prefix, count DESC`,
    )
    .all() as Array<{ key_prefix: string; path: string; count: number }>) {
    push(ensure(r.key_prefix).endpoints, { path: r.path, count: r.count }, 12);
  }
  for (const r of db
    .prepare(
      `SELECT key_prefix, user_agent ua, COUNT(*) count FROM request_log
       WHERE key_prefix IS NOT NULL AND user_agent IS NOT NULL
       GROUP BY key_prefix, ua ORDER BY key_prefix, count DESC`,
    )
    .all() as Array<{ key_prefix: string; ua: string; count: number }>) {
    push(ensure(r.key_prefix).user_agents, { ua: r.ua, count: r.count }, 6);
  }
  for (const r of db
    .prepare(
      `SELECT key_prefix, client_kind kind, COUNT(*) count FROM request_log
       WHERE key_prefix IS NOT NULL AND client_kind IS NOT NULL
       GROUP BY key_prefix, kind ORDER BY key_prefix, count DESC`,
    )
    .all() as Array<{ key_prefix: string; kind: string; count: number }>) {
    push(ensure(r.key_prefix).client_kinds, { kind: r.kind, count: r.count }, 5);
  }
  for (const r of db
    .prepare(
      `SELECT key_prefix, hour, COUNT(*) count FROM request_log
       WHERE key_prefix IS NOT NULL AND hour IS NOT NULL GROUP BY key_prefix, hour`,
    )
    .all() as Array<{ key_prefix: string; hour: number; count: number }>) {
    const p = ensure(r.key_prefix);
    if (r.hour >= 0 && r.hour < 24) p.hours[r.hour] = r.count;
  }
  for (const r of db
    .prepare(
      `SELECT key_prefix, date(created_at) day, COUNT(*) count,
              SUM(CASE WHEN status = 400 THEN 1 ELSE 0 END) bad
       FROM request_log
       WHERE key_prefix IS NOT NULL AND created_at >= date('now', ?)
       GROUP BY key_prefix, day ORDER BY key_prefix, day`,
    )
    .all(since) as Array<{ key_prefix: string; day: string; count: number; bad: number }>) {
    ensure(r.key_prefix).days.push({ day: r.day, count: r.count, bad: r.bad });
  }

  // The countries only exist for rows operations could be attributed to, so a
  // customer active before 2026-07-30 shows fewer than they really checked.
  for (const r of db
    .prepare(
      `SELECT key_prefix, country_code code, COUNT(*) count FROM operations
       WHERE key_prefix IS NOT NULL AND country_code IS NOT NULL
       GROUP BY key_prefix, code ORDER BY key_prefix, count DESC`,
    )
    .all() as Array<{ key_prefix: string; code: string; count: number }>) {
    push(ensure(r.key_prefix).countries, { code: r.code, count: r.count }, 30);
  }
  for (const r of db
    .prepare(
      `SELECT key_prefix, reject_reason reason, COUNT(*) count FROM operations
       WHERE key_prefix IS NOT NULL AND reject_reason IS NOT NULL
       GROUP BY key_prefix, reason ORDER BY key_prefix, count DESC`,
    )
    .all() as Array<{ key_prefix: string; reason: string; count: number }>) {
    push(ensure(r.key_prefix).reject_reasons, { reason: r.reason, count: r.count }, 8);
  }

  return out;
}

/** Everything one unauthenticated caller did, keyed by its user agent. */
export interface BotProfile {
  user_agent: string;
  /** Its busiest classification. A caller rarely spans two. */
  client_kind: string | null;
  /** The contact page most crawlers advertise as "+https://…" inside their UA. */
  homepage: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total: number;
  ok: number;
  paywall: number;
  bad_input: number;
  not_found: number;
  server_error: number;
  /** 2xx on a priced endpoint with no API key: an x402 payment went through. */
  billable_ok: number;
  avg_ms: number;
  distinct_ips: number;
  endpoints: Array<{ path: string; count: number }>;
  /** What it asked for and we do not serve, busiest first. */
  not_found_paths: Array<{ path: string; count: number }>;
  hours: number[];
  days: Array<{ day: string; count: number }>;
}

/** Crawlers conventionally carry their contact page in the UA as "+https://…". */
function homepageFromUserAgent(ua: string): string | null {
  return /\+(https?:\/\/[^\s;)]+)/.exec(ua)?.[1] ?? null;
}

/**
 * One profile per unauthenticated caller, keyed by user agent.
 *
 * Keyed by UA rather than by IP on purpose: the salted IP hash resets whenever
 * IP_HASH_SECRET is rotated — it did on 2026-07-10, which made every long-lived
 * caller look like it had left and been replaced — whereas a crawler's UA is
 * stable for as long as it exists.
 *
 * `minRequests` is a noise floor: 1,532 distinct agents called in the last 90
 * days and the great majority came once. Serving all of them would bury the
 * forty that matter.
 */
export function getBotProfiles(days = 90, minRequests = 5): Record<string, BotProfile> {
  const db = getStatsDB();
  const since = `-${Math.max(1, Math.min(365, days))} days`;
  const anon = `key_prefix IS NULL AND user_agent IS NOT NULL AND created_at >= date('now', ?)`;
  const billable = buildBillableFilter();
  const out: Record<string, BotProfile> = {};

  const rows = db
    .prepare(
      `SELECT user_agent ua,
              COUNT(*) total,
              SUM(status >= 200 AND status < 300) ok,
              SUM(status = 402) paywall,
              SUM(status = 400) bad_input,
              SUM(status = 404) not_found,
              SUM(status >= 500) server_error,
              SUM(CASE WHEN status >= 200 AND status < 300 AND (${billable.sql}) THEN 1 ELSE 0 END) billable_ok,
              MIN(created_at) first_seen,
              MAX(created_at) last_seen,
              COUNT(DISTINCT ip_hash) distinct_ips,
              AVG(response_ms) avg_ms
       FROM request_log WHERE ${anon}
       GROUP BY ua HAVING total >= ?`,
    )
    .all(...billable.params, since, minRequests) as Array<Record<string, string | number | null>>;

  for (const r of rows) {
    const ua = String(r.ua);
    out[ua] = {
      user_agent: ua,
      client_kind: null,
      homepage: homepageFromUserAgent(ua),
      first_seen: (r.first_seen as string) ?? null,
      last_seen: (r.last_seen as string) ?? null,
      total: Number(r.total ?? 0),
      ok: Number(r.ok ?? 0),
      paywall: Number(r.paywall ?? 0),
      bad_input: Number(r.bad_input ?? 0),
      not_found: Number(r.not_found ?? 0),
      server_error: Number(r.server_error ?? 0),
      billable_ok: Number(r.billable_ok ?? 0),
      avg_ms: Math.round(Number(r.avg_ms ?? 0)),
      distinct_ips: Number(r.distinct_ips ?? 0),
      endpoints: [],
      not_found_paths: [],
      hours: Array(24).fill(0),
      days: [],
    };
  }

  const known = (ua: string): BotProfile | null => out[ua] ?? null;
  const cap = <T>(list: T[], v: T, max: number) => {
    if (list.length < max) list.push(v);
  };

  for (const r of db
    .prepare(
      `SELECT user_agent ua, client_kind kind, COUNT(*) count FROM request_log
       WHERE ${anon} AND client_kind IS NOT NULL GROUP BY ua, kind ORDER BY ua, count DESC`,
    )
    .all(since) as Array<{ ua: string; kind: string; count: number }>) {
    const p = known(r.ua);
    if (p && p.client_kind == null) p.client_kind = r.kind;
  }
  for (const r of db
    .prepare(
      `SELECT user_agent ua, path, COUNT(*) count FROM request_log
       WHERE ${anon} GROUP BY ua, path ORDER BY ua, count DESC`,
    )
    .all(since) as Array<{ ua: string; path: string; count: number }>) {
    const p = known(r.ua);
    if (p) cap(p.endpoints, { path: r.path, count: r.count }, 12);
  }
  for (const r of db
    .prepare(
      `SELECT user_agent ua, path, COUNT(*) count FROM request_log
       WHERE ${anon} AND status = 404 GROUP BY ua, path ORDER BY ua, count DESC`,
    )
    .all(since) as Array<{ ua: string; path: string; count: number }>) {
    const p = known(r.ua);
    if (p) cap(p.not_found_paths, { path: r.path, count: r.count }, 10);
  }
  for (const r of db
    .prepare(
      `SELECT user_agent ua, hour, COUNT(*) count FROM request_log
       WHERE ${anon} AND hour IS NOT NULL GROUP BY ua, hour`,
    )
    .all(since) as Array<{ ua: string; hour: number; count: number }>) {
    const p = known(r.ua);
    if (p && r.hour >= 0 && r.hour < 24) p.hours[r.hour] = r.count;
  }
  for (const r of db
    .prepare(
      `SELECT user_agent ua, date(created_at) day, COUNT(*) count FROM request_log
       WHERE ${anon} GROUP BY ua, day ORDER BY ua, day`,
    )
    .all(since) as Array<{ ua: string; day: string; count: number }>) {
    const p = known(r.ua);
    if (p) p.days.push({ day: r.day, count: r.count });
  }

  return out;
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
        AND reject_reason IS NULL
    `).get(opType, days) as { total: number; success_count: number };
    const errorRate = overall.total > 0 ? Math.round(((overall.total - overall.success_count) / overall.total) * 10000) / 100 : 0;

    // Daily error rate trend for last 7 days
    const dailyRows = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as total, COALESCE(SUM(success), 0) as success_count
      FROM operations
      WHERE operation_type = ? AND created_at >= datetime('now', '-7 days')
        AND reject_reason IS NULL
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
 * Covers every table the privacy policy's retention promise reaches:
 * request_log, operations (invalid-IBAN prefixes live in error_detail) and
 * feedback (free-text reports, contact address). Aggregated tables
 * (daily_stats, hourly_stats) hold no personal data and are kept
 * indefinitely. This backs the public privacy policy — keep both in sync.
 */
export function purgeOldRequestLog(months: number = 12): number {
  const db = getStatsDB();
  let purged = db
    .prepare(`DELETE FROM request_log WHERE created_at < datetime('now', '-' || ? || ' months')`)
    .run(months).changes;
  purged += db
    .prepare(`DELETE FROM operations WHERE created_at < datetime('now', '-' || ? || ' months')`)
    .run(months).changes;
  // The feedback table is created lazily by its route; a stats DB opened by
  // tests or scripts may not have it yet.
  const hasFeedback = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feedback'`)
    .get();
  if (hasFeedback) {
    purged += db
      .prepare(`DELETE FROM feedback WHERE created_at < datetime('now', '-' || ? || ' months')`)
      .run(months).changes;
  }
  // A never-retrieved one-time key view is a plaintext credential at rest;
  // seven days is far beyond any legitimate retrieval delay (DPA 4.2).
  db.prepare(
    `UPDATE api_keys SET raw_key_one_time_view = NULL
     WHERE raw_key_one_time_view IS NOT NULL AND created_at < datetime('now', '-7 days')`,
  ).run();
  return purged;
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
  const terminatedKeys = `
         SELECT k.key_prefix FROM api_keys k
         WHERE k.active = 0
           AND k.deactivated_at IS NOT NULL
           AND k.deactivated_at < datetime('now', '-' || ? || ' days')
           AND (
             k.email IN (${placeholders})
             OR NOT EXISTS (SELECT 1 FROM api_keys a WHERE a.email = k.email AND a.active = 1)
           )`;
  // Both per-request tables carry key_prefix; DPA 4.7 covers them equally.
  let purged = db
    .prepare(`DELETE FROM request_log WHERE key_prefix IN (${terminatedKeys})`)
    .run(days, ...PLACEHOLDER_EMAILS).changes;
  purged += db
    .prepare(`DELETE FROM operations WHERE key_prefix IN (${terminatedKeys})`)
    .run(days, ...PLACEHOLDER_EMAILS).changes;
  return purged;
}

/**
 * Footprint of the regrouped signup cohorts — the study view.
 *
 * The business aggregates drop @cohorte.invalid keys on purpose (a farmed batch
 * once made a country the all-time #1). This function does the opposite: it
 * looks ONLY at those keys, so the two cohorts, useful precisely because they
 * are known and bounded, can be read as a case study of what an automated
 * signup burst does to every indicator — without any of it touching the real
 * numbers.
 *
 * Everything here is derived from the same rows the business views exclude:
 * operations (one per validation, carries the country), api_keys (the cohort
 * address and mint date), key_creations (the client library string).
 */
export interface CohortFootprint {
  cohorts: Array<{
    address: string;
    keys: number;
    /** Validations attributed to the cohort (operations rows). */
    units: number;
    first_seen: string | null;
    last_seen: string | null;
    top_countries: Array<{ country: string; count: number }>;
    by_type: Array<{ type: string; count: number }>;
    top_client: string | null;
  }>;
  /** Per-day validation counts across all cohorts — shows the bursts. */
  timeline: Array<{ day: string; count: number }>;
  /** What the public country ranking would look like WITH the cohorts folded
   *  back in, next to the real one WITHOUT them — the pollution, made visible. */
  countries_with: Array<{ country: string; count: number }>;
  countries_without: Array<{ country: string; count: number }>;
  totals: { cohorts: number; keys: number; units: number };
}

export function getCohortFootprint(): CohortFootprint {
  const db = getStatsDB();
  const cohortKeys = db
    .prepare("SELECT key_prefix, email FROM api_keys WHERE email LIKE '%@cohorte.invalid'")
    .all() as Array<{ key_prefix: string; email: string }>;

  const byAddress = new Map<string, string[]>();
  for (const k of cohortKeys) {
    const list = byAddress.get(k.email);
    if (list) list.push(k.key_prefix);
    else byAddress.set(k.email, [k.key_prefix]);
  }
  const allPrefixes = cohortKeys.map((k) => k.key_prefix);

  const cohorts = [...byAddress.entries()]
    .map(([address, prefixes]) => {
      const ph = prefixes.map(() => '?').join(',');
      const span = db
        .prepare(
          `SELECT MIN(created_at) first_seen, MAX(created_at) last_seen, COUNT(*) units
             FROM operations WHERE key_prefix IN (${ph})`,
        )
        .get(...prefixes) as { first_seen: string | null; last_seen: string | null; units: number };
      const top_countries = db
        .prepare(
          `SELECT country_code country, COUNT(*) count FROM operations
             WHERE key_prefix IN (${ph}) AND country_code IS NOT NULL
             GROUP BY country_code ORDER BY count DESC LIMIT 5`,
        )
        .all(...prefixes) as Array<{ country: string; count: number }>;
      const by_type = db
        .prepare(
          `SELECT operation_type type, COUNT(*) count FROM operations
             WHERE key_prefix IN (${ph}) GROUP BY operation_type ORDER BY count DESC`,
        )
        .all(...prefixes) as Array<{ type: string; count: number }>;
      const client = db
        .prepare(
          `SELECT user_agent ua, COUNT(*) n FROM key_creations
             WHERE key_prefix IN (${ph}) AND user_agent IS NOT NULL
             GROUP BY user_agent ORDER BY n DESC LIMIT 1`,
        )
        .get(...prefixes) as { ua: string; n: number } | undefined;
      return {
        address,
        keys: prefixes.length,
        units: span.units,
        first_seen: span.first_seen,
        last_seen: span.last_seen,
        top_countries,
        by_type,
        top_client: client?.ua ?? null,
      };
    })
    .sort((a, b) => b.units - a.units);

  const timeline =
    allPrefixes.length === 0
      ? []
      : (db
          .prepare(
            `SELECT date(created_at) day, COUNT(*) count FROM operations
               WHERE key_prefix IN (${allPrefixes.map(() => '?').join(',')})
               GROUP BY day ORDER BY day`,
          )
          .all(...allPrefixes) as Array<{ day: string; count: number }>);

  // The country ranking both ways. "without" is what the public page shows
  // today; "with" folds the cohorts back in — the difference is the distortion.
  const countries_without = db
    .prepare(
      'SELECT country_code country, COUNT(*) count FROM operations WHERE country_code IS NOT NULL' +
        excludePrefixClause(allPrefixes) +
        ' GROUP BY country_code ORDER BY count DESC LIMIT 8',
    )
    .all(...allPrefixes) as Array<{ country: string; count: number }>;
  const countries_with = db
    .prepare(
      "SELECT country_code country, COUNT(*) count FROM operations WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count DESC LIMIT 8",
    )
    .all() as Array<{ country: string; count: number }>;

  return {
    cohorts,
    timeline,
    countries_with,
    countries_without,
    totals: {
      cohorts: cohorts.length,
      keys: allPrefixes.length,
      units: cohorts.reduce((s, c) => s + c.units, 0),
    },
  };
}
