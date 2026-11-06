import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { dailySparkline, operationCount } from './daily-sparkline';

const now = '2026-11-06T12:00:00Z';
const days = [
  { date: '2026-11-04', n: 100 },
  { date: '2026-11-05', n: 120 },
  { date: '2026-11-06', n: 2 },
];

describe('Petites courbes : le dernier jour reste provisoire', () => {
  it('repère le jour en cours sans calculer une baisse de 98 %', () => {
    expect(dailySparkline(days, 'n', now)).toEqual({ values: [100, 120, 2], partialLast: true });
    expect(dailySparkline(days.slice(0, -1), 'n', now)).toEqual({
      values: [100, 120],
      partialLast: false,
    });
  });
  it.each([
    undefined,
    null,
    {},
    [],
    [{ date: '2026-02-30', n: 2 }],
    [{ date: '2026-11-07', n: 2 }],
    [days[0], days[2]],
    [days[1], days[0]],
    [days[0], days[0]],
    [{ date: '2026-11-05', n: null }],
    [{ date: '2026-11-05', n: Infinity }],
    [{ date: '2026-11-05', n: -2 }],
  ])('ne dessine pas une continuité ou un zéro inventé : %j', (rows) => {
    expect(dailySparkline(rows, 'n', now)).toEqual({ values: [], partialLast: false });
  });
  it('prend le jour UTC, y compris quand le repère a un décalage', () => {
    expect(dailySparkline(days, 'n', '2026-11-07T00:30:00+01:00').partialLast).toBe(true);
  });
  it('ne trace que les sept dernières journées', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-10-${20 + index}`,
      n: index,
    }));
    expect(dailySparkline(rows, 'n', now)).toEqual({
      values: [3, 4, 5, 6, 7, 8, 9],
      partialLast: false,
    });
  });
  it('sépare le segment provisoire du segment historique dans le SVG rendu', () => {
    const html = renderToStaticMarkup(
      createElement(StatCardV2, {
        title: 'Opérations',
        value: '2',
        sparkline: [100, 120, 2],
        sparklinePartialLast: true,
      }),
    );
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain('stroke-dasharray="2 3"');
    const ordinary = renderToStaticMarkup(
      createElement(StatCardV2, { title: 'Opérations', value: '2', sparkline: [100, 120, 2] }),
    );
    expect(ordinary.match(/<polyline/g)).toHaveLength(1);
    expect(ordinary).not.toContain('stroke-dasharray');
  });
  it('sépare les compteurs absents des zéros mesurés', () => {
    expect(operationCount(0)).toBe(0);
    expect(operationCount(100)).toBe(100);
    for (const value of [null, undefined, -1, Infinity, NaN, 1.5, '12'])
      expect(operationCount(value)).toBeNull();
  });
});
