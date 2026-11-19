/**
 * 🚨 NEVER JOINED, NEVER CROSSED. `page_views_daily` is not joined or crossed with `operations`,
 * `request_log`, `api_keys`, `web_events` or any table that carries a key, an IP address, a
 * referrer or a time — not in SQL, not in a script, not in a page. The two are read
 * separately. `answer-sources-isolation.test.ts` holds the SQL of `src/`, `scripts/` and
 * `frontend/` to it, for this table as for `answer_sources_daily`.
 *
 * The visit counter of the site: one page, one day, one number (Claude-Alain's decision of
 * 19 November 2026, "Le compteur, et deux phrases"; the "visit counter without a cookie" he
 * had agreed to on 10 November).
 *
 * ## What a row carries, and what it never carries
 *
 * `page_views_daily (day, page, locale, count)`, primary key `(day, page, locale)`, bumped by
 * upsert. `day` is the UTC date alone; `page` is a TEMPLATE from the closed list below, never
 * a path copied from a request (`/blz/37040044` is stored as `/blz/:code`); `locale` is one
 * of `en`, `fr`, `de`. A row NEVER carries an IP address or its hash, a user agent, a cookie,
 * a visitor or session identifier, a time of day (no `created_at`, which would store the hour
 * of the first view of the day), a query string or fragment, an API key or its prefix, an
 * IBAN, a BIC, a bank code, nor the referring site: the provenance is deliberately NOT kept,
 * the promise made to Claude-Alain being "a page, a day, a number". `page-views.test.ts`
 * holds the exact column list and that every stored page belongs to the closed list.
 *
 * It is a count of PAGE VIEWS, not of people: with no cookie and no identifier, a reader who
 * opens ten pages, or one page ten times, is ten views. Nothing here can tell.
 *
 * It is deliberately NOT in `PAID_STATE_TABLES` (src/lib/paid-state.ts): no paying customer
 * needs it back, like `daily_stats`. It lives in `stats.sqlite`, whose schema is migrated by
 * `migratePageViews` (src/lib/db.ts).
 *
 * ## One circuit, not two
 *
 * The browser reports a view through the SAME endpoint as the clicks of the page,
 * `POST /v1/web/events` (src/routes/web-events.ts): same `sendBeacon`, same body limit, same
 * per-address rate limit, same 204. The view has its own event name, `view:page`, which the
 * `web_events` table never stores: that table keeps a time and a referring host, which this
 * counter must not. The raw path travels in the request and dies in the handler.
 */
import type Database from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { INTERNAL_TOOL_UA_PREFIX } from './stats.js';

/** The event name the browser sends for a page view. Not accepted by `parseWebEvent`. */
export const PAGE_VIEW_EVENT = 'view:page';

/** What is filed when a path matches no page of the site. */
export const OTHER_PAGE = 'autre';

/**
 * The closed list of page templates, drawn from the routes of the site
 * (`frontend/app/[locale]/**` minus the dashboard and the family page, which render without
 * the beacon). A segment written `:name` stands for any one segment of the path; nothing the
 * visitor typed is ever stored. `page-views.test.ts` compares this list with the routes on
 * disk, so a new page of the site fails the test until it is listed here.
 */
export const PAGE_TEMPLATES = [
  '/',
  '/account',
  '/agents',
  '/alternatives',
  '/alternatives/:vendor',
  '/at',
  '/at/:code',
  '/audit',
  '/audit/done',
  '/be',
  '/be/:code',
  '/blog',
  '/blog/:slug',
  '/blz',
  '/blz/:code',
  '/changelog',
  '/clearing-calendar/:year',
  '/compare',
  '/device',
  '/docs',
  '/docs/:slug',
  '/iban',
  '/iban/:cc',
  '/iban-api-deutschland',
  '/iban-validation-api',
  '/iban-welche-bank',
  '/iid',
  '/iid/:iid',
  '/it',
  '/it/:code',
  '/legal',
  '/legal/:slug',
  '/openapi',
  '/playground',
  '/pricing',
  '/sheets',
  '/sk',
  '/sk/:code',
  '/sm',
  '/sm/:code',
  '/sources',
  '/status',
  '/tools',
  '/tools/qr-bill',
  '/tools/test-iban',
  '/trust',
  '/vendors',
] as const;

export type PageTemplate = (typeof PAGE_TEMPLATES)[number] | typeof OTHER_PAGE;

/** Every value the `page` column may hold. */
export const STORED_PAGES: readonly string[] = [...PAGE_TEMPLATES, OTHER_PAGE];

const LOCALES = new Set(['en', 'fr', 'de']);

/** A pathname as `location.pathname` writes it: no query, no fragment, short. */
const PATHNAME = /^\/[A-Za-z0-9._~\-/%]{0,119}$/;

const SEGMENT = /^[^/]+$/;

