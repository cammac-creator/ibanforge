import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readServiceStatuses } from './service-signals';
import { readResponseDetails, responsePathFamily } from './response-details';
import { StatusByPathTable, type StatusByPathRow } from '@/components/dashboard/status-by-path-table';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const language = vi.hoisted(() => ({ current: 'fr' as 'fr' | 'en' | 'de' }));
vi.mock('next-intl', () => ({ useLocale: () => language.current, useTranslations: () =>
  (key: string, values: Record<string, string | number> = {}) => {
    let value: unknown = ({ fr, en, de })[language.current].dashboard.responses;
    for (const part of key.split('.')) value = (value as Record<string, unknown>)[part];
    if (typeof value !== 'string') throw new Error(`Traduction absente : ${key}`);
    return value.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
  },
}));
const row = (overrides: Partial<StatusByPathRow> = {}): StatusByPathRow => ({
  path: '/v1/iban/validate', total: 10, s2xx: 7, s3xx: 0, s4xx: 2, s5xx: 1, avg_ms: 12,
  by_status: { 200: 7, 402: 2, 503: 1 }, by_method: { POST: 9, GET: 1 }, ...overrides,
});

describe('Réponses API lisibles et cohérentes', () => {
  it('refuse un total de classes impossible et des adresses dupliquées', () => {
    expect(readServiceStatuses({ rows: [row({ s2xx: 10 })] })).toBeNull();
    expect(readServiceStatuses({ rows: [row(), row()] })).toBeNull();
  });
  it('garde les classes lisibles quand les détails sont absents', () => {
    const value = row({ by_status: undefined, by_method: undefined });
    expect(readServiceStatuses({ rows: [value] })).toEqual([value]);
    expect(readResponseDetails(value, 'status')).toBeNull(); expect(readResponseDetails(value, 'method')).toBeNull();
  });
  it.each([{ 200: 8, 402: 1, 503: 1 }, { 200: 6, 402: 2, 503: 1 }, { '200x': 7, 402: 2, 503: 1 }, { 200: -1 }, { 200: NaN }] as Array<Record<string, number>>)('ne présente pas un détail de codes incohérent : %j', by_status => {
    expect(readResponseDetails(row({ by_status }), 'status')).toBeNull();
  });
  it.each([{ GET: 9 }, { GET: 11 }, { GET: -1 }, { 'GET POST': 10 }] as Array<Record<string, number>>)('ne présente pas un détail de méthodes incohérent : %j', by_method => {
    expect(readResponseDetails(row({ by_method }), 'method')).toBeNull();
  });
  it('garde les réponses informatives et trie sans modifier la source', () => {
    const value = row({ total: 11, by_status: { 103: 1, 200: 7, 402: 2, 503: 1 }, by_method: { OPTIONS: 1, POST: 10 } });
    const before = JSON.stringify(value);
    expect(readServiceStatuses({ rows: [value] })).toEqual([value]);
    expect(readResponseDetails(value, 'status')).toEqual([['200', 7], ['402', 2], ['103', 1], ['503', 1]]);
    expect(readResponseDetails(value, 'method')).toEqual([['POST', 10], ['OPTIONS', 1]]);
    expect(JSON.stringify(value)).toBe(before);
  });
  it('distingue un relevé vide, un relevé manquant et une moyenne non mesurée', () => {
    expect(renderToStaticMarkup(createElement(StatusByPathTable, { rows: [] }))).toContain(fr.dashboard.responses.empty);
    expect(renderToStaticMarkup(createElement(StatusByPathTable, { rows: undefined }))).toContain(fr.dashboard.responses.unavailable);
    const html = renderToStaticMarkup(createElement(StatusByPathTable, { rows: [row({ avg_ms: null })] }));
    expect(html).toContain(fr.dashboard.responses.unmeasured); expect(html).not.toContain('0 ms');
  });
  it.each(['fr', 'en', 'de'] as const)('rend les codes et les méthodes dans un volet ouvrable en %s', locale => {
    language.current = locale;
    const html = renderToStaticMarkup(createElement(StatusByPathTable, { rows: [row()] }));
    expect(html).toContain('<details'); expect(html).toContain('<summary'); expect(html).toContain('HTTP 503'); expect(html).toContain('POST');
    expect(html).toContain(({ fr, en, de })[locale].dashboard.responses.code['503']);
    expect(html).not.toContain('Railway'); expect(html).not.toContain('50 tools'); expect(html).not.toContain('$0.');
  });
  it('propose toutes les adresses reçues au-delà des premières cartes', () => {
    language.current = 'fr';
    const rows = Array.from({ length: 15 }, (_, i) => row({ path: `/v1/exemple/${i}` }));
    const html = renderToStaticMarkup(createElement(StatusByPathTable, { rows }));
    expect((html.match(/data-api-response-path=/g) ?? [])).toHaveLength(12);
    expect(html).toContain('Afficher les 15 adresses correspondantes');
  });
  it('ne confond pas une adresse ressemblante avec une famille connue', () => {
    expect(responsePathFamily('/stats-other')).toBe('recorded');
    expect(responsePathFamily('/stats/history')).toBe('statistics');
    expect(responsePathFamily('/v1/iban/validate')).toBe('iban');
  });
});
