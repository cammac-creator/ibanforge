import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';
import { PackSalesCard } from '@/components/dashboard/overview/pack-sales-card';
import { packUsdLabel, retainedPackSales, type PackSalesSnapshot } from './pack-sales';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: 'en' | 'fr' | 'de' }) =>
    createTranslator({ locale, messages: { en, fr, de }[locale], namespace: 'dashboard.overview' }),
}));

function sample(stripe: Partial<PackSalesSnapshot['stripe']> = {}): PackSalesSnapshot {
  return {
    version: 1, source: 'retained_api_keys_payment_metadata', scope: 'all_retained_credit_keys',
    generated_at: '2026-09-10T15:00:00.000Z',
    stripe: {
      groups: 6, usd_amount_minor: 123450, usd_known_groups: 2, usd_zero_groups: 1,
      amount_missing_groups: 1, other_currency_groups: 1, invalid_amount_groups: 1, conflicting_groups: 1,
      first_key_created_at: null, last_key_created_at: null, ...stripe,
    },
    x402: { distinct_references: 2, settlement_status: 'not_reconciled', confirmed_amount_usdc: null },
    unattributed_credit_keys: 3, granted_credit_keys: 1, excluded_internal_credit_keys: 1,
    duplicate_reference_rows: 2, ambiguous_rail_keys: 1,
  };
}

async function render(value: unknown, locale = 'fr') {
  return renderToStaticMarkup(await PackSalesCard({ data: retainedPackSales(value), locale }));
}

describe('Montants conservés des packs et limites visibles', () => {
  it.each([
    ['fr', '1 234,50 USD', 'Montant USD connu pour 2 références sur 6', 'remboursements', 'une autre devise', 'pas rapprochées'],
    ['en', '1,234.50 USD', 'Known USD amount for 2 references out of 6', 'refunds', 'another currency', 'not reconciled'],
    ['de', '1 234,50 USD', 'Bekannter USD-Betrag für 2 von 6', 'Rückerstattungen', 'anderer Währung', 'nicht mit Abwicklungen abgeglichen'],
  ])('affiche en %s le même montant que la tuile et les exclusions', async (locale, amount, coverage, refunds, otherCurrency, notSettled) => {
    const data = sample();
    const html = await render(data, locale);
    expect(packUsdLabel(retainedPackSales(data), locale)).toBe(amount);
    expect(html).toContain(`data-pack-amount="true">${amount}</p>`);
    expect(html).toContain(coverage);
    expect(html).toContain(refunds);
    expect(html).toContain(otherCurrency);
    expect(html).toContain(notSettled);
    expect(html).toContain('Pro/OEM');
    expect(html).toContain('2026-09-10 15:00:00 UTC');
    expect(html).not.toContain('$');
  });

  it('conserve un montant zéro confirmé, même si des références restent inconnues', async () => {
    const data = sample({ usd_amount_minor: 0, usd_zero_groups: 2 });
    const html = await render(data);
    expect(packUsdLabel(retainedPackSales(data), 'fr')).toBe('0,00 USD');
    expect(html).toContain('montant USD confirmé à zéro : 2');
    expect(html).toContain('Sans montant et devise exploitables : 1');
  });

  it('ne transforme pas les montants inconnus ou absents en zéro encaissé', async () => {
    const data = sample({ groups: 1, usd_amount_minor: null, usd_known_groups: 0, usd_zero_groups: 0,
      amount_missing_groups: 1, other_currency_groups: 0, invalid_amount_groups: 0, conflicting_groups: 0 });
    expect(packUsdLabel(retainedPackSales(data), 'fr')).toBe('—');
    const html = await render(data);
    expect(html).toContain('data-pack-amount="true">—</p>');
    expect(html).not.toContain('0,00 USD');
    const empty = await render(sample({ ...data.stripe, groups: 0, amount_missing_groups: 0 }));
    expect(empty).toContain('Aucune référence Stripe de pack retenue');
  });

  it('refuse une ancienne réponse contenant un total catalogue', async () => {
    const old = { packs_sold: { revenue_usd: 99999, partly_deduced: true } };
    const html = await render(old);
    expect(html).toContain('Montants conservés indisponibles');
    expect(html).toContain('Aucun prix catalogue utilisé');
    expect(html).not.toContain('99999');
  });

  it.each([null, undefined, {}, { version: 0 }, sample({ usd_amount_minor: -1 }),
    sample({ usd_amount_minor: Number.NaN }), sample({ usd_amount_minor: 1.5 }),
    sample({ usd_amount_minor: null }), sample({ groups: 7 }), sample({ usd_known_groups: -1 }),
    { ...sample(), x402: { distinct_references: 1, settlement_status: 'settled', confirmed_amount_usdc: 5 } },
  ])('annonce indisponible un contrat incomplet ou incohérent : %#', async (data) => {
    expect(retainedPackSales(data)).toBeNull();
    expect(await render(data)).toContain('Montants conservés indisponibles');
    expect(packUsdLabel(retainedPackSales(data), 'en')).toBe('—');
  });
});
