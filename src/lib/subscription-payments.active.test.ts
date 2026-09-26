/**
 * Les lecteurs de l'abonnement après le lot B2 (chantier « clé unique »,
 * 25.09.2026) : une résiliation ne désactive plus la clé, elle pose
 * `subscription_ended_at` et garde l'identifiant. « Abonné un jour » et
 * « abonné aujourd'hui » ne se lisent donc plus sur la même colonne.
 *
 * Adresses inventées sur alpha.example.net : example.com est rangé parmi les
 * comptes internes, exclus des revenus et de l'activation.
 */
import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { processStripeEvent } from '../routes/stripe-webhook.js';
import { generateApiKey, validateApiKey } from './api-keys.js';
import { ensureTopupRef } from './key-purchases.js';
import {
  readSubscriptionRows,
  subscriptionsSold,
  type AttachedSubscriptionRow,
  type SubscriptionKeyRow,
  type SubscriptionPaymentRow,
} from './subscription-payments.js';
import { getActivation } from './activation.js';
import { purgeTerminatedKeyTelemetry } from './stats.js';
import { getStatsDB } from './db.js';

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

function proCheckout(opts: {
  sessionId: string;
  subscriptionId: string;
  ref?: string | null;
  email?: string | null;
}) {
  return {
    id: `evt_${uniq('sub')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { plan: 'pro' },
        customer_email: opts.email ?? null,
        customer_details: null,
        payment_status: 'paid',
        mode: 'subscription',
        subscription: opts.subscriptionId,
        amount_total: 2900,
        currency: 'usd',
        client_reference_id: opts.ref ?? null,
        payment_intent: null,
      },
    },
  } as unknown as Stripe.Event;
}

function deleted(subscriptionId: string): Stripe.Event {
  return {
    id: `evt_${uniq('deleted')}`,
    type: 'customer.subscription.deleted',
    data: { object: { id: subscriptionId } },
  } as unknown as Stripe.Event;
}

/** Ce que les lectures sans Stripe comptent pour UN abonnement. */
function soldFor(subscriptionId: string) {
  const rows = readSubscriptionRows();
  return subscriptionsSold(
    {
      keys: rows.keys.filter(
        (k: SubscriptionKeyRow) => k.stripe_subscription_id === subscriptionId,
      ),
      payments: rows.payments.filter(
        (p: SubscriptionPaymentRow) => p.subscription_id === subscriptionId,
      ),
      attached: rows.attached.filter(
        (a: AttachedSubscriptionRow) => a.stripe_subscription_id === subscriptionId,
      ),
    },
    () => false,
  );
}

/** Une clé gratuite qui prend Pro sur elle-même, par sa référence. */
function attachedPro(email: string) {
  const key = generateApiKey(email)!;
  const subscriptionId = `sub_test_${uniq('active')}`;
  const sessionId = `cs_test_${uniq('active')}`;
  processStripeEvent(proCheckout({ sessionId, subscriptionId, ref: ensureTopupRef(key.key_hash) }));
  return { key, subscriptionId, sessionId };
}

describe('abonnement vivant, abonnement terminé', () => {
  it('un abonnement terminé n’est plus actif, sa clé l’est encore', () => {
    const { key, subscriptionId } = attachedPro(`${uniq('ended')}@alpha.example.net`);
    expect(soldFor(subscriptionId)).toMatchObject({ subscriptions: 1, active_subscriptions: 1 });
    processStripeEvent(deleted(subscriptionId));
    expect(soldFor(subscriptionId)).toMatchObject({ subscriptions: 1, active_subscriptions: 0 });
    expect(validateApiKey(key.api_key).valid).toBe(true);
  });

  it('le premier paiement d’un Pro rattaché est compté une fois, au registre', () => {
    const { subscriptionId } = attachedPro(`${uniq('first')}@alpha.example.net`);
    const sold = soldFor(subscriptionId);
    expect(sold.first_payments).toBe(1);
    expect(sold.first_payments_usd_minor).toBe(2900);
    // Et une fin ne l'efface pas : l'argent a été encaissé.
    processStripeEvent(deleted(subscriptionId));
    expect(soldFor(subscriptionId).first_payments_usd_minor).toBe(2900);
  });

  it('une frappe Pro reste comptée sur sa clé, jamais une seconde fois au registre', () => {
    const subscriptionId = `sub_test_${uniq('minted')}`;
    processStripeEvent(proCheckout({ sessionId: `cs_test_${uniq('minted')}`, subscriptionId }));
    const sold = soldFor(subscriptionId);
    expect(sold.first_payments).toBe(1);
    expect(sold.first_payments_usd_minor).toBe(2900);
  });
});

describe('le drapeau abonné du CRM (activation)', () => {
  it('abonné tant que l’abonnement vit ; après sa fin, la clé redevient un gratuit', () => {
    const email = `${uniq('crm')}@alpha.example.net`;
    const { subscriptionId } = attachedPro(email);
    const during = getActivation().clients.find((c) => c.email === email);
    expect(during?.subscriber).toBe(true);
    expect(during?.keys[0]?.role).toBe('subscription');

    processStripeEvent(deleted(subscriptionId));
    const after = getActivation().clients.find((c) => c.email === email);
    expect(after?.subscriber).toBe(false);
    expect(after?.keys[0]).toMatchObject({ role: 'free', active: 1 });
  });
});

describe('une clé née d’un abonnement terminé au CRM (relecture de la PR 264, D5)', () => {
  it('son rôle n’est jamais free : ni allocation ni crédits', () => {
    const email = `${uniq('crm_ended')}@alpha.example.net`;
    const subscriptionId = `sub_test_${uniq('crm_ended')}`;
    processStripeEvent(
      proCheckout({ sessionId: `cs_test_${uniq('crm_ended')}`, subscriptionId, email }),
    );
    processStripeEvent(deleted(subscriptionId));
    const client = getActivation().clients.find((c) => c.email === email);
    expect(client?.subscriber).toBe(false);
    expect(client?.keys[0]).toMatchObject({ role: 'subscription', active: 1 });
  });
});

describe('la purge DPA 4.7 (Q12)', () => {
  it('une fin d’abonnement ne fait pas courir le délai : la clé reste active, sa télémétrie est gardée', () => {
    const { key, subscriptionId } = attachedPro(`${uniq('dpa')}@alpha.example.net`);
    processStripeEvent(deleted(subscriptionId));
    const db = getStatsDB();
    db.prepare(
      `INSERT INTO request_log (key_prefix, method, path, status, created_at)
       VALUES (?, 'POST', '/v1/iban/validate', 200, datetime('now', '-90 days'))`,
    ).run(key.key_prefix);
    // Même une fin posée il y a longtemps ne compte pas : seule la désactivation
    // de la dernière clé fait courir le délai.
    db.prepare(
      `UPDATE api_keys SET subscription_ended_at = datetime('now', '-90 days') WHERE key_hash = ?`,
    ).run(key.key_hash);
    purgeTerminatedKeyTelemetry(30);
    const kept = db
      .prepare('SELECT COUNT(*) AS n FROM request_log WHERE key_prefix = ?')
      .get(key.key_prefix) as { n: number };
    expect(kept.n).toBe(1);
  });
});
