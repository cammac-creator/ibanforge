import { isInternal } from './lifecycle-radar.js';
import { isInternalEmail } from './internal-accounts.js';
import type { PackKeyRow } from './business-summary.js';

export interface PackSalesSummary {
  version: 1;
  source: 'retained_api_keys_payment_metadata';
  generated_at: string;
  scope: 'all_retained_credit_keys';
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

function reference(value: string | null): string | null {
  return value?.trim() || null;
}

function ambiguous(row: PackKeyRow): boolean {
  return !!reference(row.stripe_session_id) && !!reference(row.x402_payment_ref);
}

function internal(email: string): boolean {
  // Les acheteurs sans adresse sont cachés du CRM, mais leurs paiements restent réels.
  const normalized = email.trim().toLowerCase();
  if (normalized === 'stripe-buyer' || normalized === 'credits-buyer') return false;
  return isInternal(email) || isInternalEmail(email);
}

function groupBy(rows: PackKeyRow[], field: 'stripe_session_id' | 'x402_payment_ref') {
  const groups = new Map<string, PackKeyRow[]>();
  for (const row of rows) {
    const id = reference(row[field]);
    if (!id) continue;
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  return [...groups.values()];
}

function excluded(group: PackKeyRow[]): boolean {
  // Une copie non marquée ne transforme pas un cadeau ou un test en vente.
  return group.some((row) => internal(row.email) || !!row.issued_by_us);
}

function firstCreatedAt(group: PackKeyRow[]): string | null {
  const dates = group.flatMap((row) => {
    if (!row.created_at) return [];
    const value = row.created_at.replace(' ', 'T');
    const time = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
    return Number.isFinite(time) ? [new Date(time).toISOString()] : [];
  });
  return dates.sort()[0] ?? null;
}

/**
 * Montants déclarés par Stripe dans les lignes conservées, jamais prix catalogue.
 * Les références x402 identifient des demandes, pas un règlement confirmé.
 * Sans référence, une clé peut être ancienne, offerte ou remplacée : aucune vente déduite.
 */
export function summarizePackSales(rows: PackKeyRow[], now = new Date()): PackSalesSummary {
  const credits = rows.filter((row) => (row.credits_total ?? 0) > 0);
  const stripeGroups = groupBy(credits, 'stripe_session_id');
  const x402Groups = groupBy(credits, 'x402_payment_ref');
  const out: PackSalesSummary = {
    version: 1,
    source: 'retained_api_keys_payment_metadata',
    generated_at: now.toISOString(),
    scope: 'all_retained_credit_keys',
    stripe: {
      groups: 0,
      usd_amount_minor: null,
      usd_known_groups: 0,
      usd_zero_groups: 0,
      amount_missing_groups: 0,
      other_currency_groups: 0,
      invalid_amount_groups: 0,
      conflicting_groups: 0,
      first_key_created_at: null,
      last_key_created_at: null,
    },
    x402: {
      distinct_references: 0,
      settlement_status: 'not_reconciled',
      confirmed_amount_usdc: null,
    },
    unattributed_credit_keys: 0,
    granted_credit_keys: 0,
    excluded_internal_credit_keys: 0,
    duplicate_reference_rows: 0,
    ambiguous_rail_keys: 0,
  };
  for (const row of credits) {
    if (internal(row.email)) out.excluded_internal_credit_keys++;
    else if (row.issued_by_us) out.granted_credit_keys++;
    else if (ambiguous(row)) out.ambiguous_rail_keys++;
    else if (!reference(row.stripe_session_id) && !reference(row.x402_payment_ref)) {
      out.unattributed_credit_keys++;
    }
  }
  // Les lignes à deux références sont signalées à part, sans compter deux fois un doublon.
  for (const group of [...stripeGroups, ...x402Groups]) {
    out.duplicate_reference_rows += Math.max(0, group.filter((row) => !ambiguous(row)).length - 1);
  }
  out.x402.distinct_references = x402Groups.filter((group) => !excluded(group)).length;

  for (const group of stripeGroups) {
    if (excluded(group)) continue;
    out.stripe.groups++;
    // Date de la clé d'origine du groupe ; ce n'est pas un horodatage du paiement.
    const createdAt = firstCreatedAt(group);
    if (createdAt) {
      if (!out.stripe.first_key_created_at || createdAt < out.stripe.first_key_created_at) {
        out.stripe.first_key_created_at = createdAt;
      }
      if (!out.stripe.last_key_created_at || createdAt > out.stripe.last_key_created_at) {
        out.stripe.last_key_created_at = createdAt;
      }
    }
    const amounts = new Map<string, { minor: number; currency: string }>();
    const knownMinors = new Set<number>();
    const knownCurrencies = new Set<string>();
    let invalid = false;
    for (const row of group) {
      const minor = row.amount_paid_minor;
      const currency = row.amount_paid_currency?.trim().toLowerCase();
      if (minor != null && (!Number.isSafeInteger(minor) || minor < 0)) invalid = true;
      if (currency && !/^[a-z]{3}$/.test(currency)) invalid = true;
      if (minor != null && Number.isSafeInteger(minor) && minor >= 0) knownMinors.add(minor);
      if (currency && /^[a-z]{3}$/.test(currency)) knownCurrencies.add(currency);
      if (minor == null || !currency) continue;
      if (Number.isSafeInteger(minor) && minor >= 0 && /^[a-z]{3}$/.test(currency)) {
        amounts.set(`${currency}:${minor}`, { minor, currency });
      }
    }
    if (group.some(ambiguous) || knownMinors.size > 1 || knownCurrencies.size > 1) {
      out.stripe.conflicting_groups++;
    } else if (invalid) out.stripe.invalid_amount_groups++;
    else if (!amounts.size) out.stripe.amount_missing_groups++;
    else {
      const amount = [...amounts.values()][0];
      if (amount.currency !== 'usd') out.stripe.other_currency_groups++;
      else {
        const sum = (out.stripe.usd_amount_minor ?? 0) + amount.minor;
        if (!Number.isSafeInteger(sum))
          throw new RangeError('Pack USD total exceeds safe integer range');
        out.stripe.usd_amount_minor = sum;
        out.stripe.usd_known_groups++;
        if (amount.minor === 0) out.stripe.usd_zero_groups++;
      }
    }
  }
  return out;
}
