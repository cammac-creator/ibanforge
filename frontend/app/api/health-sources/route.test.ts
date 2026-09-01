import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from './route';

// Freshness relay for the village plaques: reduces /health to the per-source
// last_updated map. Nothing else from /health may pass through — the page
// needs dates, not the ops surface.

afterEach(() => vi.unstubAllGlobals());

const HEALTH = {
  status: 'ok',
  uptime_seconds: 123,
  bic_data_last_updated: '2026-09-01 03:22:35',
  bic_sources: [
    { source: 'bundesbank', entries: 143, last_updated: '2026-09-01 03:22:27', stale: false },
    { source: 'oenb', entries: 1, last_updated: '2026-09-01 03:22:29', stale: false },
    { source: 'six_group', entries: 20, last_updated: '2026-09-01 03:22:28', stale: true },
  ],
};

describe('GET /api/health-sources', () => {
  it('reduces /health to the freshness map, overall date and stale flag', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(HEALTH), { status: 200 }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sources: {
        bundesbank: '2026-09-01 03:22:27',
        oenb: '2026-09-01 03:22:29',
        six_group: '2026-09-01 03:22:28',
      },
      overall: '2026-09-01 03:22:35',
      anyStale: true,
    });
  });

  it('serves an empty map when the API is unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ sources: {}, overall: null, anyStale: false });
  });
});