/**
 * The template of a path, or `autre`. The locale prefix (`/fr`, `/de`; English has none)
 * is dropped first. A path that is not a plain pathname (a query, a fragment, odd
 * characters) is `autre`, whatever follows.
 */
export function pageTemplate(path: string): PageTemplate {
  if (!PATHNAME.test(path)) return OTHER_PAGE;
  const parts = path.split('/').slice(1);
  if (parts.length > 0 && LOCALES.has(parts[0]!)) parts.shift();
  // a trailing slash names the same page
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  if (parts.some((p) => p === '')) return OTHER_PAGE;
  for (const template of PAGE_TEMPLATES) {
    const want = template === '/' ? [] : template.split('/').slice(1);
    if (want.length !== parts.length) continue;
    if (want.every((w, i) => (w.startsWith(':') ? SEGMENT.test(parts[i]!) : w === parts[i]))) {
      return template;
    }
  }
  return OTHER_PAGE;
}

export interface PageView {
  page: PageTemplate;
  locale: string;
}

/**
 * The browser's payload for a view, validated: a pathname and a locale, nothing else is
 * read (a referrer, a viewport or any other field the body carries is ignored, not stored).
 * Null when the body is not a well-formed view.
 */
export function parsePageView(raw: unknown): PageView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.name !== PAGE_VIEW_EVENT) return null;
  const locale = typeof o.locale === 'string' ? o.locale.trim() : '';
  const page = typeof o.page === 'string' ? o.page.trim() : '';
  if (!LOCALES.has(locale) || !PATHNAME.test(page)) return null;
  return { page: pageTemplate(page), locale };
}

/**
 * A request that must not be counted: the browser asks not to be tracked (`DNT: 1`, the
 * Global Privacy Control `Sec-GPC: 1`), or it is a script or a crawler that says so. The
 * agent is read to decide and thrown away; it is never stored. The page also keeps silent
 * for driven browsers (frontend/components/forge/cta-beacon.tsx): this is the second net.
 */
const AUTOMATED_AGENT =
  /bot|crawl|spider|slurp|headless|lighthouse|phantom|selenium|playwright|puppeteer|curl\/|wget|python|node-fetch|undici|axios|go-http|java\/|libwww|okhttp|httpclient/i;

export function shouldSkipView(headers: {
  dnt?: string | undefined;
  secGpc?: string | undefined;
  userAgent?: string | undefined;
}): boolean {
  if (headers.dnt === '1' || headers.secGpc === '1') return true;
  const ua = headers.userAgent ?? '';
  if (!ua) return true; // a real browser always names itself
  if (ua.toLowerCase().startsWith(INTERNAL_TOOL_UA_PREFIX)) return true;
  return AUTOMATED_AGENT.test(ua);
}

/** One statement per open database: a reopened database gets its own. */
const upserts = new WeakMap<Database.Database, Database.Statement>();

function upsertFor(db: Database.Database): Database.Statement {
  let stmt = upserts.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO page_views_daily (day, page, locale, count)
      VALUES (date('now'), ?, ?, 1)
      ON CONFLICT(day, page, locale) DO UPDATE SET count = count + 1
    `);
    upserts.set(db, stmt);
  }
  return stmt;
}

/** Count one view. Never throws: a broken statistics database must not answer the browser with an error. */
export function recordPageView(view: PageView): boolean {
  try {
    upsertFor(getStatsDB()).run(view.page, view.locale);
    return true;
  } catch (err) {
    console.error(
      '[stats] recordPageView failed:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

export interface PageViewsSummary {
  days: number;
  /** First UTC day of the window, today included in it. */
  since: string;
  /** Page views, never people. */
  total: number;
  /** Per page template over the window, the busiest first. */
  by_page: Array<{ page: string; count: number }>;
  /** Per page template and UTC day, oldest day first. */
  by_page_day: Array<{ day: string; page: string; count: number }>;
}

/** The counts of the last `days` calendar days in UTC, today included. Numbers and templates only. */
export function pageViewsSummary(days: number): PageViewsSummary {
  const db = getStatsDB();
  const back = `-${Math.max(0, days - 1)} days`;
  const { since } = db.prepare(`SELECT date('now', ?) AS since`).get(back) as { since: string };
  const byPage = db
    .prepare(
      `SELECT page, SUM(count) AS count FROM page_views_daily
        WHERE day >= ? GROUP BY page ORDER BY count DESC, page`,
    )
    .all(since) as Array<{ page: string; count: number }>;
  const byPageDay = db
    .prepare(
      `SELECT day, page, SUM(count) AS count FROM page_views_daily
        WHERE day >= ? GROUP BY day, page ORDER BY day, page`,
    )
    .all(since) as Array<{ day: string; page: string; count: number }>;
  return {
    days,
    since,
    total: byPage.reduce((n, r) => n + r.count, 0),
    by_page: byPage,
    by_page_day: byPageDay,
  };
}
