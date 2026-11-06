import { createTranslator } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivationFunnel } from '@/components/dashboard/activation-funnel';
import { AcquisitionPanel } from '@/components/dashboard/acquisition-panel';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';
const state = vi.hoisted(() => ({ locale: 'fr' as 'fr' | 'en' | 'de' }));
vi.mock('@/components/dashboard/info-dot', () => ({ InfoDot: ({ children }: { children: ReactNode }) => createElement('span', null, children) }));
vi.mock('next-intl/server', () => ({ getTranslations: async (namespace: string) => {
  if (namespace !== 'dashboard.acquisition') throw new Error('Espace de traduction inattendu');
  return createTranslator({ locale: state.locale, messages: { fr, en, de }[state.locale].dashboard.acquisition });
} }));
const nowIso = '2026-11-06T14:00:00Z';

describe('Libellés et états de l’acquisition conservée', () => {
  for (const locale of ['fr', 'en', 'de'] as const) {
    it(`nomme les comptes et les accès sans réduire les chiffres à une couleur en ${locale}`, async () => {
      state.locale = locale; const t = { fr, en, de }[locale].dashboard.acquisition;
      const funnel = { period_days: 30, signed_up: 20, first_call: 11, hit_limit: 1, purchased: 5,
        median_hours_signup_to_first_call: 0, median_n_signup_to_first_call: 0,
        median_hours_first_call_to_purchase: 50, median_n_first_call_to_purchase: 3 };
      const html = renderToStaticMarkup(await ActivationFunnel({ funnel, locale }));
      expect(html).toContain(t.access); expect(html).toContain(t.accessNote); expect(html).toContain(t.creditKeyDelay);
      expect(html).toContain(t.notMeasurable); expect(html).not.toContain(t.underHour);
      const panel = renderToStaticMarkup(await AcquisitionPanel({ locale, nowIso, periodDays: 30,
        sources: [{ source: 'documentation-integration', signups: 3, called: 2, paying: 1 }],
        cohorts: [{ week_start: '2026-11-02', signups: 0, called_pct: 0, paid_pct: 0 }] }));
      expect(panel).toContain(t.calledShare); expect(panel).toContain(t.accessShare); expect(panel).toContain(t.inProgress);
      expect(panel.match(/>—</g)).toHaveLength(2); expect(panel).toContain('documentation-integration');
    });
  }
  it('sépare une lecture incohérente d’une liste vide connue', async () => {
    state.locale = 'fr'; const t = fr.dashboard.acquisition;
    const html = renderToStaticMarkup(await AcquisitionPanel({ locale: 'fr', nowIso, sources: undefined, cohorts: [] }));
    expect(html).toContain(t.unavailable); expect(html).toContain(t.emptyWeeks); expect(html).not.toContain(t.emptySources);
    expect(renderToStaticMarkup(await ActivationFunnel({ locale: 'fr', funnel: undefined }))).toContain(t.unavailable);
  });
});
