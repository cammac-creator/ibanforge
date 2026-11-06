import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type Stripe from 'stripe';
import {
  adminFailedPayments,
  readFailedPaymentCharges,
  _setStripeForTests,
  summarizeFailedPayments,
} from './admin-failed-payments.js';

/**
 * La règle qui compte : un refus suivi d'un paiement réussi du MÊME acheteur
 * n'est pas une vente perdue. Sans elle, l'écran aurait annoncé une perte là où
 * le client était simplement revenu avec une autre carte, ce qui s'est produit
 * en août 2026.
 */
function charge(p: Partial<Stripe.Charge> & { created: number }): Stripe.Charge {
  return {
    id: `ch_fictif_${p.created}`,
    amount: 2000,
    captured: true,
    amount_captured: 2000,
    amount_refunded: 0,
    currency: 'usd',
    status: 'failed',
    refunded: false,
    billing_details: { email: 'a@alpha.example.net' },
    ...p,
  } as unknown as Stripe.Charge;
}

const DEBUT = new Date('2026-06-13T12:00:00.000Z');
const FIN = new Date('2026-09-11T12:00:00.000Z');

describe('Résumé des paiements refusés', () => {
  it('lit encore les détails de carte avec un mandat développé Endive', () => {
    const details = {
      type: 'card',
      card: {
        brand: 'visa',
        last4: '4242',
        country: 'CH',
        mandate: { id: 'mandate_fictif', object: 'mandate' },
      },
    } as Stripe.Charge.PaymentMethodDetails;
    const r = summarizeFailedPayments(
      [
        charge({
          created: 1788536000,
          payment_method_details: details,
          failure_code: 'generic_decline',
        }),
      ],
      90,
      DEBUT,
      FIN,
    );
    expect(r.latest[0]).toMatchObject({
      card_brand: 'visa',
      card_last4: '4242',
      card_country: 'CH',
      decline_reason: 'generic_decline',
    });
    expect(r.by_reason).toEqual({ generic_decline: 1 });
  });

  it.each([
    'code_invalid',
    'code_expired',
    'insufficient_funds',
    'customer_declined',
    'payment_limit_exceeded',
    'partner_generic_decline',
  ])('conserve le nouveau motif BLIK %s sans liste fermée', (reason) => {
    const r = summarizeFailedPayments(
      [
        charge({
          created: 1788536000,
          payment_method_details: { type: 'blik', blik: {} } as Stripe.Charge.PaymentMethodDetails,
          outcome: { reason } as Stripe.Charge.Outcome,
        }),
      ],
      90,
      DEBUT,
      FIN,
    );
    expect(r.by_reason).toEqual({ [reason]: 1 });
    expect(r.latest[0]).toMatchObject({ decline_reason: reason, card_brand: null });
  });

  it('compte les tentatives, les acheteurs et le motif du refus', () => {
    const r = summarizeFailedPayments(
      [
        charge({
          created: 1788536000,
          outcome: { reason: 'card_velocity_exceeded' } as Stripe.Charge.Outcome,
        }),
        charge({
          created: 1788536100,
          outcome: { reason: 'card_velocity_exceeded' } as Stripe.Charge.Outcome,
        }),
      ],
      90,
      DEBUT,
      FIN,
    );
    expect(r.version).toBe(1);
    expect(r.attempts).toBe(2);
    expect(r.distinct_buyers).toBe(1);
    expect(r.by_reason).toEqual({ card_velocity_exceeded: 2 });
    expect(r.amount_attempted_minor).toBe(4000);
    expect(r.currency).toBe('usd');
  });

  it('ne compte PAS comme perdu un acheteur qui a fini par payer', () => {
    const r = summarizeFailedPayments(
      [charge({ created: 1787536000 }), charge({ created: 1787636000, status: 'succeeded' })],
      90,
      DEBUT,
      FIN,
    );
    expect(r.attempts).toBe(1);
    expect(r.distinct_buyers).toBe(1);
    expect(r.unrecovered_buyers).toBe(0);
    expect(r.latest[0].recovered).toBe(true);
  });

  it('garde un acheteur non rattrapé pour ce qu’il est', () => {
    const r = summarizeFailedPayments(
      [
        charge({
          created: 1787536000,
          billing_details: { email: 'attente@alpha.example.net' } as Stripe.Charge.BillingDetails,
        }),
        charge({
          created: 1787636000,
          status: 'succeeded',
          billing_details: { email: 'autre@alpha.example.net' } as Stripe.Charge.BillingDetails,
        }),
      ],
      90,
      DEBUT,
      FIN,
    );
    expect(r.unrecovered_buyers).toBe(1);
    expect(r.latest[0].recovered).toBe(false);
  });

  it('ne mélange pas deux devises dans un même total', () => {
    const r = summarizeFailedPayments(
      [charge({ created: 1787536000 }), charge({ created: 1787636000, currency: 'chf' })],
      90,
      DEBUT,
      FIN,
    );
    expect(r.currency).toBeNull();
    expect(r.amount_attempted_minor).toBeNull();
    expect(r.amounts_by_currency).toEqual({ usd: 2000, chf: 2000 });
  });

  it('rend un résumé vide plutôt que de se casser quand rien n’a échoué', () => {
    const r = summarizeFailedPayments(
      [charge({ created: 1787536000, status: 'succeeded' })],
      90,
      DEBUT,
      FIN,
    );
    expect(r.attempts).toBe(0);
    expect(r.distinct_buyers).toBe(0);
    expect(r.latest).toEqual([]);
  });
});

