import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { businessAccountsHref, businessCohort, readBusinessAccounts, type BusinessAccounts } from './business-accounts';
import { BusinessAccountsReading } from '@/components/dashboard/business-accounts-reading';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const language = vi.hoisted(() => ({ current: 'fr' as 'fr' | 'en' | 'de' }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return { getTranslations: async (namespace: 'dashboard.businessAccounts') => createTranslator({
    locale: language.current, messages: { fr, en, de }[language.current], namespace,
  }) };
});
const NOW = '2026-11-06T12:00:00.000Z';
function fixture(): BusinessAccounts {
  return { version: 1, generated_at: NOW, timezone: 'UTC', basis: 'retained_accounts_and_purchases',
    cohort: 'active_today', window: { start: '2026-11-06', end: '2026-11-06' },
    total: 1, page: 1, page_size: 50, pages: 1,
    rows: [{ email: 'person@alpha.example.net', created_at: '2026-11-02T09:30:00.000Z',
      first_purchase_at: null, active_days: 1, last_active_day: '2026-11-06' }] };
}
const render = async (data: unknown, ok = true) => renderToStaticMarkup(await BusinessAccountsReading({
  promise: Promise.resolve({ ok, data, status: ok ? 200 : 503 }), cohort: 'active_today', locale: language.current, nowIso: NOW,
}));

describe('détail des comptes : contrats et périodes', () => {
  it('accepte la population attendue et projette seulement les champs utiles', () => {
    const input = fixture();
    expect(readBusinessAccounts({ ...input, champInutile: 'exemple' }, 'active_today', NOW)).toEqual(input);
    expect(readBusinessAccounts(input, 'new_buyers', NOW)).toBeNull();
  });
  it.each([null, [], {}, { error: 'unavailable' }])('refuse une réponse absente ou illisible : %j', input => {
    expect(readBusinessAccounts(input, 'active_today', NOW)).toBeNull();
  });
  it('garde zéro distinct de la lecture impossible', () => {
    const input = { ...fixture(), total: 0, rows: [] };
    expect(readBusinessAccounts(input, 'active_today', NOW)?.total).toBe(0);
    expect(readBusinessAccounts({ ...input, page: 2 }, 'active_today', NOW)).toBeNull();
  });
  it('refuse une liste partielle, des doublons et une pagination incohérente', () => {
    const input = fixture();
    for (const bad of [ { ...input, total: 2 }, { ...input, rows: [] }, { ...input, page_size: 500 },
      { ...input, total: 2, rows: [...input.rows, ...input.rows] }, { ...input, pages: 2 }, { ...input, total: -1 } ]) {
      expect(readBusinessAccounts(bad, 'active_today', NOW)).toBeNull();
    }
  });
  it('vérifie la dernière page et sa taille sans perdre le total', () => {
    const input = { ...fixture(), total: 55, page: 2, pages: 2,
      rows: Array.from({ length: 5 }, (_, i) => ({ ...fixture().rows[0], email: `member-${i}@alpha.example.net` })) };
    expect(readBusinessAccounts(input, 'active_today', NOW)).toEqual(input);
    expect(readBusinessAccounts({ ...input, rows: input.rows.slice(1) }, 'active_today', NOW)).toBeNull();
  });
  it('refuse les dates impossibles, sans fuseau et trop futures', () => {
    const input = fixture();
    for (const generated_at of ['2026-11-06T12:00:00', '2026-02-30T12:00:00Z', '2026-11-06T12:02:00Z']) {
      expect(readBusinessAccounts({ ...input, generated_at }, 'active_today', NOW)).toBeNull();
    }
    for (const row of [{ ...input.rows[0], created_at: '2026-11-07T00:00:00Z' },
      { ...input.rows[0], first_purchase_at: 'illisible' }, { ...input.rows[0], first_purchase_at: '2026-11-07T00:00:00Z' }]) {
      expect(readBusinessAccounts({ ...input, rows: [row] }, 'active_today', NOW)).toBeNull();
    }
  });
  it('refuse une autre fenêtre, une activité hors fenêtre et un inactif dans la liste active', () => {
    const input = fixture();
    expect(readBusinessAccounts({ ...input, window: { start: '2026-11-05', end: '2026-11-06' } }, 'active_today', NOW)).toBeNull();
    for (const row of [{ ...input.rows[0], active_days: 0, last_active_day: null },
      { ...input.rows[0], active_days: 2 }, { ...input.rows[0], last_active_day: '2026-11-05' },
      { ...input.rows[0], last_active_day: '2026-11-07' }]) {
      expect(readBusinessAccounts({ ...input, rows: [row] }, 'active_today', NOW)).toBeNull();
    }
  });
  it('un compte nouveau peut n’avoir ni achat ni opération réussie', () => {
    const input: BusinessAccounts = { ...fixture(), cohort: 'new_accounts', window: { start: '2026-11-02', end: '2026-11-06' },
      rows: [{ ...fixture().rows[0], active_days: 0, last_active_day: null }] };
    expect(readBusinessAccounts(input, 'new_accounts', NOW)).toEqual(input);
    expect(readBusinessAccounts({ ...input, cohort: 'new_buyers' }, 'new_buyers', NOW)).toBeNull();
  });
  it('ne transforme pas un achat ancien en premier achat de la semaine', () => {
    const input: BusinessAccounts = { ...fixture(), cohort: 'new_buyers', window: { start: '2026-11-02', end: '2026-11-06' },
      rows: [{ ...fixture().rows[0], first_purchase_at: '2026-11-01T23:59:59.999Z' }] };
    expect(readBusinessAccounts(input, 'new_buyers', NOW)).toBeNull();
    input.rows[0].first_purchase_at = '2026-11-02T00:00:00.000Z';
    expect(readBusinessAccounts(input, 'new_buyers', NOW)).toEqual(input);
  });
  it('valide les sélections et fabrique des liens localisés', () => {
    expect(businessCohort('active_today')).toBe('active_today');
    expect(businessCohort(['active_today'])).toBeNull(); expect(businessCohort('all')).toBeNull();
    expect(businessAccountsHref('fr', 'active_today')).toBe('/fr/dashboard/indicators?cohort=active_today');
    expect(businessAccountsHref('en', 'new_buyers', 2)).toBe('/dashboard/indicators?cohort=new_buyers&page=2');
  });
});

describe('présentation du détail sans faux zéros', () => {
  it.each(['fr', 'en', 'de'] as const)('rend une lecture datée et le lien vers le dossier en %s', async locale => {
    language.current = locale;
    const html = await render(fixture()), t = { fr, en, de }[locale].dashboard.businessAccounts;
    expect(html).toContain('data-business-account'); expect(html).toContain(t.accounts);
    expect(html).toContain('person%40alpha.example.net'); expect(html).toContain('02.11.2026 · 10:30');
    expect(html).toContain(t.noPurchase); expect(html).toContain(t.difference);
    expect(html).not.toContain('data-business-accounts-unavailable');
  });
  it('explique une lecture indisponible sans rendre de liste vide', async () => {
    language.current = 'fr';
    const html = await render(null, false);
    expect(html).toContain(fr.dashboard.businessAccounts.unavailable);
    expect(html).not.toContain(fr.dashboard.businessAccounts.empty);
    expect(html).not.toContain('data-business-account>');
  });
  it('affiche une absence constatée seulement après une lecture valide', async () => {
    language.current = 'fr';
    const html = await render({ ...fixture(), total: 0, rows: [] });
    expect(html).toContain(fr.dashboard.businessAccounts.empty);
    expect(html).not.toContain('data-business-accounts-unavailable');
  });
});
