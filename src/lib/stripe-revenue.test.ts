import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  IBANFORGE_KINDS,
  readStripeRevenue,
  StripeRevenueCache,
  summarizeStripeRevenue,
  type MinorByCurrency,
  type StripeRevenueClient,
} from './stripe-revenue.js';

/**
 * La lecture de Stripe, sans jamais appeler Stripe : un faux client rend des
 * pages, compte ses appels et mesure combien sont en vol en même temps.
 *
 * Montants inventés (cents USD pour les paiements, centimes CHF pour le
 * règlement), construits pour que l'invariant tienne : tout le net crédité est
 * soit viré, soit en attente.
 */

type Fixture = {
  charges: Stripe.Charge[];
  invoicePayments?: Stripe.InvoicePayment[] | Error;
  sessions?: Stripe.Checkout.Session[] | Error;
  payouts?: Stripe.Payout[] | Error;
  balance?: Stripe.Balance | Error;
  chargesError?: Error;
};

let n = 0;
function charge(p: {
  pi: string | null;
  amount: number;
  net: number;
  fee: number;
  status?: string;
  captured?: boolean;
  refunded?: number;
  livemode?: boolean;
  created?: number;
  withBalance?: boolean;
  legacyInvoice?: string;
}): Stripe.Charge {
  n += 1;
  return {
    id: `ch_fixture_${n}`,
    object: 'charge',
    amount: p.amount,
    amount_captured: p.captured === false ? 0 : p.amount,
    amount_refunded: p.refunded ?? 0,
    captured: p.captured ?? true,
    currency: 'usd',
    status: p.status ?? 'succeeded',
    livemode: p.livemode ?? true,
    created: p.created ?? 1893456000 + n,
    payment_intent: p.pi,
    balance_transaction:
      p.withBalance === false
        ? null
        : { id: `txn_${n}`, currency: 'chf', amount: p.net + p.fee, fee: p.fee, net: p.net },
    ...(p.legacyInvoice ? { invoice: p.legacyInvoice } : {}),
  } as unknown as Stripe.Charge;
}

function invoicePayment(pi: string, invoice: unknown): Stripe.InvoicePayment {
  n += 1;
  return {
    id: `inpay_${n}`,
    object: 'invoice_payment',
    status: 'paid',
    invoice,
    payment: { type: 'payment_intent', payment_intent: pi },
  } as unknown as Stripe.InvoicePayment;
}

const subscriptionInvoice = (reason: string) => ({
  id: `in_${reason}`,
  object: 'invoice',
  billing_reason: reason,
  parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_fixture' } },
});

function session(pi: string | null, metadata: Record<string, string>, mode = 'payment') {
  n += 1;
  return {
    id: `cs_fixture_${n}`,
    object: 'checkout.session',
    payment_intent: pi,
    metadata,
    mode,
    status: 'complete',
  } as unknown as Stripe.Checkout.Session;
}

function payout(amount: number, status: string, arrival = 1893542400): Stripe.Payout {
  n += 1;
  return {
    id: `po_${n}`,
    object: 'payout',
    amount,
    currency: 'chf',
    status,
    arrival_date: arrival,
  } as unknown as Stripe.Payout;
}

