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
 * ## The signal never leaves the site
 *
 * The visitor's browser reports a view to the SITE, on its own origin (`POST /api/pv`,
 * frontend/app/api/pv/route.ts), never to this API: a direct call would put the visitor's
 * address in this API's request log (`recordRequest`, twelve months) and in its host's
 * journal. The site files the path under its template, drops robots, Do Not Track and
 * Global Privacy Control without keeping or logging anything, adds up what it keeps in
 * memory, and every 45 seconds sends THIS API one batch, server to server:
 * `POST /v1/admin/page-views` with `{items: [{page, locale, count}]}`, behind
 * `authorizeAdmin` and the site's key (`SITE_ADMIN_TOKEN`). The batch carries no address,
 * no agent and no header of any visitor. The route is in `SKIP_TRACKING` (src/app.ts), so it
 * leaves nothing in `request_log`; the door writes one `admin_calls` line per batch, which
 * is the site's own call, not a visitor's.
 *
 * Nobody can post a view to the public `POST /v1/web/events` any more: the event
 * `view:page` is refused there like any unknown name. This route still checks the template
 * and the language against the closed lists, so the key of the site cannot write a path.
 */
import type Database from 'better-sqlite3';
import { getStatsDB } from './db.js';

/** What is filed when a path matches no page of the site. */
export const OTHER_PAGE = 'autre';

/**
 * The closed list of page templates, drawn from the routes of the site
 * (`frontend/app/[locale]/**` minus the dashboard and the family page, which render without
 * the beacon). A segment written `:name` stands for any one segment of the path; nothing the
 * visitor typed is ever stored. The site files a path under these templates itself
 * (frontend/lib/page-views.ts keeps the same list); `page-views.test.ts` holds the two lists
 * equal and the site's test compares its list with the routes on disk.
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

export const PAGE_VIEW_LOCALES = ['en', 'fr', 'de'] as const;

/** Most items one batch may carry: the closed list times the languages, with room to spare. */
export const MAX_BATCH_ITEMS = 200;
/** Most views one item may add: a site that batches for a minute sees far fewer. */
export const MAX_ITEM_COUNT = 100_000;

export interface PageViewItem {
  page: string;
  locale: string;
  count: number;
}

/**
 * The batch a site sends, validated against the closed lists: every page a template of
 * `STORED_PAGES`, every locale one of the three, every count a whole number from 1 up. Null
 * as soon as one item is wrong: nothing is half-written. Whatever else an item or the body
 * carries is ignored, never stored.
 */
export function parsePageViewBatch(raw: unknown): PageViewItem[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const items = (raw as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH_ITEMS) return null;
  const out: PageViewItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const o = item as Record<string, unknown>;
    if (typeof o.page !== 'string' || !STORED_PAGES.includes(o.page)) return null;
    if (
      typeof o.locale !== 'string' ||
      !(PAGE_VIEW_LOCALES as readonly string[]).includes(o.locale)
    )
      return null;
    if (
      !Number.isInteger(o.count) ||
      (o.count as number) < 1 ||
      (o.count as number) > MAX_ITEM_COUNT
    )
      return null;
    out.push({ page: o.page, locale: o.locale, count: o.count as number });
  }
  return out;
}

/** One statement per open database: a reopened database gets its own. */
const upserts = new WeakMap<Database.Database, Database.Statement>();

function upsertFor(db: Database.Database): Database.Statement {
  let stmt = upserts.get(db);
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO page_views_daily (day, page, locale, count)
      VALUES (date('now'), ?, ?, ?)
      ON CONFLICT(day, page, locale) DO UPDATE SET count = count + excluded.count
    `);
    upserts.set(db, stmt);
  }
  return stmt;
}

/**
 * Add a batch, in one transaction. Never throws: a broken statistics database must not turn a
 * batch into an error for the site, which would only retry. False when the write failed.
 */
export function recordPageViews(items: readonly PageViewItem[]): boolean {
  try {
    const db = getStatsDB();
    const stmt = upsertFor(db);
    db.transaction(() => {
      for (const { page, locale, count } of items) stmt.run(page, locale, count);
    })();
    return true;
  } catch (err) {
    console.error(
      '[stats] recordPageViews failed:',
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
