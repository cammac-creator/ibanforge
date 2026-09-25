import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { getDoorBoard } from '../lib/door-board.js';
import { buildDigestMessage } from '../lib/door-board-digest.js';

/**
 * La route du tableau des portes, montée dans l'application réelle. Base
 * synthétique, secret factice, fixtures inventées (ce dépôt est public).
 */
const SECRET = 'secret-factice-du-tableau-des-portes';
const NOW = new Date('2026-10-07T10:00:00Z');

let ip = 0;
const headers = (secret?: string): Record<string, string> => {
  ip += 1;
  return {
    'x-forwarded-for': `198.51.100.${ip}`,
    ...(secret ? { 'X-Admin-Secret': secret } : {}),
  };
};

describe('GET /v1/admin/doors', () => {
  const previous = process.env.ADMIN_SECRET;
  const app = buildApp();

  beforeAll(() => {
    process.env.ADMIN_SECRET = SECRET;
    const insert = getStatsDB().prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier)
       VALUES (?, ?, ?, ?, ?, ?, 'email')`,
    );
    insert.run(
      'rt-1',
      'ifk_rt000001',
      'une@gamma.example.net',
      'une@gamma.example.net',
      '2026-09-29 08:00:00',
      'site-docs',
    );
    insert.run(
      'rt-2',
      'ifk_rt000002',
      'deux@gamma.example.net',
      'deux@gamma.example.net',
      '2026-09-30 08:00:00',
      'site-docs',
    );
    insert.run(
      'rt-3',
      'ifk_rt000003',
      'trois@gamma.example.net',
      'trois@gamma.example.net',
      '2026-10-06 08:00:00',
      'glama',
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
    closeAll();
  });

  it('refuse sans le secret, et ne se met jamais en cache', async () => {
    const without = await app.request('/v1/admin/doors', { headers: headers() });
    expect(without.status).toBe(401);
    expect(without.headers.get('cache-control')).toBe('private, no-store');
    const wrong = await app.request('/v1/admin/doors', { headers: headers('pas-le-bon') });
    expect(wrong.status).toBe(401);
  });

  it('rend les mêmes nombres que le résumé du lundi, et aucune donnée personnelle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const res = await app.request('/v1/admin/doors?weeks=4', { headers: headers(SECRET) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as ReturnType<typeof getDoorBoard> & {
      digest: { enabled: boolean; recent: unknown[] };
      requested: { weeks: string | null };
    };
    expect(body.weeks_shown).toBe(4);
    expect(body.requested).toEqual({ weeks: '4' });
    expect(body.last_week).toMatchObject({
      week: '2026-W40',
      numbers: { created: 2, first_success: 0, paid: 0, free_active: 0 },
    });
    expect(body.control).toMatchObject({ created_total: 3, external_fleet: 3, equal: true });

    // Le message du lundi est bâti par la même fonction, à la même heure.
    const message = buildDigestMessage(getDoorBoard({ now: NOW.getTime() }));
    expect(message.numbers).toEqual({ week: body.last_week.week, ...body.last_week.numbers });
    expect(message.text).toContain(body.last_week.sentence);

    expect(body.digest).toMatchObject({ enabled: true, recent: [] });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/example\.net|ifk_|rt-\d/);
  });

  it('prend la valeur par défaut pour un nombre de semaines illisible', async () => {
    const res = await app.request('/v1/admin/doors?weeks=beaucoup', {
      headers: headers(SECRET),
    });
    const body = (await res.json()) as { weeks_shown: number; requested: { weeks: string } };
    expect(body.weeks_shown).toBe(10);
    expect(body.requested.weeks).toBe('beaucoup');
  });
});
