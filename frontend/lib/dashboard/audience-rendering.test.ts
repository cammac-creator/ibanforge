import { createElement, type ReactNode, type ComponentProps, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { IndicatorCard, JourneyPanel } from '@/components/dashboard/audience/journey-panel';
import { SitePanel } from '@/components/dashboard/audience/site-panel';
import { EntryPanel } from '@/components/dashboard/audience/entry-panel';
import { audienceFixture } from './audience-fixture';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const catalogues = { fr, en, de };
// createElement reçoit les enfants en troisième argument. Le type du fournisseur
// exige leur présence dans les propriétés, alors que React remplit ce champ lui-même.
const TranslationProvider = NextIntlClientProvider as ComponentType<
  Omit<ComponentProps<typeof NextIntlClientProvider>, 'children'> & { children?: ReactNode }
>;
function render(node: ReactNode, locale: keyof typeof catalogues = 'fr') {
  return renderToStaticMarkup(
    createElement(
      TranslationProvider,
      {
        locale,
        messages: catalogues[locale],
        timeZone: 'UTC',
        now: new Date('2026-06-16T12:00:00Z'),
      },
      node,
    ),
  );
}

describe('Rendu honnête et traduit de la nouvelle vue Audience', () => {
  it.each(['fr', 'en', 'de'] as const)(
    'traduit les origines et les cas sans recul en %s',
    (locale) => {
      const html = render(createElement(EntryPanel, { funnel: audienceFixture() }), locale);
      expect(html).toContain(catalogues[locale].dashboard.audience.entry.referrer.unknown);
      expect(html).toContain(catalogues[locale].dashboard.audience.entry.referrer.search);
      expect(html).toContain(catalogues[locale].dashboard.audience.entry.page.docs);
      expect(html).toContain(catalogues[locale].dashboard.audience.notMeasurable);
      expect(html).not.toMatch(/NaN|Infinity|MISSING_MESSAGE/);
    },
  );
  it('garde les autres mesures quand les origines sont absentes', () => {
    const funnel = { ...audienceFixture(), by_entry_referrer: undefined, by_entry_page: undefined };
    const html = render(createElement(JourneyPanel, { funnel }));
    expect(html).toContain('Cette source n’a pas fourni');
    expect(html).toContain('66,7 %');
    expect(html).not.toContain('Moteurs reconnus</h3>');
  });
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
