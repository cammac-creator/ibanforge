import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { stats } from './stats.js';
import { recordRejection } from '../lib/stats.js';
import type { RejectionRow } from '../lib/stats.js';

const app = new Hono();
app.route('/', stats);

const TOKEN = 'test-stats-token';
const PREVIOUS = process.env.STATS_TOKEN;

beforeAll(() => {
  process.env.STATS_TOKEN = TOKEN;
});

afterAll(() => {
  if (PREVIOUS === undefined) delete process.env.STATS_TOKEN;
  else process.env.STATS_TOKEN = PREVIOUS;
});

const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

describe('GET /stats/rejections', () => {
  it('exige le même Bearer STATS_TOKEN que les autres routes /stats/*', async () => {
    const res = await app.request('/stats/rejections');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('refuse un token faux', async () => {
    const res = await app.request('/stats/rejections', {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(403);
  });

  it('renvoie les catégories de rejet agrégées', async () => {
    recordRejection('bic_lookup', 'normalizable');
    const res = await app.request('/stats/rejections', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { period_days: number; rows: RejectionRow[] };
    expect(body.period_days).toBe(30);
    const row = body.rows.find(
      (r) => r.operation_type === 'bic_lookup' && r.reject_reason === 'normalizable',
    );
    expect(row).toBeDefined();
    expect(row!.count).toBeGreaterThan(0);
  });

  it('borne la fenêtre à 90 jours et retombe sur 30 si le paramètre est illisible', async () => {
    const clamped = await app.request('/stats/rejections?days=999', auth);
    expect(((await clamped.json()) as { period_days: number }).period_days).toBe(90);

    const floored = await app.request('/stats/rejections?days=0', auth);
    expect(((await floored.json()) as { period_days: number }).period_days).toBe(1);

    // `parseInt('abc')` vaut NaN : sans garde, il traverserait Math.max/min et
    // produirait la fenêtre SQL '-NaN days', silencieusement vide.
    const garbage = await app.request('/stats/rejections?days=abc', auth);
    expect(((await garbage.json()) as { period_days: number }).period_days).toBe(30);
  });
});

describe('GET /stats — clean revenue total', () => {
  it('serves total_revenue_usdc_clean, bounded by the raw total', async () => {
    const res = await app.request('/stats', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_revenue_usdc: number;
      total_revenue_usdc_clean: number;
    };
    expect(typeof body.total_revenue_usdc_clean).toBe('number');
    // The clean figure excludes the pre-2026-04-18 drift, so it can never
    // exceed the all-time attempted sum.
    expect(body.total_revenue_usdc_clean).toBeLessThanOrEqual(body.total_revenue_usdc);
  });
});

describe('GET /stats — freshness witness', () => {
  it('serves last_write_at so the dashboard can tell a dead collector from a quiet day', async () => {
    const res = await app.request('/stats', auth);
    const body = (await res.json()) as { last_write_at: string | null };
    // The local DB always has request_log rows (the suite itself writes some),
    // so the witness must be a datetime string, not undefined.
    expect(typeof body.last_write_at).toBe('string');
  });
});

describe('GET /stats/events', () => {
  it('requires the stats token', async () => {
    const res = await app.request('/stats/events');
    expect(res.status).toBe(403);
  });

  it('returns annotation rows', async () => {
    const { recordEvent } = await import('../lib/events.js');
    recordEvent('manual', 'stats-route-events-fixture');
    const res = await app.request('/stats/events?period=7', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ label: string; kind: string }> };
    expect(body.events.some((e) => e.label === 'stats-route-events-fixture')).toBe(true);
    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare(`DELETE FROM events WHERE label = 'stats-route-events-fixture'`).run();
  });
});

describe('GET /stats/history — expected weekday band', () => {
  it('every entry carries expected_min/expected_max fields (null when history is short)', async () => {
    const res = await app.request('/stats/history?period=7', auth);
    const body = (await res.json()) as Array<{
      date: string;
      expected_min: number | null;
      expected_max: number | null;
    }>;
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect('expected_min' in row).toBe(true);
      expect('expected_max' in row).toBe(true);
    }
  });
});
