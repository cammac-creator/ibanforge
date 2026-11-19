import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/** A hermetic statistics database: these tests count rows on today's date. */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-page-views-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import {
  OTHER_PAGE,
  PAGE_TEMPLATES,
  STORED_PAGES,
  pageTemplate,
  pageViewsSummary,
  parsePageView,
  shouldSkipView,
} from './page-views.js';
import { getStatsDB } from './db.js';
import { webEvents, resetWebEventLimiter } from '../routes/web-events.js';

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

beforeEach(() => {
  getStatsDB().prepare('DELETE FROM page_views_daily').run();
  // web_events is created on first use: an absent table is an empty one
  try {
    getStatsDB().prepare('DELETE FROM web_events').run();
  } catch {
    /* not created yet */
  }
  resetWebEventLimiter();
});

const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function app() {
  const a = new Hono();
  a.route('/', webEvents);
  return a;
}
function post(body: unknown, headers: Record<string, string> = {}) {
  return app().request('/v1/web/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'User-Agent': BROWSER,
      'X-Forwarded-For': '203.0.113.9',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const view = (page: string, locale = 'en') => ({ name: 'view:page', page, locale });
function rows() {
  return getStatsDB()
    .prepare('SELECT day, page, locale, count FROM page_views_daily ORDER BY page, locale')
    .all() as Array<{ day: string; page: string; locale: string; count: number }>;
}

function webEventRows(): number {
  try {
    return (getStatsDB().prepare('SELECT count(*) AS n FROM web_events').get() as { n: number }).n;
  } catch {
    return 0;
  }
}

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
  /** The routes of the site on disk: every `page.tsx` under frontend/app/[locale]. */
  function routes(dir: string, prefix = '', out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (!statSync(path).isDirectory()) {
        if (entry === 'page.tsx') out.push(prefix === '' ? '/' : prefix);
        continue;
      }
      // (group) folders do not count in the URL; [...rest] is the 404 catch-all
      if (entry.startsWith('(')) routes(path, prefix, out);
      else if (entry === '[...rest]') continue;
      else routes(path, `${prefix}/${entry.replace(/^\[(.+)\]$/, ':$1')}`, out);
    }
    return out;
  }

  it('lists every public route of the site, and only those', () => {
    const root = join(import.meta.dirname, '..', '..', 'frontend', 'app', '[locale]');
    const shape = (p: string) => p.replace(/:[a-z]+/g, ':');
    // the dashboard and the family page render without the beacon: never counted
    const onDisk = routes(root)
      .filter((r) => !r.startsWith('/dashboard') && !r.startsWith('/famille'))
      .map(shape)
      .sort();
    expect(onDisk.length).toBeGreaterThan(40);
    expect([...PAGE_TEMPLATES].map(shape).sort()).toEqual(onDisk);
  });

  it('files a bank code, a slug or a year under its template, never as written', () => {
    expect(pageTemplate('/blz/37040044')).toBe('/blz/:code');
    expect(pageTemplate('/de/blz/37040044')).toBe('/blz/:code');
    expect(pageTemplate('/fr/at/12000')).toBe('/at/:code');
    expect(pageTemplate('/iid/00762')).toBe('/iid/:iid');
    expect(pageTemplate('/iban/DE')).toBe('/iban/:cc');
    expect(pageTemplate('/blog/a-title-nobody-listed')).toBe('/blog/:slug');
    expect(pageTemplate('/clearing-calendar/2027')).toBe('/clearing-calendar/:year');
    expect(pageTemplate('/')).toBe('/');
    expect(pageTemplate('/fr')).toBe('/');
    expect(pageTemplate('/de/')).toBe('/');
    expect(pageTemplate('/pricing')).toBe('/pricing');
    expect(pageTemplate('/fr/tools/qr-bill/')).toBe('/tools/qr-bill');
  });

  it('files anything else under autre: unknown paths, extra depth, a query or a fragment', () => {
    for (const path of [
      '/unknown',
      '/pricing/extra',
      '/blz/37040044/x',
      '/pricing?ref=a@b.example',
      '/pricing#x',
      '//pricing',
      '/blz//x',
      '/dashboard',
      '/famille',
      '/x y',
    ]) {
      expect(pageTemplate(path), path).toBe(OTHER_PAGE);
    }
  });
});

