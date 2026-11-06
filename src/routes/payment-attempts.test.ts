import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { Hono } from 'hono';

const isolated = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-tentatives-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});
import { getStatsDB } from '../lib/db.js';
import { getPaymentAttempts } from '../lib/payment-attempts.js';
import { getStats, getStatsHistory } from '../lib/stats.js';
import { stats } from './stats.js';

const app = new Hono().route('/', stats);
const previousToken = process.env.STATS_TOKEN;
const auth = { headers: { Authorization: 'Bearer jeton-fictif' } };
const db = getStatsDB();
const insert = (date: string, amount: number | string | null, kind = 'iban_validate') =>
  db
    .prepare('INSERT INTO daily_stats (date, operation_type, revenue_usdc) VALUES (?, ?, ?)')
    .run(date, kind, amount);
beforeEach(() => {
  process.env.STATS_TOKEN = 'jeton-fictif';
  db.exec('DELETE FROM daily_stats');
});
afterAll(() => {
  if (previousToken === undefined) delete process.env.STATS_TOKEN;
  else process.env.STATS_TOKEN = previousToken;
  for (const suffix of ['', '-wal', '-shm']) rmSync(isolated + suffix, { force: true });
});

describe('Lecture ciblée des tentatives USDC', () => {
  it('rend sept dates UTC et de vrais zéros sans aucune tentative', () => {
    const data = getPaymentAttempts(new Date('2026-11-06T12:00:00Z'));
    expect(data.window).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
      days: 7,
      time_zone: 'UTC',
    });
    expect(data.days.map((row) => row.date)).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(data.days.every((row) => row.attempted_usdc === 0)).toBe(true);
    expect(data.total_attempted_usdc).toBe(0);
    expect(data).toMatchObject({
      basis: 'verified_payment_attempts',
      settlement: 'not_reconciled',
      currency: 'USDC',
    });
  });
  it('garde le début historique, inclut les packs et écarte demain', () => {
    insert('2026-04-17', 100);
    insert('2026-04-18', 1);
    insert('2026-10-30', 2);
    insert('2026-10-31', 0.1);
    insert('2026-11-06', 3, 'credits_purchase');
    insert('2026-11-06', 0.2);
    insert('2026-11-07', 9000);
    const data = getPaymentAttempts(new Date('2026-11-06T23:59:59.999Z'));
    expect(data.total_since).toBe('2026-04-18');
    expect(data.total_attempted_usdc).toBe(6.3);
    expect(data.days[0].attempted_usdc).toBe(0.1);
    expect(data.days[6].attempted_usdc).toBe(3.2);
  });
  it('retrouve les montants des routes complètes sur une même base sans dates futures', () => {
    const now = new Date();
    for (let back = 0; back < 10; back++) {
      insert(
        new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10),
        (back + 1) / 10,
      );
    }
    const data = getPaymentAttempts(now);
    expect(data.total_attempted_usdc).toBe(getStats().total_revenue_usdc_clean);
    expect(data.days).toEqual(
      getStatsHistory(7).map((row) => ({
        date: row.date,
        attempted_usdc: Math.round(row.revenue_usdc * 1e6) / 1e6,
      })),
    );
  });
  it.each([null, 'illisible', -0.1, Infinity, Number.MAX_SAFE_INTEGER])(
    'refuse un montant illisible : %s',
    (value) => {
      insert('2026-11-05', value);
      expect(() => getPaymentAttempts(new Date('2026-11-06T12:00:00Z'))).toThrow();
    },
  );
  it('refuse une date impossible dans le cumul', () => {
    insert('2026-09-31', 2);
    expect(() => getPaymentAttempts(new Date('2026-11-06T12:00:00Z'))).toThrow();
  });
  it('interdit une lecture anonyme, un faux jeton et un service sans jeton', async () => {
    expect((await app.request('/stats/payment-attempts')).status).toBe(403);
    expect(
      (await app.request('/stats/payment-attempts', { headers: { Authorization: 'Bearer faux' } }))
        .status,
    ).toBe(403);
    delete process.env.STATS_TOKEN;
    expect((await app.request('/stats/payment-attempts', auth)).status).toBe(403);
  });
  it('sert uniquement le périmètre fixe, privé et non mis en cache', async () => {
    const response = await app.request('/stats/payment-attempts', auth);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      version: 1,
      source: 'daily_stats',
      window: { days: 7 },
    });
    for (const query of ['period=30', 'days=7', 'foo=bar']) {
      expect((await app.request(`/stats/payment-attempts?${query}`, auth)).status).toBe(400);
    }
  });
  it('une corruption répond indisponible, jamais zéro', async () => {
    insert(new Date().toISOString().slice(0, 10), 'illisible');
    const response = await app.request('/stats/payment-attempts', auth);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'stats_unavailable' });
  });
});
