import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { processStripeEvent } from './stripe-webhook.js';
import {
  consumeOneTimeKey,
  validateApiKey,
  OEM_MONTHLY_LIMIT,
  PRO_MONTHLY_LIMIT,
} from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';

function keyCount(): number {
  return (getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }).n;
}

// Build a minimal Stripe.Event shape — processStripeEvent only reads:
//   event.id, event.type, event.data.object.metadata.bundle,
//   event.data.object.id, event.data.object.customer_email
// We cast the partial to Stripe.Event since constructing the full type
// would pull half the Stripe SDK into the test file.
function mockEvent(opts: {
  id: string;
  type?: string;
  bundle?: string;
  email?: string | null;
  sessionId?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  /** Stripe minor units: 2000 = $20.00. `null` = Stripe told us nothing. */
  amountTotal?: number | null;
  currency?: string | null;
}): Stripe.Event {
  return {
    id: opts.id,
    type: opts.type ?? 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId ?? `cs_test_${opts.id}`,
        metadata: opts.bundle === undefined ? null : { bundle: opts.bundle },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: opts.paymentStatus ?? 'paid',
        amount_total: opts.amountTotal === undefined ? 2000 : opts.amountTotal,
        currency: opts.currency === undefined ? 'usd' : opts.currency,
      },
    },
  } as unknown as Stripe.Event;
}

/** What the database actually holds for a checkout session. */
function storedAmount(sessionId: string):
  | {
      amount_paid_minor: number | null;
      amount_paid_currency: string | null;
    }
  | undefined {
  return getStatsDB()
    .prepare(
      'SELECT amount_paid_minor, amount_paid_currency FROM api_keys WHERE stripe_session_id = ?',
    )
    .get(sessionId) as
    { amount_paid_minor: number | null; amount_paid_currency: string | null } | undefined;
}

describe('processStripeEvent — checkout.session.completed', () => {
  it('mints a key when bundle is valid (1k)', () => {
    const eventId = `evt_test_${Date.now()}_1k`;
    const result = processStripeEvent(
      mockEvent({ id: eventId, bundle: '1k', email: `stripe1-${Date.now()}@example.com` }),
    );
    expect(result.status).toBe(200);
    expect(result.body.bundle).toBe('1k');
    expect(result.body.credits_minted).toBe(1000);
    expect(result.body.key_prefix).toMatch(/^ifk_/);
  });

  it('mints a key with 5k credits when bundle is 5k', () => {
    const eventId = `evt_test_${Date.now()}_5k`;
    const result = processStripeEvent(
      mockEvent({ id: eventId, bundle: '5k', email: `stripe2-${Date.now()}@example.com` }),
    );
    expect(result.body.credits_minted).toBe(5000);
  });

  it('mints a key with 25k credits when bundle is 25k', () => {
    const eventId = `evt_test_${Date.now()}_25k`;
    const result = processStripeEvent(
      mockEvent({ id: eventId, bundle: '25k', email: `stripe3-${Date.now()}@example.com` }),
    );
    expect(result.body.credits_minted).toBe(25000);
  });

  it('rejects an unknown bundle but still marks the event processed', () => {
    const eventId = `evt_test_${Date.now()}_bad_bundle`;
    const result = processStripeEvent(mockEvent({ id: eventId, bundle: '999k' }));
    expect(result.status).toBe(200);
    expect(result.body.error).toBe('unknown_bundle');

    // Replay: should be idempotent (event already marked processed)
    const replay = processStripeEvent(mockEvent({ id: eventId, bundle: '999k' }));
    expect(replay.body.idempotent).toBe(true);
  });
});

// Editor/OEM subscription checkout: metadata carries plan='oem' (set on the
// private Payment Link) and the session references a Stripe subscription id.
function mockOemEvent(opts: {
  id: string;
  email?: string | null;
  sessionId?: string;
  subscriptionId?: string | null;
  amountTotal?: number | null;
  currency?: string | null;
}): Stripe.Event {
  return {
    id: opts.id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId ?? `cs_test_${opts.id}`,
        metadata: { plan: 'oem' },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: 'paid',
        mode: 'subscription',
        subscription: opts.subscriptionId ?? `sub_test_${opts.id}`,
        amount_total: opts.amountTotal === undefined ? 14900 : opts.amountTotal,
        currency: opts.currency === undefined ? 'usd' : opts.currency,
      },
    },
  } as unknown as Stripe.Event;
}

