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
import {
  generateStripeKey,
  generateOemKey,
  deactivateBySubscription,
  OEM_MONTHLY_LIMIT,
  PRO_MONTHLY_LIMIT,
} from '../lib/api-keys.js';
import { PRO_PRICE_USD } from '../lib/payment-links.js';
import { notifyPurchaseTelegram } from '../lib/notify.js';
import { markAuditPaid } from '../lib/audit-jobs.js';
import { notifyOps } from '../lib/ops-alert.js';
import {
  sendApiKeyEmail,
  sendSubscriptionKeyEmail,
  alertKeyDeliveryFailure,
  sendAuditReadyEmail,
} from '../lib/email.js';

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

// Pro subscription (2026-09-02): the PUBLIC monthly tier, sold through a public
// Payment Link on the pricing page (metadata.plan = 'pro'). Minted through the
// same path as OEM: a monthly allowance that resets on the 1st, a key that
// dies with its subscription. No SLA, no embedding rights.
export const STRIPE_PRO_PLAN = { monthly_limit: PRO_MONTHLY_LIMIT, price_usd: PRO_PRICE_USD };

export type SubscriptionPlan = 'oem' | 'pro';

export const SUBSCRIPTION_PLANS: Record<
  SubscriptionPlan,
  { monthly_limit: number; price_usd: number }
> = {
  oem: STRIPE_OEM_PLAN,
  pro: STRIPE_PRO_PLAN,
};

/**
 * The events that mint a key.
 *
 * 🚨 `checkout.session.async_payment_succeeded` is the second one, and it was
 * missing — a dormant trap that costs nothing today and costs everything the
 * day SEPA Direct Debit or TWINT is enabled on a Payment Link. On those
 * methods `checkout.session.completed` fires with `payment_status: 'unpaid'`,
 * which the guard below correctly refuses to mint on; Stripe then sends
 * `async_payment_succeeded` days later when the money actually lands. Without
 * it in this set, that event fell through to `ignored_event_type` and answered
 * 200: money collected, no key created, no error anywhere. The buyer is left
 * with a receipt and nothing to call the API with, and nothing in our logs
 * looks wrong.
 *
 * Both events mint through the SAME barrier — `generateStripeKey` is
 * idempotent on `stripe_session_id`, and the two events carry the same
 * session — so a session that somehow produced both (a card checkout that also
 * emitted an async success) mints exactly once. The second one sees
 * `api_key: null`, which is also what suppresses the duplicate owner alert.
 *
 * `async_payment_failed` is deliberately NOT here: it must be recorded and
 * ignored, never minted on.
 */
const MINTING_EVENTS: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

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
  /** Set on subscriptions (Editor/OEM, Pro) — switches the customer email template. */
  plan?: SubscriptionPlan;
  monthlyLimit?: number;
}

/**
 * Persist what Stripe says was ACTUALLY collected, on the key this session
 * minted, at the moment Stripe announces it.
 *
 * Audit B2: the amount was never stored. `credits_total` was kept and the
 * dollar figure re-derived from the pack price table whenever a report needed
 * it. A derived amount is retroactive by construction: the day a price moves,
 * a promotion runs, or a partial refund lands, every past purchase is restated
 * to a number no buyer ever paid, and nothing in the data shows it changed.
 *
 * Three deliberate choices:
 *
 *  - **Minor units, verbatim.** `amount_total` is what Stripe charged, in the
 *    currency's smallest unit (2000 = $20.00). We store the provider's own
 *    number rather than a converted one so the row can always be checked
 *    against the Stripe dashboard without arithmetic in between.
 *  - **A missing amount stays NULL.** `amount_total` is nullable on the Stripe
 *    type. Coercing it to 0 would record "this buyer paid nothing", which is a
 *    measurement; NULL says we were not told, which is the truth.
 *  - **`amount_paid_minor IS NULL` in the WHERE.** First write wins, and a
 *    second event for the same session can never overwrite it. This is not
 *    theoretical: `checkout.session.async_payment_succeeded` carries a
 *    DIFFERENT event id for the SAME session, so it clears the
 *    processed_webhooks barrier, reaches an idempotent mint, and reaches here.
 */
