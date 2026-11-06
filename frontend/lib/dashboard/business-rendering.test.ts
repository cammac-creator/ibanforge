import { createElement, type ReactNode, type ComponentProps, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { BusinessSection } from '@/components/dashboard/overview/business-section';
import { MetricGuide } from '@/components/dashboard/overview/metric-guide';
import { businessFixture } from './business-pulse.fixture';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const catalogues = { fr, en, de };
let language: keyof typeof catalogues = 'fr';
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    createTranslator({
      locale: language,
      messages: catalogues[language],
      namespace: 'dashboard.pilot',
    }),
}));
const Provider = NextIntlClientProvider as ComponentType<
  Omit<ComponentProps<typeof NextIntlClientProvider>, 'children'> & { children?: ReactNode }
>;
function render(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      Provider,
      {
        locale: language,
        messages: catalogues[language],
        timeZone: 'UTC',
        now: new Date('2026-11-06T12:00:00Z'),
        onError(error) {
          throw error;
        },
      },
      node,
    ),
  );
}
describe('pilotage rendu en trois langues', () => {
  it.each(['fr', 'en', 'de'] as const)(
    'résout toutes les clés et montre les limites en %s',
    async (locale) => {
      language = locale;
      const data = businessFixture();
      const view = await BusinessSection({
        promise: Promise.resolve({ ok: true, status: 200, data }),
        locale,
        period: 30,
        nowIso: data.generated_at,
      });
      const html = render(view);
      expect(html).toContain(catalogues[locale].dashboard.pilot.essentials);
      expect(html).toContain('type="range"');
      expect(html).toContain('stroke-dasharray="4 5"');
      expect(html).toContain('UTC');
      expect(html).not.toContain('NaN');
      expect(render(await MetricGuide({ locale }))).toContain(
        catalogues[locale].dashboard.pilot.guideTitle,
      );
    },
  );
  it('une lecture absente garde les tirets sans afficher des courbes vides', async () => {
    language = 'fr';
    const html = render(
      await BusinessSection({
        promise: Promise.resolve({ ok: false, status: 503, data: null }),
        locale: 'fr',
        period: 7,
        nowIso: '2026-11-06T12:00:00Z',
      }),
    );
    expect(html).toContain('Les tirets indiquent');
    expect(html.match(/>—</g)).toHaveLength(4);
    expect(html).not.toContain('type="range"');
    for (const cohort of ['active_today', 'active_week', 'new_accounts', 'new_buyers']) {
      expect(html).toContain(`/fr/dashboard/indicators?cohort=${cohort}`);
    }
  });
  it('la fraîcheur vient de la source, pas de la date de rendu de la page', async () => {
    language = 'fr';
    const data = businessFixture();
    const html = render(
      await BusinessSection({
        promise: Promise.resolve({ ok: true, status: 200, data }),
        locale: 'fr',
        period: 7,
        nowIso: '2026-11-06T13:00:00Z',
      }),
    );
    expect(html).toContain('plus de 15 minutes');
    expect(html).toContain('12:00 UTC');
  });
});
