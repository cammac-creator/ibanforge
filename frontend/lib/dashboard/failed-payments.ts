/**
 * Contrat de lecture des paiements refusés.
 *
 * Le 11.09.2026 : quatre achats avaient été refusés depuis juin sans que rien
 * ne le montre. Ce que cet écran doit surtout ne PAS faire, c'est transformer
 * une lecture impossible en « zéro refus » : ce serait exactement le mensonge
 * rassurant qu'on vient de réparer sur les montants.
 */
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

export interface FailedPaymentsSnapshot {
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

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const entier = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** Une réponse d'une autre forme, ou incohérente, devient « indisponible », jamais zéro. */
export function retainedFailedPayments(value: unknown): FailedPaymentsSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as FailedPaymentsSnapshot;
  if (d.version !== 1 || d.source !== 'stripe_charges_read') return null;
  if (!entier(d.period_days) || d.period_days < 1 || d.period_days > 365) return null;
  for (const s of [d.window_start, d.observed_until]) {
    if (typeof s !== 'string' || !ISO.test(s) || new Date(s).toISOString() !== s) return null;
  }
  if (d.window_start >= d.observed_until) return null;
  if (![d.attempts, d.distinct_buyers, d.unrecovered_buyers, d.amount_attempted_minor].every(entier)) return null;
  // Un acheteur non rattrapé est un acheteur : il ne peut pas y en avoir plus.
  if (d.unrecovered_buyers > d.distinct_buyers) return null;
  // Chaque acheteur a au moins une tentative refusée.
  if (d.distinct_buyers > d.attempts) return null;
  if (!Array.isArray(d.latest) || d.latest.length > d.attempts) return null;
  if (d.by_reason === null || typeof d.by_reason !== 'object') return null;
  return d;
}

/** Un motif technique de Stripe, dit en français ordinaire. */
export function declineKey(reason: string | null): string {
  switch (reason) {
    case 'card_velocity_exceeded':
      return 'velocity';
    case 'partner_insufficient_funds':
    case 'insufficient_funds':
      return 'funds';
    case 'expired_card':
      return 'expired';
    case 'incorrect_cvc':
    case 'invalid_cvc':
      return 'cvc';
    case 'do_not_honor':
    case 'generic_decline':
      return 'generic';
    case 'fraudulent':
    case 'highest_risk_level':
    case 'elevated_risk_level':
      return 'risk';
    default:
      return 'other';
  }
}

/** Le jour d'une tentative, en UTC comme la fenêtre qui la contient. */
export function attemptDay(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
