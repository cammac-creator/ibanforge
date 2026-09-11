import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';
import { ServiceUsageCard } from '@/components/dashboard/overview/service-usage-card';
import { retainedServiceUsage, type ServiceUsageSnapshot } from './service-usage';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: 'en' | 'fr' | 'de' }) =>
    createTranslator({ locale, messages: { en, fr, de }[locale], namespace: 'dashboard.overview' }),
}));

const sample = (patch: Partial<ServiceUsageSnapshot> = {}): ServiceUsageSnapshot => ({
  version: 1, period_days: 30, window_start: '2026-08-13T00:00:00.000Z',
  observed_until: '2026-09-11T12:34:56.789Z', unit: 'account', observation_basis: 'retained_request_log',
  active_accounts: 1234, returning_accounts: 5, first_observed_accounts: 8, ...patch,
});

async function render(value: unknown, locale = 'fr') {
  return renderToStaticMarkup(await ServiceUsageCard({ value, locale }));
}

describe('Réponses observées : contrat et limites de lecture', () => {
  it.each([
    undefined, null, {}, { version: 0 }, { ...sample(), unit: 'key' },
    { ...sample(), observation_basis: 'operations' }, { ...sample(), period_days: 7 },
    { ...sample(), active_accounts: -1 }, { ...sample(), returning_accounts: 1235 },
    { ...sample(), first_observed_accounts: 1235 }, { ...sample(), active_accounts: NaN },
    { ...sample(), returning_accounts: 0.5 }, { ...sample(), first_observed_accounts: '0' },
    { ...sample(), active_accounts: Number.MAX_SAFE_INTEGER + 1 },
    { ...sample(), window_start: '2026-08-12T00:00:00.000Z' },
    { ...sample(), window_start: '2026-08-13T01:00:00.000Z' },
    { ...sample(), observed_until: '2026-09-11T12:34:56+02:00' },
    { ...sample(), observed_until: '2026-09-31T12:34:56.789Z' },
    { ...sample(), observed_until: 'pas une date' },
  ])('ne transforme pas une lecture absente ou incompatible en zéro (%#)', async (value) => {
    expect(retainedServiceUsage(value)).toBeNull();
    const html = await render(value);
    expect(html).toContain('data-service-usage="unavailable"');
    expect(html).toContain('Mesure indisponible');
    expect(html).not.toContain('data-service-count');
  });

  it('accepte les fenêtres UTC de 30 et 90 jours, jour courant inclus', () => {
    expect(retainedServiceUsage(sample())).not.toBeNull();
    expect(retainedServiceUsage(sample({ period_days: 90, window_start: '2026-06-14T00:00:00.000Z' }))).not.toBeNull();
  });

  it('les deux sous-ensembles peuvent se recouper sans invalider la lecture', () => {
    expect(retainedServiceUsage(sample({ active_accounts: 3, returning_accounts: 3, first_observed_accounts: 3 }))).not.toBeNull();
  });

  it('conserve un zéro connu et expose son périmètre', async () => {
    const html = await render(sample({ active_accounts: 0, returning_accounts: 0, first_observed_accounts: 0 }));
    expect(html).toContain('data-service-usage="available"');
    expect(html.match(/data-service-count="[a-z]+">0<\/p>/g)).toHaveLength(3);
    expect(html).toContain('Aucune réponse attribuable observée');
    expect(html).not.toContain('Mesure indisponible');
  });

  it.each([
    ['fr', '1 234', 'Journée en cours incomplète', 'ne s’additionnent pas', 'Ce n’est pas un nombre de personnes', 'pas première utilisation à vie'],
    ['en', '1,234', 'The current day is incomplete', 'must not be added together', 'not a count of people', 'not first-ever usage'],
    ['de', '1 234', 'Der laufende Tag ist unvollständig', 'dürfen nicht addiert werden', 'keine Personenzahl', 'nicht die erste Nutzung überhaupt'],
  ])('affiche les nombres et leurs réserves en %s', async (locale, count, partial, subsets, people, first) => {
    const html = await render(sample(), locale);
    expect(html).toContain(`data-service-count="active">${count}</p>`);
    for (const text of [partial, subsets, people, first, '13/08/2026', '11/09/2026', '12:34 UTC']) expect(html).toContain(text);
    expect(html).toContain('<details');
    expect(html).toContain('MCP');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });
});
