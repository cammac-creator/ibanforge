import { describe, expect, it } from 'vitest';
import { readActivationFunnel, readAcquisitionSources, readAcquisitionCohorts, observedDelay } from './acquisition-read';

const now = '2026-11-06T14:00:00Z';
const funnel = { period_days: 30, signed_up: 20, first_call: 11, hit_limit: 1, purchased: 5 };
const week = { week_start: '2026-11-02', signups: 4, called_pct: 75, paid_pct: 25 };

describe('Lecture des comptes conservés et de leurs cohortes', () => {
  it('garde les états indépendants, dont un accès possible sans refus', () => {
    expect(readActivationFunnel(funnel)).toEqual(funnel);
    expect(readActivationFunnel({ ...funnel, period_days: 90 })).not.toBeNull();
  });
  it.each([null, {}, { ...funnel, signed_up: -1 }, { ...funnel, first_call: 21 }, { ...funnel, purchased: 1.5 }, { ...funnel, period_days: 7 }])('refuse un compteur ou une fenêtre incohérents : %j', raw => {
    expect(readActivationFunnel(raw)).toBeNull();
  });
  it('distingue les sources vides des lectures absentes et trie sans modifier les données', () => {
    const rows = [{ source: 'b', signups: 1, called: 0, paying: 0 }, { source: 'a', signups: 2, called: 1, paying: 2 }];
    expect(readAcquisitionSources(rows)?.map(r => r.source)).toEqual(['a', 'b']);
    expect(rows[0].source).toBe('b');
    expect(readAcquisitionSources([])).toEqual([]);
    expect(readAcquisitionSources(undefined)).toBeNull();
  });
  it('refuse les doublons et les catégories supérieures à leur population', () => {
    const row = { source: 'direct', signups: 2, called: 1, paying: 1 };
    expect(readAcquisitionSources([row, row])).toBeNull();
    expect(readAcquisitionSources([{ ...row, paying: 3 }])).toBeNull();
    expect(readAcquisitionSources([{ ...row, called: Number.NaN }])).toBeNull();
  });
  it('marque la semaine courante avec l’instant de la page et garde les zéros connus', () => {
    const old = { ...week, week_start: '2026-10-26', signups: 0, called_pct: 0, paid_pct: 0 };
    expect(readAcquisitionCohorts([week, old], now)).toEqual([{ ...old, partial: false }, { ...week, partial: true }]);
    expect(week).not.toHaveProperty('partial');
  });
  it.each([
    { ...week, week_start: '2026-02-30' }, { ...week, week_start: '2026-11-03' },
    { ...week, week_start: '2026-11-09' }, { ...week, partial: false },
    { ...week, signups: 0 }, { ...week, called_pct: 101 }, { ...week, paid_pct: -1 },
  ])('refuse une semaine ou un taux incohérents : %j', row => {
    expect(readAcquisitionCohorts([row], now)).toBeNull();
  });
  it('refuse les semaines répétées et un instant de référence inconnu', () => {
    expect(readAcquisitionCohorts([week, week], now)).toBeNull();
    expect(readAcquisitionCohorts([week], 'inconnu')).toBeNull();
  });
  it('n’invente pas une médiane instantanée quand aucune observation ne la soutient', () => {
    expect(observedDelay(0, 0)).toBeNull();
    expect(observedDelay(0, 2)).toEqual({ hours: 0, sample: 2 });
    expect(observedDelay(6, undefined)).toEqual({ hours: 6, sample: null });
    for (const value of [null, undefined, -1, Infinity, Number.NaN]) expect(observedDelay(value, 2)).toBeNull();
  });
});
