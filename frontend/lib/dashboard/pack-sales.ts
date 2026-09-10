import { formatGrouped } from '@/lib/format-grouped';

/** Contrat de lecture : références conservées, sans rapprochement de factures ni de transferts. */
export interface PackSalesSnapshot {
  version: 1;
  source: 'retained_api_keys_payment_metadata';
  scope: 'all_retained_credit_keys';
  generated_at: string;
  stripe: {
    groups: number;
    usd_amount_minor: number | null;
    usd_known_groups: number;
    usd_zero_groups: number;
    amount_missing_groups: number;
    other_currency_groups: number;
    invalid_amount_groups: number;
    conflicting_groups: number;
    first_key_created_at: string | null;
    last_key_created_at: string | null;
  };
  x402: {
    distinct_references: number;
    settlement_status: 'not_reconciled';
    confirmed_amount_usdc: null;
  };
  unattributed_credit_keys: number;
  granted_credit_keys: number;
  excluded_internal_credit_keys: number;
  duplicate_reference_rows: number;
  ambiguous_rail_keys: number;
}

/** Une API plus ancienne ou un total catalogue ne deviennent pas un montant confirmé. */
export function retainedPackSales(value: unknown): PackSalesSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as PackSalesSnapshot;
  if (data?.version !== 1 || data.source !== 'retained_api_keys_payment_metadata'
    || data.scope !== 'all_retained_credit_keys' || !data.stripe || !data.x402) return null;
  if (typeof data.generated_at !== 'string' || !Number.isFinite(Date.parse(data.generated_at))
    || data.x402.settlement_status !== 'not_reconciled' || data.x402.confirmed_amount_usdc !== null) return null;
  const counts = [data.stripe.groups, data.stripe.usd_known_groups, data.stripe.usd_zero_groups,
    data.stripe.amount_missing_groups, data.stripe.other_currency_groups, data.stripe.invalid_amount_groups,
    data.stripe.conflicting_groups, data.x402.distinct_references, data.unattributed_credit_keys,
    data.granted_credit_keys, data.excluded_internal_credit_keys, data.duplicate_reference_rows, data.ambiguous_rail_keys];
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  const stripe = data.stripe;
  if (stripe.groups !== stripe.usd_known_groups + stripe.amount_missing_groups + stripe.other_currency_groups
    + stripe.invalid_amount_groups + stripe.conflicting_groups || stripe.usd_zero_groups > stripe.usd_known_groups) return null;
  const amount = data.stripe.usd_amount_minor;
  if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) return null;
  if ((amount === null) !== (stripe.usd_known_groups === 0)) return null;
  return data;
}

/** La tuile et le détail partagent la même valeur, le même format et le même instant de lecture. */
export function packUsdLabel(data: PackSalesSnapshot | null, locale: string): string {
  const amount = data?.stripe.usd_amount_minor;
  return amount == null ? '—' : `${formatGrouped(amount / 100, locale, 2)} USD`;
}