const at = (day: number) =>
  Math.floor(Date.parse(`2026-08-${String(day).padStart(2, '0')}T12:00:00Z`) / 1000);
afterEach(() => {
  _setStripeForTests(null);
  vi.unstubAllEnvs();
});
describe('un paiement ultérieur observé n’est pas un rapprochement de vente', () => {
  it('ne rattrape jamais un refus par une charge antérieure ou de la même seconde', () => {
    for (const paid of [at(10), at(11)]) {
      const r = summarizeFailedPayments(
        [charge({ created: at(11) }), charge({ created: paid, status: 'succeeded' })],
        90,
        DEBUT,
        FIN,
      );
      expect(r.unrecovered_buyers).toBe(1);
      expect(r.latest[0].recovered_at).toBeNull();
    }
  });
  it('n’accepte ni autorisation non encaissée, ni zéro, ni remboursement intégral', () => {
    for (const patch of [
      { captured: false },
      { amount_captured: 0 },
      { refunded: true, amount_refunded: 2000 },
    ]) {
      const r = summarizeFailedPayments(
        [charge({ created: at(10) }), charge({ created: at(11), status: 'succeeded', ...patch })],
        90,
        DEBUT,
        FIN,
      );
      expect(r.latest[0].recovered).toBe(false);
    }
  });
  it('garde le refus plus récent en attente et compte les adresses inconnues à part', () => {
    const r = summarizeFailedPayments(
      [
        charge({ created: at(10) }),
        charge({ created: at(11), status: 'succeeded' }),
        charge({ created: at(12) }),
        charge({
          created: at(13),
          billing_details: { email: null } as Stripe.Charge.BillingDetails,
        }),
      ],
      90,
      DEBUT,
      FIN,
    );
    expect(r).toMatchObject({
      attempts: 3,
      distinct_buyers: 1,
      unrecovered_buyers: 1,
      attempts_without_email: 1,
    });
    expect(r.latest.map((r) => r.recovered)).toEqual([false, false, true]);
    expect(r.latest[2].recovered_at).toBe('2026-08-11T12:00:00.000Z');
  });
  it('normalise l’adresse et utilise le reçu si l’adresse de facturation est vide', () => {
    const r = summarizeFailedPayments(
      [
        charge({
          created: at(10),
          billing_details: { email: '' } as Stripe.Charge.BillingDetails,
          receipt_email: ' A@ALPHA.EXAMPLE.NET ',
        }),
        charge({ created: at(11), status: 'succeeded' }),
      ],
      90,
      DEBUT,
      FIN,
    );
    expect(r.latest[0]).toMatchObject({ email: 'a@alpha.example.net', recovered: true });
  });
  it('ne rétablit pas une fausse devise unique après USD/EUR/USD', () => {
    const r = summarizeFailedPayments(
      [
        charge({ created: at(12) }),
        charge({ created: at(11), currency: 'eur' }),
        charge({ created: at(10) }),
      ],
      90,
      DEBUT,
      FIN,
    );
    expect(r.currency).toBeNull();
    expect(r.amount_attempted_minor).toBeNull();
    expect(r.amounts_by_currency).toEqual({ usd: 4000, eur: 2000 });
  });
  it('borne les dates et ne modifie pas l’ordre des charges d’entrée', () => {
    const rows = [
      charge({ created: at(10) }),
      charge({ created: Math.floor(FIN.getTime() / 1000) + 1 }),
      charge({ created: Math.floor(DEBUT.getTime() / 1000) - 1 }),
    ];
    const before = rows.map((c) => c.created);
    const r = summarizeFailedPayments(rows, 90, DEBUT, FIN);
    expect(r.attempts).toBe(1);
    expect(rows.map((c) => c.created)).toEqual(before);
  });
});

