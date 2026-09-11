import { Hono } from 'hono';
import Stripe from 'stripe';
import { isAdminAuthorized } from './api-keys.js';

/**
 * Les paiements REFUSÉS, que rien ne montrait jusqu'ici.
 *
 * Le 11.09.2026 : quatre tentatives d'achat ont échoué depuis juin, dont deux
 * le même jour pour le même acheteur, et aucune n'apparaissait nulle part.
 * Un refus est pourtant le signal commercial le plus actionnable qui existe :
 * quelqu'un a sorti sa carte, et il est reparti sans rien.
 *
 * Trois choix assumés :
 *
 *  - **On TIRE depuis Stripe, on n'attend pas d'être prévenu.** Écouter les
 *    évènements d'échec demanderait de modifier l'abonnement du point d'écoute,
 *    donc de toucher au compte de paiement. Une lecture à la demande ne change
 *    rien chez Stripe et donne la même information.
 *  - **Un refus suivi d'un paiement réussi n'est PAS une vente perdue.** Le
 *    champ `recovered` le dit, sinon on compterait comme perdu l'acheteur qui a
 *    simplement retenté avec une autre carte — c'est arrivé en août.
 *  - **Indisponible n'est jamais zéro.** Si Stripe ne répond pas, la route rend
 *    503 avec `unavailable`. Un zéro inventé se lirait « personne n'a échoué »,
 *    ce qui est exactement le mensonge qu'on vient de réparer.
 */
export const adminFailedPayments = new Hono();

export interface FailedAttempt {
  created_at: string;
  email: string | null;
  amount_minor: number | null;
  currency: string | null;
  decline_reason: string | null;
  decline_message: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_country: string | null;
  recovered: boolean;
}

export interface FailedPaymentsSummary {
  version: 1;
  source: 'stripe_charges_read';
  period_days: number;
  window_start: string;
  observed_until: string;
  attempts: number;
  distinct_buyers: number;
  unrecovered_buyers: number;
  amount_attempted_minor: number;
  currency: string | null;
  by_reason: Record<string, number>;
  latest: FailedAttempt[];
}

let _stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key);
  return _stripe;
}
/** Les tests posent leur propre client ; la production n'appelle jamais ceci. */
export function _setStripeForTests(client: Stripe | null): void {
  _stripe = client;
}

/**
 * Résume des charges Stripe déjà lues. Séparé de la route pour être testable
 * sans réseau : c'est ici que vit la règle « un refus rattrapé n'est pas perdu ».
 */
export function summarizeFailedPayments(
  charges: Stripe.Charge[],
  periodDays: number,
  windowStart: Date,
  observedUntil: Date,
): FailedPaymentsSummary {
  const failed = charges.filter((c) => c.status === 'failed');
  const paidEmails = new Set(
    charges
      .filter((c) => c.status === 'succeeded' && !c.refunded)
      .map((c) => (c.billing_details?.email ?? c.receipt_email ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const byReason: Record<string, number> = {};
  const buyers = new Set<string>();
  const unrecovered = new Set<string>();
  let attempted = 0;
  let currency: string | null = null;

  const latest: FailedAttempt[] = [];
  for (const c of failed.sort((a, b) => b.created - a.created)) {
    const email = (c.billing_details?.email ?? c.receipt_email ?? '').trim().toLowerCase() || null;
    const reason = c.outcome?.reason ?? c.failure_code ?? 'unknown';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    attempted += c.amount ?? 0;
    // Une seule devise attendue aujourd'hui ; si elle diverge, on ne mélange pas.
    if (currency === null) currency = c.currency ?? null;
    else if (c.currency && c.currency !== currency) currency = null;
    const recovered = email !== null && paidEmails.has(email);
    if (email) {
      buyers.add(email);
      if (!recovered) unrecovered.add(email);
    }
    const card = c.payment_method_details?.card ?? null;
    latest.push({
      created_at: new Date(c.created * 1000).toISOString(),
      email,
      amount_minor: c.amount ?? null,
      currency: c.currency ?? null,
      decline_reason: reason,
      decline_message: c.outcome?.seller_message ?? c.failure_message ?? null,
      card_brand: card?.brand ?? null,
      card_last4: card?.last4 ?? null,
      card_country: card?.country ?? null,
      recovered,
    });
  }

  return {
    version: 1,
    source: 'stripe_charges_read',
    period_days: periodDays,
    window_start: windowStart.toISOString(),
    observed_until: observedUntil.toISOString(),
    attempts: failed.length,
    distinct_buyers: buyers.size,
    unrecovered_buyers: unrecovered.size,
    amount_attempted_minor: attempted,
    currency,
    by_reason: byReason,
    latest: latest.slice(0, 20),
  };
}

adminFailedPayments.get('/v1/admin/failed-payments', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const asked = Number(c.req.query('days') ?? 90);
  const periodDays = Number.isFinite(asked) && asked >= 1 && asked <= 365 ? Math.floor(asked) : 90;
  const stripe = getStripe();
  c.header('Cache-Control', 'private, no-store');
  if (!stripe) {
    return c.json({ error: 'unavailable', reason: 'stripe_not_configured' }, 503);
  }
  const observedUntil = new Date();
  const windowStart = new Date(observedUntil.getTime() - periodDays * 86400_000);
  try {
    // Les charges réussies entrent aussi : c'est ce qui permet de dire qu'un
    // refus a été rattrapé plutôt que de le compter comme une vente perdue.
    const page = await stripe.charges.list({
      created: { gte: Math.floor(windowStart.getTime() / 1000) },
      limit: 100,
    });
    return c.json(summarizeFailedPayments(page.data, periodDays, windowStart, observedUntil));
  } catch {
    return c.json({ error: 'unavailable', reason: 'stripe_unreachable' }, 503);
  }
});
