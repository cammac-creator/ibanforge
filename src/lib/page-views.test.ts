import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/** A hermetic statistics database: these tests count rows on today's date. */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-page-views-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  process.env.SITE_ADMIN_TOKEN = 'test-site-key-page-views-0123456789';
  return path;
});

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import {
  MAX_BATCH_ITEMS,
  PAGE_TEMPLATES,
  STORED_PAGES,
  pageViewsSummary,
  parsePageViewBatch,
} from './page-views.js';
import { closeAll, getStatsDB } from './db.js';
import { resetWebEventLimiter } from '../routes/web-events.js';

afterAll(() => {
  closeAll();
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

const KEY = 'test-site-key-page-views-0123456789';
const app = buildApp();
const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function count(table: string): number {
  try {
    return (getStatsDB().prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  } catch {
    return 0; // web_events is created on first use: an absent table is an empty one
  }
}
function rows() {
  return getStatsDB()
    .prepare('SELECT day, page, locale, count FROM page_views_daily ORDER BY page, locale')
    .all() as Array<{ day: string; page: string; locale: string; count: number }>;
}
function batch(items: unknown, headers: Record<string, string> = { 'X-Admin-Secret': KEY }) {
  return app.request('/v1/admin/page-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.20', ...headers },
    body: JSON.stringify({ items }),
  });
}

beforeEach(() => {
  getStatsDB().prepare('DELETE FROM page_views_daily').run();
  resetWebEventLimiter();
});

describe('page_views_daily schema', () => {
  it('holds exactly day, page, locale, count: no key, IP, agent, time or referrer', () => {
    const cols = (
      getStatsDB().prepare('PRAGMA table_info(page_views_daily)').all() as Array<{ name: string }>
    )
      .map((c) => c.name)
      .sort();
    expect(cols).toEqual(['count', 'day', 'locale', 'page']);
  });
});

describe('the closed list of page templates', () => {
  it('is the list the site files its paths under, word for word', () => {
    const site = readFileSync(
      join(import.meta.dirname, '..', '..', 'frontend', 'lib', 'page-template.ts'),
      'utf8',
    );
    const block = /export const PAGE_TEMPLATES = \[([\s\S]*?)\] as const;/.exec(site)![1]!;
    const siteList = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(siteList.length).toBeGreaterThan(40);
    expect(siteList).toEqual([...PAGE_TEMPLATES]);
  });
});

describe('parsePageViewBatch', () => {
  const ok = { page: '/pricing', locale: 'en', count: 3 };
  it('keeps a well-formed batch and nothing else of its items', () => {
    expect(parsePageViewBatch({ items: [{ ...ok, ip: '203.0.113.1', ua: 'x' }] })).toEqual([ok]);
  });
  it('refuses a page off the list, a bad locale or a bad count, whole', () => {
    for (const bad of [
      { ...ok, page: '/blz/37040044' },
      { ...ok, page: '/pricing?a=1' },
      { ...ok, locale: 'es' },
      { ...ok, count: 0 },
      { ...ok, count: 1.5 },
      { ...ok, count: '2' },
      { ...ok, count: 1_000_000 },
    ]) {
      expect(parsePageViewBatch({ items: [ok, bad] }), JSON.stringify(bad)).toBeNull();
    }
    expect(parsePageViewBatch({ items: [] })).toBeNull();
    expect(parsePageViewBatch({})).toBeNull();
    expect(parsePageViewBatch({ items: Array(MAX_BATCH_ITEMS + 1).fill(ok) })).toBeNull();
  });
});

describe('POST /v1/admin/page-views', () => {
  it('adds a batch by template, day and locale', async () => {
    const today = (getStatsDB().prepare("SELECT date('now') AS d").get() as { d: string }).d;
    expect(
      (
        await batch([
          { page: '/blz/:code', locale: 'de', count: 2 },
          { page: '/pricing', locale: 'en', count: 1 },
        ])
      ).status,
    ).toBe(204);
    expect((await batch([{ page: '/pricing', locale: 'en', count: 4 }])).status).toBe(204);
    expect(rows()).toEqual([
      { day: today, page: '/blz/:code', locale: 'de', count: 2 },
      { day: today, page: '/pricing', locale: 'en', count: 5 },
    ]);
  });

  it('refuses without the key, with a wrong key and with a page off the list; writes nothing', async () => {
    expect((await batch([{ page: '/pricing', locale: 'en', count: 1 }], {})).status).toBe(401);
    expect(
      (await batch([{ page: '/pricing', locale: 'en', count: 1 }], { 'X-Admin-Secret': 'nope' }))
        .status,
    ).toBe(401);
    expect((await batch([{ page: '/some/free/path', locale: 'en', count: 1 }])).status).toBe(400);
    expect(rows()).toEqual([]);
  });

  it('stores only templates of the closed list', async () => {
    await batch(PAGE_TEMPLATES.slice(0, 5).map((page) => ({ page, locale: 'fr', count: 1 })));
    await batch([{ page: 'autre', locale: 'en', count: 1 }]);
    for (const r of rows()) expect(STORED_PAGES).toContain(r.page);
  });

  it('adds up in the summary, numbers only', async () => {
    await batch([
      { page: '/pricing', locale: 'en', count: 2 },
      { page: '/pricing', locale: 'fr', count: 1 },
      { page: '/', locale: 'en', count: 1 },
    ]);
    const s = pageViewsSummary(30);
    expect(s.total).toBe(4);
    expect(s.by_page).toEqual([
      { page: '/pricing', count: 3 },
      { page: '/', count: 1 },
    ]);
    expect(Object.keys(s).sort()).toEqual(['by_page', 'by_page_day', 'days', 'since', 'total']);
  });
});

describe('the whole application, telemetry middleware included', () => {
  it('leaves request_log untouched by a batch, and writes one admin_calls line per batch, not per view', async () => {
    const log = count('request_log');
    const calls = count('admin_calls');
    // ten views in a single batch, as the site sends them
    expect(
      (
        await batch([
          { page: '/pricing', locale: 'en', count: 4 },
          { page: '/', locale: 'fr', count: 3 },
          { page: '/blz/:code', locale: 'de', count: 3 },
        ])
      ).status,
    ).toBe(204);
    expect(count('request_log')).toBe(log);
    expect(count('admin_calls')).toBe(calls + 1);
    expect(rows().reduce((n, r) => n + r.count, 0)).toBe(10);
  });

  it('refuses a view posted to the public route like any unknown name, and counts nothing', async () => {
    const before = count('web_events');
    const res = await app.request('/v1/web/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': BROWSER,
        'X-Forwarded-For': '203.0.113.9',
      },
      body: JSON.stringify({ name: 'view:page', page: '/pricing', locale: 'en' }),
    });
    expect(res.status).toBe(400);
    expect(rows()).toEqual([]);
    expect(count('web_events')).toBe(before);
  });

  it('a refused public post is logged as before this lot: the route is not in SKIP_TRACKING', async () => {
    // What the telemetry already did for ANY refused event before the visit counter: one
    // request_log line with the hashed address and the agent. The counter adds nothing to it.
    const log = count('request_log');
    await app.request('/v1/web/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': BROWSER,
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({ name: 'nope:nope', page: '/pricing', locale: 'en' }),
    });
    const afterUnknown = count('request_log');
    await app.request('/v1/web/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': BROWSER,
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({ name: 'view:page', page: '/pricing', locale: 'en' }),
    });
    // a view is traced exactly like an unknown event: the same single line
    expect(count('request_log') - afterUnknown).toBe(afterUnknown - log);
  });
});
