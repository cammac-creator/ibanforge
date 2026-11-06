import type { BusinessPulse } from './business-pulse';

/** Jeu entièrement fictif, réservé aux tests de lecture et de rendu. */
export function businessFixture(now = new Date('2026-11-06T12:00:00.000Z')): BusinessPulse {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const days = Array.from({ length: 90 }, (_, i) => ({
    date: day(end - (89 - i) * 86400000),
    active_accounts: 6 + (i % 7),
    new_accounts: i % 3 === 0 ? 2 : 0,
    new_buyers: i % 14 === 0 ? 1 : 0,
  }));
  const monday = end - ((now.getUTCDay() + 6) % 7) * 86400000;
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = day(monday - (7 - i) * 7 * 86400000);
    const finish = day(monday - (7 - i) * 7 * 86400000 + 6 * 86400000);
    const rows = days.filter((d) => d.date >= start && d.date <= finish);
    return {
      start,
      end: finish,
      partial: i === 7,
      new_accounts: rows.reduce((n, d) => n + d.new_accounts, 0),
      new_buyers: rows.reduce((n, d) => n + d.new_buyers, 0),
    };
  });
  return {
    version: 1,
    generated_at: now.toISOString(),
    timezone: 'UTC',
    basis: 'retained_accounts_and_purchases',
    days,
    weeks,
    totals: {
      known_accounts: 94,
      buyer_accounts: 11,
      active_7d: 18,
      active_30d: 37,
      returning_7d: 9,
    },
  };
}
