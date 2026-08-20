import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { processStripeEvent } from './stripe-webhook.js';
import { consumeOneTimeKey, validateApiKey, OEM_MONTHLY_LIMIT } from '../lib/api-keys.js';
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
      },
    },
  } as unknown as Stripe.Event;
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
    const result = processStripeEvent(
      mockEvent({ id: eventId, bundle: '999k' }),
    );
    expect(result.status).toBe(200);
    expect(result.body.error).toBe('unknown_bundle');

    // Replay: should be idempotent (event already marked processed)
    const replay = processStripeEvent(
      mockEvent({ id: eventId, bundle: '999k' }),
    );
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
    const first = processStripeEvent(
      mockOemEvent({ id: `evt_oem_a_${run}`, sessionId }),
    );
    // Stripe retries deliver a DIFFERENT event id for the same session.
    const second = processStripeEvent(
      mockOemEvent({ id: `evt_oem_b_${run}`, sessionId }),
    );
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
      mockSubscriptionDeleted({ id: `evt_churn_unknown_${run}`, subscriptionId: `sub_never_minted_${run}` }),
    );
    expect(result.status).toBe(200);
    expect(result.body.key_deactivated).toBe(false);
  });
});

describe('processStripeEvent — idempotency', () => {
  it('does NOT mint twice when the same event_id arrives twice', () => {
    const eventId = `evt_test_${Date.now()}_idempotent`;
    const sessionId = `cs_test_${Date.now()}_idempotent`;

    const first = processStripeEvent(
      mockEvent({ id: eventId, bundle: '1k', sessionId, email: `idempo-${Date.now()}@example.com` }),
    );
    expect(first.body.credits_minted).toBe(1000);
    const firstPrefix = first.body.key_prefix;

    const second = processStripeEvent(
      mockEvent({ id: eventId, bundle: '1k', sessionId, email: `idempo-${Date.now()}@example.com` }),
    );
    expect(second.body.idempotent).toBe(true);
    expect(second.body.key_prefix).toBeUndefined();
    // First call's key was minted, second call did not return a new one
    expect(typeof firstPrefix).toBe('string');
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
    const result = processStripeEvent(
      mockEvent({ id: eventId, type: 'customer.created' }),
    );
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
      mockEvent({ id: eventId, bundle: '5k', sessionId, email: `consume-${Date.now()}@example.com` }),
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
    processStripeEvent(
      mockEvent({ id: eventId, bundle: '1k', sessionId, email: null }),
    );
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
      mockEvent({ id: `evt_async_pending_${Date.now()}`, bundle: '5k', sessionId, paymentStatus: 'unpaid' }),
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
      mockEvent({ id: `evt_r1_${stamp}`, type: 'checkout.session.async_payment_succeeded', bundle: '1k', sessionId }),
    );
    // Same event id again — the processed_webhooks barrier.
    const sameEvent = processStripeEvent(
      mockEvent({ id: `evt_r1_${stamp}`, type: 'checkout.session.async_payment_succeeded', bundle: '1k', sessionId }),
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