function recordAmountPaid(session: Stripe.Checkout.Session): {
  amount_paid_minor: number;
  amount_paid_currency: string;
} | null {
  const minor = session.amount_total;
  const currency = session.currency;
  if (minor == null || currency == null) return null;

  getStatsDB()
    .prepare(
      `UPDATE api_keys SET amount_paid_minor = ?, amount_paid_currency = ?
         WHERE stripe_session_id = ? AND amount_paid_minor IS NULL`,
    )
    .run(minor, currency, session.id);

  return { amount_paid_minor: minor, amount_paid_currency: currency };
}

export function processStripeEvent(event: Stripe.Event): {
  status: number;
  body: Record<string, unknown>;
  notify?: StripePurchaseNotify;
} {
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
    if (!deactivatedPrefix) {
      // Nothing to deactivate YET. Stripe guarantees no delivery order, so
      // this cancellation can land BEFORE the checkout.session.completed
      // that mints the key — and the idempotency barrier would eat Stripe's
      // replay of this event, leaving that key immortal. The tombstone makes
      // the order irrelevant: a later mint against this subscription refuses.
      db.prepare('INSERT OR IGNORE INTO dead_subscriptions (subscription_id) VALUES (?)').run(
        sub.id,
      );
    }
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );
    return {
      status: 200,
      body: {
        received: true,
        subscription: sub.id,
        key_deactivated: deactivatedPrefix ?? false,
      },
    };
  }

  if (!MINTING_EVENTS.has(event.type)) {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );
    return { status: 200, body: { received: true, ignored_event_type: event.type } };
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Guard against async payment methods (SEPA Debit, ACH, etc.) where
  // checkout.session.completed fires BEFORE the payment is actually settled.
  // For card payments (Payment Links default) this is always 'paid'. For async
  // methods, Stripe fires checkout.session.async_payment_succeeded later —
  // which is now handled above, so this branch is a wait, not a dead end.
  //
  // 'no_payment_required' is NOT a wait: Stripe emits it for a session
  // settled at zero (100% promo, subscription trial) — cases where no
  // async_payment_succeeded will EVER follow. Waiting on it was the exact
  // trap the MINTING_EVENTS comment describes: legitimate transaction
  // concluded, no key, no error anywhere. Dormant until the first promo
  // code or OEM trial exists, and silent the day one does.
  if (
    session.payment_status &&
    session.payment_status !== 'paid' &&
    session.payment_status !== 'no_payment_required'
  ) {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );
    return {
      status: 200,
      body: { received: true, pending: true, payment_status: session.payment_status },
    };
  }

  // Subscription checkout: Editor/OEM (private Payment Link, metadata.plan='oem')
  // or Pro (public Payment Link, metadata.plan='pro'). Mints a monthly-limit key
  // tied to the subscription id — NOT a credit pack.
  // Creditor-file audit (audit.ts): a one-off Checkout Session created from
  // code with metadata.audit_job. No key to mint: the job flips to paid and
  // the customer's status poll returns the download link. Idempotent through
  // processed_webhooks like every other event; markAuditPaid itself keeps the
  // first payment's data if Stripe retries.
  const auditJobId = session.metadata?.audit_job;
  if (typeof auditJobId === 'string' && auditJobId !== '') {
    const paidJob = markAuditPaid(auditJobId, {
      session_id: session.id,
      email: session.customer_email ?? session.customer_details?.email ?? null,
      amount_minor: session.amount_total ?? null,
      currency: session.currency ?? null,
    });
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );
    if (paidJob?.payer_email) {
      sendAuditReadyEmail({
        to: paidJob.payer_email,
        lang: paidJob.lang,
        link: `https://ibanforge.com/${paidJob.lang}/audit/done?job=${paidJob.id}&session_id=${encodeURIComponent(session.id)}`,
        rows: paidJob.rows,
        price_chf: paidJob.price_chf,
      });
    }
    if (paidJob && !process.env.VITEST) {
      const who = paidJob.payer_email
        ? `<mail>@${paidJob.payer_email.split('@')[1]}`
        : 'e-mail inconnu';
      void notifyOps(
        `Audit de fichier vendu : ${paidJob.price_chf} CHF, ${paidJob.rows} lignes, ${who}. Rapport telechargeable 24 h.`,
      ).catch(() => undefined);
    }
    return {
      status: 200,
      body: { received: true, event_id: event.id, audit_job: auditJobId, paid: paidJob !== null },
    };
  }

  const requestedPlan = session.metadata?.plan ?? '';
  if (requestedPlan === 'oem' || requestedPlan === 'pro') {
    const plan: SubscriptionPlan = requestedPlan;
    const planConfig = SUBSCRIPTION_PLANS[plan];
    const email = session.customer_email ?? session.customer_details?.email ?? null;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription?.id ?? null);
    // The other half of the tombstone (see customer.subscription.deleted):
    // if the cancellation was delivered first, minting here would create the
    // immortal key that no later event will ever kill.
    if (
      subscriptionId &&
      db.prepare('SELECT 1 FROM dead_subscriptions WHERE subscription_id = ?').get(subscriptionId)
    ) {
      db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
        event.id,
        event.type,
      );
      return {
        status: 200,
        body: {
          received: true,
          event_id: event.id,
          plan,
          skipped: 'subscription_already_canceled',
          subscription: subscriptionId,
        },
      };
    }
    const mint = generateOemKey(email, planConfig.monthly_limit, session.id, subscriptionId);
    // After the mint: the row must exist for the amount to land on it.
    const paid = recordAmountPaid(session);

    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );

    const notify: StripePurchaseNotify | undefined = mint.api_key
      ? {
          email,
          bundle: plan,
          credits: 0,
          priceUsd: planConfig.price_usd,
          keyPrefix: mint.key_prefix,
          rawKey: mint.api_key,
          plan,
          monthlyLimit: mint.monthly_limit,
        }
      : undefined;

    return {
      status: 200,
      body: {
        received: true,
        event_id: event.id,
        plan,
        monthly_limit: mint.monthly_limit,
        key_prefix: mint.key_prefix,
        ...(paid ?? {}),
      },
      notify,
    };
  }

  const bundle = (session.metadata?.bundle ?? '') as string;
  const bundleConfig = STRIPE_BUNDLES[bundle];

  if (!bundleConfig) {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );
    return { status: 200, body: { received: true, error: 'unknown_bundle', bundle } };
  }

  const email = session.customer_email ?? session.customer_details?.email ?? null;
  const mintResult = generateStripeKey(email, bundleConfig.credits, session.id);
  // After the mint: the row must exist for the amount to land on it.
  const paid = recordAmountPaid(session);

  db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
    event.id,
    event.type,
  );

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
      ...(paid ?? {}),
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

  // Outside the signature try: getStripe() throwing on a missing env var is a
  // CONFIG state, and echoing its message published the variable's name to
  // any anonymous caller. 503 also makes Stripe retry once the config is
  // fixed, where a 400 dropped the event for good.
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    return c.json(
      {
        error: 'webhook_not_configured',
        message: 'Webhook processing is temporarily unavailable.',
      },
      503,
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
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
      const deliver = result.notify.plan
        ? sendSubscriptionKeyEmail({
            to: result.notify.email,
            rawKey: result.notify.rawKey,
            monthlyLimit: result.notify.monthlyLimit ?? 0,
            plan: result.notify.plan,
          })
        : sendApiKeyEmail({
            to: result.notify.email,
            rawKey: result.notify.rawKey,
            credits: result.notify.credits,
            bundle: result.notify.bundle,
          });
      // The empty catch was doubly defensive (the transport swallows and logs
      // everything already), but it also meant a key that was PAID FOR and never
      // arrived left no trace anywhere a human looks. QUA-13, 2026-09-01: the
      // relay's own refusal now alerts from inside src/lib/email.ts, and a throw
      // before it ever answers alerts from here. Nothing personal in the text:
      // Telegram is not a declared processor (src/lib/ops-alert.ts, rule 3).
      void deliver.catch(() => {
        alertKeyDeliveryFailure('stripe key delivery threw before the relay answered');
      });
    }
  }

  return c.json(result.body, result.status as 200 | 400 | 503);
});
