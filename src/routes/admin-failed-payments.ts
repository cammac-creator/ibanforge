import { Hono } from 'hono';
import type Stripe from 'stripe';
import { createStripeClient } from '../lib/stripe-client.js';
import { isAdminAuthorized } from '../lib/admin-auth.js';

/** Lecture du compte Stripe : un refus observé ne prouve ni une vente perdue ni son origine bancaire. */
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
  /** Charge encaissée créée strictement après le refus, à la même adresse ; pas un rapprochement d’achat. */
  recovered_at: string | null;
}
export interface FailedPaymentsCoverage {
  complete: boolean;
  reason: 'complete' | 'deadline' | 'page_limit' | 'stripe_error' | 'pagination_invalid';
  pages_read: number;
  charges_read: number;
}
export interface FailedPaymentsSummary {
  version: 1;
  source: 'stripe_charges_read';
  scope: 'stripe_account';
  period_days: number;
  window_start: string;
  observed_until: string;
  attempts: number;
  distinct_buyers: number;
  unrecovered_buyers: number;
  attempts_without_email: number;
  /** Ancien champ : défini seulement si une devise unique est connue, sinon null. */
  amount_attempted_minor: number | null;
  currency: string | null;
  amounts_by_currency: Record<string, number>;
  unknown_amount_attempts: number;
  by_reason: Record<string, number>;
  latest: FailedAttempt[];
}
let _stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = createStripeClient(key, { timeout: 8000, maxNetworkRetries: 0 });
  return _stripe;
}
/** Client fictif des tests ; aucun appel de production. */
export function _setStripeForTests(client: Stripe | null): void {
  _stripe = client;
}
const emailOf = (c: Stripe.Charge): string | null =>
  (c.billing_details?.email?.trim() || c.receipt_email?.trim() || '').toLowerCase() || null;

/** Fenêtre stable et montants par devise, sans interpréter un paiement ultérieur comme le même achat. */
export function summarizeFailedPayments(
  charges: Stripe.Charge[],
  periodDays: number,
  windowStart: Date,
  observedUntil: Date,
): FailedPaymentsSummary {
  const rows = charges.filter(
    (c) =>
      Number.isFinite(c.created) &&
      c.created * 1000 >= windowStart.getTime() &&
      c.created * 1000 <= observedUntil.getTime(),
  );
  const failed = rows.filter((c) => c.status === 'failed').sort((a, b) => b.created - a.created);
  const latestPaid = new Map<string, number>();
  for (const c of rows) {
    const email = emailOf(c);
    if (
      email &&
      c.status === 'succeeded' &&
      c.captured === true &&
      c.amount_captured > 0 &&
      c.amount_refunded < c.amount_captured &&
      !c.refunded
    ) {
      latestPaid.set(email, Math.max(latestPaid.get(email) ?? 0, c.created));
    }
  }
  const byReason: Record<string, number> = {};
  const amounts: Record<string, number> = {};
  const buyers = new Set<string>();
  const unrecovered = new Set<string>();
  let withoutEmail = 0;
  let unknownAmount = 0;
  const latest: FailedAttempt[] = [];
  for (const c of failed) {
    const email = emailOf(c);
    const reason = c.outcome?.reason ?? c.failure_code ?? 'unknown';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    const minor = Number.isSafeInteger(c.amount) && c.amount >= 0 ? c.amount : null;
    const currency =
      typeof c.currency === 'string' && /^[a-z]{3}$/.test(c.currency) ? c.currency : null;
    if (minor !== null && currency) amounts[currency] = (amounts[currency] ?? 0) + minor;
    else unknownAmount++;
    const paidAt = email ? latestPaid.get(email) : undefined;
    const recovered = paidAt !== undefined && paidAt > c.created;
    if (email) {
      buyers.add(email);
      if (!recovered) unrecovered.add(email);
    } else withoutEmail++;
    const card = c.payment_method_details?.card ?? null;
    latest.push({
      created_at: new Date(c.created * 1000).toISOString(),
      email,
      amount_minor: minor,
      currency,
      decline_reason: reason,
      decline_message: c.outcome?.seller_message ?? c.failure_message ?? null,
      card_brand: card?.brand ?? null,
      card_last4: card?.last4 ?? null,
      card_country: card?.country ?? null,
      recovered,
      recovered_at: recovered ? new Date(paidAt * 1000).toISOString() : null,
    });
  }
  const currencies = Object.keys(amounts);
  const currency = currencies.length === 1 && unknownAmount === 0 ? currencies[0] : null;
  return {
    version: 1,
    source: 'stripe_charges_read',
    scope: 'stripe_account',
    period_days: periodDays,
    window_start: windowStart.toISOString(),
    observed_until: observedUntil.toISOString(),
    attempts: failed.length,
    distinct_buyers: buyers.size,
    unrecovered_buyers: unrecovered.size,
    attempts_without_email: withoutEmail,
    amount_attempted_minor: currency ? amounts[currency] : failed.length === 0 ? 0 : null,
    currency,
    amounts_by_currency: amounts,
    unknown_amount_attempts: unknownAmount,
    by_reason: byReason,
    latest: latest.slice(0, 20),
  };
}

