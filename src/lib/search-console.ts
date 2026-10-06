import { createSign } from 'node:crypto';
import { getStatsDB } from './db.js';

/**
 * What Google actually sends us, read once every six hours.
 *
 * Search Console was verified for `https://ibanforge.com/` in August and never
 * read: the 06/09/2026 reading — a handful of clicks a week — was the first,
 * and it was taken by hand with two throwaway scripts. A figure read once is a
 * figure nobody watches; this module is the same reading, permanent, so the
 * Monday question ("did anything move in Google") has an answer on the
 * dashboard rather than in a terminal history.
 *
 * No SDK, no new dependency: a service-account JWT signed with `node:crypto`,
 * exchanged for an access token, and three JSON endpoints. `GSC_SA_JSON` holds
 * the whole service-account key and exists ONLY in the production environment;
 * absent, this module is "not configured" and nothing throws — the API must
 * boot on a laptop that has never seen a Google credential.
 *
 * Two rules the callers depend on:
 *
 * • Every derivation lives here, not in the dashboard card. The weekly
 *   aggregation, the page paths made relative and the three-state verdict are
 *   all things a test can hold still; computed in JSX they would be numbers
 *   nobody could assert on.
 * • An impossible figure is `null`, never `0`. Search Console omits days with
 *   no data at all, so a quiet week aggregates to zero impressions — and an
 *   average position printed as `0` claims a rank better than first place.
 */

/** The verified property. One knob fewer: the API serves exactly one site. */
export const SITE_URL = 'https://ibanforge.com/';
const SITE_ORIGIN = 'https://ibanforge.com';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3';
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

/**
 * Read-only is enough for all three calls, URL inspection included. The
 * throwaway probe asked for the read-write `webmasters` scope because it also
 * resubmitted the sitemap; nothing here writes, so nothing here asks.
 */
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/**
 * Search Console data lags two to three days. The window ends at J-3 so the
 * last week of the series is complete rather than half-collected — a partial
 * Sunday drawn beside four full weeks reads as a collapse.
 */
export const LAG_DAYS = 3;

/** Complete weeks in the series, and the window the top lists are taken over. */
export const WEEKS = 4;
export const TOP_WINDOW_DAYS = 28;
export const TOP_ROWS = 10;

/**
 * The witnesses: one URL per family that matters, and no more.
 *
 * URL inspection is quota'd at 2 000 calls a day and costs one call per URL, so
 * this list is fixed and short by design — a refresh spends eight. One home,
 * one localised home, the docs, the two register indexes, one register leaf
 * (the Bundesbank BLZ the September campaign points at), the audit page that
 * carries the 14 November deadline, and the newest country. If Google has
 * dropped a whole family, one of these eight says so.
 */
export const WITNESS_PATHS = [
  '/',
  '/fr',
  '/docs',
  '/blz',
  '/iban/ch',
  '/de/blz/37040044',
  '/fr/audit',
  '/sk',
] as const;

/** Refresh cadence of the persistent cache; `?refresh=1` overrides it. */
export const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface SearchConsoleWeek {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Sunday, YYYY-MM-DD. */
  end: string;
  clicks: number;
  impressions: number;
  /** Clicks over impressions, 0..100 with one decimal; null with no impression. */
  ctr: number | null;
  /** Impression-weighted average position, one decimal; null with no impression. */
  position: number | null;
}

