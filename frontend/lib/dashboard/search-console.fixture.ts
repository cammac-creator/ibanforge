import type { SearchConsole } from '@/lib/dashboard-overview';

/** Données inventées, partagées par les tests de lecture et la recette du panneau. */
export function googleFixture(): SearchConsole {
  return {
    site: 'https://alpha.example.net/',
    window_end: '2026-11-03',
    fetched_at: '2026-11-06 12:00:00',
    stale: false,
    refreshing: false,
    top_window: { start: '2026-10-07', end: '2026-11-03' },
    weeks: [
      {
        start: '2026-10-05',
        end: '2026-10-11',
        clicks: 10,
        impressions: 100,
        ctr: 10,
        position: 8,
      },
      {
        start: '2026-10-12',
        end: '2026-10-18',
        clicks: 20,
        impressions: 200,
        ctr: 10,
        position: 7,
      },
      {
        start: '2026-10-19',
        end: '2026-10-25',
        clicks: 30,
        impressions: 300,
        ctr: 10,
        position: 6,
      },
      {
        start: '2026-10-26',
        end: '2026-11-01',
        clicks: 40,
        impressions: 400,
        ctr: 10,
        position: 5,
      },
    ],
    queries: [{ key: 'validation alpha', clicks: 11, impressions: 100, position: 4 }],
    pages: [{ key: '/guide-alpha', clicks: 7, impressions: 70, position: 5 }],
    sitemaps: [
      {
        path: 'https://alpha.example.net/sitemap.xml',
        submitted: 250,
        indexed: 999,
        errors: 0,
        warnings: 1,
        is_pending: false,
        last_submitted: '2026-10-01T10:00:00Z',
        last_downloaded: '2026-11-03T10:00:00Z',
      },
    ],
    inspections: [
      {
        path: '/page-alpha',
        state: 'indexed',
        coverage: 'Indexed',
        last_crawled: '2026-11-02',
        error: null,
      },
      {
        path: '/page-beta',
        state: 'not-indexed',
        coverage: 'Crawled - currently not indexed',
        last_crawled: '2026-11-01',
        error: null,
      },
      { path: '/page-gamma', state: 'unknown', coverage: null, last_crawled: null, error: null },
      {
        path: '/page-delta',
        state: 'unknown',
        coverage: null,
        last_crawled: null,
        error: 'http_429',
      },
    ],
  };
}
