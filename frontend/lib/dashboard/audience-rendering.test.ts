import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { IndicatorCard, JourneyPanel } from '@/components/dashboard/audience/journey-panel';
import { SitePanel } from '@/components/dashboard/audience/site-panel';
import { audienceFixture } from './audience-fixture';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const catalogues = { fr, en, de };
function render(node: ReactNode, locale: keyof typeof catalogues = 'fr') {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale,
        messages: catalogues[locale],
        children: node,
        timeZone: 'UTC',
        now: new Date('2026-06-16T12:00:00Z'),
      },
      node,
    ),
  );
}

describe('Rendu honnête et traduit de la nouvelle vue Audience', () => {
  it.each(['fr', 'en', 'de'] as const)(
    'nomme les cas sans recul en %s sans leur attribuer un taux de zéro',
    (locale) => {
      const fixture = audienceFixture();
      const html = render(
        createElement(IndicatorCard, {
          name: 'paid_use_7d',
          indicator: fixture.indicators.paid_use_7d,
        }),
        locale,
      );
      expect(html).toContain(catalogues[locale].dashboard.audience.notMeasurable);
      expect(html).not.toMatch(/<strong>0[,.]0 %|NaN|Infinity|MISSING_MESSAGE/);
    },
  );

  it('affiche des sources absentes comme inconnues et ne remplace pas les KPI par zéro', () => {
    const html = render(createElement(SitePanel, { web: null, sources: null }));
    expect(html).toContain('Lecture indisponible');
    expect(html).not.toContain('<strong>0</strong>');
    expect(render(createElement(JourneyPanel, { funnel: null }))).toContain(
      'Cette source n’a pas fourni',
    );
  });

  it.each(['fr', 'en', 'de'] as const)(
    'garde un rendu identique entre deux moteurs de formatage en %s',
    (locale) => {
      const spy = vi.spyOn(Number.prototype, 'toLocaleString');
      const node = createElement(JourneyPanel, { funnel: audienceFixture() });
      try {
        spy.mockReturnValue('formatage-serveur');
        const server = render(node, locale);
        spy.mockReturnValue('formatage-navigateur');
        expect(render(node, locale)).toBe(server);
        expect(server).toContain(locale === 'en' ? '66.7 %' : '66,7 %');
        expect(server).toContain(catalogues[locale].dashboard.audience.mcpTitle);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );
});