export interface SearchConsoleRow {
  /** The query as typed, or the page as a path relative to the site. */
  key: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

export interface SearchConsoleSitemap {
  path: string;
  submitted: number;
  indexed: number;
  /** ISO instants as Google returns them, or null when it has never happened. */
  last_submitted: string | null;
  last_downloaded: string | null;
  errors: number;
  warnings: number;
  is_pending: boolean;
}

/**
 * Google's verdict, folded to the three answers worth acting on.
 *
 * `indexed` = it is in the index. `not-indexed` = Google knows the URL and has
 * chosen not to index it (crawled-currently-not-indexed, a duplicate, an
 * excluded canonical) — a content or canonical problem. `unknown` = Google has
 * never heard of it, which is a discovery problem and a different fix.
 */
export type IndexState = 'indexed' | 'not-indexed' | 'unknown';

export interface SearchConsoleInspection {
  /** Path relative to the site, as the card prints it. */
  path: string;
  state: IndexState;
  /** Google's own sentence ("Submitted and indexed"), kept verbatim. */
  coverage: string | null;
  /** Date of the last crawl, YYYY-MM-DD, or null when never crawled. */
  last_crawled: string | null;
  /** Set when the inspection itself failed, e.g. "http_429". The other eight still stand. */
  error: string | null;
}

export interface SearchConsoleSummary {
  site: string;
  /** J-3: the last day Search Console is expected to have data for. */
  window_end: string;
  /** Four complete Monday→Sunday weeks, oldest first. */
  weeks: SearchConsoleWeek[];
  /** The window the two top lists are taken over. */
  top_window: { start: string; end: string };
  queries: SearchConsoleRow[];
  pages: SearchConsoleRow[];
  sitemaps: SearchConsoleSitemap[];
  inspections: SearchConsoleInspection[];
}

export interface CachedSummary {
  summary: SearchConsoleSummary;
  /** SQLite `datetime('now')` form, UTC. */
  fetched_at: string;
}

/** An upstream refusal, carrying Google's own status so the route can pass it on. */
export class SearchConsoleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SearchConsoleError';
  }
}

// ---------------------------------------------------------------------------
// Credentials and token
// ---------------------------------------------------------------------------

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/**
 * The service account, or null when the environment has none.
 *
 * Parsed on every call rather than at import: the variable is read in
 * production only, and a module that threw at import time on a malformed value
 * would take the whole API down for a dashboard card.
 */
export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GSC_SA_JSON;
  if (!raw || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
      return null;
    }
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

export function isSearchConsoleConfigured(): boolean {
  return serviceAccount() !== null;
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

/** In-memory access token, dropped a minute before Google would refuse it. */
let token: { value: string; expiresAt: number } | null = null;
/**
 * The exchange in flight. The calls of one reading start together (see
 * searchConsoleSummary): without this, each of the twelve would sign its own
 * JWT and exchange it, twelve tokens for one reading.
 */
let tokenInflight: Promise<string> | null = null;

/** Tests own the clock and the credential; they must also own this. */
export function resetSearchConsoleAuth(): void {
  token = null;
  tokenInflight = null;
}

function accessToken(now: number): Promise<string> {
  if (token && token.expiresAt > now) return Promise.resolve(token.value);
  if (!tokenInflight) {
    tokenInflight = exchangeToken(now).finally(() => {
      tokenInflight = null;
    });
  }
  return tokenInflight;
}

async function exchangeToken(now: number): Promise<string> {
  const key = serviceAccount();
  if (!key) throw new SearchConsoleError(0, 'not_configured');

  const iat = Math.floor(now / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  }).catch(() => null);
  if (!res) throw new SearchConsoleError(0, 'token_unreachable');
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  } | null;
  if (!res.ok || !body?.access_token) {
    throw new SearchConsoleError(res.status, `token_refused:${body?.error ?? res.status}`);
  }
  // A minute of margin: a token that expires while a request is in flight is a
  // 401 the caller reads as an authorisation problem.
  const ttl = Math.max(60, body.expires_in ?? 3600) * 1000;
  token = { value: body.access_token, expiresAt: now + ttl - 60_000 };
  return token.value;
}

