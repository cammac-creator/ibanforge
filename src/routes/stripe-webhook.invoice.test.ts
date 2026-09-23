import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { processStripeEvent } from './stripe-webhook.js';
import { consumeOneTimeKey, rotateApiKey } from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { readSubscriptionRows, subscriptionsSold } from '../lib/subscription-payments.js';

/**
 * Les renouvellements d'abonnement (invoice.paid), et la règle qui compte :
 * la première facture est déjà sur la clé frappée au Checkout, elle ne doit
 * jamais entrer une seconde fois dans l'argent encaissé.
 *
 * Montants et adresses inventés. Les adresses sont sur alpha.example.net et
 * non sur example.com : ce dernier domaine est rangé parmi les comptes
 * internes, qui sont exclus des revenus.
 */

let seq = 0;
function uid(label: string): string {
  seq += 1;
  return `${label}_${Date.now()}_${seq}`;
}

function checkoutPro(opts: {
  eventId: string;
  sessionId: string;
  subscriptionId: string;
  email?: string;
  amountTotal?: number;
}): Stripe.Event {
  return {
    id: opts.eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { plan: 'pro' },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: 'paid',
        mode: 'subscription',
        subscription: opts.subscriptionId,
        amount_total: opts.amountTotal ?? 1700,
        currency: 'usd',
      },
    },
  } as unknown as Stripe.Event;
}

/** Une facture payée, dans la forme actuelle de l'API (parent) ou l'ancienne (subscription). */
function invoicePaid(opts: {
  eventId: string;
  invoiceId: string;
  subscriptionId?: string | null;
  billingReason?: string | null;
  amountPaid?: number | null;
  currency?: string;
  paidAt?: number;
  legacyShape?: boolean;
}): Stripe.Event {
  const subscription = opts.subscriptionId ?? null;
  const shape = opts.legacyShape
    ? { subscription }
    : {
        parent: subscription
          ? {
              type: 'subscription_details',
              subscription_details: { subscription, metadata: {} },
              quote_details: null,
            }
          : null,
      };
  return {
    id: opts.eventId,
    type: 'invoice.paid',
    created: 1893456000,
    data: {
      object: {
        id: opts.invoiceId,
        object: 'invoice',
        billing_reason:
          opts.billingReason === undefined ? 'subscription_cycle' : opts.billingReason,
        amount_paid: opts.amountPaid === undefined ? 1700 : opts.amountPaid,
        currency: opts.currency ?? 'usd',
        status: 'paid',
        status_transitions: { paid_at: opts.paidAt ?? 1893459600 },
        ...shape,
      },
    },
  } as unknown as Stripe.Event;
}

function rowsFor(subscriptionId: string) {
  return getStatsDB()
    .prepare(
      `SELECT stripe_event_id, invoice_id, key_hash, amount_paid_minor, amount_paid_currency,
              billing_reason, paid_at
         FROM subscription_payments WHERE subscription_id = ?`,
    )
    .all(subscriptionId) as Array<{
    stripe_event_id: string;
    invoice_id: string;
    key_hash: string | null;
    amount_paid_minor: number | null;
    amount_paid_currency: string | null;
    billing_reason: string | null;
    paid_at: string | null;
  }>;
}

function keyHashOf(prefix: string): string {
  return (
    getStatsDB().prepare('SELECT key_hash FROM api_keys WHERE key_prefix = ?').get(prefix) as {
      key_hash: string;
    }
  ).key_hash;
}

/** Ce que les lectures sans Stripe comptent pour un abonnement donné. */
function soldFor(subscriptionId: string) {
  const rows = readSubscriptionRows();
  return subscriptionsSold(
    {
      keys: rows.keys.filter((k) => k.stripe_subscription_id === subscriptionId),
      payments: rows.payments.filter((p) => p.subscription_id === subscriptionId),
    },
    () => false,
  );
}

