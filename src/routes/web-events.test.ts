import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { webEvents, resetWebEventLimiter, WEB_EVENTS_PER_WINDOW } from './web-events.js';
import { parseWebEvent } from '../lib/web-events.js';
import { getStatsDB } from '../lib/db.js';

const SECRET = 'test-admin-secret-web-events';
const RUN = `t${Date.now()}`;

function makeApp() {
  const app = new Hono();
  app.route('/', webEvents);
  return app;
}

function post(app: Hono, body: unknown, ip = '203.0.113.7') {
  return app.request('/v1/web/events', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-Forwarded-For': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('parseWebEvent', () => {
  it('keeps a well-formed event and drops what it cannot trust', () => {
    expect(
      parseWebEvent({ name: 'cta:try', page: '/fr', locale: 'fr', referrer: 'News.YCombinator.com', viewport: 'phone' }),
    ).toEqual({ name: 'cta:try', page: '/fr', locale: 'fr', referrer: 'news.ycombinator.com', viewport: 'phone' });
    expect(parseWebEvent({ name: 'cta:try', page: '/fr', locale: 'fr', referrer: 'not a host', viewport: 'tv' })).toEqual({
      name: 'cta:try', page: '/fr', locale: 'fr', referrer: null, viewport: null,
    });
  });
  it('refuses a bad name, page or locale', () => {
    expect(parseWebEvent({ name: 'CTA', page: '/fr', locale: 'fr' })).toBeNull();
    expect(parseWebEvent({ name: 'cta:try', page: 'fr', locale: 'fr' })).toBeNull();
    expect(parseWebEvent({ name: 'cta:try', page: '/fr', locale: 'it' })).toBeNull();
    expect(parseWebEvent('cta:try')).toBeNull();
  });
});

describe('POST /v1/web/events', () => {
  beforeEach(() => resetWebEventLimiter());

  it('records a valid event and answers 204', async () => {
    const app = makeApp();
    const res = await post(app, { name: `cta:${RUN}`, page: '/fr', locale: 'fr', referrer: '', viewport: 'desktop' });
    expect(res.status).toBe(204);
    const row = getStatsDB().prepare('SELECT page, locale, referrer, viewport FROM web_events WHERE name = ?').get(`cta:${RUN}`) as Record<string, unknown>;
    expect(row).toEqual({ page: '/fr', locale: 'fr', referrer: null, viewport: 'desktop' });
  });

  it('answers 400 to junk and 413 to a big body', async () => {
    const app = makeApp();
    expect((await post(app, 'not json')).status).toBe(400);
    expect((await post(app, { name: 'x' })).status).toBe(400);
    expect((await post(app, { name: 'cta:big', page: '/fr', locale: 'fr', referrer: 'a'.repeat(2000) })).status).toBe(413);
  });

  it('limits one address to the window', async () => {
    const app = makeApp();
    for (let i = 0; i < WEB_EVENTS_PER_WINDOW; i++) {
      expect((await post(app, { name: 'cta:limit', page: '/fr', locale: 'fr' }, '198.51.100.9')).status).toBe(204);
    }
    expect((await post(app, { name: 'cta:limit', page: '/fr', locale: 'fr' }, '198.51.100.9')).status).toBe(429);
    expect((await post(app, { name: 'cta:limit', page: '/fr', locale: 'fr' }, '198.51.100.10')).status).toBe(204);
  });
});

describe('GET /v1/admin/web-events', () => {
  beforeAll(() => {
    process.env.ADMIN_SECRET = SECRET;
  });
  it('is admin only', async () => {
    const app = makeApp();
    expect((await app.request('/v1/admin/web-events')).status).toBe(401);
  });
  it('counts by name, page, referrer and day', async () => {
    const app = makeApp();
    resetWebEventLimiter();
    await post(app, { name: `film:${RUN}`, page: '/de', locale: 'de', referrer: 'example.net' });
    const res = await app.request('/v1/admin/web-events?days=1', { headers: { 'X-Admin-Secret': SECRET } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; by_name: Array<{ name: string; count: number }>; by_referrer: Array<{ referrer: string }>; by_day: Array<{ day: string }> };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.by_name.some((r) => r.name === `film:${RUN}` && r.count === 1)).toBe(true);
    expect(body.by_referrer.some((r) => r.referrer === 'example.net')).toBe(true);
    expect(body.by_day.length).toBeGreaterThanOrEqual(1);
  });
});
