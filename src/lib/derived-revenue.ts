/**
 * L'argent encaissé selon nos propres traces : le repli quand Stripe ne répond
 * pas.
 *
 * Trois registres, chacun avec ses règles déjà écrites ailleurs :
 *
 *  - packs : les montants Stripe conservés sur les clés à crédits, une fois par
 *    référence, sans prix catalogue (summarizePackSales, la lecture que la
 *    tuile affichait jusqu'ici) ;
 *  - abonnements : premier paiement sur la clé, renouvellements dans
 *    `subscription_payments` (subscriptionsSold), avec la MÊME règle interne
 *    que les packs, pour que les deux parts parlent de la même population ;
 *  - audits de fichier : `audit_sales`, le registre durable des audits payés.
 *
 * USD seulement dans le total. Un montant dans une autre devise (les audits
 * vendus en francs avant le passage au dollar) est compté à part, jamais
 * converti ; un montant absent n'est jamais remplacé par un tarif. Ce total
 * est donc un plancher honnête, et la tuile le présente comme tel : « selon
 * les clés », jamais comme la lecture de Stripe.
 */
import { getStatsDB } from './db.js';
import {
  isInternalBuyer,
  readPackSaleRows,
  summarizePackSales,
  type PackSalesSummary,
} from './pack-sales.js';
import {
  readSubscriptionRows,
  subscriptionsSold,
  type SubscriptionsSold,
} from './subscription-payments.js';

type Db = ReturnType<typeof getStatsDB>;

export interface AuditLedgerTotals {
  usd_minor: number;
  other_currency_payments: number;
  unusable_amount_payments: number;
  /** Au format SQLite UTC. */
  last_paid_at: string | null;
}

export interface DerivedRevenue {
  source: 'api_keys_and_ledgers';
  currency: 'usd';
  /** Packs + abonnements + audits, en cents USD. */
  total_minor: number;
  by_kind: { pack: number; abonnement: number; audit: number };
  /** Paiements connus dans une autre devise : hors total, jamais convertis. */
  other_currency_payments: number;
  /** Paiements sans montant exploitable (absent, invalide, contradictoire) : hors total. */
  unusable_amount_payments: number;
  last_payment_at: string | null;
}

/** Une date SQLite ('YYYY-MM-DD HH:MM:SS', UTC) ou ISO, rendue en ISO. */
export function toIsoUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function latest(dates: Array<string | null>): string | null {
  const iso = dates.map(toIsoUtc).filter((d): d is string => !!d);
  iso.sort();
  return iso[iso.length - 1] ?? null;
}

export function buildDerivedRevenue(parts: {
  packs: PackSalesSummary;
  subscriptions: SubscriptionsSold;
  audits: AuditLedgerTotals;
}): DerivedRevenue {
  const { packs, subscriptions, audits } = parts;
  const byKind = {
    pack: packs.stripe.usd_amount_minor ?? 0,
    abonnement: subscriptions.usd_minor,
    audit: audits.usd_minor,
  };
  const total = byKind.pack + byKind.abonnement + byKind.audit;
  if (!Number.isSafeInteger(total)) throw new RangeError('Derived USD total exceeds safe range');
  return {
    source: 'api_keys_and_ledgers',
    currency: 'usd',
    total_minor: total,
    by_kind: byKind,
    other_currency_payments:
      packs.stripe.other_currency_groups +
      subscriptions.other_currency_payments +
      audits.other_currency_payments,
    unusable_amount_payments:
      packs.stripe.amount_missing_groups +
      packs.stripe.invalid_amount_groups +
      packs.stripe.conflicting_groups +
      subscriptions.first_payments_amount_missing +
      subscriptions.renewals_amount_missing +
      audits.unusable_amount_payments,
    last_payment_at: latest([
      packs.stripe.last_key_created_at,
      subscriptions.last_payment_at,
      audits.last_paid_at,
    ]),
  };
}

/** Les audits payés, tous temps, par devise ; même validation que audit-jobs.ts. */
export function readAuditLedger(db: Db = getStatsDB()): AuditLedgerTotals {
  const row = db
    .prepare(
      `WITH measured AS (
         SELECT paid_at, amount_paid_minor, lower(trim(amount_paid_currency)) currency,
                (typeof(amount_paid_minor) = 'integer' AND amount_paid_minor >= 0
                 AND lower(trim(amount_paid_currency)) GLOB '[a-z][a-z][a-z]') valid_amount
           FROM audit_sales
       )
       SELECT COALESCE(SUM(CASE WHEN valid_amount AND currency = 'usd' THEN amount_paid_minor END), 0) usd_minor,
              COUNT(CASE WHEN valid_amount AND currency <> 'usd' THEN 1 END) other_currency,
              COUNT(CASE WHEN NOT valid_amount THEN 1 END) unusable,
              MAX(paid_at) last_paid_at
         FROM measured`,
    )
    .get() as {
    usd_minor: number;
    other_currency: number;
    unusable: number;
    last_paid_at: string | null;
  };
  return {
    usd_minor: row.usd_minor,
    other_currency_payments: row.other_currency,
    unusable_amount_payments: row.unusable,
    last_paid_at: row.last_paid_at,
  };
}

export function readDerivedRevenue(db: Db = getStatsDB(), now = new Date()): DerivedRevenue {
  // Les mêmes lignes que /v1/admin/pack-sales : une par achat, au registre
  // (lot B1) ; une recharge y est une vente, une rotation n'y double rien.
  return buildDerivedRevenue({
    packs: summarizePackSales(readPackSaleRows(db), now),
    subscriptions: subscriptionsSold(readSubscriptionRows(db), isInternalBuyer),
    audits: readAuditLedger(db),
  });
}
