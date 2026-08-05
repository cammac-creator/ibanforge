/**
 * POST /v1/stripe/webhook — Stripe webhook receiver for credit pack purchases.
 *
 * Flow:
 *   1. User clicks a Payment Link in the dashboard → Stripe Checkout completes
 *   2. Stripe POSTs `checkout.session.completed` here with `metadata.bundle`
 *   3. We verify the signature, mint a credit-based API key, store the raw key
 *      in a one-time-view column so the success page can retrieve it once
 *   4. The frontend success page calls /v1/stripe/key/:session_id to get the key
 *
 * Mounted BEFORE the api-key + x402 middleware in index.ts because Stripe
 * authenticates via signature header, not Bearer token.
 *
 * Signature verification reads the raw text body (NOT c.req.json()) — Hono
 * does not auto-parse until requested, so c.req.text() returns the unmodified
 * bytes Stripe used to compute the signature.
 *
 * Idempotency is enforced via the `processed_webhooks` table: Stripe retries
 * webhooks aggressively, and we must not mint the same key twice.
 */
import { Hono } from 'hono';
import Stripe from 'stripe';
import { getStatsDB } from '../lib/db.js';
import { generateStripeKey, generateOemKey, deactivateBySubscription, OEM_MONTHLY_LIMIT } from '../lib/api-keys.js';
import { notifyPurchaseTelegram } from '../lib/notify.js';
import { sendApiKeyEmail, sendOemKeyEmail } from '../lib/email.js';

export const STRIPE_BUNDLES: Record<string, { credits: number; price_usd: number }> = {
  '1k': { credits: 1000, price_usd: 5 },
  '5k': { credits: 5000, price_usd: 20 },
  '25k': { credits: 25000, price_usd: 80 },
};

// Editor/OEM subscription — sold through a PRIVATE Payment Link sent in
// conversation (metadata.plan = 'oem'), never listed on the public pricing
// page. The subscription buys embedding rights + SLA + a monthly allowance,
// not prepaid credits.
export const STRIPE_OEM_PLAN = { monthly_limit: OEM_MONTHLY_LIMIT, price_usd: 149 };

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export function resetStripeClient(): void {
  _stripe = null;
}

/**
 * Pure handler — testable without spinning up a Hono app or mocking signature
 * verification. Returns the JSON body + HTTP status the route would emit.
 *
 * Idempotency: writes to processed_webhooks AFTER successful key mint so a
 * crash mid-flow leaves the event un-processed and Stripe will retry.
 */
export interface StripePurchaseNotify {
  email: string | null;
  bundle: string;
  credits: number;
  priceUsd: number;
  keyPrefix: string;
  rawKey: string;
  /** Set on Editor/OEM subscriptions — switches the customer email template. */
  plan?: 'oem';
  monthlyLimit?: number;
}

