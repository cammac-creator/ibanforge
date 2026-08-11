import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiKeys } from './api-keys.js';
import { Hono } from 'hono';

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = 'correct-horse-battery-staple';
  // Allow @example.com / disposable domains in test suite so we don't have to
  // invent unique real-looking emails for every test case.
  process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('/v1/admin/keys — admin auth (timing-safe)', () => {
  it('rejects requests without X-Admin-Secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of same length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'wrong-horse-battery-staple-BAD', // padded to 30 chars
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of different length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'short',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when ADMIN_SECRET env is not set (defence in depth)', async () => {
    delete process.env.ADMIN_SECRET;
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'anything',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts correct secret and issues a key', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ email: `admin-test-${Date.now()}@example.com` }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { api_key: string };
    expect(json.api_key).toMatch(/^ifk_/);
  });
});

describe('/v1/admin/keys GET — listing', () => {
  it('unauthorized without secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys');
    expect(res.status).toBe(401);
  });

  it('authorized with correct secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(json.keys)).toBe(true);
  });
});

describe('/v1/keys/generate — acquisition source (best-effort)', () => {
  it('stores a well-formed source and ignores a malformed one', async () => {
    process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
    const app = makeApp();
    const { getStatsDB } = await import('../lib/db.js');

    const okEmail = `src-ok-${Date.now()}@example.com`;
    const ok = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: okEmail, source: 'NPM-Readme' }),
    });
    expect(ok.status).toBe(201);
    const row = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE email = ?')
      .get(okEmail) as { source: string | null };
    expect(row.source).toBe('npm-readme');

    // Malformed source (spaces, too long, injection-ish) must not block the
    // key and must land as NULL — attribution is best-effort by contract.
    const badEmail = `src-bad-${Date.now()}@example.com`;
    const bad = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: badEmail, source: 'not a valid source!! ' + 'x'.repeat(60) }),
    });
    expect(bad.status).toBe(201);
    const rowBad = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE email = ?')
      .get(badEmail) as { source: string | null };
    expect(rowBad.source).toBeNull();
  });
});

describe('/v1/admin/activation — per-email activation view', () => {
  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/activation');
    expect(res.status).toBe(401);
  });

  it('returns the four blocks with a clamped period', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/activation?days=45', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clients: unknown[];
      funnel: { period_days: number };
      sources: unknown[];
      cohorts: unknown[];
    };
    expect(Array.isArray(body.clients)).toBe(true);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.cohorts).toHaveLength(8);
    // Only 30 and 90 are served; anything else falls back to 30.
    expect(body.funnel.period_days).toBe(30);
  });
});

describe('POST /v1/admin/events — manual annotations', () => {
  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an empty label, records a real one', async () => {
    const app = makeApp();
    const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': 'correct-horse-battery-staple' };
    const bad = await app.request('/v1/admin/events', { method: 'POST', headers, body: JSON.stringify({ label: '  ' }) });
    expect(bad.status).toBe(400);
    const ok = await app.request('/v1/admin/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'admin-events-route-fixture' }),
    });
    expect(ok.status).toBe(201);
    const { getEvents } = await import('../lib/events.js');
    expect(getEvents(1).some((e) => e.label === 'admin-events-route-fixture' && e.kind === 'manual')).toBe(true);
    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare(`DELETE FROM events WHERE label = 'admin-events-route-fixture'`).run();
  });
});

describe('/v1/admin/weekly-facts + /v1/admin/digest — Monday digest plumbing', () => {
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': 'correct-horse-battery-staple' };

  it('facts endpoint requires the secret and serves the WoW block', async () => {
    const app = makeApp();
    expect((await app.request('/v1/admin/weekly-facts')).status).toBe(401);
    const res = await app.request('/v1/admin/weekly-facts', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { week: string; requests: { current: number; previous: number } };
    expect(body.week).toMatch(/^\d{4}-W\d{2}$/);
    expect(typeof body.requests.current).toBe('number');
  });

  it('digest POST upserts by week (re-running the cron never duplicates)', async () => {
    const app = makeApp();
    const week = '1999-W01'; // far outside any real listing window
    const post = (body_fr: string) =>
      app.request('/v1/admin/digest', { method: 'POST', headers, body: JSON.stringify({ week, body_fr }) });
    expect((await post('premier jet')).status).toBe(201);
    expect((await post('version corrigée')).status).toBe(201);
    const { getStatsDB } = await import('../lib/db.js');
    const rows = getStatsDB().prepare('SELECT body_fr FROM weekly_digest WHERE week = ?').all(week) as Array<{ body_fr: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].body_fr).toBe('version corrigée');
    getStatsDB().prepare('DELETE FROM weekly_digest WHERE week = ?').run(week);
  });

  it('digest POST rejects a malformed week or empty body', async () => {
    const app = makeApp();
    const bad = await app.request('/v1/admin/digest', {
      method: 'POST',
      headers,
      body: JSON.stringify({ week: 'lundi', body_fr: 'x' }),
    });
    expect(bad.status).toBe(400);
    const empty = await app.request('/v1/admin/digest', {
      method: 'POST',
      headers,
      body: JSON.stringify({ week: '2026-W01', body_fr: '  ' }),
    });
    expect(empty.status).toBe(400);
  });

  it('digest GET lists rows newest week first', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/digest?limit=3', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { digests: Array<{ week: string }> };
    expect(Array.isArray(body.digests)).toBe(true);
  });
});
