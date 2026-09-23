import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';
import { CollectedCard } from '@/components/dashboard/overview/collected-card';
import { formatGrouped } from '@/lib/format-grouped';
import {
  collectedView,
  formatMinorMap,
  readStripeRevenuePayload,
  type KindTotals,
  type StripeRevenuePayload,
} from './stripe-revenue';

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale }: { locale: 'en' | 'fr' | 'de' }) =>
    createTranslator({ locale, messages: { en, fr, de }[locale], namespace: 'dashboard.overview' }),
}));

/**
 * La tuile « Encaissé ». Montants inventés : ce dépôt est public, aucun chiffre
 * d'activité réelle. Brut en cents USD, net et virements en centimes CHF.
 */

function kind(over: Partial<KindTotals> = {}): KindTotals {
  return { count: 0, gross: {}, refunded: {}, fees: {}, net: {}, net_unknown: 0, last_payment_at: null, ...over };
}

function stripePayload(over: Partial<NonNullable<StripeRevenuePayload['stripe']>> = {}): StripeRevenuePayload {
  return {
    version: 1,
    source: 'stripe',
    reason: null,
    served_at: '2030-01-02T09:31:00.000Z',
    cache_ttl_seconds: 900,
    stripe: {
      version: 1,
      read_at: '2030-01-02T09:30:00.000Z',
      livemode: true,
      by_kind: {
        pack: kind({ count: 3, gross: { usd: 2800 }, net: { chf: 2356 }, fees: { chf: 164 } }),
        abonnement: kind({ count: 2, gross: { usd: 3400 }, net: { chf: 2912 }, fees: { chf: 148 } }),
        audit: kind({ count: 1, gross: { usd: 14900 }, net: { chf: 12991 }, fees: { chf: 419 } }),
        autre: kind(),
      },
      total: kind({ count: 6, gross: { usd: 21100 }, net: { chf: 18259 }, fees: { chf: 731 } }),
      classification: { invoices: true, sessions: true },
      payouts: {
        paid: { count: 2, amount: { chf: 15000 }, last_arrival_at: '2030-01-01T00:00:00.000Z' },
        in_transit: { count: 1, amount: { chf: 1666 } },
      },
      balance: { available: { chf: 1093 }, pending: { chf: 500 } },
      awaiting_payout: { chf: 3259 },
      ...over,
    },
    derived: derived(),
  };
}

function derived(over: Partial<StripeRevenuePayload['derived']> = {}): StripeRevenuePayload['derived'] {
  return {
    source: 'api_keys_and_ledgers',
    currency: 'usd',
    total_minor: 20300,
    by_kind: { pack: 2000, abonnement: 3400, audit: 14900 },
    other_currency_payments: 0,
    unusable_amount_payments: 0,
    last_payment_at: '2030-02-01T01:00:00.000Z',
    ...over,
  };
}

function derivedPayload(over: Partial<StripeRevenuePayload['derived']> = {}): StripeRevenuePayload {
  return {
    version: 1,
    source: 'indisponible',
    reason: 'stripe_unreachable',
    served_at: '2030-01-02T09:31:00.000Z',
    cache_ttl_seconds: 900,
    stripe: null,
    derived: derived(over),
  };
}

async function render(value: unknown, locale = 'fr') {
  const data = readStripeRevenuePayload(value);
  if (!data) throw new Error('contrat refusé');
  return renderToStaticMarkup(await CollectedCard({ data, locale }));
}

const money = (n: number, locale: string) => formatGrouped(n, locale, 2);

