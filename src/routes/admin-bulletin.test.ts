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
        'decisions',
        'definitions',
        'moved',
        'needs',
        'not_yet',
        'numbers',
        'observed_at',
        'observed_at_zurich',
        'requested',
        'veille',
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
      body.moved.alert_history,
      body.moved.sources,
      body.needs.forum_threads,
      body.decisions,
      body.veille,
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

// ─── Étape A2 : le dépôt des veilles, les propositions et les réponses ──────

const FEED_TOKEN = 'jeton-factice-du-depot';
const HEARTBEAT = 'jeton-factice-des-battements';

describe('POST /internal/bulletin/:source, le dépôt des veilles', () => {
  const app = buildApp();
  const saved = {
    feed: process.env.BULLETIN_FEED_TOKEN,
    hb: process.env.HEARTBEAT_TOKEN,
    admin: process.env.ADMIN_SECRET,
  };

  const deposit = (
    source: string,
    body: unknown,
    token: string | null = FEED_TOKEN,
  ): Promise<Response> => {
    ip += 1;
    return Promise.resolve(
      app.request(`/internal/bulletin/${source}`, {
        method: 'POST',
        headers: {
          'x-forwarded-for': `203.0.113.${(ip % 250) + 1}`,
          'content-type': 'application/json',
          ...(token !== null ? { 'x-bulletin-token': token } : {}),
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  };

  const rows = (): Array<{ source: string; week: string; payload: string }> =>
    getStatsDB()
      .prepare(`SELECT source, week, payload FROM bulletin_feed ORDER BY source, week`)
      .all() as Array<{ source: string; week: string; payload: string }>;

  beforeEach(() => {
    process.env.BULLETIN_FEED_TOKEN = FEED_TOKEN;
    process.env.HEARTBEAT_TOKEN = HEARTBEAT;
    process.env.ADMIN_SECRET = SECRET;
    getStatsDB().exec('DELETE FROM bulletin_feed');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    for (const [name, value] of [
      ['BULLETIN_FEED_TOKEN', saved.feed],
      ['HEARTBEAT_TOKEN', saved.hb],
      ['ADMIN_SECRET', saved.admin],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const good = { lines: ['Une porte inventée qui s’ouvre.'] };

  it('refuse sans jeton, avec un mauvais jeton, et avec un jeton de la bonne longueur', async () => {
    expect((await deposit('weekly-veille', good, null)).status).toBe(401);
    expect((await deposit('weekly-veille', good, 'faux')).status).toBe(401);
    expect((await deposit('weekly-veille', good, 'x'.repeat(FEED_TOKEN.length))).status).toBe(401);
    expect(rows()).toEqual([]);
  });

  it('n’accepte ni le jeton des battements ni le secret d’administration', async () => {
    expect((await deposit('weekly-veille', good, HEARTBEAT)).status).toBe(401);
    expect((await deposit('weekly-veille', good, SECRET)).status).toBe(401);
    expect(rows()).toEqual([]);
  });

  it('refuse tout quand BULLETIN_FEED_TOKEN n’est pas posé, ou vide', async () => {
    delete process.env.BULLETIN_FEED_TOKEN;
    expect((await deposit('weekly-veille', good)).status).toBe(401);
    process.env.BULLETIN_FEED_TOKEN = '';
    expect((await deposit('weekly-veille', good, '')).status).toBe(401);
    expect(rows()).toEqual([]);
  });

  it('refuse une source hors liste, un corps trop gros, illisible ou hors forme', async () => {
    expect((await deposit('autre-veille', good)).status).toBe(404);
    expect((await deposit('weekly-veille', { lines: ['x'.repeat(5000)] })).status).toBe(413);
    expect((await deposit('weekly-veille', 'pas du json')).status).toBe(400);
    expect(
      (await deposit('weekly-veille', { lines: ['un'], score: { value: 1, out_of: 7 } })).status,
    ).toBe(400);
    expect(
      (await deposit('weekly-veille', { lines: ['un'], lien: 'https://example.com' })).status,
    ).toBe(400);
    expect(rows()).toEqual([]);
  });

  it('répond { ok: true } et rien d’autre, une ligne par source et par semaine', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await deposit('weekly-veille', good);
      expect(res.status).toBe(200);
      // Rien de ce qui a été reçu ne revient : les journaux des workflows sont publics.
      expect(await res.text()).toBe('{"ok":true}');
    }
    const res = await deposit('weekly-reco-baseline', {
      lines: ['Présent : une requête inventée'],
      score: { value: 2, out_of: 7, errors: 0 },
    });
    expect(res.status).toBe(200);
    expect(rows().map((r) => [r.source, r.week])).toEqual([
      ['weekly-reco-baseline', '2026-W40'],
      ['weekly-veille', '2026-W40'],
    ]);
    const bulletin = (await (
      await app.request('/v1/admin/bulletin', { headers: headers(SECRET) })
    ).json()) as Bulletin;
    expect(bulletin.veille).toMatchObject({
      state: 'read',
      sources: [
        { source: 'weekly-veille', state: 'read', lines: ['Une porte inventée qui s’ouvre.'] },
        { source: 'weekly-reco-baseline', state: 'read', score: { value: 2, out_of: 7 } },
      ],
    });
  });
});

describe('POST /v1/admin/bulletin/proposals et /answers', () => {
  const app = buildApp();
  const previous = process.env.ADMIN_SECRET;

  const post = (path: string, body: unknown, secret: string | null = SECRET): Promise<Response> => {
    ip += 1;
    return Promise.resolve(
      app.request(path, {
        method: 'POST',
        headers: {
          'x-forwarded-for': `192.0.2.${(ip % 250) + 1}`,
          'content-type': 'application/json',
          ...(secret ? { 'X-Admin-Secret': secret } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  };

  beforeEach(() => {
    process.env.ADMIN_SECRET = SECRET;
    getStatsDB().exec('DELETE FROM bulletin_proposals; DELETE FROM bulletin_answers;');
    resetMergedPullsCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
  });

  it('refuse sans le secret', async () => {
    expect((await post('/v1/admin/bulletin/proposals', { title: 'x' }, null)).status).toBe(401);
    expect(
      (await post('/v1/admin/bulletin/answers', { key: 'session:1', answer: 'oui' }, null)).status,
    ).toBe(401);
  });

  it('pose une proposition, puis reçoit sa réponse, montrée par le bulletin', async () => {
    const created = await post('/v1/admin/bulletin/proposals', {
      title: 'Une proposition inventée',
      origin: 'weekly-veille',
    });
    expect(created.status).toBe(201);
    const { key, week } = (await created.json()) as { key: string; week: string };
    expect(key).toMatch(/^session:\d+$/);
    expect(week).toBe('2026-W40');

    const answered = await post('/v1/admin/bulletin/answers', { key, answer: 'plus_tard' });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ ok: true, key, answer: 'plus_tard', week: '2026-W40' });

    const bulletin = (await (
      await app.request('/v1/admin/bulletin', { headers: headers(SECRET) })
    ).json()) as Bulletin;
    expect(bulletin.decisions).toMatchObject({
      state: 'read',
      shown: [{ key, answer: { answer: 'plus_tard', label: 'Une proposition inventée' } }],
    });
  });

  it('refuse une réponse hors forme, et une clé que le bulletin ne montre pas', async () => {
    expect((await post('/v1/admin/bulletin/proposals', { title: '' })).status).toBe(400);
    expect(
      (await post('/v1/admin/bulletin/answers', { key: 'session:1', answer: 'peut-être' })).status,
    ).toBe(400);
    expect((await post('/v1/admin/bulletin/answers', ['session:1', 'oui'])).status).toBe(400);
    const unknown = await post('/v1/admin/bulletin/answers', {
      key: 'session:424242',
      answer: 'oui',
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'unknown_proposal' });
  });
});
