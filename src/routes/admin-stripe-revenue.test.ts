import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type Stripe from 'stripe';
import { adminStripeRevenue, _setStripeRevenueForTests } from './admin-stripe-revenue.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import type { StripeRevenueClient } from '../lib/stripe-revenue.js';

/**
 * La porte de la route, le repli quand Stripe tombe, et ce que le corps ne
 * contient jamais. Aucun appel à Stripe : la fabrique rend un faux client.
 *
 * 🚨 Toute variable d'environnement touchée est restaurée : une garde d'admin
 * laissée ouverte par un test contaminerait les fichiers qui suivent.
 */
vi.hoisted(() => {
  process.env.RADAR_INTERNAL_EMAILS = '';
  process.env.CRM_INTERNAL_EMAILS = '';
});

const app = new Hono();
app.route('/', adminStripeRevenue);
const headers = { 'X-Admin-Secret': 'secret-admin-fictif' };

function page<T>(data: T[]) {
  return Promise.resolve({ data, has_more: false });
}

/** Deux paiements inventés : un pack et un abonnement. */
function fakeStripe(opts: { down?: boolean } = {}): StripeRevenueClient {
  const charges = [
    {
      id: 'ch_route_pack',
      status: 'succeeded',
      captured: true,
      amount: 2000,
      amount_captured: 2000,
      amount_refunded: 0,
      currency: 'usd',
      livemode: true,
      created: 1893456000,
      payment_intent: 'pi_route_pack',
      balance_transaction: { id: 'txn_a', currency: 'chf', amount: 1800, fee: 82, net: 1718 },
    },
    {
      id: 'ch_route_sub',
      status: 'succeeded',
      captured: true,
      amount: 1700,
      amount_captured: 1700,
      amount_refunded: 0,
      currency: 'usd',
      livemode: true,
      created: 1893459600,
      payment_intent: 'pi_route_sub',
      receipt_email: 'abonne@alpha.example.net',
      billing_details: { email: 'abonne@alpha.example.net' },
      balance_transaction: { id: 'txn_b', currency: 'chf', amount: 1530, fee: 74, net: 1456 },
    },
  ] as unknown as Stripe.Charge[];
  return {
    charges: {
      list: () =>
        opts.down ? Promise.reject(new Error('api.stripe.com injoignable')) : page(charges),
    },
    invoicePayments: {
      list: () =>
        page([
          {
            id: 'inpay_route',
            status: 'paid',
            invoice: {
              id: 'in_route',
              billing_reason: 'subscription_cycle',
              parent: {
                type: 'subscription_details',
                subscription_details: { subscription: 'sub_route' },
              },
            },
            payment: { type: 'payment_intent', payment_intent: 'pi_route_sub' },
          },
        ] as unknown as Stripe.InvoicePayment[]),
    },
    checkout: {
      sessions: {
        list: () =>
          page([
            {
              id: 'cs_route_pack',
              payment_intent: 'pi_route_pack',
              metadata: { bundle: '5k' },
              mode: 'payment',
              customer_details: { email: 'acheteur@beta.example.net' },
            },
          ] as unknown as Stripe.Checkout.Session[]),
      },
    },
    payouts: {
      list: () =>
        page([
          {
            id: 'po_route',
            amount: 2000,
            currency: 'chf',
            status: 'paid',
            arrival_date: 1893542400,
          },
        ] as unknown as Stripe.Payout[]),
    },
    balance: {
      retrieve: () =>
        Promise.resolve({
          available: [{ amount: 1000, currency: 'chf' }],
          pending: [{ amount: 174, currency: 'chf' }],
        } as unknown as Stripe.Balance),
    },
  };
}

/** Nos propres traces, pour le repli : un pack, un abonné et son renouvellement, deux audits. */
function seedLedgers() {
  const db = getStatsDB();
  db.exec('DELETE FROM api_keys; DELETE FROM subscription_payments; DELETE FROM audit_sales;');
  const key = db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, credits_total, credits_remaining,
       monthly_limit, amount_paid_minor, amount_paid_currency, stripe_session_id,
       stripe_subscription_id, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  key.run(
    'h_pack',
    'ifk_route001',
    'acheteur@beta.example.net',
    5000,
    4000,
    null,
    2000,
    'usd',
    'cs_route_pack',
    null,
    '2030-01-01 00:00:00',
  );
  // Un pack interne : exclu, comme sur la tuile des packs.
  key.run(
    'h_internal',
    'ifk_route002',
    'acme@example.com',
    25000,
    25000,
    null,
    8000,
    'usd',
    'cs_route_internal',
    null,
    '2030-01-01 00:00:00',
  );
  key.run(
    'h_sub',
    'ifk_route003',
    'abonne@alpha.example.net',
    null,
    null,
    10000,
    1700,
    'usd',
    'cs_route_sub',
    'sub_route',
    '2030-01-01 01:00:00',
  );
  db.prepare(
    `INSERT INTO subscription_payments (stripe_event_id, invoice_id, subscription_id, key_hash,
       amount_paid_minor, amount_paid_currency, billing_reason, paid_at)
     VALUES ('evt_route', 'in_route', 'sub_route', 'h_sub', 1700, 'usd', 'subscription_cycle', '2030-02-01 01:00:00')`,
  ).run();
  const audit = db.prepare(
    `INSERT INTO audit_sales (job_id, rows, tier, price, currency, amount_paid_minor,
       amount_paid_currency, paid_at) VALUES (?, 10, 'small', ?, ?, ?, ?, ?)`,
  );
  audit.run('job_usd', 149, 'USD', 14900, 'usd', '2030-01-05 00:00:00');
  // Un audit vendu en francs : compté à part, jamais converti.
  audit.run('job_chf', 149, 'CHF', 14900, 'chf', '2029-12-01 00:00:00');
}

