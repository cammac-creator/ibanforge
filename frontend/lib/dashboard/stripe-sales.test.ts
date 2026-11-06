import { describe, expect, it } from 'vitest';
import { readSalesDays, salesPeriod, type SalesDay } from './stripe-sales';
import type { StripeRevenueSnapshot } from './stripe-revenue';

const day = (count = 1, usd = 100): SalesDay => ({ count, gross: { usd }, refunded: {}, fees: { chf: 5 }, net_unknown: 0 });
function snapshot(days: Record<string, SalesDay>): StripeRevenueSnapshot {
  const totals = { count: 0, gross: {} as Record<string, number>, refunded: {} as Record<string, number>, fees: {} as Record<string, number>, net_unknown: 0 };
  for (const row of Object.values(days)) {
    totals.count += row.count;
    totals.net_unknown += row.net_unknown;
    for (const key of ['gross', 'refunded', 'fees'] as const) for (const [c, n] of Object.entries(row[key])) totals[key][c] = (totals[key][c] ?? 0) + n;
  }
  // Le lecteur de série ne dépend que de ces trois champs du contrat complet.
  return { read_at: '2030-03-31T22:30:00.000Z', ibanforge: totals, ibanforge_days: days } as StripeRevenueSnapshot;
}

describe('les ventes suivent des jours suisses et la date de lecture', () => {
  it.each([7, 30, 90] as const)('retient exactement %s jours, même au changement d’heure', (length) => {
    const readAt = '2030-03-31T22:30:00.000Z'; // 1er avril, 00 h 30 en Suisse.
    const end = Date.parse('2030-04-01T12:00:00Z');
    const date = (ago: number) => new Date(end - ago * 86400000).toISOString().slice(0, 10);
    const rows = { [date(0)]: day(1, 100), [date(length - 1)]: day(2, 200), [date(length)]: day(4, 400), '2030-04-02': day(8, 800) };
    const period = salesPeriod(rows, readAt, length);
    expect(period.days).toHaveLength(length);
    expect(period.end).toBe('2030-04-01');
    expect(period.start).toBe(date(length - 1));
    expect(period.count).toBe(3);
    expect(period.gross).toEqual({ usd: 300 });
    expect(period.days.filter((d) => d.partial)).toHaveLength(1);
    expect(period.days.at(-1)?.day).toBe('2030-04-01');
    expect(period.days.filter((d) => d.count === 0)).toHaveLength(length - 2);
  });
  it('garde séparés USD, EUR et frais CHF, sans soustraire les remboursements du brut', () => {
    const period = salesPeriod({ '2030-04-01': { ...day(2, 1000), gross: { usd: 1000, eur: 500 }, refunded: { usd: 300 }, fees: { chf: 25 } } }, '2030-04-01T10:00:00.000Z', 7);
    expect(period).toMatchObject({ count: 2, gross: { usd: 1000, eur: 500 }, refunded: { usd: 300 }, fees: { chf: 25 } });
  });
});

describe('la série quotidienne se recoupe avec les cumuls IBANforge', () => {
  it('accepte un historique vide connu et une série cohérente', () => {
    expect(readSalesDays(snapshot({}))).toEqual({});
    const s = snapshot({ '2030-03-31': day() });
    expect(readSalesDays(s)).toEqual(s.ibanforge_days);
  });
  it.each([undefined, null, [], 'illisible'])('refuse un champ absent ou invalide (%s)', (value) => {
    const s = snapshot({}); s.ibanforge_days = value;
    expect(readSalesDays(s)).toBeNull();
  });
  it.each(['2030-02-30', '2030-04-02', '2030-2-01'])('refuse une date impossible ou future : %s', (key) => {
    expect(readSalesDays(snapshot({ [key]: day() }))).toBeNull();
  });
  it.each(['count', 'net_unknown', 'gross', 'fees', 'refunded'] as const)('refuse un cumul %s différent', (field) => {
    const s = snapshot({ '2030-03-31': day() });
    if (field === 'count' || field === 'net_unknown') s.ibanforge[field] += 1;
    else s.ibanforge[field].eur = 1;
    expect(readSalesDays(s)).toBeNull();
  });
  it('refuse remboursement supérieur au brut et frais inconnus supérieurs aux paiements', () => {
    expect(readSalesDays(snapshot({ '2030-03-31': { ...day(), refunded: { usd: 101 } } }))).toBeNull();
    expect(readSalesDays(snapshot({ '2030-03-31': { ...day(), net_unknown: 2 } }))).toBeNull();
  });
});