describe('pagination des charges, entièrement fictive', () => {
  const client = (list: ReturnType<typeof vi.fn>) => ({ charges: { list } }) as unknown as Stripe;
  it('lit la page suivante au-delà des cent premières charges', async () => {
    const first = Array.from({ length: 100 }, (_, i) =>
      charge({ created: at(20) - i, status: 'succeeded' }),
    );
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: first, has_more: true })
      .mockResolvedValueOnce({ data: [charge({ created: at(10) })], has_more: false });
    const r = await readFailedPaymentCharges(client(list), DEBUT, FIN);
    expect(r.coverage).toEqual({
      complete: true,
      reason: 'complete',
      pages_read: 2,
      charges_read: 101,
    });
    expect(list.mock.calls[1][0].starting_after).toBe(first.at(-1)?.id);
    expect(list.mock.calls[0][0].created.lte).toBe(Math.floor(FIN.getTime() / 1000));
    expect(list.mock.calls[0][1]).toMatchObject({ maxNetworkRetries: 0 });
    expect(summarizeFailedPayments(r.charges, 90, DEBUT, FIN).attempts).toBe(1);
  });
  it('rend la lecture partielle quand la page suivante échoue', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: [charge({ created: at(10) })], has_more: true })
      .mockRejectedValueOnce(new Error('fictif'));
    const r = await readFailedPaymentCharges(client(list), DEBUT, FIN);
    expect(r.coverage).toMatchObject({
      complete: false,
      reason: 'stripe_error',
      pages_read: 1,
      charges_read: 1,
    });
  });
  it('annonce les bornes de temps et de pages, sans faux zéro exhaustif', async () => {
    let clock = 0;
    const list = vi.fn(async () => {
      clock = 9000;
      return { data: [charge({ created: at(10) })], has_more: true };
    });
    expect(
      (await readFailedPaymentCharges(client(list), DEBUT, FIN, { now: () => clock })).coverage
        .reason,
    ).toBe('deadline');
    expect(
      (await readFailedPaymentCharges(client(list), DEBUT, FIN, { maxPages: 1 })).coverage.reason,
    ).toBe('page_limit');
  });
  it('refuse une pagination répétée ou vide qui annonce une suite', async () => {
    const c = charge({ created: at(10) });
    const repeated = vi.fn().mockResolvedValue({ data: [c], has_more: true });
    expect((await readFailedPaymentCharges(client(repeated), DEBUT, FIN)).coverage).toMatchObject({
      complete: false,
      reason: 'pagination_invalid',
      charges_read: 1,
    });
    const empty = vi.fn().mockResolvedValue({ data: [], has_more: true });
    expect((await readFailedPaymentCharges(client(empty), DEBUT, FIN)).coverage.complete).toBe(
      false,
    );
  });
  it('répond503 si rien n’a pu être lu et401 sans autorisation', async () => {
    vi.stubEnv('ADMIN_SECRET', 'secret-refus-fictif');
    _setStripeForTests(client(vi.fn().mockRejectedValue(new Error('source factice absente'))));
    const app = new Hono().route('/', adminFailedPayments);
    expect((await app.request('/v1/admin/failed-payments')).status).toBe(401);
    const r = await app.request('/v1/admin/failed-payments', {
      headers: { 'X-Admin-Secret': 'secret-refus-fictif' },
    });
    expect(r.status).toBe(503);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('rend un zéro connu, daté et complet si Stripe ne contient aucune charge', async () => {
    vi.stubEnv('ADMIN_SECRET', 'secret-refus-fictif');
    _setStripeForTests(client(vi.fn().mockResolvedValue({ data: [], has_more: false })));
    const r = await new Hono()
      .route('/', adminFailedPayments)
      .request('/v1/admin/failed-payments?days=7', {
        headers: { 'X-Admin-Secret': 'secret-refus-fictif' },
      });
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body).toMatchObject({
      attempts: 0,
      period_days: 7,
      scope: 'stripe_account',
      coverage: { complete: true, charges_read: 0 },
    });
    expect(Date.parse(body.observed_until) - Date.parse(body.window_start)).toBe(7 * 86400000);
    expect(Number.isFinite(Date.parse(body.read_at))).toBe(true);
  });
});