describe('la tuile lit Stripe : total, détail par nature, net, virements, heure', () => {
  it.each([
    ['fr', 'Encaissé · Stripe', 'Abonnements', 'Net ', 'viré ', 'en attente ', 'Lu chez Stripe le 2030-01-02 10:30, heure suisse'],
    ['en', 'Collected · Stripe', 'Subscriptions', 'Net ', 'paid out ', 'pending ', 'Read from Stripe on 2030-01-02 10:30, Swiss time'],
    ['de', 'Eingenommen · Stripe', 'Abonnements', 'Netto ', 'ausgezahlt ', 'ausstehend ', 'Bei Stripe gelesen am 2030-01-02 10:30, Schweizer Zeit'],
  ])('en %s', async (locale, title, subscriptions, net, paid, awaiting, readAt) => {
    const html = await render(stripePayload(), locale);
    expect(html).toContain(title);
    expect(html).toContain(`>${money(211, locale)} USD</p>`);
    expect(html).toContain(subscriptions);
    // Le détail sous-entend la devise du total : pas de « USD » répété.
    expect(html).toContain(`>${money(34, locale)}</span>`);
    expect(html).toContain(`>${money(149, locale)}</span>`);
    expect(html).toContain(`${net}${money(182.59, locale)} CHF`);
    expect(html).toContain(`${paid}${money(150, locale)} CHF`);
    expect(html).toContain(`${awaiting}${money(32.59, locale)} CHF`);
    expect(html).toContain(readAt);
    expect(html).not.toContain('$');
  });

  it("donne l'heure suisse d'été", () => {
    const view = collectedView(stripePayload({ read_at: '2030-07-01T09:30:00.000Z' }), 'fr');
    expect(view.readAt).toBe('2030-07-01 11:30');
  });

  it("n'affiche « Autres » que s'il y en a, et le signale", async () => {
    const quiet = await render(stripePayload());
    expect(quiet).not.toContain('Autres');
    const html = await render(
      stripePayload({
        by_kind: {
          pack: kind({ count: 1, gross: { usd: 2800 } }),
          abonnement: kind(),
          audit: kind(),
          autre: kind({ count: 1, gross: { usd: 500 } }),
        },
        total: kind({ count: 2, gross: { usd: 3300 }, net: { chf: 2900 } }),
      }),
    );
    expect(html).toContain('<span class="text-amber-300">');
    expect(html).toContain('Autres');
    expect(html).toContain(`>${money(5, 'fr')}</span>`);
  });

  it("n'additionne jamais deux devises", () => {
    const view = collectedView(
      stripePayload({
        by_kind: {
          pack: kind({ count: 1, gross: { usd: 2800 } }),
          abonnement: kind({ count: 1, gross: { eur: 1200 } }),
          audit: kind(),
          autre: kind(),
        },
        total: kind({ count: 2, gross: { usd: 2800, eur: 1200 }, net: { chf: 3600 } }),
      }),
      'en',
    );
    expect(view.headline).toBe('28.00 USD + 12.00 EUR');
    expect(view.kinds.find((k) => k.kind === 'abonnement')?.amount).toBe('12.00 EUR');
    expect(view.kinds.find((k) => k.kind === 'audit')?.amount).toBe('0');
  });

  it('dit ce qui manque : classement partiel, remboursement, clé de test, virements non lus', async () => {
    const html = await render(
      stripePayload({
        livemode: false,
        classification: { invoices: false, sessions: true },
        total: kind({ count: 6, gross: { usd: 21100 }, refunded: { usd: 400 }, net: { chf: 18259 }, net_unknown: 1 }),
        payouts: null,
        awaiting_payout: null,
      }),
    );
    expect(html).toContain('Classement incomplet');
    expect(html).toContain(`Remboursé : ${money(4, 'fr')} USD, non déduit du total.`);
    expect(html).toContain('Clé Stripe de test');
    expect(html).toContain('virements non lus');
    expect(html).toContain('Net inconnu pour 1 paiement.');
    expect(html).not.toContain('en attente');
  });

  it("ne transforme pas un virement absent en « 0 USD » : la devise du compte est lue", () => {
    const view = collectedView(
      stripePayload({
        payouts: { paid: { count: 0, amount: {}, last_arrival_at: null }, in_transit: { count: 0, amount: {} } },
      }),
      'fr',
    );
    expect(view.paidOut).toBe(`${money(0, 'fr')} CHF`);
  });
});

describe('sans Stripe, le total selon les clés, annoncé comme tel', () => {
  it.each([
    ['fr', 'Encaissé · selon les clés', 'selon les clés, Stripe indisponible'],
    ['en', 'Collected · from our keys', 'from our keys, Stripe unavailable'],
    ['de', 'Eingenommen · laut Schlüsseln', 'laut Schlüsseln, Stripe nicht verfügbar'],
  ])('en %s', async (locale, title, note) => {
    const html = await render(derivedPayload(), locale);
    expect(html).toContain(title);
    expect(html).toContain(`>${money(203, locale)} USD</p>`);
    expect(html).toContain(note);
    expect(html).toContain(`>${money(34, locale)}</span>`);
    expect(html).not.toContain('CHF');
    expect(html).not.toContain('data-collected-read-at');
  });

  it('compte à part ce qui reste hors du total', async () => {
    const html = await render(derivedPayload({ other_currency_payments: 1, unusable_amount_payments: 1 }));
    expect(html).toContain('2 paiements hors total : autre devise ou montant absent.');
  });
});

describe('un contrat incohérent ne devient jamais un montant', () => {
  const valid = stripePayload();
  it.each([
    ['vide', null],
    ['ancienne version', { ...valid, version: 0 }],
    ['source inconnue', { ...valid, source: 'cache' }],
    ['stripe annoncé sans lecture', { ...valid, stripe: null }],
    ['indisponible avec une lecture', { ...valid, source: 'indisponible' }],
    ['repli qui ne s’additionne pas', { ...valid, derived: derived({ total_minor: 1 }) }],
    ['repli dans une autre devise', { ...valid, derived: { ...derived(), currency: 'chf' } }],
    ['brut négatif', stripePayload({ total: kind({ count: 6, gross: { usd: -1 } }) })],
    ['devise illisible', stripePayload({ total: kind({ count: 6, gross: { dollars: 100 } }) })],
    ['natures qui ne font pas le total', stripePayload({ total: kind({ count: 5, gross: { usd: 21100 } }) })],
    ['heure illisible', stripePayload({ read_at: 'hier' })],
    ['montant fractionnaire', stripePayload({ awaiting_payout: { chf: 1.5 } })],
  ])('%s', (_, value) => {
    expect(readStripeRevenuePayload(value)).toBeNull();
  });

  it('accepte le contrat servi par la route, lecture et repli', () => {
    expect(readStripeRevenuePayload(stripePayload())).not.toBeNull();
    expect(readStripeRevenuePayload(derivedPayload())).not.toBeNull();
  });

  it("formate une somme vide sans s'inventer une devise", () => {
    expect(formatMinorMap({}, 'fr')).toBe('0');
    expect(formatMinorMap({}, 'fr', { fallback: 'usd' })).toBe(`${money(0, 'fr')} USD`);
  });
});