/** Le jeu de référence : sept paiements réussis, deux qui n'en sont pas. */
function reference(): Fixture {
  return {
    charges: [
      charge({ pi: 'pi_pack_a', amount: 400, net: 319, fee: 41 }),
      charge({ pi: 'pi_pack_b', amount: 2000, net: 1718, fee: 82 }),
      charge({ pi: 'pi_sub_first', amount: 1700, net: 1456, fee: 74 }),
      charge({ pi: 'pi_sub_cycle', amount: 1700, net: 1456, fee: 74 }),
      charge({ pi: 'pi_audit', amount: 14900, net: 12991, fee: 419 }),
      charge({ pi: 'pi_pack_invoiced', amount: 400, net: 319, fee: 41 }),
      charge({ pi: 'pi_other', amount: 500, net: 407, fee: 43 }),
      // Ni un refus ni une simple autorisation ne sont de l'argent.
      charge({
        pi: 'pi_declined',
        amount: 2000,
        net: 0,
        fee: 0,
        status: 'failed',
        withBalance: false,
      }),
      charge({ pi: 'pi_held', amount: 2000, net: 0, fee: 0, captured: false, withBalance: false }),
    ],
    invoicePayments: [
      invoicePayment('pi_sub_first', subscriptionInvoice('subscription_create')),
      invoicePayment('pi_sub_cycle', subscriptionInvoice('subscription_cycle')),
      // Une facture sans abonnement ne fait pas d'un pack un abonnement.
      invoicePayment('pi_pack_invoiced', {
        id: 'in_manual',
        billing_reason: 'manual',
        parent: null,
      }),
    ],
    sessions: [
      session('pi_pack_a', { bundle: '1k' }),
      session('pi_pack_b', { bundle: '5k' }),
      session('pi_audit', { audit_job: 'job_fixture', rows: '10', tier: 'small' }),
      session('pi_pack_invoiced', { bundle: '1k' }),
      // Le Checkout d'un abonnement n'a pas d'intention de paiement : sa charge
      // est classée par sa facture.
      session(null, { plan: 'pro' }, 'subscription'),
    ],
    payouts: [
      payout(10000, 'paid', 1893542400),
      payout(5000, 'paid', 1893628800),
      payout(1666, 'in_transit'),
      payout(700, 'failed'),
    ],
    balance: {
      object: 'balance',
      available: [{ amount: 1500, currency: 'chf' }],
      pending: [{ amount: 500, currency: 'chf' }],
    } as unknown as Stripe.Balance,
  };
}

function fakeClient(data: Fixture, opts: { pageSize?: number; delayMs?: number } = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  async function track<T>(method: string, params: unknown, produce: () => T): Promise<T> {
    calls.push({ method, params });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
      return produce();
    } finally {
      inFlight -= 1;
    }
  }
  function pager<T extends { id: string }>(method: string, source: T[] | Error | undefined) {
    return (params: { limit?: number; starting_after?: string }) =>
      track(method, params, () => {
        if (source instanceof Error) throw source;
        const all = source ?? [];
        const size = opts.pageSize ?? params.limit ?? 100;
        const start = params.starting_after
          ? all.findIndex((x) => x.id === params.starting_after) + 1
          : 0;
        return { data: all.slice(start, start + size), has_more: start + size < all.length };
      });
  }
  const client: StripeRevenueClient = {
    charges: {
      list: (params) =>
        data.chargesError
          ? track('charges', params, () => {
              throw data.chargesError;
            })
          : pager('charges', data.charges)(params),
    },
    invoicePayments: { list: pager('invoicePayments', data.invoicePayments) },
    checkout: { sessions: { list: pager('sessions', data.sessions) } },
    payouts: { list: pager('payouts', data.payouts) },
    balance: {
      retrieve: () =>
        track('balance', null, () => {
          if (data.balance instanceof Error) throw data.balance;
          return data.balance ?? ({ available: [], pending: [] } as unknown as Stripe.Balance);
        }),
    },
  };
  return { client, calls, maxInFlight: () => maxInFlight };
}

const READ_AT = new Date('2030-01-02T09:30:00.000Z');

