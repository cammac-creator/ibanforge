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
 *
 * Renouvellements (23/09/2026) : `invoice.paid` consigne les factures
 * `subscription_cycle` dans `subscription_payments`, sans rien frapper. Le
 * premier paiement d'un abonnement reste sur sa clé (voir
 * src/lib/subscription-payments.ts).
 */
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { getStatsDB } from '../lib/db.js';
import {
  generateOemKey,
  deactivateBySubscription,
  OEM_MONTHLY_LIMIT,
  PRO_MONTHLY_LIMIT,
} from '../lib/api-keys.js';
import { PRO_PRICE_USD } from '../lib/payment-links.js';
import { notifyPurchaseTelegram } from '../lib/notify.js';
import { markAuditPaid } from '../lib/audit-jobs.js';
import { recordSubscriptionInvoice, stripeId } from '../lib/subscription-payments.js';
import { notifyOps, opsFail } from '../lib/ops-alert.js';
import { applyCardPackPaymentInTx, recordSubscriptionMintInTx } from '../lib/key-purchases.js';
import { isReachableContact } from '../lib/quota-notice.js';
import {
  sendApiKeyEmail,
  sendSubscriptionKeyEmail,
  sendRechargeEmail,
  alertKeyDeliveryFailure,
  sendAuditReadyEmail,
} from '../lib/email.js';

/**
 * Les packs vendus par carte. `price_usd` ne sert qu'au repli de la
 * notification quand Stripe ne dit pas ce qu'il a encaissé : le montant réel
 * vient de `amount_total`. Le pack d'entrée coûte 4 $ depuis le 16.09.2026
 * (décision de Claude-Alain) ; la table disait encore 5, et la notification
 * annonçait 5 $ pour un paiement de 4 (constat C3 du lot B1).
 */
