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
import { generateStripeKey } from '../lib/api-keys.js';

export const STRIPE_BUNDLES: Record<string, { credits: number; price_usd: number }> = {
  '1k': { credits: 1000, price_usd: 5 },
  '5k': { credits: 5000, price_usd: 20 },
  '25k': { credits: 25000, price_usd: 80 },
};

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
export function processStripeEvent(event: Stripe.Event): { status: number; body: Record<string, unknown> } {
  const db = getStatsDB();

  const already = db
    .prepare('SELECT stripe_event_id FROM processed_webhooks WHERE stripe_event_id = ?')
    .get(event.id);
  if (already) {
    return { status: 200, body: { received: true, idempotent: true, event_id: event.id } };
  }

  if (event.type !== 'checkout.session.completed') {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)')
      .run(event.id, event.type);
    return { status: 200, body: { received: true, ignored_event_type: event.type } };
  }

  const session = event.data.object as Stripe.Checkout.Session;
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

  return {
    status: 200,
    body: {
      received: true,
      event_id: event.id,
      bundle,
      credits_minted: bundleConfig.credits,
      key_prefix: mintResult.key_prefix,
    },
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
  return c.json(result.body, result.status as 200 | 400 | 503);
});
