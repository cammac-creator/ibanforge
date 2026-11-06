import { describe, it, expect, afterEach, vi } from 'vitest';
import { readSearchConsoleSnapshot, googleReadAt, inspectionState } from './search-console';
import { googleFixture } from './search-console.fixture';
import { fetchSearchConsole } from '@/lib/dashboard-overview';
import { googleSummary } from './audience-model';

describe('Google : lecture cohérente et ancienne indexation neutralisée', () => {
  it('conserve les mesures et ignore indexed sans modifier la réponse source', () => {
    const raw = googleFixture(),
      parsed = readSearchConsoleSnapshot(raw)!;
    expect(parsed.sitemaps[0].indexed).toBeNull();
    expect(raw.sitemaps[0].indexed).toBe(999);
    expect(parsed.weeks).toEqual(raw.weeks);
    expect(googleSummary(parsed)).toMatchObject({ clicks: 100, impressions: 1000, ctr: 0.1 });
    expect(parsed.top_window.end).toBe('2026-11-03');
    expect(googleSummary(parsed).weeks.at(-1)?.end).toBe('2026-11-01');
  });
  it.each([0, 99, null, undefined])('ignore aussi une ancienne valeur indexed : %s', (value) => {
    const raw = googleFixture();
    Object.assign(raw.sitemaps[0], { indexed: value });
    expect(readSearchConsoleSnapshot(raw)?.sitemaps[0].indexed).toBeNull();
  });
  it('garde un vrai zéro mesuré et une position inconnue, sans rang zéro', () => {
    const raw = googleFixture();
    raw.weeks = raw.weeks.map((w) => ({ ...w, clicks: 0, impressions: 0, ctr: 0, position: 0 }));
    raw.queries[0].position = 0;
    const parsed = readSearchConsoleSnapshot(raw)!;
    expect(googleSummary(parsed).clicks).toBe(0);
    expect(googleSummary(parsed).ctr).toBeNull();
    expect(parsed.weeks.every((w) => w.position === null && w.ctr === null)).toBe(true);
    expect(parsed.queries[0].position).toBeNull();
  });
  it.each([
    [
      'semaine vide',
      (x: ReturnType<typeof googleFixture>) => {
        x.weeks = [];
      },
    ],
    [
      'jour impossible',
      (x: ReturnType<typeof googleFixture>) => {
        x.window_end = '2026-02-30';
      },
    ],
    [
      'heure impossible',
      (x: ReturnType<typeof googleFixture>) => {
        x.fetched_at = '2026-11-06 25:00:00';
      },
    ],
    [
      'lecture sans heure',
      (x: ReturnType<typeof googleFixture>) => {
        x.fetched_at = '2026-11-06';
      },
    ],
    [
      'semaine incomplète',
      (x: ReturnType<typeof googleFixture>) => {
        x.weeks[0].start = '2026-10-06';
      },
    ],
    [
      'semaine future',
      (x: ReturnType<typeof googleFixture>) => {
        x.weeks[0].start = '2026-11-02';
        x.weeks[0].end = '2026-11-08';
      },
    ],
    [
      'semaine doublonnée',
      (x: ReturnType<typeof googleFixture>) => {
        x.weeks.push({ ...x.weeks[0] });
      },
    ],
    [
      'classement inversé',
      (x: ReturnType<typeof googleFixture>) => {
        x.top_window.start = '2026-11-05';
      },
    ],
    [
      'classement futur',
      (x: ReturnType<typeof googleFixture>) => {
        x.top_window.end = '2026-11-05';
      },
    ],
    [
      'source postérieure à la lecture',
      (x: ReturnType<typeof googleFixture>) => {
        x.window_end = '2026-11-07';
      },
    ],
    [
      'compteur négatif',
      (x: ReturnType<typeof googleFixture>) => {
        x.queries[0].clicks = -1;
      },
    ],
    [
      'compteur fractionnaire',
      (x: ReturnType<typeof googleFixture>) => {
        x.weeks[0].impressions = 3.5;
      },
    ],
    [
      'somme hors précision',
      (x: ReturnType<typeof googleFixture>) => {
        x.weeks[0].clicks = Number.MAX_SAFE_INTEGER;
      },
    ],
    [
      'page doublonnée',
      (x: ReturnType<typeof googleFixture>) => {
        x.pages.push({ ...x.pages[0] });
      },
    ],
    [
      'date de sitemap invalide',
      (x: ReturnType<typeof googleFixture>) => {
        x.sitemaps[0].last_downloaded = 'demain';
      },
    ],
    [
      'rafraîchissement mal formé',
      (x: ReturnType<typeof googleFixture>) => {
        Object.assign(x, { refreshing: 'oui' });
      },
    ],
  ])('refuse %s sans inventer zéro', (_name, mutate) => {
    const raw = googleFixture();
    mutate(raw);
    expect(readSearchConsoleSnapshot(raw)).toBeNull();
  });
  it('distingue une inspection refusée d’une page dont l’état est inconnu', () => {
    const raw = googleFixture();
    expect(raw.inspections.map(inspectionState)).toEqual([
      'indexed',
      'not-indexed',
      'unknown',
      'unavailable',
    ]);
    expect(inspectionState({ ...raw.inspections[0], error: 'http_500' })).toBe('unavailable');
  });
  it('date la lecture en heure suisse, avec les changements de saison et les offsets explicites', () => {
    expect(googleReadAt('2026-11-06 12:00:00')).toBe('06.11.2026 · 13:00');
    expect(googleReadAt('2026-07-01T23:30:00Z')).toBe('02.07.2026 · 01:30');
    expect(googleReadAt('2026-11-06T14:00:00+02:00')).toBe('06.11.2026 · 13:00');
    expect(googleReadAt('2026-02-30T12:00:00Z')).toBe('—');
  });
});

describe('Google : le transport garde seulement le repli documenté', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([401, 403, 404, 500, 503])(
    'ne montre pas une lecture jointe à un refus HTTP %s',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        async () => new Response(JSON.stringify({ ...googleFixture(), stale: true }), { status }),
      );
      expect((await fetchSearchConsole('https://alpha.example.net', {})).data).toBeNull();
    },
  );
  it('préserve le repli 502 daté et son rafraîchissement, même pendant une erreur', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ ...googleFixture(), stale: true, refreshing: true }), {
          status: 502,
        }),
    );
    const res = await fetchSearchConsole('https://alpha.example.net', {});
    expect(res).toMatchObject({
      ok: false,
      status: 502,
      data: { stale: true, refreshing: true, fetched_at: '2026-11-06 12:00:00' },
    });
    expect(res.data?.sitemaps[0].indexed).toBeNull();
  });
  it('refuse une réponse 200 partielle et un 502 prétendument frais', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ weeks: [] })));
    expect((await fetchSearchConsole('https://alpha.example.net', {})).data).toBeNull();
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify(googleFixture()), { status: 502 }),
    );
    expect((await fetchSearchConsole('https://alpha.example.net', {})).data).toBeNull();
  });
});
