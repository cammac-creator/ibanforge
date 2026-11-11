/**
 * Quand une statistique casse, Railway a une ligne à montrer (ARCH-09#1, audit
 * du 10.11.2026).
 *
 * Les seize routes /stats/* attrapaient l'exception et répondaient
 * `stats_unavailable` sans un mot : le tableau de bord restait vide, et aucune
 * cause n'était écrite nulle part. Ici, chaque lecteur qu'elles appellent lève ;
 * chaque route doit garder son 500 et journaliser la cause, avec son nom.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Hono } from 'hono';

// Hissé avec les vi.mock ci-dessous, qui s'en servent.
const { BROKEN, broken } = vi.hoisted(() => {
  const BROKEN = 'base des statistiques illisible (test)';
  return {
    BROKEN,
    broken: (): never => {
      throw new Error(BROKEN);
    },
  };
});

vi.mock('../lib/stats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/stats.js')>();
  return {
    ...actual,
    getStats: vi.fn(broken),
    getStatsHistory: vi.fn(broken),
    getStatsPulse: vi.fn(broken),
    getHourlyStats: vi.fn(broken),
    getErrorStats: vi.fn(broken),
    getPatternStats: vi.fn(broken),
    getStatusByPath: vi.fn(broken),
    getBusinessFunnel: vi.fn(broken),
    getSourceStats: vi.fn(broken),
    getRejectionStats: vi.fn(broken),
    getCohortFootprint: vi.fn(broken),
    getTrafficTrend: vi.fn(broken),
    getMcpToolStats: vi.fn(broken),
    getMcpSourceFamilies: vi.fn(broken),
  };
});
vi.mock('../lib/events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/events.js')>();
  return { ...actual, getEvents: vi.fn(broken) };
});
vi.mock('../lib/payment-attempts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/payment-attempts.js')>();
  return { ...actual, getPaymentAttempts: vi.fn(broken) };
});

import { stats } from './stats.js';

const TOKEN = 'test-stats-token-erreurs';
const PREVIOUS = process.env.STATS_TOKEN;
let errorSpy: MockInstance<typeof console.error>;

beforeAll(() => {
  process.env.STATS_TOKEN = TOKEN;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockClear());
afterAll(() => {
  errorSpy.mockRestore();
  if (PREVIOUS === undefined) delete process.env.STATS_TOKEN;
  else process.env.STATS_TOKEN = PREVIOUS;
});

const ROUTES = [
  '/stats',
  '/stats/pulse',
  '/stats/payment-attempts',
  '/stats/history',
  '/stats/hourly',
  '/stats/errors',
  '/stats/rejections',
  '/stats/business-funnel',
  '/stats/cohort-footprint',
  '/stats/status-by-path',
  '/stats/patterns',
  '/stats/events',
  '/stats/mcp-tools',
  '/stats/mcp-sources',
  '/stats/sources',
  '/stats/traffic-trend',
];

describe('/stats/* : une statistique cassée est journalisée', () => {
  it('couvre les seize routes de la famille', () => {
    const app = new Hono();
    app.route('/', stats);
    const served = [...new Set(app.routes.map((r) => r.path))].sort();
    expect(served).toEqual([...ROUTES].sort());
  });

  it.each(ROUTES)('%s : 500 stats_unavailable, et la cause au journal', async (route) => {
    const app = new Hono();
    app.route('/', stats);
    const res = await app.request(route, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'stats_unavailable' });
    const lines = errorSpy.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`[stats] ${route} failed:`);
    expect(lines[0]).toContain(BROKEN);
  });
});
