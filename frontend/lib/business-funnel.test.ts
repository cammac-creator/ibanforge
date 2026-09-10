import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';
import { BusinessFunnelChart } from '@/components/dashboard/business-funnel-chart';
import { businessFunnelRows, formatRequestDay, isCurrentUtcDay, type BusinessFunnelDay, type BusinessFunnelRow } from './business-funnel';

// Seul le moteur SVG est remplacé : les libellés, infobulles et notes viennent du composant réel.
vi.mock('recharts', async () => {
  const React = await import('react');
  const Rows = React.createContext<BusinessFunnelRow[]>([]);
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
    BarChart: ({ data, children }: { data: BusinessFunnelRow[]; children: ReactNode }) =>
      React.createElement(Rows.Provider, { value: data }, children),
    Bar: ({ name, children }: { name?: string; children?: ReactNode }) =>
      React.createElement('div', null, name, children),
    Cell: ({ fillOpacity }: { fillOpacity: number }) => React.createElement('i', { 'data-opacity': fillOpacity }),
    XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) => {
      const row = React.useContext(Rows)[0];
      return React.createElement('span', null, tickFormatter(row.date));
    },
    YAxis: () => null,
    Legend: () => null,
    ReferenceLine: ({ x }: { x: string }) => React.createElement('i', { 'data-marker': x }),
    Tooltip: ({ content }: { content: ReactElement<{ active?: boolean; payload?: Array<{ payload: BusinessFunnelRow }>; label?: string }> }) => {
      const row = React.useContext(Rows)[0];
      return React.cloneElement(content, { active: true, payload: [{ payload: row }], label: row.date });
    },
  };
});

const day = '2032-04-06';
const sample: BusinessFunnelDay = { date: day, success: 1, paywall: 1, auth_or_quota: 0, bad_input: 0, server_error: 0 };

describe('Résultats HTTP et cohortes', () => {
  it('calcule une part de réponses réussies sans ajouter les validations de cohortes', () => {
    const plain = businessFunnelRows([sample])[0];
    const withCohort = businessFunnelRows([sample], { [day]: 1200 })[0];
    expect(plain).toMatchObject({ total: 2, successShare: 50 });
    expect(withCohort).toMatchObject({ total: 2, successShare: 50, cohort_units: 1200 });
    expect(withCohort.cohort_scaled).toBeCloseTo(0.36);
    expect(withCohort.cohort_gap).toBeCloseTo(0.1);
    expect(sample).toEqual({ date: day, success: 1, paywall: 1, auth_or_quota: 0, bad_input: 0, server_error: 0 });
  });

  it('ne crée pas de réponses réussies quand seule la cohorte a une activité', () => {
    expect(businessFunnelRows([{ ...sample, success: 0, paywall: 0 }], { [day]: 1200 })[0])
      .toMatchObject({ total: 0, successShare: 0, cohort_units: 1200 });
    expect(businessFunnelRows([])).toEqual([]);
  });

  it('utilise le jour UTC fourni par la page, sans consulter une seconde horloge', () => {
    expect(isCurrentUtcDay(day, day)).toBe(true);
    expect(isCurrentUtcDay('2032-04-05', day)).toBe(false);
    expect(isCurrentUtcDay(undefined, day)).toBe(false);
  });

  it.each([['en', '04/06'], ['fr', '06/04'], ['de', '06.04']])('formate le jour sans dépendance au moteur du navigateur en %s', (locale, expected) => {
    expect(formatRequestDay(day, locale)).toBe(expected);
    expect(formatRequestDay('date inconnue', locale)).toBe('date inconnue');
  });
});

const messages = { en, fr, de };
function render(locale: keyof typeof messages, data: BusinessFunnelDay[], todayUtc = day) {
  // Le type du fournisseur exige children dans ses props pour ce rendu sans JSX.
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale, messages: messages[locale], timeZone: 'UTC',
    children: createElement(BusinessFunnelChart, {
      data, todayUtc, cohortByDate: { [day]: 1200 },
      markers: [{ date: day, label: 'Repère fictif A', kind: 'deploy' }, { date: `${day}T12:00:00Z`, label: 'Repère fictif B', kind: 'deploy' }, { date: '2031-01-01', label: 'Hors période', kind: 'deploy' }],
    }),
  }));
}

describe.each(['en', 'fr', 'de'] as const)('Graphique et infobulle en %s', (locale) => {
  const copy = messages[locale].dashboard.overview.details.businessFunnelChart;

  it('rend les cinq statuts, la part technique et les limites dans la langue choisie', () => {
    const html = render(locale, [sample]);
    for (const label of Object.values(copy.series)) expect(html).toContain(label);
    expect(html).toContain(copy.successShare);
    expect(html).toContain('50%');
    expect(html).toContain(copy.reading);
    expect(html).toContain(copy.cohortLegend);
    expect(html).toContain(copy.cohortNote);
    expect(html).toContain(copy.partialDay);
    expect(html).toContain('data-opacity="0.3"');
    expect(html).not.toContain('Paid success');
    expect(html).not.toContain('Taux de conversion');
    expect(html).toContain('Repère fictif A · Repère fictif B');
    expect(html.match(/data-marker=/g)).toHaveLength(1);
    expect(html).not.toContain('Hors période');
  });

  it('rend les états sans requête et sans pourcentage inventé', () => {
    expect(render(locale, [])).toContain(copy.empty);
    const html = render(locale, [{ ...sample, success: 0, paywall: 0 }]);
    expect(html).toContain(copy.emptyDay);
    expect(html).not.toContain(copy.successShare);
    expect(html).not.toContain('NaN');
    expect(html).toContain(copy.cohortValue);
  });

  it('réserve l’avertissement de journée incomplète au dernier jour courant', () => {
    const html = render(locale, [sample], '2032-04-07');
    expect(html).not.toContain(copy.partialDay);
    expect(html).not.toContain('data-opacity="0.3"');
  });
});
