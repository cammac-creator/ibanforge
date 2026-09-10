import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';
import { AuditStatsCard } from '@/components/dashboard/overview/audit-stats-card';
import type { AuditStats } from './dashboard-overview';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: 'en' | 'fr' | 'de' }) =>
    createTranslator({ locale, messages: { en, fr, de }[locale], namespace: 'dashboard.overview' }),
}));

// Le bloc d’échec est un autre composant serveur asynchrone ; son contenu est testé ailleurs.
vi.mock('@/components/dashboard/overview/fetching', () => ({
  FetchFailed: ({ status }: { status: number }) => createElement('p', null, `Lecture impossible (${status})`),
}));

function stats(overrides: Partial<AuditStats> = {}): AuditStats {
  return {
    period_days: 30, since: '2026-08-11 00:00:00', uploads: 8, sales: 5,
    revenue_chf: 223.5, revenue_basis: 'stripe_checkout',
    payment_amounts: { chf: 3, unknown: 1, other_currency: 1 },
    last_sale_at: '2026-09-10T12:00:00Z', conversion: 5 / 8,
    ...overrides,
  };
}

async function render(data: AuditStats | null, locale = 'fr', status = 200) {
  return renderToStaticMarkup(await AuditStatsCard({
    statsPromise: Promise.resolve({ ok: status === 200, status, data }), locale,
  }));
}

describe('Montants et périmètre de la carte des audits', () => {
  it.each([
    ['fr', '223,50', '3 rapports avec montant CHF connu sur 5 rapports débloqués.', 'remboursements', 'une autre devise'],
    ['en', '223.50', '3 reports with a known CHF amount out of 5 unlocked reports.', 'refunds', 'another currency'],
    ['de', '223,50', '3 Berichte mit bekanntem CHF-Betrag von 5 freigeschalteten Berichten.', 'Rückerstattungen', 'anderen Währung'],
  ])('explique le total partiel et ses limites en %s', async (locale, amount, coverage, refunds, currency) => {
    const html = await render(stats(), locale);
    expect(html).toContain(amount);
    expect(html).toContain(coverage);
    expect(html).toContain(refunds);
    expect(html).toContain(currency);
    expect(html).not.toContain('Invalid Date');
  });

  it('conserve le zéro confirmé, mais ne remplace pas un montant inconnu par zéro', async () => {
    const knownZero = await render(stats({ sales: 1, revenue_chf: 0, payment_amounts: { chf: 1, unknown: 0, other_currency: 0 } }));
    expect(knownZero).toContain('>0,00</dd>');
    const unknown = await render(stats({ sales: 1, revenue_chf: null, payment_amounts: { chf: 0, unknown: 1, other_currency: 0 } }));
    expect(unknown).toContain('>–</dd>');
    expect(unknown).toContain('1 rapport sans montant exploitable');
    expect(unknown).not.toContain('>0,00</dd>');
  });

  it('masque le catalogue si une ancienne API est encore servie ou restaurée', async () => {
    const html = await render(stats({ revenue_chf: 745, revenue_basis: undefined, payment_amounts: undefined }));
    expect(html).not.toContain('745');
    expect(html).toContain('Montants payés indisponibles');
    expect(html).toContain('Aucun prix catalogue utilisé');
  });

  it('annonce un rapport entre deux volumes, même au-delà de 100 %, et non des visiteurs convertis', async () => {
    const html = await render(stats({ uploads: 1, sales: 2, conversion: 2 }));
    expect(html).toContain('rapports / dépôts');
    expect(html).toContain('200 %');
    expect(html).toContain('ne mesure pas la conversion des visiteurs');
  });

  it('garde les échecs de lecture distincts de l’absence d’activité', async () => {
    const failed = await render(null, 'fr', 503);
    expect(failed).toContain('Lecture impossible (503)');
    expect(failed).not.toContain('>0');
    const empty = await render(stats({ uploads: 0, sales: 0, revenue_chf: 0 }));
    expect(empty).toContain('Aucun fichier déposé');
    expect(empty).not.toContain('Lecture impossible');
  });
});