async function google<T>(url: string, init: RequestInit, now: number): Promise<T> {
  const bearer = await accessToken(now);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${bearer}` },
  }).catch(() => null);
  if (!res) throw new SearchConsoleError(0, 'unreachable');
  if (!res.ok) {
    // A refused token is worth forgetting: the next call re-signs rather than
    // replaying the same rejected bearer for the next hour.
    if (res.status === 401) token = null;
    throw new SearchConsoleError(res.status, `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Dates, as strings — no local timezone anywhere
// ---------------------------------------------------------------------------

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayMs = (key: string): number => Date.parse(`${key}T00:00:00Z`);

/** The last day Search Console is expected to hold, given the two-to-three-day lag. */
export function windowEnd(now: Date): string {
  return dayKey(now.getTime() - LAG_DAYS * DAY_MS);
}

/**
 * The last `count` complete Monday→Sunday weeks ending on or before `end`.
 *
 * Complete is the load-bearing word: the week containing `end` is skipped
 * unless `end` is its Sunday. Four full weeks compare with each other; three
 * full weeks and a stub does not, and the stub is always the newest one — the
 * only column anybody looks at.
 */
export function completeWeeks(end: string, count = WEEKS): Array<{ start: string; end: string }> {
  // getUTCDay is 0 on a Sunday, which is also the number of days back to the
  // most recent Sunday from a Sunday: the same expression covers both cases.
  const lastSunday = dayMs(end) - new Date(dayMs(end)).getUTCDay() * DAY_MS;
  const weeks: Array<{ start: string; end: string }> = [];
  for (let i = count - 1; i >= 0; i--) {
    const sunday = lastSunday - i * 7 * DAY_MS;
    weeks.push({ start: dayKey(sunday - 6 * DAY_MS), end: dayKey(sunday) });
  }
  return weeks;
}

// ---------------------------------------------------------------------------
// The three calls
// ---------------------------------------------------------------------------

export interface AnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export type AnalyticsDimension = 'date' | 'query' | 'page';

export async function searchAnalytics(
  range: { startDate: string; endDate: string },
  dimension: AnalyticsDimension,
  rowLimit = 1000,
  now: number = Date.now(),
): Promise<AnalyticsRow[]> {
  const body = await google<{ rows?: AnalyticsRow[] }>(
    `${WEBMASTERS}/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...range, dimensions: [dimension], rowLimit }),
    },
    now,
  );
  return body.rows ?? [];
}

export async function sitemapStatus(now: number = Date.now()): Promise<SearchConsoleSitemap[]> {
  const body = await google<{
    sitemap?: Array<{
      path?: string;
      lastSubmitted?: string;
      lastDownloaded?: string;
      isPending?: boolean;
      errors?: string | number;
      warnings?: string | number;
      contents?: Array<{ submitted?: string | number; indexed?: string | number }>;
    }>;
  }>(`${WEBMASTERS}/sites/${encodeURIComponent(SITE_URL)}/sitemaps`, {}, now);

  // Google sends the counters as decimal STRINGS ("1394"), which add up as
  // concatenation the moment anyone forgets. Coerced once, here.
  const int = (v: string | number | undefined): number => {
    const n = typeof v === 'number' ? v : Number.parseInt(v ?? '0', 10);
    return Number.isFinite(n) ? n : 0;
  };
  return (body.sitemap ?? []).map((s) => ({
    path: s.path ?? '',
    submitted: (s.contents ?? []).reduce((n, c) => n + int(c.submitted), 0),
    indexed: (s.contents ?? []).reduce((n, c) => n + int(c.indexed), 0),
    last_submitted: s.lastSubmitted ?? null,
    last_downloaded: s.lastDownloaded ?? null,
    errors: int(s.errors),
    warnings: int(s.warnings),
    is_pending: s.isPending === true,
  }));
}

export interface IndexStatusResult {
  verdict?: string;
  coverageState?: string;
  lastCrawlTime?: string;
  indexingState?: string;
}

export async function inspect(url: string, now: number = Date.now()): Promise<IndexStatusResult> {
  const body = await google<{ inspectionResult?: { indexStatusResult?: IndexStatusResult } }>(
    INSPECT_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL }),
    },
    now,
  );
  return body.inspectionResult?.indexStatusResult ?? {};
}

// ---------------------------------------------------------------------------
// Derivations — everything a test can hold still
// ---------------------------------------------------------------------------

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Daily rows folded into the given weeks.
 *
 * CTR is recomputed from the totals and position is weighted by impressions,
 * neither is averaged from the daily values. Google's per-day `position` is
 * itself an average over that day's impressions, so a plain mean would give a
 * Tuesday with four impressions the same weight as a Monday with four hundred
 * — and the number that moves the most is exactly the quiet day.
 */
export function weeklySeries(
  rows: readonly AnalyticsRow[],
  weeks: ReadonlyArray<{ start: string; end: string }>,
): SearchConsoleWeek[] {
  return weeks.map((w) => {
    let clicks = 0;
    let impressions = 0;
    let weighted = 0;
    for (const r of rows) {
      const day = r.keys?.[0];
      if (!day || day < w.start || day > w.end) continue;
      const imp = r.impressions ?? 0;
      clicks += r.clicks ?? 0;
      impressions += imp;
      weighted += (r.position ?? 0) * imp;
    }
    return {
      start: w.start,
      end: w.end,
      clicks,
      impressions,
      // No impression is not "0 % and rank 0": it is nothing to divide by.
      ctr: impressions > 0 ? round1((clicks / impressions) * 100) : null,
      position: impressions > 0 ? round1(weighted / impressions) : null,
    };
  });
}

/** A page URL as the card prints it: the site's own origin dropped, `/` kept. */
export function relativePath(url: string): string {
  if (url === SITE_ORIGIN) return '/';
  // The origin has to END there, hence the slash in the prefix. Without it,
  // `https://ibanforge.com.evil.example/x` starts with the origin and would be
  // printed as the path `.evil.example/x`: a foreign host wearing our own
  // site's clothes on an operator screen. Google only returns URLs inside the
  // verified property, so this is a guard against the day it stops being
  // true, not against today.
  if (!url.startsWith(`${SITE_ORIGIN}/`)) return url;
  return url.slice(SITE_ORIGIN.length);
}

/** Analytics rows for the `query` / `page` dimensions, ranked as Google ranked them. */
export function topRows(
  rows: readonly AnalyticsRow[],
  dimension: 'query' | 'page',
  limit = TOP_ROWS,
): SearchConsoleRow[] {
  const out: SearchConsoleRow[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const raw = r.keys?.[0];
    if (typeof raw !== 'string') continue;
    out.push({
      key: dimension === 'page' ? relativePath(raw) : raw,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      position: (r.impressions ?? 0) > 0 ? round1(r.position ?? 0) : null,
    });
  }
  return out;
}

/**
 * Google's verdict and coverage sentence folded to the three states.
 *
 * `verdict` alone is not enough: a URL Google has never seen and a URL it
 * crawled and refused both come back NEUTRAL, and those are opposite problems
 * with opposite fixes. The coverage sentence is the only field that separates
 * them, so it is read — case-insensitively, because it is prose.
 */
export function indexStateOf(result: IndexStatusResult | null): IndexState {
  if (!result || (!result.verdict && !result.coverageState)) return 'unknown';
  if (result.verdict === 'PASS') return 'indexed';
  const coverage = (result.coverageState ?? '').toLowerCase();
  if (coverage.includes('unknown to google') || coverage === '') return 'unknown';
  return 'not-indexed';
}

// ---------------------------------------------------------------------------
// The assembled reading
// ---------------------------------------------------------------------------

/**
 * One witness. One that fails must not cost the other seven, nor the four
 * weeks: the inspection quota is per day and shared with nothing else, so a
 * 429 here is a partial reading, not a broken one.
 */
async function inspectWitness(path: string, at: number): Promise<SearchConsoleInspection> {
  try {
    const result = await inspect(`${SITE_ORIGIN}${path}`, at);
    return {
      path,
      state: indexStateOf(result),
      coverage: result.coverageState ?? null,
      last_crawled: result.lastCrawlTime ? result.lastCrawlTime.slice(0, 10) : null,
      error: null,
    };
  } catch (err) {
    return {
      path,
      state: 'unknown',
      coverage: null,
      last_crawled: null,
      error: err instanceof SearchConsoleError ? err.message : 'failed',
    };
  }
}

/**
 * One reading of the property: four weeks, two top lists, the sitemap, eight
 * witnesses. Twelve calls to Google, of which eight are inspections.
 */
export async function searchConsoleSummary(now: Date = new Date()): Promise<SearchConsoleSummary> {
  const at = now.getTime();
  const end = windowEnd(now);
  const weeks = completeWeeks(end);
  const topStart = dayKey(dayMs(end) - (TOP_WINDOW_DAYS - 1) * DAY_MS);
  const topWindow = { start: topStart, end };

  // Every call starts at once (30.09.2026). One after the other, the twelve
  // calls of a reading took 53 to 59 seconds (request_log, a week of them), the
  // eight inspections being the slow ones, and the dashboard waited for all of
  // them. Same calls, same quota, same order in the result.
  const topRange = { startDate: topWindow.start, endDate: topWindow.end };
  const [daily, queries, pages, sitemaps, inspections] = await Promise.all([
    searchAnalytics(
      { startDate: weeks[0].start, endDate: weeks[weeks.length - 1].end },
      'date',
      1000,
      at,
    ),
    searchAnalytics(topRange, 'query', TOP_ROWS, at),
    searchAnalytics(topRange, 'page', TOP_ROWS, at),
    sitemapStatus(at),
    Promise.all(WITNESS_PATHS.map((path) => inspectWitness(path, at))),
  ]);

  return {
    site: SITE_URL,
    window_end: end,
    weeks: weeklySeries(daily, weeks),
    top_window: topWindow,
    queries: topRows(queries, 'query'),
    pages: topRows(pages, 'page'),
    sitemaps,
    inspections,
  };
}

// ---------------------------------------------------------------------------
// Persistent cache — one row, six hours
// ---------------------------------------------------------------------------

let ready = false;
function ensureTable(): void {
  if (ready) return;
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS search_console_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ready = true;
}

/** Tests that swap the stats database out from under us must be able to say so. */
export function resetSearchConsoleCache(): void {
  ready = false;
}

/** The last reading that landed, or null when none ever has. */
export function cachedSummary(): CachedSummary | null {
  ensureTable();
  const row = getStatsDB()
    .prepare('SELECT payload, fetched_at FROM search_console_cache WHERE id = 1')
    .get() as { payload: string; fetched_at: string } | undefined;
  if (!row) return null;
  try {
    return { summary: JSON.parse(row.payload) as SearchConsoleSummary, fetched_at: row.fetched_at };
  } catch {
    // A payload we cannot read is the same as no payload; the next refresh
    // replaces it. Never let a stored string throw on a dashboard render.
    return null;
  }
}

/**
 * The `datetime('now')` form, produced from a Date we were handed.
 *
 * Written rather than defaulted so the stamp comes from the SAME clock the age
 * check reads. Letting SQLite stamp the row and a JavaScript Date measure it
 * is two clocks agreeing by luck, and it makes the refresh cadence impossible
 * to hold still under test.
 */
const sqlStamp = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

function storeSummary(summary: SearchConsoleSummary, now: Date): CachedSummary {
  ensureTable();
  const fetched_at = sqlStamp(now);
  getStatsDB()
    .prepare(
      `INSERT INTO search_console_cache (id, payload, fetched_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(JSON.stringify(summary), fetched_at);
  return { summary, fetched_at };
}

/** Age of a stored reading in ms, or Infinity when the stamp cannot be read. */
export function cacheAgeMs(fetchedAt: string, now: Date): number {
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(fetchedAt)
    ? fetchedAt.replace(' ', 'T')
    : `${fetchedAt.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : now.getTime() - t;
}

/** What a refresh that failed left behind: when, and Google's status. */
export interface SearchConsoleFailure {
  at: number;
  status: number;
}

/** What the route serves: a stored reading, and what is happening to it. */
export interface SearchConsoleReading extends CachedSummary {
  /** A refresh is running in the background; the next open gets its result. */
  refreshing: boolean;
  /** The last refresh failed after this reading landed (the card says so). */
  failure: SearchConsoleFailure | null;
}

/** After a failed refresh, the next background attempt waits this long. */
export const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000;

let inflight: Promise<CachedSummary> | null = null;
let lastFailure: SearchConsoleFailure | null = null;

/** Tests that run refreshes must start from a quiet module. */
export function resetSearchConsoleRefresh(): void {
  inflight = null;
  lastFailure = null;
}

/**
 * The one refresh in flight, started if there is none. Two opens during a
 * refresh share it: on 30.09.2026 three reloads in one minute each paid a full
 * reading, three times the inspection quota for one answer.
 */
function refreshOnce(now: Date): Promise<CachedSummary> {
  if (!inflight) {
    inflight = searchConsoleSummary(now)
      .then((summary) => {
        lastFailure = null;
        return storeSummary(summary, now);
      })
      .catch((err: unknown) => {
        lastFailure = {
          at: now.getTime(),
          status: err instanceof SearchConsoleError ? err.status : 0,
        };
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** A background refresh whose failure is logged, never thrown at nobody. */
function refreshInBackground(now: Date): void {
  if (inflight) return;
  refreshOnce(now).catch((err: unknown) => {
    console.warn(
      'Search Console refresh failed:',
      err instanceof Error ? err.message : String(err),
    );
  });
}

/** True when a failure is too recent for another background attempt. */
function backingOff(now: Date): boolean {
  return lastFailure !== null && now.getTime() - lastFailure.at < RETRY_AFTER_FAILURE_MS;
}

/**
 * The reading the route serves, without ever making the dashboard wait for
 * Google once a reading exists.
 *
 * Under six hours old, the stored reading as is. Older, the stored reading AT
 * ONCE, and a refresh started behind it for the next open: until 30.09.2026 the
 * first open after six hours waited for the whole reading, 53 to 59 seconds,
 * and the growth view of the dashboard with it. Only the very first reading
 * (nothing stored yet) and `refresh` wait for Google.
 *
 * Google is still asked at most four times a day per instance, whatever the
 * number of dashboard opens — thirty-two of the two thousand daily
 * inspections: one refresh at a time, none within half an hour of a failure.
 */
export async function readSearchConsole({
  refresh = false,
  now = new Date(),
}: { refresh?: boolean; now?: Date } = {}): Promise<SearchConsoleReading> {
  if (!refresh) {
    const cached = cachedSummary();
    if (cached) {
      const young = cacheAgeMs(cached.fetched_at, now) < CACHE_MAX_AGE_MS;
      if (!young && !backingOff(now)) refreshInBackground(now);
      return {
        ...cached,
        refreshing: inflight !== null,
        failure: young ? null : lastFailure,
      };
    }
  }
  const fresh = await refreshOnce(now);
  return { ...fresh, refreshing: false, failure: null };
}

/**
 * The hourly warm-up (src/index.ts): a reading past six hours is refreshed
 * before anyone opens the dashboard, so the morning open finds this morning's
 * reading rather than last night's. Same budget as the opens: nothing happens
 * under six hours, during a refresh, or within half an hour of a failure.
 */
export function warmSearchConsole(now: Date = new Date()): void {
  if (!isSearchConsoleConfigured() || inflight || backingOff(now)) return;
  const cached = cachedSummary();
  if (cached && cacheAgeMs(cached.fetched_at, now) < CACHE_MAX_AGE_MS) return;
  refreshInBackground(now);
}
