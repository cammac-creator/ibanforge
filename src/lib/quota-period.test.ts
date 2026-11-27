import { describe, it, expect } from 'vitest';
import {
  ALERT_THRESHOLDS,
  DEFAULT_ALERT_THRESHOLDS,
  crossedThresholds,
  currentPeriodFor,
  formatResetUtc,
  isAlertThreshold,
} from './quota-period.js';

describe('currentPeriodFor : la période unique d’un compteur de quota', () => {
  it('dit le mois, son début et la remise à zéro au 1er du mois suivant, 00:00 UTC', () => {
    const p = currentPeriodFor('une-cle', new Date('2026-11-27T16:40:00Z'));
    expect(p).toEqual({
      month: '2026-11',
      start: '2026-11-01T00:00:00.000Z',
      resetsAt: '2026-12-01T00:00:00.000Z',
    });
  });

  it('passe l’année en décembre', () => {
    const p = currentPeriodFor('une-cle', new Date('2026-12-31T23:59:59Z'));
    expect(p.month).toBe('2026-12');
    expect(p.resetsAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('une seconde avant minuit appartient encore au mois qui finit', () => {
    expect(currentPeriodFor('k', new Date('2026-11-30T23:59:59.999Z')).month).toBe('2026-11');
    expect(currentPeriodFor('k', new Date('2026-12-01T00:00:00.000Z')).month).toBe('2026-12');
  });

  it('se dit pareil partout : « 2026-12-01 00:00 UTC »', () => {
    expect(formatResetUtc('2026-12-01T00:00:00.000Z')).toBe('2026-12-01 00:00 UTC');
  });
});

describe('les seuils d’alerte : une liste fermée', () => {
  it('50, 80, 90 et 100, et 80 seul par défaut', () => {
    expect([...ALERT_THRESHOLDS]).toEqual([50, 80, 90, 100]);
    expect([...DEFAULT_ALERT_THRESHOLDS]).toEqual([80]);
  });

  it('refuse tout le reste', () => {
    for (const bad of [0, 10, 95, 101, '80', null, undefined, Number.NaN]) {
      expect(isAlertThreshold(bad), String(bad)).toBe(false);
    }
  });
});

describe('crossedThresholds : de l’arithmétique, sans lecture de base', () => {
  it('un appel ordinaire ne franchit rien', () => {
    expect(crossedThresholds(10, 11, 200)).toEqual([]);
  });

  it('franchit le seuil sur l’appel exact, une seule fois', () => {
    expect(crossedThresholds(99, 100, 200)).toEqual([50]);
    expect(crossedThresholds(100, 101, 200)).toEqual([]);
    expect(crossedThresholds(159, 160, 200)).toEqual([80]);
  });

  it('un lot peut en franchir plusieurs d’un coup', () => {
    expect(crossedThresholds(40, 195, 200)).toEqual([50, 80, 90]);
    expect(crossedThresholds(0, 200, 200)).toEqual([50, 80, 90, 100]);
  });

  it('compte le seuil en unités, arrondi vers le haut', () => {
    // 80 % de 25 = 20 ; 90 % de 15 = 13,5, donc 14.
    expect(crossedThresholds(19, 20, 25)).toEqual([80]);
    expect(crossedThresholds(13, 14, 15)).toEqual([90]);
  });

  it('un plafond nul ou invalide ne franchit rien', () => {
    expect(crossedThresholds(0, 5, 0)).toEqual([]);
    expect(crossedThresholds(0, 5, Number.NaN)).toEqual([]);
  });
});
