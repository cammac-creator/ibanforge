import { beforeEach, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { swissWeekFromLabel } from './bulletin.js';
import { deleteCost, listCosts, moneyPeriods, readMoney, saveCost } from './bulletin-money.js';
import type { StripeRevenueResult, StripeRevenueSnapshot } from './stripe-revenue.js';

/**
 * « Encaissé moins coûts » (priorité 05). Montants INVENTÉS et ronds, aucun chiffre
 * réel (dépôt public). Semaine 40 : du 28.09 au 04.10.2026 ; ses périodes sont
 * septembre entier et octobre du 1er au 4.
 */
const W40 = swissWeekFromLabel('2026-W40')!;

function snapshot(over: Partial<StripeRevenueSnapshot> = {}): StripeRevenueSnapshot {
  const empty = {
    count: 0,
    gross: {},
    refunded: {},
    fees: {},
    net: {},
    net_unknown: 0,
    last_payment_at: null,
  };
  return {
    version: 1,
    read_at: '2026-10-07T09:55:00.000Z',
    livemode: true,
    by_kind: { pack: empty, abonnement: empty, audit: empty, autre: empty },
    ibanforge: empty,
    account: empty,
    classification: { invoices: true, sessions: true },
    payouts: null,
    balance: null,
    awaiting_payout: null,
    ibanforge_days: {
      // Août : hors des deux périodes.
      '2026-08-31': {
        count: 1,
        gross: { usd: 5000 },
        refunded: {},
        fees: { chf: 100 },
        net_unknown: 0,
      },
      '2026-09-10': {
        count: 2,
        gross: { usd: 3000 },
        refunded: {},
        fees: { chf: 200 },
        net_unknown: 0,
      },
      '2026-09-30': {
        count: 1,
        gross: { usd: 1000 },
        refunded: { usd: 1000 },
        fees: { chf: 50 },
        net_unknown: 0,
      },
      '2026-10-02': {
        count: 1,
        gross: { usd: 2000 },
        refunded: {},
        fees: { chf: 80 },
        net_unknown: 0,
      },
      // Après le dimanche de la semaine : hors du mois en cours lu.
      '2026-10-05': {
        count: 1,
        gross: { usd: 9000 },
        refunded: {},
        fees: { chf: 300 },
        net_unknown: 0,
      },
    },
    ...over,
  };
}

const ok = (s: StripeRevenueSnapshot = snapshot()): StripeRevenueResult => ({
  ok: true,
  snapshot: s,
});

function cost(
  item: string,
  from: string,
  to: string,
  amount_minor: number,
  currency = 'usd',
  nature = 'facture',
) {
  const r = saveCost({ item, from, to, amount_minor, currency, nature });
  if (!r.ok) throw new Error(`${item} ${from}: ${r.error}`);
  return r;
}

beforeEach(() => {
  getStatsDB().exec('DELETE FROM bulletin_costs');
});

describe('les périodes du bulletin', () => {
  it('le mois précédent entier, et le mois du dimanche jusqu’à la fin de la semaine', () => {
    expect(moneyPeriods(W40)).toEqual([
      { month: '2026-09', from: '2026-09-01', to: '2026-10-01', complete: true },
      { month: '2026-10', from: '2026-10-01', to: '2026-10-05', complete: false },
    ]);
    // Une semaine à cheval sur deux mois : le mois du dimanche, lu jusqu'à lui.
    expect(moneyPeriods(swissWeekFromLabel('2026-W44')!)[1]).toEqual({
      month: '2026-11',
      from: '2026-11-01',
      to: '2026-11-02',
      complete: false,
    });
    // Une semaine qui finit le mois (dimanche 31.05.2026) : le mois en cours est entier.
    expect(moneyPeriods(swissWeekFromLabel('2026-W22')!)).toEqual([
      { month: '2026-04', from: '2026-04-01', to: '2026-05-01', complete: true },
      { month: '2026-05', from: '2026-05-01', to: '2026-06-01', complete: true },
    ]);
    // Janvier : le mois précédent est décembre de l'année d'avant.
    expect(moneyPeriods(swissWeekFromLabel('2027-W02')!)[0]).toMatchObject({
      month: '2026-12',
      from: '2026-12-01',
    });
  });
});

describe('les saisies de coûts', () => {
  it('refuse ce qui n’a pas sa forme', () => {
    const good = {
      item: 'vercel',
      from: '2026-09-01',
      to: '2026-10-01',
      amount_minor: 1000,
      currency: 'usd',
      nature: 'releve',
    };
    expect(saveCost(good)).toMatchObject({ ok: true, replaced: false });
    for (const [patch, error] of [
      [{ item: 'loyer' }, 'invalid_item'],
      [{ from: '2026-09-31' }, 'invalid_period'],
      [{ to: '2026-09-01' }, 'invalid_period'],
      [{ to: '2028-01-01' }, 'invalid_period'],
      [{ amount_minor: 10.5 }, 'invalid_amount'],
      [{ amount_minor: -1 }, 'invalid_amount'],
      [{ amount_minor: '1000' }, 'invalid_amount'],
      [{ currency: 'USD' }, 'invalid_currency'],
      [{ nature: 'devine' }, 'invalid_nature'],
      [{ note: 42 }, 'invalid_note'],
      [{ montant: 1 }, 'invalid_body'],
    ] as const) {
      expect(saveCost({ ...good, ...patch }), JSON.stringify(patch)).toEqual({ ok: false, error });
    }
  });

  it('remplace la même période, refuse un chevauchement, et retire une saisie', () => {
    const first = cost('railway', '2026-09-01', '2026-10-01', 500);
    expect(cost('railway', '2026-09-01', '2026-10-01', 700)).toEqual({
      ok: true,
      id: first.id,
      replaced: true,
    });
    expect(
      saveCost({
        item: 'railway',
        from: '2026-09-15',
        to: '2026-10-15',
        amount_minor: 1,
        currency: 'usd',
        nature: 'facture',
      }),
    ).toEqual({ ok: false, error: 'overlap' });
    // Un autre poste sur la même période ne chevauche rien.
    cost('vercel', '2026-09-15', '2026-10-15', 1);
    expect(listCosts().map((c) => [c.item, c.amount_minor])).toEqual([
      ['railway', 700],
      ['vercel', 1],
    ]);
    expect(deleteCost(first.id)).toBe(true);
    expect(deleteCost(first.id)).toBe(false);
  });
});

describe('encaissé moins coûts', () => {
  it('sans coût saisi : l’encaissé lu, et un plafond, jamais un zéro', () => {
    const m = readMoney(W40, ok());
    const [sep, oct] = m.periods;
    expect(m.stripe_read_at).toBe('2026-10-07T09:55:00.000Z');
    expect(sep.received).toEqual({
      state: 'read',
      count: 3,
      gross: { usd: 4000 },
      refunded: { usd: 1000 },
      test_mode: false,
    });
    expect(sep.costs.find((c) => c.item === 'frais_stripe')).toMatchObject({
      state: 'connu',
      amounts: { chf: 250 },
      nature: 'mesure',
    });
    expect(sep.costs.find((c) => c.item === 'vercel')).toMatchObject({
      state: 'inconnu',
      reason: 'non_saisi',
      blocking: true,
    });
    // Un poste ponctuel non saisi ne fait pas du résultat un plafond.
    expect(sep.costs.find((c) => c.item === 'domaines')).toMatchObject({
      state: 'inconnu',
      reason: 'non_saisi',
      blocking: false,
    });
    expect(sep.result).toEqual({
      status: 'au_plus',
      by_currency: { usd: 3000, chf: -250 },
      missing: ['Site (Vercel)', 'API (Railway)', 'Modèles de langage'],
    });
    expect(oct.received).toMatchObject({ count: 1, gross: { usd: 2000 } });
  });

  it('tous les postes attendus couverts : un résultat exact, devise par devise', () => {
    cost('vercel', '2026-09-01', '2026-10-01', 2000, 'usd', 'releve');
    // Deux saisies qui pavent le mois sans trou.
    cost('railway', '2026-09-01', '2026-09-16', 300);
    cost('railway', '2026-09-16', '2026-10-01', 200);
    cost('modeles', '2026-09-01', '2026-10-01', 100);
    cost('domaines', '2026-09-01', '2026-10-01', 1500, 'chf');
    const [sep] = readMoney(W40, ok()).periods;
    expect(sep.costs.find((c) => c.item === 'railway')).toMatchObject({
      state: 'connu',
      amounts: { usd: 500 },
      nature: 'facture',
    });
    expect(sep.costs.find((c) => c.item === 'vercel')).toMatchObject({ nature: 'releve' });
    expect(sep.result).toEqual({
      status: 'exact',
      by_currency: { usd: 3000 - 2000 - 500 - 100, chf: -250 - 1500 },
      missing: [],
    });
  });

  it('une estimation se dit estimée', () => {
    cost('vercel', '2026-09-01', '2026-10-01', 2000, 'usd', 'estime');
    cost('railway', '2026-09-01', '2026-10-01', 500);
    cost('modeles', '2026-09-01', '2026-10-01', 100);
    expect(readMoney(W40, ok()).periods[0].result.status).toBe('estime');
  });

  it('une saisie qui déborde ou laisse un trou rend le poste inconnu, jamais au prorata', () => {
    // Un cycle du 9 au 9 : il déborde de septembre.
    cost('vercel', '2026-09-09', '2026-10-09', 2000);
    cost('railway', '2026-09-01', '2026-09-20', 300);
    cost('modeles', '2026-09-01', '2026-10-01', 100);
    const [sep, oct] = readMoney(W40, ok()).periods;
    expect(sep.costs.find((c) => c.item === 'vercel')).toMatchObject({
      state: 'inconnu',
      reason: 'deborde',
    });
    expect(sep.costs.find((c) => c.item === 'railway')).toMatchObject({
      state: 'inconnu',
      reason: 'partiel',
    });
    expect(sep.result).toMatchObject({
      status: 'au_plus',
      missing: ['Site (Vercel)', 'API (Railway)'],
    });
    // Le mois en cours, lu jusqu'au dimanche, n'est couvert par aucune saisie mensuelle.
    expect(oct.complete).toBe(false);
    expect(oct.result.status).toBe('au_plus');
  });

  it('Stripe injoignable, ou un classement manqué : le résultat est inconnu', () => {
    const down = readMoney(W40, { ok: false, reason: 'stripe_unreachable' }).periods[0];
    expect(down.received).toEqual({ state: 'inconnu', reason: 'stripe_unreachable' });
    expect(down.costs.find((c) => c.item === 'frais_stripe')).toMatchObject({
      state: 'inconnu',
      reason: 'stripe_indisponible',
    });
    expect(down.result).toMatchObject({ status: 'inconnu', by_currency: null });
    const partial = readMoney(
      W40,
      ok(snapshot({ classification: { invoices: false, sessions: true } })),
    ).periods[0];
    expect(partial.received).toEqual({ state: 'inconnu', reason: 'classement_incomplet' });
    expect(partial.result.status).toBe('inconnu');
  });

  it('des frais illisibles font du résultat un plafond, et une clé de test se dit', () => {
    const s = snapshot({ livemode: false });
    s.ibanforge_days['2026-09-10'] = { ...s.ibanforge_days['2026-09-10'], net_unknown: 1 };
    const [sep] = readMoney(W40, ok(s)).periods;
    expect(sep.received).toMatchObject({ test_mode: true });
    expect(sep.costs.find((c) => c.item === 'frais_stripe')).toMatchObject({
      state: 'inconnu',
      reason: 'frais_incomplets',
      blocking: true,
    });
    expect(sep.result.missing).toContain('Frais Stripe');
  });
});