describe('POST /v1/web/events with a view', () => {
  it('counts one view by template, day and locale, and writes nothing to web_events', async () => {
    expect((await post(view('/de/blz/37040044', 'de'))).status).toBe(204);
    expect((await post(view('/de/blz/10000000', 'de'))).status).toBe(204);
    expect((await post(view('/pricing', 'en'))).status).toBe(204);
    const today = (getStatsDB().prepare("SELECT date('now') AS d").get() as { d: string }).d;
    expect(rows()).toEqual([
      { day: today, page: '/blz/:code', locale: 'de', count: 2 },
      { day: today, page: '/pricing', locale: 'en', count: 1 },
    ]);
    expect(webEventRows()).toBe(0);
  });

  it('stores only templates of the closed list, whatever the browser writes', async () => {
    for (const p of [
      '/',
      '/blz/1',
      '/x/../y',
      '/unknown/page',
      '/pricing?a=1',
      '/iid/00762',
      '/zzz',
    ]) {
      await post(view(p));
    }
    for (const r of rows()) expect(STORED_PAGES).toContain(r.page);
  });

  it('ignores what else the body carries: a referrer or a viewport is never stored', async () => {
    await post({
      ...view('/pricing'),
      referrer: 'news.example.net',
      viewport: 'phone',
      extra: 'a@b.example',
    });
    const dump = JSON.stringify(rows());
    expect(dump).not.toContain('example');
    expect(rows()).toHaveLength(1);
  });

  it('answers 400 to a malformed view and counts nothing', async () => {
    expect((await post({ name: 'view:page', page: 'pricing', locale: 'en' })).status).toBe(400);
    expect((await post({ name: 'view:page', page: '/pricing', locale: 'es' })).status).toBe(400);
    expect((await post({ name: 'view:other', page: '/pricing', locale: 'en' })).status).toBe(400);
    expect(rows()).toEqual([]);
  });

  it('does not count a browser that asks not to be tracked, nor a script that names itself', async () => {
    expect((await post(view('/pricing'), { DNT: '1' })).status).toBe(204);
    expect((await post(view('/pricing'), { 'Sec-GPC': '1' })).status).toBe(204);
    expect((await post(view('/pricing'), { 'User-Agent': 'curl/8.4.0' })).status).toBe(204);
    expect(
      (await post(view('/pricing'), { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }))
        .status,
    ).toBe(204);
    expect((await post(view('/pricing'), { 'User-Agent': 'IBANforge-outil/1.0' })).status).toBe(
      204,
    );
    expect(rows()).toEqual([]);
  });

  it('shares the per-address rate limit of the click circuit', async () => {
    let last = 204;
    for (let i = 0; i < 61; i++) last = (await post(view('/pricing'))).status;
    expect(last).toBe(429);
  });

  it('still takes a click exactly as before', async () => {
    expect(
      (
        await post({
          name: 'cta:try-hero',
          page: '/',
          locale: 'en',
          referrer: '',
          viewport: 'phone',
        })
      ).status,
    ).toBe(204);
    expect(webEventRows()).toBe(1);
    expect(rows()).toEqual([]);
  });
});

describe('shouldSkipView and parsePageView', () => {
  it('skips a request without an agent, keeps a browser', () => {
    expect(shouldSkipView({ userAgent: BROWSER })).toBe(false);
    expect(shouldSkipView({})).toBe(true);
  });
  it('reads only the pathname and the locale', () => {
    expect(
      parsePageView({ name: 'view:page', page: '/fr/blz/1', locale: 'fr', ip: '1.2.3.4' }),
    ).toEqual({
      page: '/blz/:code',
      locale: 'fr',
    });
  });
});

describe('pageViewsSummary', () => {
  it('sums by template over the window and by day, numbers only', async () => {
    await post(view('/pricing'));
    await post(view('/pricing', 'fr'));
    await post(view('/'));
    const s = pageViewsSummary(30);
    expect(s.total).toBe(3);
    expect(s.by_page).toEqual([
      { page: '/pricing', count: 2 },
      { page: '/', count: 1 },
    ]);
    expect(s.by_page_day).toHaveLength(2);
    expect(Object.keys(s).sort()).toEqual(['by_page', 'by_page_day', 'days', 'since', 'total']);
  });
});
