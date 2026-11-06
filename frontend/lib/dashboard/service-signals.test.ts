import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import {
  readServiceStatuses,
  readServiceSources,
  readServiceErrorRates,
  validIbanShare,
} from './service-signals';
import { BrokenSection } from '@/components/dashboard/overview/broken-section';
import type { Fetched } from '@/components/dashboard/overview/fetching';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const language = vi.hoisted(() => ({ current: 'fr' as 'fr' | 'en' | 'de' }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    createTranslator({
      locale: language.current,
      messages: { fr, en, de }[language.current],
      namespace: 'dashboard.overview',
    }),
}));
vi.mock('@/components/dashboard/info-dot', () => ({
  InfoDot: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
vi.mock('@/components/dashboard/living-tool-card', () => ({ LivingToolCard: () => null }));

const status = {
  rows: [{ path: '/v1/iban/validate', total: 10, s2xx: 9, s3xx: 0, s4xx: 1, s5xx: 0, avg_ms: 2 }],
};
const health = {
  bic_sources: [
    { source: 'registre-fictif', entries: 100, last_updated: '2026-11-06', stale: false },
  ],
};
const errors = {
  error_rate: {
    iban_validate: { rate: 10, trend: [0, 10] },
    bic_lookup: { rate: 0, trend: [0, 0] },
  },
  top_invalid_ibans: [],
  top_missing_bics: [],
};
const stats = { by_type: { iban_validate: { total: 100, valid_count: 90 } } };

describe('Lectures de service : le statut HTTP ne valide pas le contenu', () => {
  it('distingue une série HTTP vide d’un objet sans série', () => {
    expect(readServiceStatuses({ rows: [] })).toEqual([]);
    expect(readServiceStatuses({})).toBeNull();
    expect(readServiceStatuses(status)).toEqual(status.rows);
    expect(readServiceStatuses({ rows: [{ ...status.rows[0], s5xx: undefined }] })).toBeNull();
    expect(readServiceStatuses({ rows: [{ ...status.rows[0], s5xx: 11 }] })).toBeNull();
  });
  it('ne prétend jamais que les registres sont frais sans en avoir lu', () => {
    expect(readServiceSources({})).toBeNull();
    expect(readServiceSources({ bic_sources: [] })).toBeNull();
    expect(
      readServiceSources({ bic_sources: [{ ...health.bic_sources[0], stale: 'false' }] }),
    ).toBeNull();
    expect(readServiceSources(health)).toEqual(health.bic_sources);
  });
  it('refuse les taux impossibles et garde un taux connu sans courbe inventée', () => {
    expect(readServiceErrorRates({})).toBeNull();
    expect(
      readServiceErrorRates({ error_rate: { ...errors.error_rate, bic_lookup: { rate: 101 } } }),
    ).toBeNull();
    expect(
      readServiceErrorRates({
        error_rate: { iban_validate: { rate: 10 }, bic_lookup: { rate: 0, trend: [NaN] } },
      }),
    ).toEqual({ iban_validate: { rate: 10, trend: [] }, bic_lookup: { rate: 0, trend: [] } });
  });
  it('n’invente pas 100 % de validité quand le dénominateur manque', () => {
    expect(validIbanShare(stats)).toBe(90);
    for (const value of [
      {},
      { by_type: { iban_validate: { total: 0, valid_count: 0 } } },
      { by_type: { iban_validate: { total: 10, valid_count: 11 } } },
    ])
      expect(validIbanShare(value)).toBeNull();
  });
});

const fetched = <T>(data: T): Promise<Fetched<T>> =>
  Promise.resolve({ ok: true, status: 200, data });
async function render(overrides: Partial<Parameters<typeof BrokenSection>[0]> = {}) {
  return renderToStaticMarkup(
    await BrokenSection({
      period: 30,
      statsPromise: fetched(stats) as Parameters<typeof BrokenSection>[0]['statsPromise'],
      errorsPromise: fetched(errors),
      statusByPathPromise: fetched(status),
      healthPromise: fetched(health),
      ...overrides,
    }),
  );
}

describe('Verdict rendu : période et inconnues restent visibles', () => {
  it.each(['fr', 'en', 'de'] as const)(
    'affiche la qualité des données, pas un taux de disponibilité, en %s',
    async (locale) => {
      language.current = locale;
      const html = await render();
      expect(html).toContain({ fr, en, de }[locale].dashboard.overview.broken.successRate);
      expect(html).toContain('90.0%');
      expect(html).toContain('30');
      expect(html).not.toMatch(/NaN|MISSING_MESSAGE/);
    },
  );
  it('rend un verdict inconnu quand HTTP 200 ne contient pas les sources', async () => {
    language.current = 'fr';
    const html = await render({ healthPromise: fetched({}) });
    expect(html).toContain('Vérification incomplète');
    expect(html).toContain('Fraîcheur des registres : donnée absente ou illisible');
    expect(html).not.toContain('Aucune erreur serveur relevée');
  });
  it('ne plante pas sur un objet de taux illisible et affiche des tirets', async () => {
    const html = await render({
      errorsPromise: fetched({}) as Parameters<typeof BrokenSection>[0]['errorsPromise'],
    });
    expect(html).toContain('Vérification incomplète');
    expect(html.match(/>—<\/p>/g)).toHaveLength(2);
  });
  it('garde un incident connu visible même si une autre lecture manque', async () => {
    const html = await render({
      statusByPathPromise: fetched({ rows: [{ ...status.rows[0], s2xx: 8, s5xx: 1 }] }),
      healthPromise: fetched({}),
    });
    expect(html).toContain('Des erreurs serveur ont été relevées sur 30 jours');
    expect(html).toContain('/v1/iban/validate');
    expect(html).toContain('donnée absente ou illisible');
  });
  it('conserve la distinction d’une source figée et d’un import à faire', async () => {
    const make = (stale_reason: 'source_frozen' | 'import_overdue') =>
      fetched({ bic_sources: [{ ...health.bic_sources[0], stale: true, stale_reason }] });
    expect(await render({ healthPromise: make('source_frozen') })).toContain(
      'aucun registre suivi à actualiser',
    );
    expect(await render({ healthPromise: make('import_overdue') })).toContain(
      'au moins un registre suivi doit être actualisé',
    );
  });
});