let factoryCalls = 0;

beforeEach(() => {
  vi.stubEnv('ADMIN_SECRET', 'secret-admin-fictif');
  factoryCalls = 0;
  seedLedgers();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _setStripeRevenueForTests(null);
});
afterAll(() => closeAll());

describe('GET /v1/admin/stripe-revenue', () => {
  it('refuse sans le bon secret, avant toute lecture de Stripe', async () => {
    _setStripeRevenueForTests({
      factory: () => {
        factoryCalls += 1;
        return fakeStripe();
      },
    });
    expect((await app.request('/v1/admin/stripe-revenue')).status).toBe(401);
    const wrong = await app.request('/v1/admin/stripe-revenue', {
      headers: { 'X-Admin-Secret': 'pas-le-bon' },
    });
    expect(wrong.status).toBe(401);
    expect(factoryCalls).toBe(0);
  });

  it('sert la lecture de Stripe et le repli, sans cache HTTP et sans donnée personnelle', async () => {
    _setStripeRevenueForTests({ factory: () => fakeStripe() });
    const res = await app.request('/v1/admin/stripe-revenue', { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as {
      version: number;
      source: string;
      reason: string | null;
      cache_ttl_seconds: number;
      stripe: {
        by_kind: Record<string, { count: number; gross: Record<string, number> }>;
        total: { gross: Record<string, number>; net: Record<string, number> };
        payouts: { paid: { amount: Record<string, number> } };
        awaiting_payout: Record<string, number>;
        read_at: string;
      };
      derived: { total_minor: number };
    };
    expect(body.version).toBe(1);
    expect(body.source).toBe('stripe');
    expect(body.reason).toBeNull();
    expect(body.cache_ttl_seconds).toBe(900);
    expect(body.stripe.by_kind.pack).toMatchObject({ count: 1, gross: { usd: 2000 } });
    expect(body.stripe.by_kind.abonnement).toMatchObject({ count: 1, gross: { usd: 1700 } });
    expect(body.stripe.by_kind.audit.count).toBe(0);
    expect(body.stripe.total.gross).toEqual({ usd: 3700 });
    expect(body.stripe.total.net).toEqual({ chf: 3174 });
    expect(body.stripe.payouts.paid.amount).toEqual({ chf: 2000 });
    expect(body.stripe.awaiting_payout).toEqual({ chf: 1174 });
    expect(Date.parse(body.stripe.read_at)).not.toBeNaN();
    expect(body.derived.total_minor).toBeGreaterThan(0);

    const text = JSON.stringify(body);
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/\b(ch|pi|cs|in|po|sub|txn)_route/);
  });

  it('répond 200 « indisponible » avec le total selon les clés quand Stripe ne répond pas', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    _setStripeRevenueForTests({ factory: () => fakeStripe({ down: true }) });
    const res = await app.request('/v1/admin/stripe-revenue', { headers });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      reason: string;
      stripe: unknown;
      derived: {
        currency: string;
        total_minor: number;
        by_kind: { pack: number; abonnement: number; audit: number };
        other_currency_payments: number;
        last_payment_at: string;
      };
    };
    expect(body.source).toBe('indisponible');
    expect(body.reason).toBe('stripe_unreachable');
    expect(body.stripe).toBeNull();
    // Pack externe + premier paiement + renouvellement + audit en dollars ; le
    // pack interne et l'audit en francs restent dehors.
    expect(body.derived.by_kind).toEqual({ pack: 2000, abonnement: 3400, audit: 14900 });
    expect(body.derived.total_minor).toBe(20300);
    expect(body.derived.currency).toBe('usd');
    expect(body.derived.other_currency_payments).toBe(1);
    expect(body.derived.last_payment_at).toBe('2030-02-01T01:00:00.000Z');
    // Le message de Stripe reste dans le journal du serveur.
    expect(JSON.stringify(body)).not.toContain('injoignable');
  });

  it('dit « non configuré » sans clé Stripe', async () => {
    _setStripeRevenueForTests({ factory: () => null });
    const body = (await (await app.request('/v1/admin/stripe-revenue', { headers })).json()) as {
      source: string;
      reason: string;
    };
    expect(body).toMatchObject({ source: 'indisponible', reason: 'stripe_not_configured' });
  });
});