// Pro subscription checkout (2026-09-02): the PUBLIC Payment Link carries
// plan='pro'; everything else is the OEM shape at the Pro price.
function mockProEvent(opts: {
  id: string;
  email?: string | null;
  sessionId?: string;
  subscriptionId?: string | null;
}): Stripe.Event {
  return {
    id: opts.id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId ?? `cs_test_${opts.id}`,
        metadata: { plan: 'pro' },
        customer_email: opts.email ?? null,
        customer_details: opts.email ? { email: opts.email } : null,
        payment_status: 'paid',
        mode: 'subscription',
        subscription: opts.subscriptionId ?? `sub_test_${opts.id}`,
        amount_total: 2900,
        currency: 'usd',
      },
    },
  } as unknown as Stripe.Event;
}

function mockSubscriptionDeleted(opts: { id: string; subscriptionId: string }): Stripe.Event {
  return {
    id: opts.id,
    type: 'customer.subscription.deleted',
    data: { object: { id: opts.subscriptionId } },
  } as unknown as Stripe.Event;
}

describe('processStripeEvent — Editor/OEM subscription', () => {
  it('mints a monthly-limit key (not credits) on an oem checkout', () => {
    const run = Date.now();
    const sessionId = `cs_test_oem_${run}`;
    const result = processStripeEvent(
      mockOemEvent({ id: `evt_oem_${run}`, email: `oem-${run}@example.com`, sessionId }),
    );
    expect(result.status).toBe(200);
    expect(result.body.plan).toBe('oem');
    expect(result.body.monthly_limit).toBe(OEM_MONTHLY_LIMIT);
    expect(result.body.key_prefix).toMatch(/^ifk_/);
    expect(result.notify?.plan).toBe('oem');

    // The delivered key is a monthly-quota key with the OEM allowance.
    const delivered = consumeOneTimeKey(sessionId);
    expect(delivered).not.toBeNull();
    expect(delivered!.monthly_limit).toBe(OEM_MONTHLY_LIMIT);
    expect(delivered!.credits_total).toBeNull();
    const v = validateApiKey(delivered!.api_key);
    expect(v.valid).toBe(true);
    expect(v.monthlyLimit).toBe(OEM_MONTHLY_LIMIT);
    expect(v.creditsRemaining).toBeUndefined();
  });

  it('does not mint twice for the same checkout session (webhook retry)', () => {
    const run = Date.now();
    const sessionId = `cs_test_oem_retry_${run}`;
    const first = processStripeEvent(mockOemEvent({ id: `evt_oem_a_${run}`, sessionId }));
    // Stripe retries deliver a DIFFERENT event id for the same session.
    const second = processStripeEvent(mockOemEvent({ id: `evt_oem_b_${run}`, sessionId }));
    expect(second.status).toBe(200);
    expect(second.body.key_prefix).toBe(first.body.key_prefix);
    expect(second.notify).toBeUndefined(); // no duplicate owner alert / email
  });

  it('deactivates the key when the subscription is canceled', () => {
    const run = Date.now();
    const sessionId = `cs_test_oem_churn_${run}`;
    const subscriptionId = `sub_test_churn_${run}`;
    processStripeEvent(mockOemEvent({ id: `evt_oem_c_${run}`, sessionId, subscriptionId }));
    const delivered = consumeOneTimeKey(sessionId);
    expect(validateApiKey(delivered!.api_key).valid).toBe(true);

    const churn = processStripeEvent(
      mockSubscriptionDeleted({ id: `evt_churn_${run}`, subscriptionId }),
    );
    expect(churn.status).toBe(200);
    expect(churn.body.key_deactivated).toMatch(/^ifk_/);
    expect(validateApiKey(delivered!.api_key).valid).toBe(false);
  });

  it('answers 200 gracefully for an unknown canceled subscription', () => {
    const run = Date.now();
    const result = processStripeEvent(
      mockSubscriptionDeleted({
        id: `evt_churn_unknown_${run}`,
        subscriptionId: `sub_never_minted_${run}`,
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.key_deactivated).toBe(false);
  });
});

describe('processStripeEvent — Pro subscription (public monthly tier)', () => {
  it('mints a 10,000/month key on a pro checkout and says so', () => {
    const run = Date.now();
    const sessionId = `cs_test_pro_${run}`;
    const result = processStripeEvent(
      mockProEvent({ id: `evt_pro_${run}`, email: `pro-${run}@example.com`, sessionId }),
    );
    expect(result.status).toBe(200);
    expect(result.body.plan).toBe('pro');
    expect(result.body.monthly_limit).toBe(PRO_MONTHLY_LIMIT);
    expect(result.body.amount_paid_minor).toBe(2900);
    expect(result.notify?.plan).toBe('pro');
    expect(result.notify?.priceUsd).toBe(29);
    expect(result.notify?.monthlyLimit).toBe(PRO_MONTHLY_LIMIT);

    const delivered = consumeOneTimeKey(sessionId);
    expect(delivered).not.toBeNull();
    expect(delivered!.monthly_limit).toBe(PRO_MONTHLY_LIMIT);
    expect(delivered!.credits_total).toBeNull();
    const v = validateApiKey(delivered!.api_key);
    expect(v.valid).toBe(true);
    expect(v.monthlyLimit).toBe(PRO_MONTHLY_LIMIT);
  });

  it('the Pro key dies with its subscription, like the OEM one', () => {
    const run = Date.now();
    const sessionId = `cs_test_pro_churn_${run}`;
    const subscriptionId = `sub_test_pro_churn_${run}`;
    processStripeEvent(mockProEvent({ id: `evt_pro_c_${run}`, sessionId, subscriptionId }));
    const delivered = consumeOneTimeKey(sessionId);
    expect(validateApiKey(delivered!.api_key).valid).toBe(true);
    const churn = processStripeEvent(
      mockSubscriptionDeleted({ id: `evt_pro_churn_${run}`, subscriptionId }),
    );
    expect(churn.body.key_deactivated).toMatch(/^ifk_/);
    expect(validateApiKey(delivered!.api_key).valid).toBe(false);
  });

  it('does not mint twice for the same pro session', () => {
    const run = Date.now();
    const sessionId = `cs_test_pro_retry_${run}`;
    const first = processStripeEvent(mockProEvent({ id: `evt_pro_a_${run}`, sessionId }));
    const second = processStripeEvent(mockProEvent({ id: `evt_pro_b_${run}`, sessionId }));
    expect(second.body.key_prefix).toBe(first.body.key_prefix);
    expect(second.notify).toBeUndefined();
  });
});

describe('processStripeEvent — idempotency', () => {
  it('does NOT mint twice when the same event_id arrives twice', () => {
    const eventId = `evt_test_${Date.now()}_idempotent`;
    const sessionId = `cs_test_${Date.now()}_idempotent`;

    const first = processStripeEvent(
      mockEvent({
        id: eventId,
        bundle: '1k',
        sessionId,
        email: `idempo-${Date.now()}@example.com`,
      }),
    );
    expect(first.body.credits_minted).toBe(1000);
    const firstPrefix = first.body.key_prefix;

    const second = processStripeEvent(
      mockEvent({
        id: eventId,
        bundle: '1k',
        sessionId,
        email: `idempo-${Date.now()}@example.com`,
      }),
    );
    expect(second.body.idempotent).toBe(true);
    expect(second.body.key_prefix).toBeUndefined();
    // First call's key was minted, second call did not return a new one
    expect(typeof firstPrefix).toBe('string');
  });
});

/**
 * Audit B2: the amount collected by card was never stored. Reports re-derived
 * it from the pack price table, which makes every historical figure a function
 * of TODAY's prices: change one, and the past silently restates itself to a
 * number no buyer ever paid.
 */
describe('the amount collected is measured, never re-derived', () => {
  it('stores what Stripe says was charged, in Stripe’s own minor units', () => {
    const run = Date.now();
    const sessionId = `cs_test_amount_${run}`;
    const result = processStripeEvent(
      mockEvent({
        id: `evt_amount_${run}`,
        bundle: '5k',
        sessionId,
        email: `acme-${run}@example.com`,
        amountTotal: 2000,
        currency: 'usd',
      }),
    );

    expect(result.body.amount_paid_minor).toBe(2000);
    expect(storedAmount(sessionId)).toEqual({
      amount_paid_minor: 2000,
      amount_paid_currency: 'usd',
    });
  });

  it('records the currency beside the amount rather than assuming USD', () => {
    const run = Date.now();
    const sessionId = `cs_test_currency_${run}`;
    processStripeEvent(
      mockEvent({
        id: `evt_currency_${run}`,
        bundle: '1k',
        sessionId,
        amountTotal: 4500,
        currency: 'eur',
      }),
    );
    // A minor-unit integer without its currency is not an amount. The pack
    // table's implicit USD is exactly the assumption this column removes.
    expect(storedAmount(sessionId)).toEqual({
      amount_paid_minor: 4500,
      amount_paid_currency: 'eur',
    });
  });

  it('keeps a discounted price instead of the list price of the pack', () => {
    const run = Date.now();
    const sessionId = `cs_test_discount_${run}`;
    // A coupon on the $20 pack. The old reconstruction would have reported 20.
    processStripeEvent(
      mockEvent({ id: `evt_discount_${run}`, bundle: '5k', sessionId, amountTotal: 1500 }),
    );
    expect(storedAmount(sessionId)?.amount_paid_minor).toBe(1500);
  });

  /**
   * 🚨 Zero is a measurement, NULL is "we were not told". Coercing a missing
   * amount to 0 would record that the buyer paid nothing.
   */
  it('leaves the amount NULL when Stripe announces none, never 0', () => {
    const run = Date.now();
    const sessionId = `cs_test_noamount_${run}`;
    const result = processStripeEvent(
      mockEvent({
        id: `evt_noamount_${run}`,
        bundle: '1k',
        sessionId,
        amountTotal: null,
        currency: null,
      }),
    );

    expect(result.body.amount_paid_minor).toBeUndefined();
    const row = storedAmount(sessionId);
    expect(row?.amount_paid_minor).toBeNull();
    expect(row?.amount_paid_minor).not.toBe(0);
    expect(row?.amount_paid_currency).toBeNull();
  });

  /**
   * The path the `amount_paid_minor IS NULL` guard exists for.
   *
   * A plain Stripe retry short-circuits on processed_webhooks and never gets
   * here. `checkout.session.async_payment_succeeded` is different: a NEW event
   * id for the SAME session, so it clears that barrier, hits an idempotent
   * mint, and reaches the amount write. First value observed must win.
   */
  it('never lets a later event for the same session overwrite the amount', () => {
    const run = Date.now();
    const sessionId = `cs_test_async_${run}`;

    processStripeEvent(
      mockEvent({ id: `evt_async_a_${run}`, bundle: '5k', sessionId, amountTotal: 2000 }),
    );
    expect(storedAmount(sessionId)?.amount_paid_minor).toBe(2000);

    const second = processStripeEvent(
      mockEvent({
        id: `evt_async_b_${run}`,
        type: 'checkout.session.async_payment_succeeded',
        bundle: '5k',
        sessionId,
        amountTotal: 9999,
        currency: 'chf',
      }),
    );
    expect(second.status).toBe(200);
    // The mint was idempotent and so was the amount.
    expect(storedAmount(sessionId)).toEqual({
      amount_paid_minor: 2000,
      amount_paid_currency: 'usd',
    });
  });

  it('measures the subscription checkout too, not just credit packs', () => {
    const run = Date.now();
    const sessionId = `cs_test_oem_amount_${run}`;
    const result = processStripeEvent(
      mockOemEvent({ id: `evt_oem_amount_${run}`, sessionId, amountTotal: 14900 }),
    );
    expect(result.body.amount_paid_minor).toBe(14900);
    expect(storedAmount(sessionId)).toEqual({
      amount_paid_minor: 14900,
      amount_paid_currency: 'usd',
    });
  });

  /**
   * The migration is additive and re-runnable: a key minted through a path that
   * carries no payment session keeps NULL columns, and nothing backfills them
   * with a guess. "We do not know" survives.
   */
  it('leaves a key that never went through Stripe unmeasured', () => {
    const row = getStatsDB()
      .prepare(
        `SELECT amount_paid_minor FROM api_keys
           WHERE stripe_session_id IS NULL AND amount_paid_minor IS NOT NULL LIMIT 1`,
      )
      .get();
    expect(row).toBeUndefined();
  });
});

describe('processStripeEvent — async payment guard', () => {
  it('does NOT mint when payment_status is unpaid (async methods pending)', () => {
    const eventId = `evt_test_${Date.now()}_unpaid`;
    const result = processStripeEvent(
      mockEvent({
        id: eventId,
        bundle: '5k',
        sessionId: `cs_test_${Date.now()}_unpaid`,
        email: `unpaid-${Date.now()}@example.com`,
        paymentStatus: 'unpaid',
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.pending).toBe(true);
    expect(result.body.payment_status).toBe('unpaid');
    expect(result.body.credits_minted).toBeUndefined();
  });

  it('mints when payment_status is paid (card payments, default)', () => {
    const eventId = `evt_test_${Date.now()}_paid_explicit`;
    const result = processStripeEvent(
      mockEvent({
        id: eventId,
        bundle: '5k',
        sessionId: `cs_test_${Date.now()}_paid_explicit`,
        email: `paid-${Date.now()}@example.com`,
        paymentStatus: 'paid',
      }),
    );
    expect(result.body.credits_minted).toBe(5000);
  });
});

describe('processStripeEvent — non-checkout events', () => {
  it('records but ignores customer.created (or any non-checkout event)', () => {
    const eventId = `evt_test_${Date.now()}_other`;
    const result = processStripeEvent(mockEvent({ id: eventId, type: 'customer.created' }));
    expect(result.status).toBe(200);
    expect(result.body.ignored_event_type).toBe('customer.created');
    expect(result.body.credits_minted).toBeUndefined();
  });
});

describe('consumeOneTimeKey', () => {
  it('returns the raw key once, then null on subsequent reads', () => {
    const sessionId = `cs_test_${Date.now()}_consume`;
    const eventId = `evt_test_${Date.now()}_consume`;
    const result = processStripeEvent(
      mockEvent({
        id: eventId,
        bundle: '5k',
        sessionId,
        email: `consume-${Date.now()}@example.com`,
      }),
    );
    expect(result.body.credits_minted).toBe(5000);

    const first = consumeOneTimeKey(sessionId);
    expect(first).not.toBeNull();
    expect(first?.api_key).toMatch(/^ifk_/);
    expect(first?.credits_total).toBe(5000);
    expect(first?.credits_remaining).toBe(5000);

    const second = consumeOneTimeKey(sessionId);
    expect(second).toBeNull();
  });

  it('returns null for an unknown session id', () => {
    const result = consumeOneTimeKey(`cs_test_does_not_exist_${Date.now()}`);
    expect(result).toBeNull();
  });

  it('strips placeholder email "stripe-buyer" when no email was provided', () => {
    const sessionId = `cs_test_${Date.now()}_no_email`;
    const eventId = `evt_test_${Date.now()}_no_email`;
    processStripeEvent(mockEvent({ id: eventId, bundle: '1k', sessionId, email: null }));
    const result = consumeOneTimeKey(sessionId);
    expect(result?.email).toBeNull();
  });
});

/**
 * Audit A2 — the dormant trap. Today every Payment Link is card-only, so
 * `checkout.session.completed` always arrives with `payment_status: 'paid'`
 * and this never fires. The day SEPA Direct Debit or TWINT is switched on, it
 * fires on every purchase: `completed` arrives `unpaid` (correctly refused
 * below), and the money lands days later with
 * `checkout.session.async_payment_succeeded` — which used to fall through to
 * `ignored_event_type` and answer 200. Money collected, no key minted, no
 * error raised, nothing in the logs looking wrong.
 */
describe('async payment methods — the day SEPA/TWINT is enabled', () => {
  it('waits rather than minting when the completed session is not paid yet', () => {
    const sessionId = `cs_test_async_${Date.now()}`;
    const result = processStripeEvent(
      mockEvent({
        id: `evt_async_pending_${Date.now()}`,
        bundle: '5k',
        sessionId,
        paymentStatus: 'unpaid',
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body.pending).toBe(true);
    expect(result.body.key_prefix).toBeUndefined();
    expect(result.notify).toBeUndefined();
  });

  it('mints when the money actually lands', () => {
    const stamp = Date.now();
    const sessionId = `cs_test_async_ok_${stamp}`;
    // 1. Checkout completes, unpaid — nothing minted.
    processStripeEvent(
      mockEvent({ id: `evt_a1_${stamp}`, bundle: '5k', sessionId, paymentStatus: 'unpaid' }),
    );
    // 2. Days later, the debit clears.
    const settled = processStripeEvent(
      mockEvent({
        id: `evt_a2_${stamp}`,
        type: 'checkout.session.async_payment_succeeded',
        bundle: '5k',
        sessionId,
        paymentStatus: 'paid',
      }),
    );
    expect(settled.status).toBe(200);
    expect(settled.body.credits_minted).toBe(5000);
    expect(settled.body.key_prefix).toMatch(/^ifk_/);
    // The buyer gets the key, and the owner gets the alert — once.
    expect(settled.notify?.credits).toBe(5000);
    const key = consumeOneTimeKey(sessionId);
    expect(key?.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(key?.credits_total).toBe(5000);
  });

  /**
   * Stripe retries a webhook for three days. The replay must go through the
   * same `stripe_session_id` barrier the card path uses: one settlement, one
   * key, one owner alert.
   */
  it('mints exactly once however often Stripe replays it', () => {
    const stamp = Date.now();
    const sessionId = `cs_test_async_replay_${stamp}`;
    const before = keyCount();

    const first = processStripeEvent(
      mockEvent({
        id: `evt_r1_${stamp}`,
        type: 'checkout.session.async_payment_succeeded',
        bundle: '1k',
        sessionId,
      }),
    );
    // Same event id again — the processed_webhooks barrier.
    const sameEvent = processStripeEvent(
      mockEvent({
        id: `evt_r1_${stamp}`,
        type: 'checkout.session.async_payment_succeeded',
        bundle: '1k',
        sessionId,
      }),
    );
    // A DIFFERENT event id on the same session — the stripe_session_id barrier,
    // which is the one that matters when `completed` and
    // `async_payment_succeeded` both arrive paid.
    const sameSession = processStripeEvent(
      mockEvent({ id: `evt_r2_${stamp}`, bundle: '1k', sessionId }),
    );

    expect(keyCount() - before).toBe(1);
    expect(first.notify?.rawKey).toMatch(/^ifk_/);
    expect(sameEvent.body.idempotent).toBe(true);
    expect(sameEvent.notify).toBeUndefined();
    expect(sameSession.notify).toBeUndefined();
    expect(sameSession.body.key_prefix).toBe(first.body.key_prefix);
  });

  it('records a failed async payment and mints nothing', () => {
    const stamp = Date.now();
    const before = keyCount();
    const result = processStripeEvent(
      mockEvent({
        id: `evt_failed_${stamp}`,
        type: 'checkout.session.async_payment_failed',
        bundle: '25k',
        sessionId: `cs_test_failed_${stamp}`,
      }),
    );
    expect(result.body.ignored_event_type).toBe('checkout.session.async_payment_failed');
    expect(keyCount()).toBe(before);
  });
});

describe('out-of-order delivery — the tombstone', () => {
  // Stripe guarantees no delivery order. Before the tombstone, a
  // customer.subscription.deleted landing BEFORE its checkout.session.completed
  // found nothing to deactivate, the completed then minted a LIVE key against
  // the dead subscription, and the idempotency barrier ate Stripe's replay of
  // the deleted — an immortal key, invisible in every log.
  it('refuses to mint an OEM key for a subscription whose cancellation arrived first', () => {
    const run = Date.now();
    const subId = `sub_test_dead_${run}`;
    const before = keyCount();

    const deleted = processStripeEvent(
      mockSubscriptionDeleted({ id: `evt_del_first_${run}`, subscriptionId: subId }),
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.key_deactivated).toBe(false);

    const completed = processStripeEvent(
      mockOemEvent({
        id: `evt_oem_late_${run}`,
        sessionId: `cs_test_late_${run}`,
        subscriptionId: subId,
      }),
    );
    expect(completed.status).toBe(200);
    expect(completed.body.skipped).toBe('subscription_already_canceled');
    expect(keyCount()).toBe(before);
  });

  it('still mints and deactivates normally when the order is normal', () => {
    const run = Date.now();
    const subId = `sub_test_ordered_${run}`;
    const minted = processStripeEvent(
      mockOemEvent({
        id: `evt_oem_ord_${run}`,
        sessionId: `cs_test_ord_${run}`,
        subscriptionId: subId,
      }),
    );
    expect(minted.body.key_prefix).toMatch(/^ifk_/);

    const deleted = processStripeEvent(
      mockSubscriptionDeleted({ id: `evt_del_ord_${run}`, subscriptionId: subId }),
    );
    expect(deleted.body.key_deactivated).toBe(minted.body.key_prefix);
  });
});

describe('no_payment_required is a settlement, not a wait', () => {
  // Stripe emits it for a session settled at zero — 100% promo, subscription
  // trial. No async_payment_succeeded will EVER follow, so parking these as
  // "pending" was a legitimate transaction concluded with no key and no error
  // anywhere. Dormant until the first promo code exists.
  it('mints on payment_status no_payment_required', () => {
    const run = Date.now();
    const result = processStripeEvent(
      mockEvent({
        id: `evt_npr_${run}`,
        bundle: '1k',
        sessionId: `cs_test_npr_${run}`,
        email: `npr-${run}@example.com`,
        paymentStatus: 'no_payment_required',
        amountTotal: 0,
      }),
    );
    expect(result.body.pending).toBeUndefined();
    expect(result.body.credits_minted).toBe(1000);
  });
});
