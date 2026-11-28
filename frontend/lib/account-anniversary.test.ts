import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayOfMonthWord, readDay, readRenewalDay, sheetFromOverviewKey, sheetFromReport } from './account-overview';
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
      renewal_day: 10,
      resets_basis: 'subscription',
    },
    '2026-12',
  )!;

  it('lit le jour et la base servis par l’API, jamais la date UTC', () => {
    expect(sheet.resetsOn).toBe('2027-01-10');
    expect(sheet.renewalDay).toBe(10);
    expect(sheet.resetsBasis).toBe('subscription');
  });

  it('un abonnement du 31 vu en février : le jour dit est 31 (l’ancrage), la date est le 28 (la prochaine)', () => {
    const feb = sheetFromOverviewKey(
      { ...BASE, resets_at: '2027-02-27T23:00:00.000Z', resets_on: '2027-02-28', renewal_day: 31, resets_basis: 'subscription' },
      '2027-02',
    )!;
    expect(feb.renewalDay).toBe(31);
    expect(feb.resetsOn).toBe('2027-02-28');
    expect(dayOfMonthWord(feb.renewalDay!, 'en')).toBe('31st');
    expect(dayOfMonthWord(feb.renewalDay!, 'fr')).toBe('31');
    // La page choisit la phrase qui dit « le dernier jour des mois plus courts » au-delà du 28.
    const app = readFileSync(join(__dirname, '..', 'components', 'account', 'account-app.tsx'), 'utf8');
    expect(app).toContain('sheet.renewalDay > 28 ? "resetsOnSubscriptionLate"');
  });

  it('dit le jour du mois dans la langue de la page, sans Intl', () => {
    expect(dayOfMonthWord(10, 'en')).toBe('10th');
    expect(dayOfMonthWord(10, 'fr')).toBe('10');
    expect(dayOfMonthWord(10, 'de')).toBe('10.');
    expect(dayOfMonthWord(1, 'fr')).toBe('1er');
    expect(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map((d) => dayOfMonthWord(d, 'en')),
    ).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
  });
});

describe('un renouvellement entre 22 h et minuit UTC : la page ne se contredit pas', () => {
  it('jour UTC 30 mais prochaine date le 31 à Zurich : seule la date est dite', () => {
    expect(readRenewalDay(30, '2027-01-31')).toBeNull();
    expect(readRenewalDay(10, '2027-01-11')).toBeNull();
    expect(readRenewalDay(31, '2027-03-01')).toBeNull();
    // Cohérents : même jour, ou dernier jour d'un mois court.
    expect(readRenewalDay(10, '2027-01-10')).toBe(10);
    expect(readRenewalDay(31, '2027-02-28')).toBe(31);
    expect(readRenewalDay(30, '2027-02-28')).toBe(30);
    const sheet = sheetFromOverviewKey(
      { ...BASE, resets_at: '2027-01-30T23:00:00.000Z', resets_on: '2027-01-31', renewal_day: 30, resets_basis: 'subscription' },
      '2027-01',
    )!;
    expect(sheet.renewalDay).toBeNull();
    expect(sheet.resetsOn).toBe('2027-01-31');
    const app = readFileSync(join(__dirname, '..', 'components', 'account', 'account-app.tsx'), 'utf8');
    expect(app).toContain('t("resetsOnSubscriptionDate"');
  });
});

describe('un abonné pas encore basculé', () => {
  it('une clé Pro dont l’API dit « calendar » garde le texte du 1er, sans jour d’ancrage', () => {
    const sheet = sheetFromOverviewKey(
      { ...BASE, resets_at: '2027-01-01T00:00:00.000Z', resets_on: '2027-01-01', renewal_day: null, resets_basis: 'calendar' },
      '2026-12',
    )!;
    expect(sheet.resetsBasis).toBe('calendar');
    expect(sheet.renewalDay).toBeNull();
    expect(sheet.resetsOn).toBe('2027-01-01');
    // La page n'emploie la phrase de l'abonnement que pour la base « subscription » avec son jour.
    const app = readFileSync(join(__dirname, '..', 'components', 'account', 'account-app.tsx'), 'utf8');
    expect(app).toContain('sheet.resetsBasis === "subscription" && sheet.resetsOn && sheet.renewalDay');
    expect(app).toContain('sheet.resetsBasis === "calendar" && sheet.resetsOn');
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
      expect(a.resetsOnSubscriptionLate, loc).toContain('{day}');
      expect(a.resetsOnSubscriptionDate, loc).toContain('{date}');
      expect(a.resetsOnCalendar, loc).toContain('{date}');
    }
  });
});
