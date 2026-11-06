/** Contrat des refus observés : une lecture incomplète ne devient jamais un zéro exhaustif. */
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
  recovered_at: string | null;
}
export interface FailedPaymentsSnapshot {
  version: 1;
  source: 'stripe_charges_read';
  scope: 'stripe_account';
  period_days: number;
  window_start: string;
  observed_until: string;
  read_at: string;
  attempts: number;
  distinct_buyers: number;
  unrecovered_buyers: number;
  attempts_without_email: number;
  amount_attempted_minor: number | null;
  currency: string | null;
  amounts_by_currency: Record<string, number>;
  unknown_amount_attempts: number;
  by_reason: Record<string, number>;
  latest: FailedAttempt[];
  coverage: { complete: boolean; reason: 'complete' | 'deadline' | 'page_limit' | 'stripe_error' | 'pagination_invalid'; pages_read: number; charges_read: number };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const entier = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const stamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const currency = (v: unknown): v is string => typeof v === 'string' && /^[a-z]{3}$/.test(v);
const nullableText = (v: unknown): boolean => v === null || typeof v === 'string';

/** Toutes les lignes sont contrôlées avant rendu ; aucune date impossible ne peut lever une exception. */
export function retainedFailedPayments(value: unknown): FailedPaymentsSnapshot | null {
  if (!object(value)) return null;
  const d = value;
  if (d.version !== 1 || d.source !== 'stripe_charges_read' || d.scope !== 'stripe_account') return null;
  if (!entier(d.period_days) || d.period_days < 1 || d.period_days > 365) return null;
  if (!stamp(d.window_start) || !stamp(d.observed_until) || !stamp(d.read_at)
    || Date.parse(d.observed_until) - Date.parse(d.window_start) !== d.period_days * 86400000
    || d.read_at < d.observed_until) return null;
  if (![d.attempts,d.distinct_buyers,d.unrecovered_buyers,d.attempts_without_email,d.unknown_amount_attempts].every(entier)) return null;
  const snapshot = d as unknown as FailedPaymentsSnapshot;
  if (snapshot.unrecovered_buyers > snapshot.distinct_buyers
    || snapshot.distinct_buyers > snapshot.attempts - snapshot.attempts_without_email
    || snapshot.unknown_amount_attempts > snapshot.attempts) return null;
  if (!object(d.by_reason) || Object.values(d.by_reason).some((n) => !entier(n))
    || Object.values(d.by_reason).reduce<number>((a,n) => a + (n as number),0) !== d.attempts) return null;
  if (!object(d.amounts_by_currency) || Object.entries(d.amounts_by_currency).some(([c,n]) => !currency(c) || !entier(n))) return null;
  const currencies = Object.keys(d.amounts_by_currency);
  if (d.currency === null) {
    if (d.amount_attempted_minor !== (d.attempts === 0 ? 0 : null)) return null;
  } else if (!currency(d.currency) || !entier(d.amount_attempted_minor) || currencies.length !== 1
    || d.amounts_by_currency[d.currency] !== d.amount_attempted_minor || d.unknown_amount_attempts !== 0) return null;
  if (currencies.length === 1 && d.unknown_amount_attempts === 0 && d.currency !== currencies[0]) return null;
  if (d.attempts === 0 && Object.values(d.amounts_by_currency).some((n) => n !== 0)) return null;
  const coverage = d.coverage;
  if (!object(coverage) || !entier(coverage.pages_read) || coverage.pages_read < 1 || !entier(coverage.charges_read)
    || coverage.charges_read < snapshot.attempts || coverage.charges_read > coverage.pages_read * 100
    || typeof coverage.reason !== 'string' || !['complete','deadline','page_limit','stripe_error','pagination_invalid'].includes(coverage.reason)
    || coverage.complete !== (coverage.reason === 'complete')) return null;
  if (!Array.isArray(d.latest) || d.latest.length !== Math.min(snapshot.attempts,20)) return null;
  let previous = d.observed_until;
  for (const row of d.latest) {
    if (!object(row) || !stamp(row.created_at) || row.created_at < d.window_start || row.created_at > previous
      || !nullableText(row.email) || !(row.amount_minor === null || entier(row.amount_minor))
      || !(row.currency === null || currency(row.currency)) || typeof row.recovered !== 'boolean'
      || !['decline_reason','decline_message','card_brand','card_last4','card_country'].every((key) => nullableText(row[key]))) return null;
    if (row.recovered) {
      if (!row.email || !stamp(row.recovered_at) || row.recovered_at <= row.created_at || row.recovered_at > d.observed_until) return null;
    } else if (row.recovered_at !== null) return null;
    previous = row.created_at;
  }
  return snapshot;
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