export const STRIPE_BUNDLES: Record<string, { credits: number; price_usd: number }> = {
  '1k': { credits: 1000, price_usd: 4 },
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

/** Une recharge de la même clé, à annoncer hors de la transaction (lot B1). */
export interface StripeRechargeNotify {
  /** L'adresse joignable de la clé, sinon celle du payeur ; null si aucune. */
  to: string | null;
  keyPrefix: string;
  creditsAdded: number;
  balance: number;
  bundle: string;
  amountUsd: number;
}

/** Ce que le montant d'une session dit en dollars, ou le prix du pack à défaut. */
function amountUsdOf(session: Stripe.Checkout.Session, fallbackUsd: number): number {
  if (session.amount_total != null && (session.currency ?? '').toLowerCase() === 'usd') {
    return Math.round(session.amount_total) / 100;
  }
  return fallbackUsd;
}

/** Une empreinte de la session, pour nommer une alerte sans y mettre la session. */
function sessionTag(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
}

export function processStripeEvent(event: Stripe.Event): {
  status: number;
  body: Record<string, unknown>;
  notify?: StripePurchaseNotify;
  recharge?: StripeRechargeNotify;
  /** Une alerte à lancer hors de la transaction ; sans adresse ni référence. */
  alert?: { key: string; detail: string };
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

  // Renouvellement d'abonnement : aucune clé à frapper, un paiement à consigner.
  // Seules les factures `subscription_cycle` entrent dans le registre ; la
  // première facture (`subscription_create`) est déjà portée par la clé que
  // checkout.session.completed a frappée, et toute autre facture est reçue et
  // ignorée en le disant. Détail : src/lib/subscription-payments.ts.
  //
  // UNE transaction avec processed_webhooks, comme la branche audit : un arrêt
  // entre les deux écritures laisserait soit un paiement sans évènement traité
  // (Stripe rejoue, l'unicité de la facture tient), soit l'inverse (le
  // renouvellement perdu pour toujours).
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const outcome = db
      .transaction(() => {
        const result = recordSubscriptionInvoice(event.id, invoice, event.created ?? null, db);
        db.prepare(
          'INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)',
        ).run(event.id, event.type);
        return result;
      })
      .immediate();
    return {
      status: 200,
      body: { received: true, event_id: event.id, invoice: invoice.id ?? null, ...outcome },
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
  // A credit PACK settled at zero is the exception, handled in the pack branch
  // below: nothing is credited, and a human is alerted (security review of
  // PR 259).
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
    const sessionHash = createHash('sha256').update(session.id).digest('hex');
    const { result, notify } = db
      .transaction(() => {
        const payment = markAuditPaid(auditJobId, {
          session_id: session.id,
          email: session.customer_email ?? session.customer_details?.email ?? null,
          amount_minor: session.amount_total ?? null,
          currency: session.currency ?? null,
        });
        db.prepare(
          'INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)',
        ).run(event.id, event.type);
        // Un reçu par paiement, même si Stripe envoie plusieurs événements distincts.
        // Le préfixe est séparé des evt_ Stripe et ne contient aucun lien d'accès.
        const notice = db
          .prepare(
            'INSERT OR IGNORE INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)',
          )
          .run(`audit-notice:${sessionHash}`, `audit:${payment.status}`);
        return { result: payment, notify: notice.changes > 0 };
      })
      .immediate();
    const incident = result.status === 'job_missing' || result.status === 'additional_payment';
    const paidJob = incident ? null : result.job;
    if (incident && notify) {
      // L'événement reste reçu, mais aucune livraison ni remboursement n'est prétendu.
      // Seuls les journaux privés portent la référence ; jamais le lien d'accès dans OPS.
      console.error('[audit-payment]', result.status, {
        event_id: event.id,
        audit_job: auditJobId,
      });
      if (!process.env.VITEST) {
        void opsFail(
          `audit:${result.status}:${sessionHash}`,
          'Paiement audit à examiner dans les outils privés. Aucune nouvelle livraison confirmée.',
          1,
        );
      }
    }
    if (notify && paidJob?.payer_email) {
      sendAuditReadyEmail({
        to: paidJob.payer_email,
        lang: paidJob.lang,
        link: `https://ibanforge.com/${paidJob.lang}/audit/done?job=${paidJob.id}&session_id=${encodeURIComponent(paidJob.stripe_session_id!)}`,
        rows: paidJob.rows,
        price: paidJob.price,
        currency: paidJob.currency,
      });
    }
    if (notify && paidJob && result.status === 'paid' && !process.env.VITEST) {
      const who = paidJob.payer_email
        ? `<mail>@${paidJob.payer_email.split('@')[1]}`
        : 'e-mail inconnu';
      void notifyOps(
        `Audit de fichier vendu : ${paidJob.price} ${paidJob.currency}, ${paidJob.rows} lignes, ${who}. Rapport telechargeable 24 h.`,
      ).catch(() => undefined);
    }
    return {
      status: 200,
      body: {
        received: true,
        event_id: event.id,
        audit_job: auditJobId,
        paid: !incident,
        delivery: result.status,
        report_available: paidJob !== null,
      },
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
    // Une transaction pour la frappe, le montant, la ligne du registre des
    // achats (lot B1 : le registre distingue un premier paiement d'abonnement
    // d'une recharge de pack) et l'évènement traité.
    const { mint, paid } = db
      .transaction(() => {
        const minted = generateOemKey(email, planConfig.monthly_limit, session.id, subscriptionId);
        // After the mint: the row must exist for the amount to land on it.
        const amount = recordAmountPaid(session);
        recordSubscriptionMintInTx(db, {
          sessionId: session.id,
          plan,
          subscriptionId,
          amountMinor: session.amount_total ?? null,
          currency: session.currency ?? null,
          paymentIntent: stripeId(session.payment_intent),
          payerEmail: email,
        });
        db.prepare(
          'INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)',
        ).run(event.id, event.type);
        return { mint: minted, paid: amount };
      })
      .immediate();

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
    // 🚨 Paiement encaissé, rien livré (constat C6 du lot B1) : la réponse ne
    // change pas, mais un humain doit le savoir. Sans adresse ni session dans
    // le texte : Telegram n'est pas un sous-traitant déclaré.
    return {
      status: 200,
      body: { received: true, error: 'unknown_bundle', bundle },
      alert: {
        key: `stripe:unknown-bundle:${sessionTag(session.id)}`,
        detail:
          'Un paiement Stripe a été encaissé pour un pack que l’API ne connaît pas : aucune clé ' +
          'n’a été créditée ni frappée. Session à relire dans les outils privés.',
      },
    };
  }

  // Par précaution (relecture de sécurité de la PR 259) : un pack réglé à ZÉRO
  // ne crédite rien, ni la clé de sa référence, ni une clé neuve. Checkout
  // refuse en principe un code promotionnel à 100 % en mode paiement, mais la
  // garde n'en dépend pas : un humain est prévenu et décide. Sans adresse ni
  // session dans le texte, comme l'alerte d'un pack inconnu.
  if (session.payment_status === 'no_payment_required') {
    db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
      event.id,
      event.type,
    );
    return {
      status: 200,
      body: { received: true, error: 'unpaid_pack', bundle },
      alert: {
        key: `stripe:unpaid-pack:${sessionTag(session.id)}`,
        detail:
          'Un pack a été réglé à zéro chez Stripe (aucun paiement requis) : aucune clé n’a été ' +
          'créditée ni frappée. Session à relire dans les outils privés.',
      },
    };
  }

  const email = session.customer_email ?? session.customer_details?.email ?? null;
  const clientReferenceId =
    typeof session.client_reference_id === 'string' ? session.client_reference_id : null;
  // Le registre, le crédit ou la frappe, le montant et l'évènement traité : une
  // transaction IMMEDIATE. Une session rejouée, ou `async_payment_succeeded`
  // après `completed` (même session, autre évènement), trouve sa ligne au
  // registre et ne crédite rien de plus.
  const outcome = db
    .transaction(() => {
      const out = applyCardPackPaymentInTx(db, {
        sessionId: session.id,
        bundle,
        credits: bundleConfig.credits,
        amountMinor: session.amount_total ?? null,
        currency: session.currency ?? null,
        paymentIntent: stripeId(session.payment_intent),
        payerEmail: email,
        clientReferenceId,
      });
      db.prepare('INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)').run(
        event.id,
        event.type,
      );
      return out;
    })
    .immediate();
  const paid =
    session.amount_total != null && session.currency != null
      ? { amount_paid_minor: session.amount_total, amount_paid_currency: session.currency }
      : null;
  const amountUsd = amountUsdOf(session, bundleConfig.price_usd);

  if (outcome.kind === 'idempotent') {
    return {
      status: 200,
      body: {
        received: true,
        idempotent: true,
        event_id: event.id,
        bundle,
        key_prefix: outcome.purchase.key_prefix,
        ...(paid ?? {}),
      },
    };
  }

  if (outcome.kind === 'credited') {
    // T1 : la même clé, rechargée. Le contact de service est l'adresse de la
    // clé quand elle est joignable, sinon celle du payeur (ZG8), sans que
    // celle-ci devienne jamais l'identité de la clé.
    const keyEmail = (
      db.prepare('SELECT email FROM api_keys WHERE key_hash = ?').get(outcome.keyHash) as
        { email: string } | undefined
    )?.email;
    return {
      status: 200,
      body: {
        received: true,
        event_id: event.id,
        bundle,
        topup: {
          key_prefix: outcome.keyPrefix,
          credits_added: outcome.creditsAdded,
          outcome: 'credited',
        },
        ...(paid ?? {}),
      },
      recharge: {
        to: isReachableContact(keyEmail) ? keyEmail : isReachableContact(email) ? email : null,
        keyPrefix: outcome.keyPrefix,
        creditsAdded: outcome.creditsAdded,
        balance: outcome.balanceAfter,
        bundle,
        amountUsd,
      },
    };
  }

  // Owner alert fires only on a FRESH mint (api_key non-null). On Stripe retries
  // the mint is idempotent → api_key is null → no notify → no duplicate alert.
  const notify: StripePurchaseNotify | undefined = outcome.rawKey
    ? {
        email,
        bundle,
        credits: bundleConfig.credits,
        priceUsd: amountUsd,
        keyPrefix: outcome.keyPrefix,
        rawKey: outcome.rawKey,
      }
    : undefined;

  return {
    status: 200,
    body: {
      received: true,
      event_id: event.id,
      bundle,
      credits_minted: bundleConfig.credits,
      key_prefix: outcome.keyPrefix,
      ...(clientReferenceId
        ? {
            topup: {
              key_prefix: outcome.keyPrefix,
              credits_added: bundleConfig.credits,
              outcome: outcome.fallback ? 'minted_fallback' : 'minted',
              ...(outcome.fallback ? { fallback_reason: outcome.fallback } : {}),
            },
          }
        : {}),
      ...(paid ?? {}),
    },
    notify,
    // Une référence de recharge qui n'a pas pu servir : le paiement n'est pas
    // perdu (clé neuve remise au payeur), mais le porteur attendait sa clé à
    // lui. Un humain le sait, sans adresse ni référence dans le texte.
    ...(outcome.fallback && outcome.rawKey
      ? {
          alert: {
            key: `stripe:topup-fallback:${sessionTag(session.id)}`,
            detail:
              `Un pack payé par carte avec une référence de recharge n’a pas rechargé sa clé ` +
              `(motif : ${outcome.fallback}) : une clé neuve a été frappée et remise au payeur. ` +
              'À relire dans les outils privés.',
          },
        }
      : {}),
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

  // Les alertes d'un paiement hors du chemin nominal (pack inconnu, référence
  // de recharge qui n'a pas servi) : hors de la transaction, jamais bloquantes.
  if (result.alert && !process.env.VITEST) {
    void opsFail(result.alert.key, result.alert.detail, 1);
  }

  // Une recharge de la même clé (lot B1) : la notification et le mail de
  // recharge, seulement quand le crédit a RÉELLEMENT eu lieu (jamais sur un
  // rejeu, qui ne produit pas de `recharge`).
  if (result.recharge) {
    await notifyPurchaseTelegram({
      amountUsd: result.recharge.amountUsd,
      bundle: result.recharge.bundle,
      credits: result.recharge.creditsAdded,
      keyPrefix: result.recharge.keyPrefix,
      recharge: true,
    }).catch(() => {});
    if (result.recharge.to && !process.env.VITEST) {
      void sendRechargeEmail({
        to: result.recharge.to,
        keyPrefix: result.recharge.keyPrefix,
        creditsAdded: result.recharge.creditsAdded,
        balance: result.recharge.balance,
        bundle: result.recharge.bundle,
      }).catch(() => {});
    }
  }

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
