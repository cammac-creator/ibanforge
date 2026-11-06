import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StatisticsReadNotice, StatisticsActivity } from '@/components/dashboard/overview/header';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';

const state = vi.hoisted(() => ({ locale: 'fr' as 'fr' | 'en' | 'de' }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => {
    if (namespace !== 'dashboard') throw new Error('Espace de traduction inattendu');
    return createTranslator({ locale: state.locale, messages: { fr, en, de }[state.locale].dashboard });
  },
}));

describe('Une erreur de statistiques ne devient pas une panne du service', () => {
  for (const locale of ['fr', 'en', 'de'] as const) {
    it.each([0, 401, 403, 500])(`explique la lecture refusée en ${locale} (HTTP %s)`, async (status) => {
      state.locale = locale;
      const rendered = await StatisticsReadNotice({ statsPromise: Promise.resolve({ ok: false, status, data: null }) });
      const html = renderToStaticMarkup(rendered!);
      const t = createTranslator({ locale, messages: { fr, en, de }[locale], namespace: 'dashboard.error' });
      expect(html).toContain(t('statsUnavailable'));
      expect(html).toContain(t('statsUnavailableDescription'));
      expect(html).toContain(status === 0 ? t('statsTimeout') :
        status === 401 || status === 403 ? t('statsDenied', { status }) : t('statsHttp', { status }));
      expect(html).toContain('role="status"');
      expect(html).not.toMatch(/MISSING_MESSAGE|API indisponible|Démarrez le serveur|border-red/);
    });
  }
  it('ne montre aucun avertissement quand la lecture a réussi', async () => {
    expect(await StatisticsReadNotice({ statsPromise: Promise.resolve({ ok: true, status: 200, data: { last_write_at: null } }) })).toBeNull();
  });
  it('une lecture ratée n’est jamais présentée comme une absence d’activité', async () => {
    expect(await StatisticsActivity({ statsPromise: Promise.resolve({ ok: false, status: 500, data: null }), readAtIso: '2026-11-06T12:00:00Z' })).toBeNull();
  });
});
