import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayOfMonthWord, readDay, sheetFromOverviewKey, sheetFromReport } from './account-overview';
import type { KeyReportPayload } from './account-overview';

/**
 * La date de remise à zéro d'un abonnement, sur la page du compte (chantier
 * « compte client et alertes », lot 2, 27.11.2026). Fixtures inventées.
 */
const BASE = {
  key_prefix: 'ifk_9a8b7c6d',
  created_at: '2026-08-03T10:00:00Z',
  plan: 'pro',
  allowance: { basis: 'monthly', limit: 10000, used: 120, remaining: 9880 },
  credits: null,
  subscription: { plan: 'pro', status: 'active', manage_url: 'https://billing.stripe.com/p/login/demo' },
  calls_this_month: 120,
  last_call_at: '2026-12-11T08:15:00Z',
  alerts: [],
  alert_settings: { thresholds: [80], recipients: [], max_recipients: 3 },
  actions: { topup: null, subscribe_pro: null, manage_subscription: null },
};

describe('un abonné dont l’allocation repart le jour de son abonnement', () => {
  const sheet = sheetFromOverviewKey(
    {
      ...BASE,
      // Minuit de Zurich le 10 janvier, soit 23:00 UTC la veille : la page dit le 10, pas le 9.
      resets_at: '2027-01-09T23:00:00.000Z',
      resets_on: '2027-01-10',
      resets_basis: 'subscription',
    },
    '2026-12',
  )!;

  it('lit le jour et la base servis par l’API, jamais la date UTC', () => {
    expect(sheet.resetsOn).toBe('2027-01-10');
    expect(sheet.resetsBasis).toBe('subscription');
  });

  it('dit le jour du mois dans la langue de la page, sans Intl', () => {
    expect(dayOfMonthWord('2027-01-10', 'en')).toBe('10th');
    expect(dayOfMonthWord('2027-01-10', 'fr')).toBe('10');
    expect(dayOfMonthWord('2027-01-10', 'de')).toBe('10.');
    expect(dayOfMonthWord('2027-02-01', 'fr')).toBe('1er');
    expect(
      ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-11', '2027-03-12', '2027-03-13', '2027-03-21', '2027-03-22', '2027-03-23', '2027-03-31'].map(
        (d) => dayOfMonthWord(d, 'en'),
      ),
    ).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
  });
});

describe('une clé gratuite ou une API d’avant ce lot', () => {
  it('une clé du 1er dit « calendar » ; une API qui ne sert rien ne fait rien deviner', () => {
    const free = sheetFromOverviewKey(
      { ...BASE, plan: 'free', subscription: null, resets_at: '2027-01-01T00:00:00.000Z', resets_on: '2027-01-01', resets_basis: 'calendar' },
      '2026-12',
    )!;
    expect(free.resetsBasis).toBe('calendar');
    expect(free.resetsOn).toBe('2027-01-01');
    const old = sheetFromOverviewKey({ ...BASE, resets_at: '2027-01-01T00:00:00.000Z' }, '2026-12')!;
    expect(old.resetsOn).toBeNull();
    expect(old.resetsBasis).toBeNull();
  });

  it('un jour ou une base mal formés sont écartés', () => {
    expect(readDay('2027-13-01')).toBeNull();
    expect(readDay('2027-01-32')).toBeNull();
    expect(readDay('demain')).toBeNull();
    expect(readDay(20270110)).toBeNull();
    const bad = sheetFromOverviewKey(
      { ...BASE, resets_at: '2027-01-01T00:00:00.000Z', resets_on: 'demain', resets_basis: 'whenever' },
      '2026-12',
    )!;
    expect(bad.resetsOn).toBeNull();
    expect(bad.resetsBasis).toBeNull();
  });
});

describe('une clé collée (rapport) lit la même date', () => {
  it('period_basis et resets_on du bloc usage', () => {
    const payload = {
      key_prefix: 'ifk_9a8b7c6d',
      usage: {
        used: 5,
        limit: 10000,
        remaining: 9995,
        month: '2026-12',
        basis: 'monthly',
        resets_at: '2027-01-09T23:00:00.000Z',
        resets_on: '2027-01-10',
        period_basis: 'subscription',
      },
    } as unknown as KeyReportPayload;
    const sheet = sheetFromReport(payload)!;
    expect(sheet.resetsOn).toBe('2027-01-10');
    expect(sheet.resetsBasis).toBe('subscription');
  });
});

describe('les trois langues disent la date anniversaire', () => {
  const read = (loc: string) =>
    JSON.parse(readFileSync(join(__dirname, '..', 'messages', `${loc}.json`), 'utf8')) as Record<string, unknown>;
  const account = (loc: string) => (read(loc).account ?? read(loc).Account) as Record<string, string>;

  it('une phrase pour l’abonné (jour du mois et date) et une pour la clé du 1er, partout', () => {
    for (const loc of ['en', 'fr', 'de']) {
      const a = account(loc);
      expect(a.resetsOnSubscription, loc).toContain('{day}');
      expect(a.resetsOnSubscription, loc).toContain('{date}');
      expect(a.resetsOnCalendar, loc).toContain('{date}');
    }
  });
});
