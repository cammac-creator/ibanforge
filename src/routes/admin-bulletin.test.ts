import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { resetMergedPullsCache } from '../lib/bulletin-github.js';
import type { Bulletin } from '../lib/bulletin.js';

/**
 * La route du bulletin du lundi, montée dans l'application réelle. Base
 * synthétique, secret factice, fixtures inventées (ce dépôt est public). GitHub
 * n'est jamais appelé : `fetch` est simulé. Horloge : mercredi 07.10.2026 à
 * 12:00, heure suisse ; la dernière semaine close est la 40.
 */
const SECRET = 'secret-factice-du-bulletin';
const NOW = new Date('2026-10-07T10:00:00Z');

let ip = 0;
const headers = (secret?: string): Record<string, string> => {
  ip += 1;
  return {
    'x-forwarded-for': `198.51.100.${ip}`,
    ...(secret ? { 'X-Admin-Secret': secret } : {}),
  };
};

const githubPulls = [
  {
    number: 41,
    title: 'feat: une page inventée',
    merged_at: '2026-09-30T12:00:00Z',
    updated_at: '2026-09-30T12:05:00Z',
    base: { ref: 'main' },
  },
  {
    number: 40,
    title: 'fix: un correctif inventé',
    merged_at: '2026-09-23T12:00:00Z',
    updated_at: '2026-09-23T12:05:00Z',
    base: { ref: 'main' },
  },
  {
    number: 39,
    title: 'chore: plus ancien',
    merged_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:05:00Z',
    base: { ref: 'main' },
  },
];

let github: ReturnType<typeof vi.fn>;

describe('GET /v1/admin/bulletin', () => {
  const previous = process.env.ADMIN_SECRET;
  const app = buildApp();

  beforeAll(() => {
    process.env.ADMIN_SECRET = SECRET;
    getStatsDB()
      .prepare(
        `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier)
         VALUES (?, ?, ?, ?, ?, ?, 'email')`,
      )
      .run(
        'bl-route-1',
        'ifk_blr00001',
        'une@alpha.example.net',
        'une@alpha.example.net',
        '2026-09-30 08:00:00',
        'site-home',
      );
    getStatsDB()
      .prepare(
        `INSERT INTO operations (operation_type, country_code, success, created_at, error_detail)
         VALUES ('bic_lookup', 'IT', 0, '2026-10-01 08:00:00', 'ALPHITMMXXX')`,
      )
      .run();
  });

  beforeEach(() => {
    resetMergedPullsCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    github = vi.fn(async () => new Response(JSON.stringify(githubPulls), { status: 200 }));
    vi.stubGlobal('fetch', github);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
    closeAll();
  });

  it('refuse sans le secret, ne se met jamais en cache et ne lit rien', async () => {
    const without = await app.request('/v1/admin/bulletin', { headers: headers() });
    expect(without.status).toBe(401);
    expect(without.headers.get('cache-control')).toBe('private, no-store');
    const wrong = await app.request('/v1/admin/bulletin', { headers: headers('pas-le-bon') });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('cache-control')).toBe('private, no-store');
    expect(github).not.toHaveBeenCalled();
  });

  it('rend la dernière semaine close par défaut, bloc par bloc, sans donnée personnelle', async () => {
    const res = await app.request('/v1/admin/bulletin', { headers: headers(SECRET) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as Bulletin;
    expect(Object.keys(body).sort()).toEqual(
      [
        'definitions',
        'moved',
        'needs',
        'not_yet',
        'numbers',
        'observed_at',
        'observed_at_zurich',
        'requested',
        'version',
        'week',
      ].sort(),
    );
    expect(body.version).toBe(1);
    expect(body.observed_at_zurich).toBe('07.10 à 12:00');
    expect(body.requested).toEqual({ week: null });
    expect(body.week).toMatchObject({
      label: '2026-W40',
      monday: '2026-09-28',
      sunday: '2026-10-04',
      start_utc: '2026-09-27 22:00:00',
      end_utc: '2026-10-04 22:00:00',
      last_complete: true,
    });
    expect(body.numbers).toMatchObject({
      state: 'read',
      totals: { created: 1 },
      site_home: { coverage: 'full', created: 1 },
    });
    expect(body.moved.merged_pulls).toMatchObject({
      state: 'read',
      pulls: [{ number: 41, title: 'feat: une page inventée', merged_at: '2026-09-30 12:00:00' }],
    });
    for (const block of [
      body.moved.heartbeats,
      body.moved.alerts,
      body.moved.sources,
      body.needs.forum_threads,
    ]) {
      expect(block.state).toBe('read');
    }
    expect(body.needs.missing_bics).toMatchObject({
      state: 'read',
      top: [{ country: 'IT', lookups: 1, distinct_codes: 1 }],
    });
    expect(body.not_yet.length).toBeGreaterThan(0);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/example\.net|ifk_|bl-route/);
  });

  it('rend la semaine demandée, et dit ce qui a été demandé quand il retombe sur défaut', async () => {
    const asked = await app.request('/v1/admin/bulletin?week=2026-W39', {
      headers: headers(SECRET),
    });
    const body = (await asked.json()) as Bulletin;
    expect(body.week).toMatchObject({ label: '2026-W39', last_complete: false, next: '2026-W40' });
    expect(body.requested).toEqual({ week: '2026-W39' });
    expect(body.moved.merged_pulls).toMatchObject({ state: 'read', pulls: [{ number: 40 }] });

    for (const raw of ['2026-W41', '2026-W60', 'beaucoup']) {
      const res = await app.request(`/v1/admin/bulletin?week=${raw}`, {
        headers: headers(SECRET),
      });
      const fallback = (await res.json()) as Bulletin;
      expect(fallback.week.label, raw).toBe('2026-W40');
      expect(fallback.requested).toEqual({ week: raw });
    }
  });

  it('dit « non lu » quand GitHub refuse, jamais une liste vide, et rend le reste', async () => {
    github.mockImplementation(async () => new Response('{}', { status: 403 }));
    const res = await app.request('/v1/admin/bulletin', { headers: headers(SECRET) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Bulletin;
    expect(body.moved.merged_pulls).toEqual({
      state: 'unread',
      source: 'github',
      repo: 'cammac-creator/ibanforge',
      reason: 'http_403',
      fetched_at: '2026-10-07 10:00:00',
    });
    expect(body.numbers.state).toBe('read');
    expect(body.needs.missing_bics.state).toBe('read');
  });

  it('lit GitHub une fois par semaine tant que le cache est frais', async () => {
    await app.request('/v1/admin/bulletin', { headers: headers(SECRET) });
    await app.request('/v1/admin/bulletin', { headers: headers(SECRET) });
    await app.request('/v1/admin/bulletin?week=2026-W40', { headers: headers(SECRET) });
    expect(github).toHaveBeenCalledTimes(1);
    await app.request('/v1/admin/bulletin?week=2026-W39', { headers: headers(SECRET) });
    expect(github).toHaveBeenCalledTimes(2);
  });
});
