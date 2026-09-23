import { describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import {
  invoiceSubscriptionId,
  readSubscriptionRows,
  sqliteUtc,
  stripeId,
  SUBSCRIPTION_KEY_SQL,
  subscriptionsSold,
  type SubscriptionKeyRow,
  type SubscriptionPaymentRow,
} from './subscription-payments.js';

/** Fixtures inventées : ce dépôt est public. */
function keyRow(over: Partial<SubscriptionKeyRow> = {}): SubscriptionKeyRow {
  return {
    email: 'abonne@alpha.example.net',
    stripe_session_id: 'cs_test_alpha',
    stripe_subscription_id: 'sub_test_alpha',
    amount_paid_minor: 1700,
    amount_paid_currency: 'usd',
    issued_by_us: 0,
    active: 1,
    created_at: '2030-01-01 10:00:00',
    ...over,
  };
}

function renewal(over: Partial<SubscriptionPaymentRow> = {}): SubscriptionPaymentRow {
  return {
    subscription_id: 'sub_test_alpha',
    amount_paid_minor: 1700,
    amount_paid_currency: 'usd',
    billing_reason: 'subscription_cycle',
    paid_at: '2030-02-01 10:00:00',
    email: 'abonne@alpha.example.net',
    ...over,
  };
}

const nobodyInternal = () => false;
const acmeIsInternal = (email: string) => email.endsWith('@example.com');

describe("l'abonnement d'une facture, quelle que soit la version d'API", () => {
  it('lit la forme actuelle (parent.subscription_details)', () => {
    expect(
      invoiceSubscriptionId({
        parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_a' } },
      }),
    ).toBe('sub_a');
  });

  it("lit l'ancienne forme (invoice.subscription), développée ou non", () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_b' })).toBe('sub_b');
    expect(invoiceSubscriptionId({ subscription: { id: 'sub_c', object: 'subscription' } })).toBe(
      'sub_c',
    );
  });

  it('rend null pour une facture sans abonnement, jamais une chaîne vide', () => {
    expect(invoiceSubscriptionId({ parent: null })).toBeNull();
    expect(invoiceSubscriptionId({ subscription: '' })).toBeNull();
    expect(invoiceSubscriptionId(null)).toBeNull();
    expect(stripeId({ id: '' })).toBeNull();
  });

  it('écrit les horodatages Stripe au format de SQLite', () => {
    expect(sqliteUtc(1893459600)).toBe('2030-01-01 01:00:00');
  });
});

