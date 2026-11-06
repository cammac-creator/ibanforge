import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { closeAll, getStatsDB } from './db.js';
import { getHourlyStats } from './stats.js';
import { stats } from '../routes/stats.js';
afterAll(closeAll);
beforeEach(() => {
  vi.stubEnv('STATS_TOKEN', 'jeton-statistiques-fictif');
  getStatsDB().exec('DELETE FROM hourly_stats');
});
afterEach(() => vi.unstubAllEnvs());
const date = (age: number) =>
  (getStatsDB().prepare("SELECT date('now', ?) AS d").get(`${-age} days`) as { d: string }).d;
function add(age: number, hour: number, total: number, type = 'iban_validate') {
  getStatsDB()
    .prepare(
      `INSERT INTO hourly_stats(date,hour,day_of_week,operation_type,total,success_count) VALUES(?,?,(CAST(strftime('%w',?) AS INTEGER)+6)%7,?,?,?)`,
    )
    .run(date(age), hour, date(age), type, total, total);
}
describe('fenêtre horaire UTC', () => {
  it.each([1, 7, 30, 90])(
    'compte exactement %i dates aujourd’hui inclus, sans dates futures',
    (span) => {
      add(0, 9, 2);
      if (span > 1) add(span - 1, 10, 3);
      add(span, 11, 40);
      add(-1, 12, 50);
      const r = getHourlyStats(span);
      expect(r.period_days).toBe(span);
      expect(r.window_start).toBe(date(span - 1));
      expect(r.window_end).toBe(date(0));
      expect(r.heatmap.reduce((s, p) => s + p.total, 0)).toBe(span === 1 ? 2 : 5);
      expect(r).toMatchObject({ source: 'hourly_stats', unit: 'operations', timezone: 'UTC' });
      expect(
        (getStatsDB().prepare('SELECT SUM(total) AS n FROM hourly_stats').get() as { n: number }).n,
      ).toBe(span === 1 ? 92 : 95);
    },
  );
  it('additionne les opérations des mêmes créneaux et exclut le marqueur suisse sans effacer les lignes', () => {
    add(0, 9, 2);
    add(7, 9, 3);
    add(0, 9, 100, 'audit_upload_ch');
    add(0, 9, 4, 'iban_batch');
    const r = getHourlyStats(30);
    expect(r.heatmap).toHaveLength(1);
    expect(r.heatmap[0].total).toBe(9);
  });
  it('garde une lecture vide datée et borne les appels internes', () => {
    expect(getHourlyStats(0).period_days).toBe(1);
    expect(getHourlyStats(NaN).period_days).toBe(7);
    expect(getHourlyStats(100).period_days).toBe(90);
    expect(getHourlyStats(7).heatmap).toEqual([]);
  });
  it('sert la période et interdit le cache de la lecture privée', async () => {
    const app = new Hono().route('/', stats);
    const res = await app.request('/stats/hourly?period=7', {
      headers: { Authorization: `Bearer ${process.env.STATS_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ period_days: 7, unit: 'operations', timezone: 'UTC' });
    expect((await app.request('/stats/hourly?period=7')).status).toBe(403);
  });
});
