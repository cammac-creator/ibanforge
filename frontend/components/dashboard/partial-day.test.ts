import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StackedBarChart } from '@/components/stacked-bar-chart';
import { BusinessFunnelChart } from './business-funnel-chart';
import { TrafficTrendCard } from './traffic-trend-card';
import { TrafficChart, DailyCallersChart } from './audience/charts';
import { UsageChart } from './usage-chart';
import { ActivityChart } from '@/components/crm/activity-chart';
import { partialDayProps } from './partial-day';
import { sliceToPeriod, type TrafficTrendDay } from '@/lib/traffic-trend';

vi.mock('next-intl', () => ({ useLocale: () => 'fr', useTranslations: () => (key: string) => key }));
// Le moteur graphique est contrôlé en navigateur ; ici on vérifie les données et attributs transmis par chaque carte.
vi.mock('recharts', () => {
  const children = ({ children }: { children: ReactNode }) => children;
  const empty = () => null;
  return { ResponsiveContainer: children, ComposedChart: children, BarChart: children, Bar: children,
    Cell: ({ className, fill }: { className?: string; fill?: string }) => createElement('rect', { className, fill }),
    ReferenceArea: ({ className, fill }: { className?: string; fill?: string }) => createElement('rect', { className, fill }),
    CartesianGrid: empty, XAxis: empty, YAxis: empty, Tooltip: empty, ReferenceLine: empty, Legend: empty, Line: empty, Area: empty };
});
const today = '2026-09-19', nowIso = `${today}T10:00:00.000Z`;
const base = sliceToPeriod([], 7, new Date(nowIso))[0];
const days: TrafficTrendDay[] = ['2026-09-18', today, '2026-09-20'].map(date => ({ ...base, date, total: 20, with_key: 20 }));
afterEach(() => vi.useRealTimers());

describe('Signalement de la seule journée en cours', () => {
  it('ne marque pas une journée future comme incomplète', () => {
    expect(partialDayProps('2026-09-20', today, 'demo')).toEqual({});
    expect(partialDayProps('2026-09-18', today, 'demo')).toEqual({});
  });
  it('partage un motif à 45° dans les quatre graphiques quotidiens', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(nowIso));
    const renders = [
      [createElement(StackedBarChart, { data: days, bars: [{ key: 'total', color: '#abc', label: 'Appels' }] }), 1],
      [createElement(BusinessFunnelChart, { data: days.map(d => ({ date: d.date, success: 20, paywall: 0, auth_or_quota: 0, bad_input: 0, server_error: 0 })), todayUtc: today }), 5],
      [createElement(TrafficTrendCard, { result: { ok: true, days }, nowIso }), 6],
      [createElement(DailyCallersChart, { days: days.map(d => ({ day: d.date, accounts: 4, average: d.date < today ? 4 : null })), today }), 1],
      [createElement(TrafficChart, { days, today }), 1],
    ] as const;
    for (const [element, expected] of renders) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain('rotate(45)');
      expect(html.match(/class="partial-day"/g)).toHaveLength(expected);
      expect(html).toContain('fill="url(#');
    }
  });
  it('signale aussi les petits graphiques quotidiens des clients', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(nowIso));
    const usage = renderToStaticMarkup(createElement(UsageChart, { days: [{ day: today, count: 3 }], months: [], series: [] }));
    const activity = renderToStaticMarkup(createElement(ActivityChart, { a: { email: 'anonymous', uid: 'demo', days: [{ day: today, count: 3 }], months: [] } }));
    for (const html of [usage, activity]) { expect(html).toContain('partial-day'); expect(html).toContain('Journée en cours'); expect(html).toContain('auj.'); }
  });
});