export function processStripeEvent(
  event: Stripe.Event,
): { status: number; body: Record<string, unknown>; notify?: StripePurchaseNotify } {
  const db = getStatsDB();

  const already = db
    .prepare('SELECT stripe_event_id FROM processed_webhooks WHERE stripe_event_id = ?')
    .get(event.id);
  if (already) {
    return { status: 200, body: { received: true, idempotent: true, event_id: event.id } };
  }

  // Subscription churn: the Editor/OEM key dies with its subscription. A live
  // key surviving a canceled subscription would be silent free service.
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const deactivatedPrefix = deactivateBySubscription(sub.id);
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)')
      .run(event.id, event.type);
    return {
      status: 200,
      body: {
        received: true,
        subscription: sub.id,
        key_deactivated: deactivatedPrefix ?? false,
      },
    };
  }

  if (event.type !== 'checkout.session.completed') {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)')
      .run(event.id, event.type);
    return { status: 200, body: { received: true, ignored_event_type: event.type } };
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Guard against async payment methods (SEPA Debit, ACH, etc.) where
  // checkout.session.completed fires BEFORE the payment is actually settled.
  // For card payments (Payment Links default) this is always 'paid'. For async
  // methods, Stripe fires checkout.session.async_payment_succeeded later.
  if (session.payment_status && session.payment_status !== 'paid') {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)')
      .run(event.id, event.type);
    return {
      status: 200,
      body: { received: true, pending: true, payment_status: session.payment_status },
    };
  }

  // Editor/OEM subscription checkout (private Payment Link, metadata.plan='oem').
  // Mints a monthly-limit key tied to the subscription id — NOT a credit pack.
  if ((session.metadata?.plan ?? '') === 'oem') {
    const email = session.customer_email ?? session.customer_details?.email ?? null;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription?.id ?? null);
    const mint = generateOemKey(email, STRIPE_OEM_PLAN.monthly_limit, session.id, subscriptionId);

    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)')
      .run(event.id, event.type);

    const notify: StripePurchaseNotify | undefined = mint.api_key
      ? {
          email,
          bundle: 'oem',
          credits: 0,
          priceUsd: STRIPE_OEM_PLAN.price_usd,
          keyPrefix: mint.key_prefix,
          rawKey: mint.api_key,
          plan: 'oem',
          monthlyLimit: mint.monthly_limit,
        }
      : undefined;

    return {
      status: 200,
      body: {
        received: true,
        event_id: event.id,
        plan: 'oem',
        monthly_limit: mint.monthly_limit,
        key_prefix: mint.key_prefix,
      },
      notify,
    };
  }

  const bundle = (session.metadata?.bundle ?? '') as string;
  const bundleConfig = STRIPE_BUNDLES[bundle];

  if (!bundleConfig) {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)')
      .run(event.id, event.type);
    return { status: 200, body: { received: true, error: 'unknown_bundle', bundle } };
  }

  const email = session.customer_email ?? session.customer_details?.email ?? null;
  const mintResult = generateStripeKey(email, bundleConfig.credits, session.id);

  db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)')
    .run(event.id, event.type);

  // Owner alert fires only on a FRESH mint (api_key non-null). On Stripe retries
  // the mint is idempotent → api_key is null → no notify → no duplicate alert.
  const notify: StripePurchaseNotify | undefined = mintResult.api_key
    ? {
        email,
        bundle,
        credits: bundleConfig.credits,
        priceUsd: bundleConfig.price_usd,
        keyPrefix: mintResult.key_prefix,
        rawKey: mintResult.api_key,
      }
    : undefined;

  return {
    status: 200,
    body: {
      received: true,
      event_id: event.id,
      bundle,
      credits_minted: bundleConfig.credits,
      key_prefix: mintResult.key_prefix,
    },
    notify,
  };
}

export const stripeWebhook = new Hono();

stripeWebhook.post('/v1/stripe/webhook', async (c) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return c.json(
      { error: 'webhook_not_configured', message: 'STRIPE_WEBHOOK_SECRET not set on server' },
      503,
    );
  }

  const sig = c.req.header('stripe-signature');
  if (!sig) {
    return c.json({ error: 'missing_signature', message: 'stripe-signature header required' }, 400);
  }

  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    return c.json({ error: 'invalid_signature', message: (err as Error).message }, 400);
  }

  const result = processStripeEvent(event);

  // Best-effort owner alert (Telegram). notifyPurchaseTelegram never throws and
  // returns a bool; we still .catch() defensively so a notify issue can never
  // turn a successful payment webhook into a 500 (Stripe would then retry).
  if (result.notify) {
    // Owner alert (Telegram).
    await notifyPurchaseTelegram({
      amountUsd: result.notify.priceUsd,
      bundle: result.notify.bundle,
      credits: result.notify.credits,
      keyPrefix: result.notify.keyPrefix,
      plan: result.notify.plan,
      monthlyLimit: result.notify.monthlyLimit,
    }).catch(() => {});

    // Customer key delivery (safety net beside the success page).
    //
    // NOT awaited, on purpose. This used to `await`, which was harmless only
    // while mail was unconfigured and returned instantly. The moment real
    // credentials were set on 2026-07-25 it became a live hazard: the transport
    // hung on a blocked SMTP port while Stripe gives up on a webhook at ~10s
    // and then retries for three days. Delivery is a safety net; Stripe's
    // acknowledgement is not. Fire and forget, and never let the two couple
    // again.
    if (result.notify.email && result.notify.email.includes('@')) {
      const deliver =
        result.notify.plan === 'oem'
          ? sendOemKeyEmail({
              to: result.notify.email,
              rawKey: result.notify.rawKey,
              monthlyLimit: result.notify.monthlyLimit ?? 0,
            })
          : sendApiKeyEmail({
              to: result.notify.email,
              rawKey: result.notify.rawKey,
              credits: result.notify.credits,
              bundle: result.notify.bundle,
            });
      void deliver.catch(() => {});
    }
  }

  return c.json(result.body, result.status as 200 | 400 | 503);
});