describe('invoice.paid — un renouvellement est consigné une fois', () => {
  it('enregistre une facture subscription_cycle avec son montant, sa devise et sa clé', () => {
    const sub = uid('sub_cycle');
    const minted = processStripeEvent(
      checkoutPro({
        eventId: uid('evt_checkout'),
        sessionId: uid('cs_test_cycle'),
        subscriptionId: sub,
        email: 'abonne-un@alpha.example.net',
      }),
    );
    const eventId = uid('evt_renewal');
    const result = processStripeEvent(
      invoicePaid({ eventId, invoiceId: uid('in_cycle'), subscriptionId: sub, amountPaid: 1700 }),
    );

    expect(result.status).toBe(200);
    expect(result.body.recorded).toBe(true);
    expect(result.body.billing_reason).toBe('subscription_cycle');
    expect(result.body.key_resolved).toBe(true);
    const rows = rowsFor(sub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stripe_event_id: eventId,
      amount_paid_minor: 1700,
      amount_paid_currency: 'usd',
      billing_reason: 'subscription_cycle',
      // status_transitions.paid_at, au format que SQLite écrit lui-même.
      paid_at: '2030-01-01 01:00:00',
    });
    expect(rows[0].key_hash).toBe(keyHashOf(minted.body.key_prefix as string));
  });

  it('ne consigne rien deux fois quand Stripe rejoue le même évènement', () => {
    const sub = uid('sub_replay');
    const event = invoicePaid({
      eventId: uid('evt_replay'),
      invoiceId: uid('in_replay'),
      subscriptionId: sub,
    });
    expect(processStripeEvent(event).body.recorded).toBe(true);
    const replay = processStripeEvent(event);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(rowsFor(sub)).toHaveLength(1);
  });

  it('ne compte pas deux fois une facture annoncée sous un autre évènement', () => {
    const sub = uid('sub_resent');
    const invoiceId = uid('in_resent');
    processStripeEvent(invoicePaid({ eventId: uid('evt_a'), invoiceId, subscriptionId: sub }));
    const again = processStripeEvent(
      invoicePaid({ eventId: uid('evt_b'), invoiceId, subscriptionId: sub }),
    );
    expect(again.status).toBe(200);
    expect(again.body.recorded).toBe(false);
    expect(again.body.ignored).toBe('invoice_already_recorded');
    expect(rowsFor(sub)).toHaveLength(1);
  });
});

