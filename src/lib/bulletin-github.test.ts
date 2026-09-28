import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BULLETIN_REPO,
  MERGED_PULLS_FAILURE_TTL_MS,
  MERGED_PULLS_MAX_PAGES,
  MERGED_PULLS_SUCCESS_TTL_MS,
  mergedPullsOfWeek,
  resetMergedPullsCache,
} from './bulletin-github.js';
import { swissWeekOf, swissWeekShift } from './swiss-week.js';

/**
 * Ce qui a été mis en ligne pendant la semaine, lu sur GitHub. Aucun appel ne part :
 * `fetch` est simulé. Horloge : mercredi 07.10.2026 à 12:00, heure suisse. La
 * semaine lue est la 40 (lundi 28.09 00:00 à lundi 05.10 00:00, heure suisse,
 * soit 27.09 22:00 UTC à 04.10 22:00 UTC). Titres inventés.
 */
const NOW = Date.parse('2026-10-07T10:00:00Z');
const WEEK = swissWeekShift(swissWeekOf(NOW), 1);
const OTHER_WEEK = swissWeekShift(swissWeekOf(NOW), 2);

interface Item {
  number: number;
  title: string;
  merged_at: string | null;
  updated_at: string;
  base: { ref: string };
  html_url: string;
}

function item(
  number: number,
  f: { updated: string; merged?: string | null; base?: string; title?: string },
): Item {
  return {
    number,
    title: f.title ?? `feat: changement ${number}`,
    merged_at: f.merged ?? null,
    updated_at: f.updated,
    base: { ref: f.base ?? 'main' },
    // Jamais recopié : la page ne doit pouvoir pointer que vers le dépôt.
    html_url: 'https://alpha.example.net/ailleurs',
  };
}

function page(items: unknown, status = 200): Response {
  return new Response(JSON.stringify(items), { status });
}

/**
 * Cent PR fusionnées pendant la semaine et toutes touchées depuis : une page pleine
 * qui oblige à lire la suivante.
 */
