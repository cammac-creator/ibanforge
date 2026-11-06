import { createTranslator } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MoneyAccountMetrics, MoneyLoading } from '@/components/dashboard/overview/money-readings';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const state = vi.hoisted(() => ({ locale: 'fr' as 'fr' | 'en' | 'de' }));
vi.mock('@/components/dashboard/info-dot', () => ({
  InfoDot: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    if (namespace !== 'dashboard.overview') throw new Error('Espace de traduction inattendu');
    return createTranslator({ locale: state.locale, messages: { fr, en, de }[state.locale].dashboard.overview });
  },
}));

describe('Montants et comptes pendant une lecture indépendante', () => {
  for (const locale of ['fr', 'en', 'de'] as const) {
    it(`une lecture refusée garde les comptes inconnus en ${locale}, y compris dans leur explication`, async () => {
      state.locale = locale;
      const cards = await MoneyAccountMetrics({
        promise: Promise.resolve({ ok: false, status: 503, data: null }),
        locale, nowIso: '2026-11-06T12:00:00Z',
      });
      const html = renderToStaticMarkup(cards);
      expect(html).toContain({ fr, en, de }[locale].dashboard.overview.money.accountsUnread);
      expect(html).not.toContain('0 / 0');
      expect(html.match(/>—</g)).toHaveLength(3);
    });
  }
  it('deux catégories vides connues restent deux zéros nommés', async () => {
    state.locale = 'fr';
    const cards = await MoneyAccountMetrics({
      promise: Promise.resolve({ ok: true, status: 200, data: [] }),
      locale: 'fr', nowIso: '2026-11-06T12:00:00Z',
    });
    const html = renderToStaticMarkup(cards);
    expect(html).toContain(fr.dashboard.overview.money.accountsWithCredits);
    expect(html).toContain(fr.dashboard.overview.money.accountsExtendedQuota);
    expect(html.match(/<dd[^>]+>0<\/dd>/g)).toHaveLength(2);
    expect(html).not.toContain(fr.dashboard.overview.money.accountsUnread);
  });
  it('un chargement annonce la source sans présenter de faux montant', () => {
    const html = renderToStaticMarkup(MoneyLoading({ source: 'stripe', message: 'Encaissements : lecture en cours…' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Encaissements : lecture en cours…');
    expect(html).not.toContain('data-stat-value');
  });
});