describe('classer chaque paiement, sans jamais mélanger les devises', () => {
  it('range packs, abonnements, audits et le reste, brut en USD, net et frais en CHF', () => {
    const f = reference();
    const s = summarizeStripeRevenue(
      {
        charges: f.charges,
        invoicePayments: f.invoicePayments as Stripe.InvoicePayment[],
        sessions: f.sessions as Stripe.Checkout.Session[],
        payouts: f.payouts as Stripe.Payout[],
        balance: f.balance as Stripe.Balance,
      },
      READ_AT,
    );
    expect(s.read_at).toBe('2030-01-02T09:30:00.000Z');
    expect(s.livemode).toBe(true);
    expect(s.by_kind.pack).toMatchObject({
      count: 3,
      gross: { usd: 2800 },
      net: { chf: 2356 },
      fees: { chf: 164 },
    });
    // La première facture ET le renouvellement : deux paiements d'abonnement.
    expect(s.by_kind.abonnement).toMatchObject({
      count: 2,
      gross: { usd: 3400 },
      net: { chf: 2912 },
    });
    expect(s.by_kind.audit).toMatchObject({ count: 1, gross: { usd: 14900 }, net: { chf: 12991 } });
    expect(s.by_kind.autre).toMatchObject({ count: 1, gross: { usd: 500 }, net: { chf: 407 } });
    // Le titre : packs + abonnements + audits, sans le paiement « autre ».
    expect(s.ibanforge.count).toBe(6);
    expect(s.ibanforge.gross).toEqual({ usd: 21100 });
    expect(s.ibanforge.net).toEqual({ chf: 18259 });
    expect(s.ibanforge.fees).toEqual({ chf: 731 });
    expect(s.ibanforge.refunded).toEqual({});
    expect(s.ibanforge.last_payment_at).not.toBeNull();
    // Le compte entier, « autre » compris.
    expect(s.account.count).toBe(7);
    expect(s.account.gross).toEqual({ usd: 21600 });
    expect(s.account.net).toEqual({ chf: 18666 });
    expect(s.account.fees).toEqual({ chf: 774 });
    expect(s.classification).toEqual({ invoices: true, sessions: true });
  });

  it('ne met jamais « autre » dans le titre : titre = packs + abonnements + audits', () => {
    const f = reference();
    const s = summarizeStripeRevenue(
      {
        charges: f.charges,
        invoicePayments: f.invoicePayments as Stripe.InvoicePayment[],
        sessions: f.sessions as Stripe.Checkout.Session[],
        payouts: null,
        balance: null,
      },
      READ_AT,
    );
    const sum = (field: 'gross' | 'refunded' | 'net' | 'fees'): MinorByCurrency => {
      const out: MinorByCurrency = {};
      for (const k of IBANFORGE_KINDS) {
        for (const [c, v] of Object.entries(s.by_kind[k][field])) out[c] = (out[c] ?? 0) + v;
      }
      return out;
    };
    for (const field of ['gross', 'refunded', 'net', 'fees'] as const) {
      expect(s.ibanforge[field], field).toEqual(sum(field));
    }
    expect(s.ibanforge.count).toBe(IBANFORGE_KINDS.reduce((n, k) => n + s.by_kind[k].count, 0));
    // Le compte dépasse le titre exactement du paiement « autre ».
    expect(s.account.gross.usd - s.ibanforge.gross.usd).toBe(s.by_kind.autre.gross.usd);
    expect(s.account.count - s.ibanforge.count).toBe(s.by_kind.autre.count);
  });

  it('garde hors du titre un paiement « autre », même remboursé ou sans session', () => {
    const s = summarizeStripeRevenue(
      {
        charges: [
          charge({ pi: 'pi_pack_only', amount: 2800, net: 2400, fee: 100 }),
          charge({ pi: 'pi_elsewhere', amount: 500, net: 407, fee: 43, refunded: 500 }),
        ],
        invoicePayments: [],
        sessions: [session('pi_pack_only', { bundle: '5k' })],
        payouts: null,
        balance: null,
      },
      READ_AT,
    );
    expect(s.ibanforge.gross).toEqual({ usd: 2800 });
    expect(s.ibanforge.refunded).toEqual({});
    expect(s.by_kind.autre.refunded).toEqual({ usd: 500 });
    expect(s.account.gross).toEqual({ usd: 3300 });
    expect(s.account.refunded).toEqual({ usd: 500 });
  });

  it('dit ce qui est viré et ce qui attend : tout le net est l’un ou l’autre', () => {
    const f = reference();
    const s = summarizeStripeRevenue(
      {
        charges: f.charges,
        invoicePayments: f.invoicePayments as Stripe.InvoicePayment[],
        sessions: f.sessions as Stripe.Checkout.Session[],
        payouts: f.payouts as Stripe.Payout[],
        balance: f.balance as Stripe.Balance,
      },
      READ_AT,
    );
    expect(s.payouts?.paid).toEqual({
      count: 2,
      amount: { chf: 15000 },
      last_arrival_at: '2030-01-03T00:00:00.000Z',
    });
    expect(s.payouts?.in_transit).toEqual({ count: 1, amount: { chf: 1666 } });
    expect(s.balance).toEqual({ available: { chf: 1500 }, pending: { chf: 500 } });
    expect(s.awaiting_payout).toEqual({ chf: 3666 });
    // Virements et solde n'existent qu'au niveau du compte : l'égalité se lit sur `account`.
    expect((s.payouts?.paid.amount.chf ?? 0) + (s.awaiting_payout?.chf ?? 0)).toBe(
      s.account.net.chf,
    );
  });

  it('montre un remboursement à part, sans le retirer du brut', () => {
    const s = summarizeStripeRevenue(
      {
        charges: [charge({ pi: 'pi_r', amount: 2000, net: 1718, fee: 82, refunded: 2000 })],
        invoicePayments: [],
        sessions: [session('pi_r', { bundle: '5k' })],
        payouts: [],
        balance: null,
      },
      READ_AT,
    );
    expect(s.by_kind.pack.gross).toEqual({ usd: 2000 });
    expect(s.by_kind.pack.refunded).toEqual({ usd: 2000 });
    expect(s.ibanforge.refunded).toEqual({ usd: 2000 });
    // Sans le solde, « en attente » n'est pas calculable : null, jamais zéro.
    expect(s.awaiting_payout).toBeNull();
  });

  it("lit encore l'ancien champ charge.invoice quand les factures ne disent rien", () => {
    const s = summarizeStripeRevenue(
      {
        charges: [
          charge({ pi: 'pi_legacy', amount: 1700, net: 1456, fee: 74, legacyInvoice: 'in_x' }),
        ],
        invoicePayments: [],
        sessions: [],
        payouts: null,
        balance: null,
      },
      READ_AT,
    );
    expect(s.by_kind.abonnement.count).toBe(1);
  });

  it('signale une clé de test et un net illisible', () => {
    const s = summarizeStripeRevenue(
      {
        charges: [
          charge({ pi: 'pi_t', amount: 400, net: 0, fee: 0, livemode: false, withBalance: false }),
        ],
        invoicePayments: [],
        sessions: [],
        payouts: null,
        balance: null,
      },
      READ_AT,
    );
    expect(s.livemode).toBe(false);
    expect(s.account.net_unknown).toBe(1);
    expect(s.account.net).toEqual({});
    // Sans session ni facture, ce paiement est « autre » : hors du titre.
    expect(s.ibanforge.count).toBe(0);
  });
});