describe('ce qui a été vendu en abonnements', () => {
  it('additionne le premier paiement de la clé et les renouvellements', () => {
    const sold = subscriptionsSold(
      { keys: [keyRow()], payments: [renewal(), renewal({ paid_at: '2030-03-01 10:00:00' })] },
      nobodyInternal,
    );
    expect(sold.first_payments).toBe(1);
    expect(sold.first_payments_usd_minor).toBe(1700);
    expect(sold.renewals).toBe(2);
    expect(sold.renewals_usd_minor).toBe(3400);
    expect(sold.usd_minor).toBe(5100);
    expect(sold.usd).toBe(51);
    expect(sold.subscriptions).toBe(1);
    expect(sold.active_subscriptions).toBe(1);
    expect(sold.last_payment_at).toBe('2030-03-01 10:00:00');
  });

  it("compte une fois un premier paiement porté par deux copies d'une même session", () => {
    const sold = subscriptionsSold(
      { keys: [keyRow({ active: 0 }), keyRow({ active: 1 })], payments: [] },
      nobodyInternal,
    );
    expect(sold.first_payments).toBe(1);
    expect(sold.usd_minor).toBe(1700);
  });

  it('suit la clé active après une rotation, qui ne recopie ni session ni montant', () => {
    const sold = subscriptionsSold(
      {
        keys: [
          keyRow({ active: 0 }),
          keyRow({
            stripe_session_id: null,
            amount_paid_minor: null,
            amount_paid_currency: null,
            active: 1,
          }),
        ],
        payments: [],
      },
      nobodyInternal,
    );
    expect(sold.first_payments).toBe(1);
    expect(sold.first_payments_amount_missing).toBe(0);
    expect(sold.active_subscriptions).toBe(1);
  });

  it('écarte un abonnement interne entier, premier paiement et renouvellements', () => {
    const sold = subscriptionsSold(
      {
        keys: [
          keyRow({
            email: 'acme@example.com',
            stripe_session_id: 'cs_i',
            stripe_subscription_id: 'sub_i',
          }),
          keyRow(),
        ],
        payments: [renewal({ subscription_id: 'sub_i', email: 'acme@example.com' }), renewal()],
      },
      acmeIsInternal,
    );
    expect(sold.first_payments).toBe(1);
    expect(sold.renewals).toBe(1);
    expect(sold.usd_minor).toBe(3400);
    expect(sold.excluded_subscriptions).toBe(1);
  });

  it("garde un renouvellement qu'aucune clé ne rattache : l'argent est réel", () => {
    const sold = subscriptionsSold(
      { keys: [], payments: [renewal({ subscription_id: 'sub_orphan', email: null })] },
      acmeIsInternal,
    );
    expect(sold.renewals).toBe(1);
    expect(sold.usd_minor).toBe(1700);
  });

  it("n'additionne jamais une autre devise et ne devine jamais un montant absent", () => {
    const sold = subscriptionsSold(
      {
        keys: [
          keyRow({
            stripe_session_id: 'cs_eur',
            stripe_subscription_id: 'sub_eur',
            amount_paid_currency: 'eur',
          }),
          keyRow({
            stripe_session_id: 'cs_old',
            stripe_subscription_id: 'sub_old',
            amount_paid_minor: null,
          }),
        ],
        payments: [
          renewal({ subscription_id: 'sub_eur', amount_paid_currency: 'eur' }),
          renewal({ subscription_id: 'sub_old', amount_paid_minor: null }),
        ],
      },
      nobodyInternal,
    );
    expect(sold.usd_minor).toBe(0);
    expect(sold.other_currency_payments).toBe(2);
    expect(sold.first_payments_amount_missing).toBe(1);
    expect(sold.renewals_amount_missing).toBe(1);
  });

  it('ne prend dans le registre que les factures subscription_cycle', () => {
    const sold = subscriptionsSold(
      { keys: [], payments: [renewal({ billing_reason: 'subscription_create' })] },
      nobodyInternal,
    );
    expect(sold.renewals).toBe(0);
    expect(sold.usd_minor).toBe(0);
  });

  it('écarte une clé offerte comme une clé interne', () => {
    const sold = subscriptionsSold(
      { keys: [keyRow({ issued_by_us: 1 })], payments: [] },
      nobodyInternal,
    );
    expect(sold.first_payments).toBe(0);
    expect(sold.usd_minor).toBe(0);
  });
});

describe('une seule règle pour reconnaître un abonné, et jamais deux fois le même argent', () => {
  it('la règle partagée avec activation.ts ne prend que les clés d’abonnement', () => {
    const db = getStatsDB();
    db.exec('DELETE FROM api_keys');
    const insert = db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, credits_total, stripe_session_id,
         stripe_subscription_id) VALUES (?, ?, 'abonne@alpha.example.net', ?, ?, ?)`,
    );
    insert.run('h_sub_id', 'ifk_rule0001', null, null, 'sub_rule');
    insert.run('h_sub_shape', 'ifk_rule0002', null, 'cs_rule_sub', null);
    insert.run('h_pack', 'ifk_rule0003', 1000, 'cs_rule_pack', null);
    insert.run('h_free', 'ifk_rule0004', null, null, null);
    const picked = (
      db
        .prepare(
          `SELECT key_prefix FROM api_keys WHERE (${SUBSCRIPTION_KEY_SQL}) ORDER BY key_prefix`,
        )
        .all() as Array<{ key_prefix: string }>
    ).map((r) => r.key_prefix);
    expect(picked).toEqual(['ifk_rule0001', 'ifk_rule0002']);
    expect(readSubscriptionRows(db).keys).toHaveLength(2);
  });

  it("une clé à crédits n'apporte jamais de premier paiement d'abonnement : c'est un pack", () => {
    const sold = subscriptionsSold(
      { keys: [keyRow({ credits_total: 1000, amount_paid_minor: 400 })], payments: [] },
      nobodyInternal,
    );
    expect(sold.first_payments).toBe(0);
    expect(sold.usd_minor).toBe(0);
    // L'abonnement reste compté dans la population, pas son argent.
    expect(sold.subscriptions).toBe(1);
  });
});
