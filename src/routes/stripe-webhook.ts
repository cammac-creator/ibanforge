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
 *
 * Remboursements et litiges (25/09/2026, décision de Claude-Alain : retrait
 * automatique après la mise en ligne de la recharge) : `charge.refunded` (total)
 * et `charge.dispute.created` reprennent les crédits du pack payé, par le même
 * code que la route d'administration (src/lib/key-purchases.ts). Voir
 * REVERSAL_EVENTS ci-dessous.
 */
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { getStatsDB } from '../lib/db.js';
import { getUsage, OEM_MONTHLY_LIMIT, PRO_MONTHLY_LIMIT } from '../lib/api-keys.js';
import { PRO_PRICE_USD } from '../lib/payment-links.js';
import { notifyPurchaseTelegram } from '../lib/notify.js';
import { markAuditPaid } from '../lib/audit-jobs.js';
import { recordSubscriptionInvoice, stripeId } from '../lib/subscription-payments.js';
import { notifyOps, opsFail } from '../lib/ops-alert.js';
import {
  applyCardPackPaymentInTx,
  applyCardSubscriptionPaymentInTx,
  endSubscriptionInTx,
  ensureTopupRef,
  findPurchaseByRef,
  reverseCardPurchaseInTx,
  type CardReversal,
  type ReversalReason,
} from '../lib/key-purchases.js';
import { isReachableContact } from '../lib/quota-notice.js';
import {
  sendApiKeyEmail,
  sendSubscriptionKeyEmail,
  sendSubscriptionAttachedEmail,
  sendSubscriptionEndedEmail,
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
// same path as OEM: a monthly allowance that resets on the 1st. No SLA, no
// embedding rights. Depuis le lot B2 (25.09.2026), le lien porteur de la
// référence de recharge d'une clé pose l'abonnement sur CETTE clé, et la fin de
// l'abonnement ne désactive plus rien : la clé retrouve ce qu'elle avait avant.
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

/**
 * Les évènements qui reprennent les crédits d'un pack payé par carte (décision
 * de Claude-Alain du 25.09.2026 : retrait automatique, après la mise en ligne
 * de la recharge de la même clé).
 *
 *  - `charge.refunded` : seul un remboursement TOTAL reprend. Un remboursement
 *    partiel est une négociation (spec §9) : journal et alerte, rien de repris.
 *    Des remboursements partiels qui s'additionnent deviennent totaux au
 *    dernier évènement, qui reprend une fois.
 *  - `charge.dispute.created` : tout litige reprend, quels que soient son statut
 *    et son montant, c'est la lettre de la décision. Un litige gagné ensuite ne
 *    rend rien de lui-même : un humain restitue depuis le registre.
 *
 * L'achat se retrouve par l'intention de paiement que le webhook écrit sur sa
 * ligne depuis le lot B1. Jamais plus que les crédits du pack, jamais sous
 * zéro, jamais une clé désactivée. Un remboursement ou un litige qui ne mène à
 * aucun achat répond 200 `ignored` avec un journal, jamais une erreur que
 * Stripe rejouerait des jours : le compte Stripe porte aussi les audits de
 * fichier et les paiements d'un autre projet.
 *
 * 🚨 Le point d'écoute Stripe doit être abonné aux deux : sans eux, rien
 * n'arrive ici, et la route d'administration reste le seul moyen de reprendre.
 */
const REVERSAL_EVENTS: ReadonlySet<string> = new Set(['charge.refunded', 'charge.dispute.created']);

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

/**
 * Un abonnement posé sur une clé existante, ou terminé (lot B2) : à annoncer
 * hors de la transaction, seulement sur une VRAIE transition, jamais sur un
 * rejeu. `to` : l'adresse joignable de la clé, sinon celle du payeur (contact de
 * service, jamais l'identité de la clé).
 */
export type StripeSubscriptionNotify =
  | {
      kind: 'attached';
      to: string | null;
      keyPrefix: string;
      plan: SubscriptionPlan;
      monthlyLimit: number;
      amountUsd: number;
    }
  | {
      kind: 'ended';
      to: string | null;
      keyPrefix: string;
      plan: SubscriptionPlan;
      /** L'allocation que la clé a retrouvée : 0 pour une clé née de l'abonnement. */
      allowance: number;
      /** Vrai quand cette allocation se compte sur la vie de la clé. */
      lifetime: boolean;
      /**
       * Ce qui RESTE de cette allocation au moment de la fin, lu par `getUsage`
       * sur la même assiette que le plafond (relecture de la PR 264, D4) : le
       * mois en cours compte déjà les appels payés en Pro, et une assiette de
       * vie tous les mois de la clé.
       */
      remaining: number;
      creditsRemaining: number | null;
      /** La référence de recharge de la clé, pour les liens du mail. */
      topupRef: string | null;
    };

/** La formule d'une ligne d'abonnement du registre ; Pro par défaut. */
function planOfBundle(bundle: string | null | undefined): SubscriptionPlan {
  return bundle === 'oem' ? 'oem' : 'pro';
}

/** Le contact de service d'une clé : son adresse joignable, sinon celle du payeur. */
function serviceContactOf(keyHash: string, payerEmail: string | null): string | null {
  const keyEmail = (
    getStatsDB().prepare('SELECT email FROM api_keys WHERE key_hash = ?').get(keyHash) as
      { email: string } | undefined
  )?.email;
  if (isReachableContact(keyEmail)) return keyEmail;
  return isReachableContact(payerEmail) ? payerEmail : null;
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

/** Ce qu'un remboursement ou un litige dit du paiement, sans rien écrire. */
function reversalOf(event: Stripe.Event): {
  paymentIntent: string | null;
  reason: ReversalReason;
  partial: boolean;
  /** Le statut du litige tel que Stripe l'envoie ; null pour un remboursement. */
  disputeStatus: string | null;
} {
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    // Total quand Stripe le dit (`refunded`), ou quand le cumul remboursé
    // couvre le montant du paiement.
    const full =
      charge.refunded === true ||
      (typeof charge.amount === 'number' &&
        charge.amount > 0 &&
        typeof charge.amount_refunded === 'number' &&
        charge.amount_refunded >= charge.amount);
    return {
      paymentIntent: stripeId(charge.payment_intent),
      reason: 'refunded',
      partial: !full,
      disputeStatus: null,
    };
  }
  const dispute = event.data.object as Stripe.Dispute;
  // Le statut est lu, pas jugé : tout litige reprend le pack (décision du
  // 25.09.2026). Il dit seulement si c'est une demande de renseignements
  // (`warning_*` : les fonds ne sont pas retirés) ou une rétrofacturation
  // (relecture de la PR 263, D1).
  const status = typeof dispute.status === 'string' && dispute.status ? dispute.status : null;
  return {
    paymentIntent: stripeId(dispute.payment_intent),
    reason: 'disputed',
    partial: false,
    disputeStatus: status,
  };
}

/**
 * Une demande de renseignements de la banque du payeur, pas encore un litige :
 * Stripe la signale par un statut `warning_*`, et les fonds ne sont pas retirés.
 */
function isInquiry(disputeStatus: string | null): boolean {
  return disputeStatus !== null && disputeStatus.startsWith('warning_');
}

/**
 * La réponse à Stripe, le journal et l'alerte d'un remboursement ou d'un
 * litige. Le journal ne garde que des identifiants Stripe et de l'achat ;
 * l'alerte, le préfixe de la clé et le numéro de l'achat (à relire par
 * `GET /v1/admin/purchases`), jamais une adresse. Une alerte par achat et par
 * raison : un évènement rejoué sous un autre identifiant ne la relance pas.
 */
function reversalAnswer(
  event: Stripe.Event,
  reason: ReversalReason,
  reversal: CardReversal,
  disputeStatus: string | null = null,
): { status: number; body: Record<string, unknown>; alert?: { key: string; detail: string } } {
  const base = { received: true, event_id: event.id };
  const inquiry = reason === 'disputed' && isInquiry(disputeStatus);
  const what =
    reason === 'refunded'
      ? 'remboursé'
      : inquiry
        ? 'visé par une demande de renseignements de la banque du payeur'
        : 'contesté (litige)';
  // Le statut du litige, dans le journal et dans le bloc `reversal` : sans lui,
  // une demande de renseignements se lisait comme un litige (relecture, D1).
  const statusNote = reason === 'disputed' ? ` (dispute status ${disputeStatus ?? 'unknown'})` : '';
  const statusField = reason === 'disputed' ? { dispute_status: disputeStatus } : {};
  if (reversal.kind === 'no_payment_intent' || reversal.kind === 'unknown') {
    const ignored = reversal.kind === 'unknown' ? 'no_matching_purchase' : 'no_payment_intent';
    console.info(
      `[stripe-webhook] ${event.type}${statusNote} ignored (${ignored}), event ${event.id}`,
    );
    return { status: 200, body: { ...base, ignored } };
  }
  if (reversal.kind === 'ambiguous') {
    const ids = reversal.purchases.map((p) => p.id).join(', ');
    console.warn(
      `[stripe-webhook] ${event.type}${statusNote}: several purchases (${ids}), nothing taken back`,
    );
    return {
      status: 200,
      body: { ...base, ignored: 'ambiguous_payment_intent' },
      alert: {
        key: `stripe:reversal-ambiguous:${reversal.purchases[0].id}`,
        detail:
          `Un paiement ${what} chez Stripe mène à plusieurs achats du registre (${ids}) : ` +
          'rien n’a été repris. À relire dans les outils privés.',
      },
    };
  }
  if (reversal.kind === 'partial_refund') {
    const p = reversal.purchase;
    console.info(`[stripe-webhook] partial refund on purchase ${p.id}, nothing taken back`);
    return {
      status: 200,
      body: {
        ...base,
        reversal: {
          reason,
          outcome: 'partial_refund',
          purchase_id: p.id,
          key_prefix: p.key_prefix,
          removed_credits: 0,
        },
      },
      alert: {
        key: `stripe:refund-partial:${p.id}:${sessionTag(event.id)}`,
        detail:
          `Remboursement PARTIEL chez Stripe de l’achat ${p.id} (clé ${p.key_prefix}…) : rien ` +
          'n’a été repris, c’est une négociation. Pour reprendre le pack entier : ' +
          `POST /v1/admin/purchases/${p.id}/clawback.`,
      },
    };
  }

  const out = reversal.outcome;
  const p = out.purchase;
  const alertKey = `stripe:${reason === 'refunded' ? 'refund' : 'dispute'}:${p.id}`;
  if (out.status === 'clawed_back') {
    const prefix = out.keyPrefix ?? p.key_prefix;
    const packCredits = p.credits ?? 0;
    console.info(
      `[stripe-webhook] ${event.type}${statusNote}: purchase ${p.id} ${reason}, ${out.removed} of ${packCredits} credits taken back`,
    );
    const why =
      out.keyPrefix === null
        ? ' Pas exactement une clé active dans la lignée (aucune, ou plusieurs) : rien n’a été repris.'
        : out.removed < packCredits
          ? ' Il restait moins que le pack sur la clé : seul le solde a été repris.'
          : '';
    return {
      status: 200,
      body: {
        ...base,
        reversal: {
          reason,
          ...statusField,
          outcome: 'clawed_back',
          purchase_id: p.id,
          key_prefix: prefix,
          removed_credits: out.removed,
          pack_credits: packCredits,
        },
      },
      alert: inquiry
        ? {
            // Une clé à part : si la demande devient un litige et que Stripe
            // l'annonce, cette alerte-là peut encore partir.
            key: `stripe:dispute-inquiry:${p.id}`,
            detail:
              `Demande de renseignements de la banque du payeur (${disputeStatus}) sur un pack payé par carte ` +
              `(achat ${p.id}, clé ${prefix}…) : ce n’est pas encore un litige, les fonds ne sont PAS retirés. ` +
              `${out.removed} crédits ont quand même été repris (décision du 25.09.2026), jamais sous zéro, ` +
              `clé toujours active.${why} Répondre à la demande dans Stripe. Si elle se referme sans litige, ` +
              `les ${out.removed} crédits sont à restituer à la main (aucune route ne les remet encore).`,
          }
        : {
            key: alertKey,
            detail:
              `Un pack payé par carte a été ${what} chez Stripe : ${out.removed} crédits repris sur ` +
              `la clé ${prefix}… (achat ${p.id}), jamais sous zéro, clé toujours active.${why}` +
              (reason === 'disputed'
                ? ' Litige gagné : rien n’est rendu de lui-même, restituer à la main depuis le registre.'
                : ''),
          },
    };
  }
  console.info(
    `[stripe-webhook] ${event.type}${statusNote}: purchase ${p.id} ${out.status}, nothing taken back`,
  );
  const body = {
    ...base,
    reversal: {
      reason,
      ...statusField,
      outcome: out.status,
      purchase_id: p.id,
      key_prefix: p.key_prefix,
      removed_credits: 0,
    },
  };
  // Déjà repris (rejeu sous un autre identifiant, remboursement après la route
  // d'administration) : seul un litige mérite encore un regard humain.
  if (out.status === 'unchanged' && reason === 'refunded') return { status: 200, body };
  const detail =
    out.status === 'unchanged'
      ? `Un paiement de pack déjà repris (${p.outcome}) est ${what} chez Stripe (achat ${p.id}) : rien de plus n’a été repris.`
      : out.status === 'not_a_pack'
        ? `Un paiement d’abonnement a été ${what} chez Stripe (achat ${p.id}, clé ${p.key_prefix}…) : rien n’a été repris ; l’abonnement se gère dans Stripe.`
        : `Un achat jamais réglé (${p.outcome}) est ${what} chez Stripe (achat ${p.id}) : rien n’a été repris. À relire.`;
  return { status: 200, body, alert: { key: alertKey, detail } };
}

export function processStripeEvent(event: Stripe.Event): {
  status: number;
  body: Record<string, unknown>;
  notify?: StripePurchaseNotify;
  recharge?: StripeRechargeNotify;
  subscription?: StripeSubscriptionNotify;
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

  // La fin d'un abonnement (lot B2, 25.09.2026, décision du 24.09 : une
  // résiliation ne désactive plus la clé). La clé retrouve ce qu'elle avait
  // avant l'abonnement (0 pour une clé née de lui : elle répond alors 402 avec
  // ses liens, règle A), garde ses crédits et son identifiant, reste active.
  //
  // 🚨 La pierre tombale est posée à CHAQUE fin, dans la même transaction que
  // processed_webhooks : Stripe ne garantit aucun ordre, et une résiliation
  // arrivée avant le checkout.session.completed qui frappe ou rattache la clé
  // doit faire refuser ce dernier. Sans elle, la clé garderait un Pro que
  // personne ne paie, et la barrière d'idempotence mangerait le rejeu.
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const ended = db
      .transaction(() => {
        const out = endSubscriptionInTx(db, sub.id);
        db.prepare(
          'INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)',
        ).run(event.id, event.type);
        return out;
      })
      .immediate();
    const body: Record<string, unknown> = {
      received: true,
      event_id: event.id,
      subscription: sub.id,
      outcome: ended.status,
      key_deactivated: false,
      ...(ended.status === 'ended'
        ? { key_prefix: ended.keyPrefix, allowance_restored_to: ended.allowanceRestoredTo }
        : ended.status === 'already_ended' || ended.status === 'moved_on'
          ? { key_prefix: ended.keyPrefix }
          : {}),
    };
    // Relecture de sécurité de la PR 264, D7 : deux clés actives dans la même
    // lignée (anomalie), rien n'est rendu et les deux gardent leur allocation.
    // Un humain le sait, sans adresse ni identifiant Stripe dans le texte.
    if (ended.status === 'ambiguous') {
      return {
        status: 200,
        body,
        alert: {
          key: `stripe:subscription-end-ambiguous:${sessionTag(sub.id)}`,
          detail:
            'La fin d’un abonnement mène à deux clés actives dans la même lignée : rien n’a été rendu, ' +
            'les deux gardent leur allocation d’abonnement. À relire dans les outils privés.',
        },
      };
    }
    if (ended.status !== 'ended') return { status: 200, body };
    const key = db
      .prepare('SELECT credits_remaining FROM api_keys WHERE key_hash = ?')
      .get(ended.keyHash) as { credits_remaining: number | null } | undefined;
    return {
      status: 200,
      body,
      subscription: {
        kind: 'ended',
        to: serviceContactOf(ended.keyHash, ended.purchase?.payer_email ?? null),
        keyPrefix: ended.keyPrefix,
        plan: planOfBundle(ended.purchase?.bundle),
        allowance: ended.allowanceRestoredTo,
        lifetime: ended.lifetime,
        remaining: getUsage(ended.keyHash, ended.allowanceRestoredTo, ended.lifetime).remaining,
        creditsRemaining: key?.credits_remaining ?? null,
        topupRef: ensureTopupRef(ended.keyHash),
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

  // Remboursement ou litige : la reprise et l'évènement traité dans UNE
  // transaction IMMEDIATE. Un arrêt entre les deux ne peut ni reprendre sans
  // marquer l'évènement (Stripe rejoue, l'issue de la ligne tient), ni marquer
  // sans reprendre.
  if (REVERSAL_EVENTS.has(event.type)) {
    const reversal = reversalOf(event);
    const outcome = db
      .transaction(() => {
        const out = reverseCardPurchaseInTx(db, reversal);
        db.prepare(
          'INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)',
        ).run(event.id, event.type);
        return out;
      })
      .immediate();
    return reversalAnswer(event, reversal.reason, outcome, reversal.disputeStatus);
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
      // Relecture de sécurité de la PR 264, D3 : jamais un client qui paie sans
      // rien recevoir sans alerte. Une session qui n'a encore rien livré (aucune
      // ligne au registre) arrive après la fin de son abonnement : la
      // résiliation a été reçue avant le paiement. Un simple rejeu d'une session
      // déjà livrée, lui, ne dit rien de nouveau et n'alerte pas.
      const delivered = findPurchaseByRef(`stripe:${session.id}`, db) !== null;
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
        ...(delivered
          ? {}
          : {
              alert: {
                key: `stripe:subscription-skipped:${sessionTag(session.id)}`,
                detail:
                  'Un paiement d’abonnement est arrivé après la fin de cet abonnement (la résiliation a été ' +
                  'reçue avant le paiement) : rien n’a été posé ni frappé. Le client a payé sans rien ' +
                  'recevoir : rembourser, ou rétablir à la main. À relire dans les outils privés.',
              },
            }),
      };
    }
    const clientReferenceId =
      typeof session.client_reference_id === 'string' ? session.client_reference_id : null;
    // Une transaction pour le rattachement ou la frappe, le montant, la ligne du
    // registre et l'évènement traité (lot B2 : le lien Pro porteur de la
    // référence de recharge d'une clé pose l'abonnement sur CETTE clé).
    const { outcome, paid } = db
      .transaction(() => {
        const out = applyCardSubscriptionPaymentInTx(db, {
          sessionId: session.id,
          plan,
          monthlyLimit: planConfig.monthly_limit,
          subscriptionId,
          amountMinor: session.amount_total ?? null,
          currency: session.currency ?? null,
          paymentIntent: stripeId(session.payment_intent),
          payerEmail: email,
          clientReferenceId,
        });
        // Le montant sur la clé que CETTE session a frappée (premier écrit
        // gagnant). Un rattachement ne l'écrit jamais sur la clé : elle garde
        // « l'achat qui l'a frappée », et le premier paiement de l'abonnement
        // vit au registre.
        const amount = out.kind === 'minted' ? recordAmountPaid(session) : null;
        db.prepare(
          'INSERT INTO processed_webhooks (stripe_event_id, event_type) VALUES (?, ?)',
        ).run(event.id, event.type);
        return { outcome: out, paid: amount };
      })
      .immediate();
    const amountUsd = amountUsdOf(session, planConfig.price_usd);
    const amountFields =
      session.amount_total != null && session.currency != null
        ? { amount_paid_minor: session.amount_total, amount_paid_currency: session.currency }
        : null;

    if (outcome.kind === 'idempotent') {
      return {
        status: 200,
        body: {
          received: true,
          idempotent: true,
          event_id: event.id,
          plan,
          key_prefix: outcome.purchase.key_prefix,
          ...(amountFields ?? {}),
        },
      };
    }

    // Relecture de sécurité de la PR 264, D2 : un abonnement réglé à zéro
    // (essai gratuit, code promotionnel à 100 %) est légitime et n'est pas
    // refusé, mais un humain le sait. Sans adresse ni session dans le texte.
    const unpaid = session.payment_status === 'no_payment_required';
    const unpaidDetail = (what: string): string =>
      'Un abonnement a été réglé à zéro chez Stripe (aucun paiement requis : essai ou code ' +
      `promotionnel), sans être refusé : ${what} À relire dans les outils privés.`;

    if (outcome.kind === 'attached') {
      return {
        status: 200,
        body: {
          received: true,
          event_id: event.id,
          plan,
          monthly_limit: outcome.monthlyLimit,
          attached: { key_prefix: outcome.keyPrefix, outcome: 'attached' },
          ...(amountFields ?? {}),
        },
        ...(unpaid
          ? {
              alert: {
                key: `stripe:unpaid-subscription:${sessionTag(session.id)}`,
                detail: unpaidDetail(`il a été posé sur la clé existante ${outcome.keyPrefix}….`),
              },
            }
          : {}),
        subscription: {
          kind: 'attached',
          to: serviceContactOf(outcome.keyHash, email),
          keyPrefix: outcome.keyPrefix,
          plan,
          monthlyLimit: outcome.monthlyLimit,
          amountUsd,
        },
      };
    }

    const notify: StripePurchaseNotify | undefined = outcome.rawKey
      ? {
          email,
          bundle: plan,
          credits: 0,
          priceUsd: planConfig.price_usd,
          keyPrefix: outcome.keyPrefix,
          rawKey: outcome.rawKey,
          plan,
          monthlyLimit: outcome.monthlyLimit,
        }
      : undefined;
    const fallback = outcome.fallback;
    // Deux abonnements vivants sur une clé, c'est une double facturation
    // silencieuse (ZG10) : la clé neuve est remise au payeur, et un humain
    // rembourse ou résilie. Les autres replis disent seulement que la
    // référence n'a pas servi (révoquée, inconnue, ambiguë).
    const fallbackAlert =
      fallback && fallback !== 'no_subscription' && outcome.rawKey
        ? {
            key: `stripe:subscription-${fallback === 'double_subscription' ? 'double' : 'fallback'}:${sessionTag(session.id)}`,
            detail:
              fallback === 'double_subscription'
                ? 'Un abonnement a été payé avec la référence d’une clé qui porte déjà un abonnement vivant : ' +
                  'une clé neuve a été frappée et remise au payeur. Deux abonnements sont facturés : ' +
                  'rembourser ou résilier l’un des deux dans Stripe.'
                : `Un abonnement payé avec une référence de recharge n’a pas été posé sur sa clé (motif : ${fallback}) : ` +
                  'une clé neuve a été frappée et remise au payeur. À relire dans les outils privés.',
          }
        : undefined;
    // Réglé à zéro ET replié : une seule alerte, qui dit les deux.
    const alert =
      unpaid && outcome.rawKey
        ? fallbackAlert
          ? {
              ...fallbackAlert,
              detail: `${fallbackAlert.detail} Réglé à zéro chez Stripe (aucun paiement requis).`,
            }
          : {
              key: `stripe:unpaid-subscription:${sessionTag(session.id)}`,
              detail: unpaidDetail(`une clé neuve ${outcome.keyPrefix}… a été frappée.`),
            }
        : fallbackAlert;

    return {
      status: 200,
      body: {
        received: true,
        event_id: event.id,
        plan,
        monthly_limit: outcome.monthlyLimit,
        key_prefix: outcome.keyPrefix,
        ...(clientReferenceId && fallback
          ? {
              attached: {
                key_prefix: outcome.keyPrefix,
                outcome: 'minted_fallback',
                fallback_reason: fallback,
              },
            }
          : {}),
        ...(paid ?? {}),
      },
      notify,
      ...(alert ? { alert } : {}),
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

  // Un abonnement posé sur une clé existante, ou terminé (lot B2) : seulement
  // sur une vraie transition, jamais sur un rejeu (qui ne produit pas de
  // `subscription`). Le mail de fin est court et factuel (Q14).
  if (result.subscription?.kind === 'attached') {
    const s = result.subscription;
    await notifyPurchaseTelegram({
      amountUsd: s.amountUsd,
      bundle: s.plan,
      credits: 0,
      keyPrefix: s.keyPrefix,
      plan: s.plan,
      monthlyLimit: s.monthlyLimit,
      attached: true,
    }).catch(() => {});
    if (s.to && !process.env.VITEST) {
      void sendSubscriptionAttachedEmail({
        to: s.to,
        keyPrefix: s.keyPrefix,
        plan: s.plan,
        monthlyLimit: s.monthlyLimit,
      }).catch(() => {});
    }
  }
  if (result.subscription?.kind === 'ended' && result.subscription.to && !process.env.VITEST) {
    const s = result.subscription;
    void sendSubscriptionEndedEmail({
      to: s.to as string,
      keyPrefix: s.keyPrefix,
      plan: s.plan,
      allowance: s.allowance,
      lifetime: s.lifetime,
      remaining: s.remaining,
      creditsRemaining: s.creditsRemaining,
      topupRef: s.topupRef,
    }).catch(() => {});
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