describe('lire Stripe : pagination complète, lectures secondaires qui peuvent manquer', () => {
  it('parcourt toutes les pages, dans l’ordre, et demande la transaction de solde', async () => {
    const f = reference();
    const fake = fakeClient(f, { pageSize: 2 });
    const s = await readStripeRevenue(fake.client, { now: () => READ_AT.getTime() });
    const chargePages = fake.calls.filter((c) => c.method === 'charges');
    expect(chargePages).toHaveLength(5); // 9 charges, 2 par page
    expect(chargePages[0].params).toMatchObject({
      limit: 100,
      expand: ['data.balance_transaction'],
    });
    expect(chargePages[0].params).not.toHaveProperty('starting_after');
    expect(chargePages[1].params).toMatchObject({ starting_after: f.charges[1].id });
    expect(chargePages[4].params).toMatchObject({ starting_after: f.charges[7].id });
    expect(s.account.count).toBe(7);
    expect(s.ibanforge.gross).toEqual({ usd: 21100 });
    const invoiceCall = fake.calls.find((c) => c.method === 'invoicePayments');
    expect(invoiceCall?.params).toMatchObject({ status: 'paid', expand: ['data.invoice'] });
    const sessionCall = fake.calls.find((c) => c.method === 'sessions');
    expect(sessionCall?.params).toMatchObject({ status: 'complete' });
  });

  it('quand le classement échoue, le titre baisse au lieu de gonfler, et la lecture le dit', async () => {
    const f = reference();
    f.invoicePayments = new Error('factures injoignables');
    const s = await readStripeRevenue(fakeClient(f).client, { now: () => READ_AT.getTime() });
    expect(s.classification.invoices).toBe(false);
    // Les deux paiements d'abonnement n'ont pas de session : ils tombent dans
    // « autre », visibles mais hors du titre.
    expect(s.by_kind.abonnement.count).toBe(0);
    expect(s.by_kind.autre.count).toBe(3);
    expect(s.ibanforge.gross).toEqual({ usd: 17700 });
    expect(s.account.gross).toEqual({ usd: 21600 });
  });

  it('rend null les virements et le solde quand leur lecture échoue', async () => {
    const f = reference();
    f.payouts = new Error('virements injoignables');
    const s = await readStripeRevenue(fakeClient(f).client, { now: () => READ_AT.getTime() });
    expect(s.payouts).toBeNull();
    expect(s.awaiting_payout).toBeNull();
    expect(s.account.count).toBe(7);
  });

  it('échoue entière sans les charges', async () => {
    const f = reference();
    f.chargesError = new Error('Stripe injoignable');
    await expect(readStripeRevenue(fakeClient(f).client)).rejects.toThrow('Stripe injoignable');
  });
});

