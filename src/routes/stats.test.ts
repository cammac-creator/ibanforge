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
