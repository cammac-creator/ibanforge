import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readViewAge, readViewTimestamp } from './view-freshness';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const language = vi.hoisted(() => ({ current: 'fr' as 'fr' | 'en' | 'de' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next-intl', async (importOriginal) => {
  const original = await importOriginal<typeof import('next-intl')>();
  return { ...original, useLocale: () => language.current, useTranslations: (namespace: 'dashboard.freshness') => original.createTranslator({
    locale: language.current, messages: { fr, en, de }[language.current], namespace,
  }) };
});

describe('Date suisse explicite de la vue', () => {
  it.each([
    ['2026-01-15T23:30:00.000Z', '16.01.2026', '00:30'],
    ['2026-07-15T22:30:00.000Z', '16.07.2026', '00:30'],
    ['2026-03-29T00:59:00Z', '29.03.2026', '01:59'],
    ['2026-03-29T01:00:00Z', '29.03.2026', '03:00'],
    ['2026-10-25T00:59:00Z', '25.10.2026', '02:59'],
    ['2026-10-25T01:00:00Z', '25.10.2026', '02:00'],
    ['2026-07-15T10:22:00.000+02:00', '15.07.2026', '10:22'],
  ])('convertit %s en %s à %s', (value, date, time) => {
    expect(readViewTimestamp(value)).toMatchObject({ date, time, epoch: Date.parse(value) });
  });
  it.each(['', 'illisible', '2026-02-30T12:00:00Z', '2026-11-06T25:00:00Z', '2026-11-06T12:00:00', '2026-11-06T12:00:00+24:00'])('refuse une date ambiguë ou impossible : %s', value => {
    expect(readViewTimestamp(value)).toBeNull();
  });
});

describe('Âge lisible sans relecture des données', () => {
  const start = Date.parse('2026-11-06T12:00:00Z');
  it.each([
    [-61, 'future', 0, true], [-60, 'now', 0, false], [0, 'now', 0, false], [59, 'now', 0, false],
    [60, 'minutes', 1, false], [14 * 60, 'minutes', 14, false], [15 * 60, 'minutes', 15, true],
    [59 * 60, 'minutes', 59, true], [60 * 60, 'hours', 1, true], [1439 * 60, 'hours', 23, true],
    [1440 * 60, 'days', 1, true], [2880 * 60, 'days', 2, true],
  ] as const)('exprime un écart de %s secondes', (seconds, kind, value, stale) => {
    expect(readViewAge(start, start + seconds * 1000)).toEqual({ kind, value, stale });
  });
  it('garde un âge inconnu si l’une des horloges est invalide', () => {
    expect(readViewAge(null, start).kind).toBe('unknown');
    expect(readViewAge(NaN, start).kind).toBe('unknown');
    expect(readViewAge(start, Infinity).kind).toBe('unknown');
  });
});

describe('Badge rendu dans la langue de la vue', () => {
  it.each(['fr', 'en', 'de'] as const)('rend une date, le périmètre et un bouton nommé en %s', locale => {
    language.current = locale; const t = ({ fr, en, de })[locale].dashboard.freshness;
    const html = renderToStaticMarkup(createElement(FreshnessBadge, { fetchedAtIso: '2026-11-06T12:00:00Z' }));
    expect(html).toContain('06.11.2026'); expect(html).toContain('13:00'); expect(html).toContain('dateTime="2026-11-06T12:00:00.000Z"');
    expect(html).toContain(`aria-label="${t.refreshLabel}"`); expect(html).toContain(t.refresh); expect(html).toContain(t.scope);
    if (locale !== 'fr') expect(html).not.toContain('Actualiser les données');
  });
  it('ne plante pas quand la date de vue est illisible', () => {
    language.current = 'fr';
    const html = renderToStaticMarkup(createElement(FreshnessBadge, { fetchedAtIso: 'illisible' }));
    expect(html).toContain(fr.dashboard.freshness.unknown); expect(html).not.toContain('<time'); expect(html).not.toContain('NaN');
  });
});