/** Pagination Stripe bornée : https://docs.stripe.com/api/charges/list. Aucune écriture ni relance de paiement. */
export async function readFailedPaymentCharges(
  stripe: Pick<Stripe, 'charges'>,
  start: Date,
  end: Date,
  options: { now?: () => number; deadlineMs?: number; maxPages?: number } = {},
): Promise<{ charges: Stripe.Charge[]; coverage: FailedPaymentsCoverage }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? 8000);
  const maxPages = options.maxPages ?? 20;
  const charges: Stripe.Charge[] = [];
  const ids = new Set<string>();
  let after: string | undefined;
  let pages = 0;
  let reason: FailedPaymentsCoverage['reason'] = 'page_limit';
  while (pages < maxPages) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      reason = 'deadline';
      break;
    }
    try {
      const page = await stripe.charges.list(
        {
          created: {
            gte: Math.floor(start.getTime() / 1000),
            lte: Math.floor(end.getTime() / 1000),
          },
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        },
        { timeout: remaining, maxNetworkRetries: 0 },
      );
      if (
        !Array.isArray(page.data) ||
        typeof page.has_more !== 'boolean' ||
        page.data.some((c) => !c.id || ids.has(c.id)) ||
        new Set(page.data.map((c) => c.id)).size !== page.data.length
      ) {
        reason = 'pagination_invalid';
        break;
      }
      pages++;
      for (const c of page.data) {
        ids.add(c.id);
        charges.push(c);
      }
      if (!page.has_more) {
        reason = 'complete';
        break;
      }
      after = page.data.at(-1)?.id;
      if (!after) {
        reason = 'pagination_invalid';
        break;
      }
    } catch (error) {
      if (pages === 0) throw error;
      reason = 'stripe_error';
      break;
    }
  }
  if (pages === 0) throw new Error('Lecture Stripe indisponible');
  return {
    charges,
    coverage: {
      complete: reason === 'complete',
      reason,
      pages_read: pages,
      charges_read: charges.length,
    },
  };
}

adminFailedPayments.get('/v1/admin/failed-payments', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret')))
    return c.json({ error: 'unauthorized' }, 401);
  c.header('Cache-Control', 'private, no-store');
  const asked = Number(c.req.query('days') ?? 90);
  const periodDays = Number.isFinite(asked) && asked >= 1 && asked <= 365 ? Math.floor(asked) : 90;
  const stripe = getStripe();
  if (!stripe) return c.json({ error: 'unavailable', reason: 'stripe_not_configured' }, 503);
  const observedUntil = new Date();
  const windowStart = new Date(observedUntil.getTime() - periodDays * 86400_000);
  try {
    const { charges, coverage } = await readFailedPaymentCharges(
      stripe,
      windowStart,
      observedUntil,
    );
    return c.json({
      ...summarizeFailedPayments(charges, periodDays, windowStart, observedUntil),
      coverage,
      read_at: new Date().toISOString(),
    });
  } catch {
    return c.json({ error: 'unavailable', reason: 'stripe_unreachable' }, 503);
  }
});
