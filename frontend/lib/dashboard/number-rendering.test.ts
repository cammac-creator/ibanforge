import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusByPathTable } from '@/components/dashboard/status-by-path-table';
import { UsageChart } from '@/components/dashboard/usage-chart';
import { StackedBarChart } from '@/components/stacked-bar-chart';
import { FreshnessBadge } from '@/components/crm/freshness-badge';

const language = vi.hoisted(() => ({ current: 'fr' }));
vi.mock('next-intl', () => ({ useLocale: () => language.current }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/dashboard/info-dot', () => ({
  HoverTooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) =>
    createElement('span', null, children, content),
}));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  ComposedChart: ({ children }: { children: ReactNode }) => children,
  XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) =>
    createElement('span', null, tickFormatter('2026-03-05')),
  Bar: () => null,
  Area: () => null,
  Cell: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  Legend: () => null,
}));

afterEach(() => vi.restoreAllMocks());

describe('Rendu stable des compteurs interactifs du tableau de bord', () => {
  it.each([
    ['2026-01-15T08:22:00.000Z', '09:22'],
    ['2026-07-15T08:22:00.000Z', '10:22'],
    ['2026-07-15T22:30:00.000Z', '00:30'],
    ['2026-03-29T00:59:00.000Z', '01:59'],
    ['2026-03-29T01:00:00.000Z', '03:00'],
    ['2026-10-25T00:59:00.000Z', '02:59'],
    ['2026-10-25T01:00:00.000Z', '02:00'],
    ['2026-07-15T10:22:00.000+02:00', '10:22'],
  ])('préserve l’heure suisse de lecture pour %s sans Intl', (fetchedAtIso, time) => {
    const dateFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
      throw new Error('Le badge ne doit pas appeler le formateur natif.');
    });
    const html = renderToStaticMarkup(createElement(FreshnessBadge, { fetchedAtIso }));
    expect(html).toContain(`données de ${time}`);
    expect(dateFormat).not.toHaveBeenCalled();
  });

  it.each(['en', 'fr', 'de'])('garde les nombres et les infobulles identiques en %s', (locale) => {
    language.current = locale;
    const numberFormat = vi.spyOn(Number.prototype, 'toLocaleString');
    const render = () => renderToStaticMarkup(createElement(StatusByPathTable, { rows: [{
      path: '/v1/iban/validate', total: 12345, s2xx: 10001, s3xx: 0, s4xx: 2343, s5xx: 1,
      avg_ms: 12, by_status: { 200: 10001, 402: 2343, 500: 1 }, by_method: { POST: 12345 },
    }] }));

    // Deux environnements natifs divergents doivent produire le même HTML.
    numberFormat.mockReturnValue('format-serveur');
    const server = render();
    numberFormat.mockReturnValue('format-navigateur');
    expect(render()).toBe(server);
    expect(server).toContain(locale === 'en' ? '12,345' : '12 345');
    expect(server).toContain(locale === 'en' ? '10,001' : '10 001');
    expect(server).toContain(locale === 'en' ? '2,343' : '2 343');
    expect(numberFormat).not.toHaveBeenCalled();
  });

  it.each(['en', 'fr', 'de'])('stabilise aussi le total du graphique client en %s', (locale) => {
    language.current = locale;
    const numberFormat = vi.spyOn(Number.prototype, 'toLocaleString');
    const render = () => renderToStaticMarkup(createElement(UsageChart, {
      days: [], series: [12000, 345], months: ['2026-01', '2026-02'],
    }));
    numberFormat.mockReturnValue('format-serveur');
    const server = render();
    numberFormat.mockReturnValue('format-navigateur');
    expect(render()).toBe(server);
    expect(server).toContain(locale === 'en' ? '12,345' : '12 345');
    expect(numberFormat).not.toHaveBeenCalled();
  });

  it('ne confie pas la date du graphique HTTP au format natif du navigateur', () => {
    const dateFormat = vi.spyOn(Date.prototype, 'toLocaleDateString');
    const render = () => renderToStaticMarkup(createElement(StackedBarChart, {
      data: [{ date: '2026-03-05', total: 1234 }], bars: [],
    }));
    dateFormat.mockReturnValue('date-serveur');
    const server = render();
    dateFormat.mockReturnValue('date-navigateur');
    expect(render()).toBe(server);
    expect(server).toContain('05/03');
    expect(dateFormat).not.toHaveBeenCalled();
  });
});
