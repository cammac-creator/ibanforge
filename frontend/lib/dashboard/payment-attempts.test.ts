import { describe, expect, it } from 'vitest';
import { readPaymentAttempts } from './payment-attempts';
import { dailySparkline } from './daily-sparkline';

function fixture() {
  return {
    version: 1, source: 'daily_stats', currency: 'USDC', basis: 'verified_payment_attempts',
    settlement: 'not_reconciled', read_at: '2026-11-06T12:00:00.000Z',
    total_since: '2026-04-18', total_attempted_usdc: 3,
    window: { from: '2026-10-31', to: '2026-11-06', time_zone: 'UTC', days: 7 },
    days: ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
      .map((date, i) => ({ date, attempted_usdc: i === 6 ? 0.25 : 0 })),
  };
}

describe('Tentatives USDC, périmètre et unité', () => {
  it('lit le cumul et conserve les jours sans tentative, jour courant partiel', () => {
    const data = readPaymentAttempts(fixture());
    expect(data?.total_attempted_usdc).toBe(3);
    expect(dailySparkline(data?.days, 'attempted_usdc', '2026-11-06T12:00:00Z')).toEqual({
      values: [0, 0, 0, 0, 0, 0, 0.25], partialLast: true,
    });
  });
  it('accepte un vrai zéro', () => {
    const value = fixture(); value.total_attempted_usdc = 0;
    value.days.forEach((row) => { row.attempted_usdc = 0; });
    expect(readPaymentAttempts(value)?.total_attempted_usdc).toBe(0);
  });
  it.each([null, {}, [], { total_revenue_usdc: 3 }, 'indisponible'])('ne transforme pas une lecture invalide en zéro : %j', (value) => {
    expect(readPaymentAttempts(value)).toBeNull();
  });
  it.each([
    ['version', 2], ['source', 'stripe'], ['currency', 'CHF'], ['basis', 'settled'],
    ['settlement', 'confirmed'], ['total_since', '2026-04-08'],
    ['read_at', '2026-11-31T12:00:00.000Z'], ['read_at', '2026-11-06'],
    ['total_attempted_usdc', -1], ['total_attempted_usdc', NaN],
    ['total_attempted_usdc', Infinity], ['total_attempted_usdc', '3'],
    ['total_attempted_usdc', Number.MAX_SAFE_INTEGER],
  ])('refuse un champ incompatible : %s', (key, value) => {
    expect(readPaymentAttempts({ ...fixture(), [key]: value })).toBeNull();
  });
  it.each([
    { from: '2026-10-30' }, { to: '2026-11-07' }, { days: 30 },
    { time_zone: 'Europe/Zurich' }, { from: '2026-10-32' },
  ])('refuse un périmètre incohérent : %j', (patch) => {
    const value = fixture(); Object.assign(value.window, patch);
    expect(readPaymentAttempts(value)).toBeNull();
  });
  it('refuse les dates absentes, répétées, désordonnées ou futures', () => {
    for (const change of [
      (d: ReturnType<typeof fixture>) => { d.days.pop(); },
      (d: ReturnType<typeof fixture>) => { d.days[1].date = d.days[0].date; },
      (d: ReturnType<typeof fixture>) => { d.days.reverse(); },
      (d: ReturnType<typeof fixture>) => { d.days[6].date = '2026-11-07'; },
    ]) {
      const value = fixture(); change(value); expect(readPaymentAttempts(value)).toBeNull();
    }
  });
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])('refuse un jour illisible : %s', (amount) => {
    const value = fixture(); value.days[0].attempted_usdc = amount;
    expect(readPaymentAttempts(value)).toBeNull();
  });
  it('refuse une semaine supérieure au cumul, avec une tolérance limitée aux arrondis USDC', () => {
    const value = fixture(); value.total_attempted_usdc = 0.1;
    expect(readPaymentAttempts(value)).toBeNull();
    value.total_attempted_usdc = 0.249999;
    expect(readPaymentAttempts(value)).not.toBeNull();
  });
});
