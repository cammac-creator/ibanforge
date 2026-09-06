import { getStatsDB } from './db.js';

/**
 * What visitors do on the landing page, counted, never identified.
 *
 * Audit of 2026-09-05 (n° 32): the page carried six calls to action and no
 * measurement, so the question "which door do people take" had no answer.
 * The browser sends one line per click on a tagged element and two for the
 * film (first pin, last station). A line holds an event name, a page path,
 * a locale, the referring host and a width class: nothing that names a
 * person, no cookie, no identifier, and rows older than ninety days are
 * pruned as new ones arrive. The privacy page promises self-deleting
 * telemetry; this table keeps the promise structurally.
 */
export interface WebEvent {
  name: string;
  page: string;
  locale: string;
  referrer: string | null;
  viewport: string | null;
}

/**
 * A name is a door family and a slug: `cta:try`, `nav:key`, `film:end`.
 * Restricted on 2026-09-06: the first day of measurement was mostly our own
 * deployment checks posting `probe:*` lines. The page owns the vocabulary
 * (`data-evt` attributes and the two film marks); the API refuses the rest.
 */
const NAME = /^(nav|cta|film):[a-z0-9][a-z0-9-]{0,31}$/;
const PAGE = /^\/[A-Za-z0-9._~\-/%]{0,119}$/;
const HOST = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const LOCALES = new Set(['en', 'fr', 'de']);
const VIEWPORTS = new Set(['phone', 'tablet', 'desktop']);
export const RETENTION_DAYS = 90;

let ready = false;
function ensureTable() {
  if (ready) return;
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS web_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      page TEXT NOT NULL,
      locale TEXT NOT NULL,
      referrer TEXT,
      viewport TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_web_events_created ON web_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_web_events_name ON web_events(name, created_at);
  `);
  ready = true;
}

/** The browser's payload, validated field by field; anything else is null or refused. */
export function parseWebEvent(raw: unknown): WebEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const text = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const name = text('name');
  const page = text('page');
  const locale = text('locale');
  if (!NAME.test(name) || !PAGE.test(page) || !LOCALES.has(locale)) return null;
  const referrer = text('referrer').toLowerCase();
  const viewport = text('viewport');
  return {
    name,
    page,
    locale,
    referrer: HOST.test(referrer) ? referrer : null,
    viewport: VIEWPORTS.has(viewport) ? viewport : null,
  };
}

let sinceLastPrune = 0;
export function recordWebEvent(event: WebEvent): void {
  ensureTable();
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO web_events (name, page, locale, referrer, viewport) VALUES (?, ?, ?, ?, ?)`,
  ).run(event.name, event.page, event.locale, event.referrer, event.viewport);
  // every few hundred rows, let the old ones go
  if (++sinceLastPrune >= 200) {
    sinceLastPrune = 0;
    db.prepare(`DELETE FROM web_events WHERE created_at < datetime('now', ?)`).run(
      `-${RETENTION_DAYS} days`,
    );
  }
}

export interface WebEventsSummary {
  days: number;
  since: string | null;
  total: number;
  by_name: Array<{ name: string; count: number }>;
  by_page: Array<{ page: string; locale: string; count: number }>;
  by_referrer: Array<{ referrer: string; count: number }>;
  by_day: Array<{ day: string; count: number }>;
}

/** Counts over the last `days`, for the operator's dashboard. */
export function webEventsSummary(days: number): WebEventsSummary {
  ensureTable();
  const db = getStatsDB();
  const w = `created_at >= datetime('now', ?)`;
  const arg = `-${days} days`;
  const total = (
    db.prepare(`SELECT count(*) AS n FROM web_events WHERE ${w}`).get(arg) as { n: number }
  ).n;
  const since = (
    db.prepare(`SELECT min(created_at) AS t FROM web_events WHERE ${w}`).get(arg) as {
      t: string | null;
    }
  ).t;
  return {
    days,
    since,
    total,
    by_name: db
      .prepare(
        `SELECT name, count(*) AS count FROM web_events WHERE ${w} GROUP BY name ORDER BY count DESC`,
      )
      .all(arg) as WebEventsSummary['by_name'],
    by_page: db
      .prepare(
        `SELECT page, locale, count(*) AS count FROM web_events WHERE ${w} GROUP BY page, locale ORDER BY count DESC LIMIT 40`,
      )
      .all(arg) as WebEventsSummary['by_page'],
    by_referrer: db
      .prepare(
        `SELECT referrer, count(*) AS count FROM web_events WHERE ${w} AND referrer IS NOT NULL GROUP BY referrer ORDER BY count DESC LIMIT 40`,
      )
      .all(arg) as WebEventsSummary['by_referrer'],
    by_day: db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, count(*) AS count FROM web_events WHERE ${w} GROUP BY day ORDER BY day`,
      )
      .all(arg) as WebEventsSummary['by_day'],
  };
}