function fullPage(from: number): Item[] {
  return Array.from({ length: 100 }, (_, i) =>
    item(from + i, { updated: '2026-10-06T10:00:00Z', merged: '2026-10-01T09:00:00Z' }),
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetMergedPullsCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('les PR fusionnées de la semaine', () => {
  it('garde les PR fusionnées dans main pendant la semaine, et seulement elles', async () => {
    fetchMock.mockResolvedValueOnce(
      page([
        item(12, { updated: '2026-10-06T08:00:00Z', merged: '2026-10-02T15:00:00Z' }),
        item(11, { updated: '2026-10-05T09:00:00Z', merged: '2026-09-28T07:30:00Z' }),
        // Fusionnée dans une autre branche : pas une mise en ligne.
        item(10, { updated: '2026-10-03T09:00:00Z', merged: '2026-10-03T08:00:00Z', base: 'vps' }),
        // Touchée pendant la semaine, fusionnée avant : pas de cette semaine.
        item(9, { updated: '2026-10-01T09:00:00Z', merged: '2026-09-25T08:00:00Z' }),
        // Fermée sans fusion.
        item(8, { updated: '2026-09-30T09:00:00Z', merged: null }),
        // Fusionnée le lundi suivant à 00:30 heure suisse : semaine 41.
        item(7, { updated: '2026-09-29T09:00:00Z', merged: '2026-10-04T22:30:00Z' }),
        // Dernière touche avant le lundi : la lecture s'arrête après cette page.
        item(6, { updated: '2026-09-20T09:00:00Z', merged: '2026-09-20T08:00:00Z' }),
      ]),
    );
    const read = await mergedPullsOfWeek(WEEK, NOW);
    expect(read).toEqual({
      state: 'read',
      source: 'github',
      repo: BULLETIN_REPO,
      fetched_at: '2026-10-07 10:00:00',
      pulls: [
        {
          number: 11,
          title: 'feat: changement 11',
          merged_at: '2026-09-28 07:30:00',
          url: `https://github.com/${BULLETIN_REPO}/pull/11`,
        },
        {
          number: 12,
          title: 'feat: changement 12',
          merged_at: '2026-10-02 15:00:00',
          url: `https://github.com/${BULLETIN_REPO}/pull/12`,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.github.com/repos/${BULLETIN_REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1`,
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('ibanforge-bulletin');
    // Sans jeton, et sans adresse de personne dans aucun en-tête.
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(JSON.stringify(headers)).not.toMatch(/@/);
  });

  it('lit la page suivante tant que la liste n’est pas repassée avant le lundi', async () => {
    fetchMock
      .mockResolvedValueOnce(page(fullPage(1000)))
      .mockResolvedValueOnce(
        page([
          item(900, { updated: '2026-09-29T10:00:00Z', merged: '2026-09-29T09:00:00Z' }),
          item(899, { updated: '2026-09-10T10:00:00Z', merged: '2026-09-10T09:00:00Z' }),
        ]),
      );
    const read = await mergedPullsOfWeek(WEEK, NOW);
    expect(read.state).toBe('read');
    if (read.state !== 'read') return;
    expect(read.pulls).toHaveLength(101);
    expect(read.pulls[0].number).toBe(900);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('&page=2');
  });

  it('s’arrête sur une page courte, même si tout y est récent', async () => {
    fetchMock.mockResolvedValueOnce(
      page([item(5, { updated: '2026-10-06T10:00:00Z', merged: '2026-10-01T09:00:00Z' })]),
    );
    const read = await mergedPullsOfWeek(WEEK, NOW);
    expect(read).toMatchObject({ state: 'read', pulls: [{ number: 5 }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dit « non lu » au-delà du plafond de pages, jamais une liste tronquée', async () => {
    for (let p = 0; p < MERGED_PULLS_MAX_PAGES; p++) {
      fetchMock.mockResolvedValueOnce(page(fullPage(p * 100 + 1)));
    }
    const read = await mergedPullsOfWeek(WEEK, NOW);
    expect(read).toEqual({
      state: 'unread',
      source: 'github',
      repo: BULLETIN_REPO,
      reason: 'too_many_pages',
      fetched_at: '2026-10-07 10:00:00',
    });
    expect(read).not.toHaveProperty('pulls');
    expect(fetchMock).toHaveBeenCalledTimes(MERGED_PULLS_MAX_PAGES);
  });

  it.each([
    ['un refus', () => page({ message: 'API rate limit exceeded' }, 403), 'http_403'],
    ['une coupure', () => Promise.reject(new TypeError('fetch failed')), 'network'],
    [
      'un délai dépassé',
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      'timeout',
    ],
    ['un corps qui n’est pas une liste', () => page({ items: [] }), 'invalid_body'],
    [
      'une PR sans branche de base',
      () => page([{ number: 1, title: 't', merged_at: null, updated_at: '2026-10-01T00:00:00Z' }]),
      'invalid_body',
    ],
  ])('dit « non lu » sur %s', async (_name, answer, reason) => {
    fetchMock.mockImplementationOnce(answer);
    const read = await mergedPullsOfWeek(WEEK, NOW);
    expect(read).toMatchObject({ state: 'unread', reason });
    expect(read).not.toHaveProperty('pulls');
  });
});

describe('le cache par semaine', () => {
  it('garde une lecture réussie une heure, puis relit GitHub', async () => {
    fetchMock.mockImplementation(async () =>
      page([item(3, { updated: '2026-09-20T10:00:00Z', merged: '2026-09-20T09:00:00Z' })]),
    );
    await mergedPullsOfWeek(WEEK, NOW);
    await mergedPullsOfWeek(WEEK, NOW + MERGED_PULLS_SUCCESS_TTL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await mergedPullsOfWeek(WEEK, NOW + MERGED_PULLS_SUCCESS_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(MERGED_PULLS_SUCCESS_TTL_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it('garde un échec dix minutes, pour ne pas brûler les appels partagés', async () => {
    fetchMock.mockImplementation(async () => page({}, 403));
    const first = await mergedPullsOfWeek(WEEK, NOW);
    const again = await mergedPullsOfWeek(WEEK, NOW + MERGED_PULLS_FAILURE_TTL_MS - 1);
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await mergedPullsOfWeek(WEEK, NOW + MERGED_PULLS_FAILURE_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fait attendre deux lectures simultanées sur le même appel', async () => {
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const a = mergedPullsOfWeek(WEEK, NOW);
    const b = mergedPullsOfWeek(WEEK, NOW);
    release(page([]));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(ra).toMatchObject({ state: 'read', pulls: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('garde chaque semaine à part', async () => {
    fetchMock.mockImplementation(async () => page([]));
    await mergedPullsOfWeek(WEEK, NOW);
    await mergedPullsOfWeek(OTHER_WEEK, NOW);
    await mergedPullsOfWeek(WEEK, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