describe('le cache : quinze minutes, une seule lecture en vol', () => {
  it('sert toutes les requêtes simultanées avec UNE lecture, jamais deux appels à la fois', async () => {
    const fake = fakeClient(reference(), { pageSize: 3, delayMs: 5 });
    const cache = new StripeRevenueCache({ factory: () => fake.client, waitMs: 5_000 });
    const results = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fake.maxInFlight()).toBe(1);
    // Une lecture complète : trois pages de charges, pas neuf.
    expect(fake.calls.filter((c) => c.method === 'charges')).toHaveLength(3);
  });

  it('relit après quinze minutes, pas avant', async () => {
    let clock = Date.parse('2030-01-02T09:00:00.000Z');
    const fake = fakeClient(reference());
    const cache = new StripeRevenueCache({ factory: () => fake.client, now: () => clock });
    await cache.get();
    const afterFirst = fake.calls.length;
    clock += 14 * 60_000;
    const cached = await cache.get();
    expect(fake.calls.length).toBe(afterFirst);
    expect(cached.ok && cached.snapshot.read_at).toBe('2030-01-02T09:00:00.000Z');
    clock += 2 * 60_000;
    const fresh = await cache.get();
    expect(fake.calls.length).toBe(afterFirst * 2);
    expect(fresh.ok && fresh.snapshot.read_at).toBe('2030-01-02T09:16:00.000Z');
  });

  it('retient un échec une minute, puis réessaie', async () => {
    let clock = 0;
    const f = reference();
    f.chargesError = new Error('panne');
    const fake = fakeClient(f);
    const cache = new StripeRevenueCache({ factory: () => fake.client, now: () => clock });
    expect(await cache.get()).toEqual({ ok: false, reason: 'stripe_unreachable' });
    clock += 30_000;
    await cache.get();
    expect(fake.calls).toHaveLength(1);
    clock += 31_000;
    await cache.get();
    expect(fake.calls).toHaveLength(2);
  });

  it('répond « non configuré » sans clé Stripe', async () => {
    const cache = new StripeRevenueCache({ factory: () => null });
    expect(await cache.get()).toEqual({ ok: false, reason: 'stripe_not_configured' });
  });

  it("n'attend pas une lecture lente au-delà du délai, et la sert à la requête suivante", async () => {
    const fake = fakeClient(reference(), { delayMs: 20 });
    const cache = new StripeRevenueCache({ factory: () => fake.client, waitMs: 1 });
    expect(await cache.get()).toEqual({ ok: false, reason: 'stripe_slow' });
    // La lecture continue sans personne pour l'attendre ; la suivante la trouve.
    let later = await cache.get();
    for (let i = 0; i < 200 && !later.ok; i++) {
      await new Promise((r) => setTimeout(r, 10));
      later = await cache.get();
    }
    expect(later.ok).toBe(true);
    expect(fake.maxInFlight()).toBe(1);
  });
});