describe('invoice.paid — la première facture reste sur la clé', () => {
  it("n'enregistre pas subscription_create : le premier paiement ne compte qu'une fois", () => {
    const sub = uid('sub_first');
    processStripeEvent(
      checkoutPro({
        eventId: uid('evt_checkout_first'),
        sessionId: uid('cs_test_first'),
        subscriptionId: sub,
        email: 'abonne-deux@alpha.example.net',
        amountTotal: 1700,
      }),
    );
    const first = processStripeEvent(
      invoicePaid({
        eventId: uid('evt_first_invoice'),
        invoiceId: uid('in_first'),
        subscriptionId: sub,
        billingReason: 'subscription_create',
        amountPaid: 1700,
      }),
    );
    expect(first.status).toBe(200);
    expect(first.body.recorded).toBe(false);
    expect(first.body.ignored).toBe('first_invoice_on_checkout');
    expect(rowsFor(sub)).toHaveLength(0);

    // Un mois plus tard, le renouvellement s'ajoute au premier paiement.
    processStripeEvent(
      invoicePaid({ eventId: uid('evt_second'), invoiceId: uid('in_second'), subscriptionId: sub }),
    );
    const sold = soldFor(sub);
    expect(sold.first_payments).toBe(1);
    expect(sold.renewals).toBe(1);
    expect(sold.usd_minor).toBe(3400);
  });

  it('ordre inversé : la première facture avant le Checkout ne crée rien non plus', () => {
    const sub = uid('sub_first_early');
    processStripeEvent(
      invoicePaid({
        eventId: uid('evt_early'),
        invoiceId: uid('in_early'),
        subscriptionId: sub,
        billingReason: 'subscription_create',
      }),
    );
    processStripeEvent(
      checkoutPro({
        eventId: uid('evt_late'),
        sessionId: uid('cs_test_late'),
        subscriptionId: sub,
      }),
    );
    expect(rowsFor(sub)).toHaveLength(0);
    expect(soldFor(sub).usd_minor).toBe(1700);
  });

  it.each(['subscription_update', 'subscription_threshold', 'manual', null])(
    "reçoit et ignore une facture %s, qui n'est pas un renouvellement",
    (reason) => {
      const sub = uid('sub_other');
      const result = processStripeEvent(
        invoicePaid({
          eventId: uid('evt_other'),
          invoiceId: uid('in_other'),
          subscriptionId: sub,
          billingReason: reason,
        }),
      );
      expect(result.status).toBe(200);
      expect(result.body.recorded).toBe(false);
      expect(result.body.ignored).toBe('not_a_renewal');
      expect(rowsFor(sub)).toHaveLength(0);
    },
  );

  it("ignore une facture qui n'appartient à aucun abonnement", () => {
    const result = processStripeEvent(
      invoicePaid({
        eventId: uid('evt_oneoff'),
        invoiceId: uid('in_oneoff'),
        subscriptionId: null,
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.recorded).toBe(false);
    expect(result.body.ignored).toBe('not_a_subscription_invoice');
  });
});

describe('invoice.paid — formes et cas limites', () => {
  it("lit l'abonnement dans l'ancienne forme de l'API (invoice.subscription)", () => {
    const sub = uid('sub_legacy');
    const result = processStripeEvent(
      invoicePaid({
        eventId: uid('evt_legacy'),
        invoiceId: uid('in_legacy'),
        subscriptionId: sub,
        legacyShape: true,
      }),
    );
    expect(result.body.recorded).toBe(true);
    expect(rowsFor(sub)).toHaveLength(1);
  });

  it('garde un montant absent à NULL, jamais à 0', () => {
    const sub = uid('sub_no_amount');
    processStripeEvent(
      invoicePaid({
        eventId: uid('evt_no_amount'),
        invoiceId: uid('in_no_amount'),
        subscriptionId: sub,
        amountPaid: null,
      }),
    );
    expect(rowsFor(sub)[0].amount_paid_minor).toBeNull();
    const sold = soldFor(sub);
    expect(sold.renewals).toBe(1);
    expect(sold.renewals_amount_missing).toBe(1);
    expect(sold.usd_minor).toBe(0);
  });

  it('rattache le renouvellement à la clé active après une rotation', () => {
    const sub = uid('sub_rotated');
    const sessionId = uid('cs_test_rotated');
    processStripeEvent(checkoutPro({ eventId: uid('evt_rot'), sessionId, subscriptionId: sub }));
    const delivered = consumeOneTimeKey(sessionId)!;
    const rotated = rotateApiKey(delivered.api_key)!;
    processStripeEvent(
      invoicePaid({
        eventId: uid('evt_rot_renewal'),
        invoiceId: uid('in_rot'),
        subscriptionId: sub,
      }),
    );
    expect(rowsFor(sub)[0].key_hash).toBe(keyHashOf(rotated.key_prefix));
    // La rotation ne recopie ni la session ni le montant : un seul premier paiement.
    const sold = soldFor(sub);
    expect(sold.first_payments).toBe(1);
    expect(sold.renewals).toBe(1);
    expect(sold.active_subscriptions).toBe(1);
  });

  it("enregistre un renouvellement dont aucune clé ne porte l'abonnement", () => {
    const sub = uid('sub_orphan');
    const result = processStripeEvent(
      invoicePaid({ eventId: uid('evt_orphan'), invoiceId: uid('in_orphan'), subscriptionId: sub }),
    );
    expect(result.body.recorded).toBe(true);
    expect(result.body.key_resolved).toBe(false);
    expect(rowsFor(sub)[0].key_hash).toBeNull();
  });
});
