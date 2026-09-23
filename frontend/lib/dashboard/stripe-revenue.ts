import { formatGrouped } from '@/lib/format-grouped';
import { toZurich } from '@/lib/crm/zurich';

/**
 * La tuile « Encaissé » : contrat de GET /v1/admin/stripe-revenue, sa
 * validation, et ce que la tuile affiche.
 *
 * Deux lectures possibles, jamais mélangées :
 *  - `stripe` : la source. Brut par nature et par devise, net et virements dans
 *    la devise du compte, heure de lecture ;
 *  - `derived` : quand Stripe ne répond pas, le total selon nos propres traces,
 *    en dollars seulement, annoncé « selon les clés, Stripe indisponible ».
 *
 * Aucune mise en forme par `Intl` : les montants passent par formatGrouped,
 * l'heure par toZurich (règle 8 du dépôt).
 */

export const REVENUE_KINDS = ['pack', 'abonnement', 'audit', 'autre'] as const;
export type RevenueKind = (typeof REVENUE_KINDS)[number];
export type MinorByCurrency = Record<string, number>;

export interface KindTotals {
  count: number;
  gross: MinorByCurrency;
  refunded: MinorByCurrency;
  fees: MinorByCurrency;
  net: MinorByCurrency;
  net_unknown: number;
  last_payment_at: string | null;
}

export interface StripeRevenueSnapshot {
  version: 1;
  read_at: string;
  livemode: boolean | null;
  by_kind: Record<RevenueKind, KindTotals>;
  total: KindTotals;
  classification: { invoices: boolean; sessions: boolean };
  payouts: {
    paid: { count: number; amount: MinorByCurrency; last_arrival_at: string | null };
    in_transit: { count: number; amount: MinorByCurrency };
  } | null;
  balance: { available: MinorByCurrency; pending: MinorByCurrency } | null;
  awaiting_payout: MinorByCurrency | null;
}

export interface DerivedRevenue {
  source: 'api_keys_and_ledgers';
  currency: 'usd';
  total_minor: number;
  by_kind: { pack: number; abonnement: number; audit: number };
  other_currency_payments: number;
  unusable_amount_payments: number;
  last_payment_at: string | null;
}

export interface StripeRevenuePayload {
  version: 1;
  source: 'stripe' | 'indisponible';
  reason: string | null;
  served_at: string;
  cache_ttl_seconds: number;
  stripe: StripeRevenueSnapshot | null;
  derived: DerivedRevenue;
}

// ---------------------------------------------------------------------------
// Validation : une réponse incohérente ne devient jamais un montant affiché
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isDate = (v: unknown): boolean => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isDateOrNull = (v: unknown): boolean => v === null || isDate(v);

function isMinorMap(v: unknown, nonNegative: boolean): v is MinorByCurrency {
  if (!isObject(v)) return false;
  return Object.entries(v).every(([currency, minor]) =>
    /^[a-z]{3}$/.test(currency) && typeof minor === 'number' && Number.isSafeInteger(minor)
    && (!nonNegative || minor >= 0));
}

function isKindTotals(v: unknown): v is KindTotals {
  return isObject(v) && isCount(v.count) && isMinorMap(v.gross, true) && isMinorMap(v.refunded, true)
    && isMinorMap(v.fees, false) && isMinorMap(v.net, false) && isCount(v.net_unknown)
    && isDateOrNull(v.last_payment_at);
}

function isSnapshot(v: unknown): v is StripeRevenueSnapshot {
  if (!isObject(v) || v.version !== 1 || !isDate(v.read_at)) return false;
  if (!(v.livemode === null || typeof v.livemode === 'boolean')) return false;
  if (!isObject(v.by_kind) || !REVENUE_KINDS.every((k) => isKindTotals((v.by_kind as Record<string, unknown>)[k]))) return false;
  if (!isKindTotals(v.total)) return false;
  const byKind = v.by_kind as Record<RevenueKind, KindTotals>;
  if (REVENUE_KINDS.reduce((sum, k) => sum + byKind[k].count, 0) !== v.total.count) return false;
  if (!isObject(v.classification) || typeof v.classification.invoices !== 'boolean'
    || typeof v.classification.sessions !== 'boolean') return false;
  if (v.payouts !== null) {
    const p = v.payouts;
    if (!isObject(p) || !isObject(p.paid) || !isObject(p.in_transit)) return false;
    if (!isCount(p.paid.count) || !isMinorMap(p.paid.amount, false) || !isDateOrNull(p.paid.last_arrival_at)) return false;
    if (!isCount(p.in_transit.count) || !isMinorMap(p.in_transit.amount, false)) return false;
  }
  if (v.balance !== null && (!isObject(v.balance) || !isMinorMap(v.balance.available, false)
    || !isMinorMap(v.balance.pending, false))) return false;
  return v.awaiting_payout === null || isMinorMap(v.awaiting_payout, false);
}

function isDerived(v: unknown): v is DerivedRevenue {
  if (!isObject(v) || v.source !== 'api_keys_and_ledgers' || v.currency !== 'usd') return false;
  if (!isObject(v.by_kind)) return false;
  const { pack, abonnement, audit } = v.by_kind;
  if (![pack, abonnement, audit, v.total_minor].every(isCount)) return false;
  if ((pack as number) + (abonnement as number) + (audit as number) !== v.total_minor) return false;
  return isCount(v.other_currency_payments) && isCount(v.unusable_amount_payments)
    && isDateOrNull(v.last_payment_at);
}

/** La réponse de l'API, ou null si elle n'est pas exactement ce contrat. */
export function readStripeRevenuePayload(value: unknown): StripeRevenuePayload | null {
  if (!isObject(value) || value.version !== 1) return null;
  if (value.source !== 'stripe' && value.source !== 'indisponible') return null;
  if (!isDerived(value.derived)) return null;
  if (value.source === 'stripe' ? !isSnapshot(value.stripe) : value.stripe !== null) return null;
  return value as unknown as StripeRevenuePayload;
}

// ---------------------------------------------------------------------------
// Ce que la tuile affiche
// ---------------------------------------------------------------------------

/** Les devises sans décimales chez Stripe ; toutes les autres en ont deux. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

function amountOf(minor: number, currency: string, locale: string): string {
  const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
  return formatGrouped(minor / 10 ** decimals, locale, decimals);
}

/** Le dollar d'abord, le franc ensuite, le reste par ordre alphabétique. */
function currencies(map: MinorByCurrency): string[] {
  const rank = (c: string) => (c === 'usd' ? 0 : c === 'chf' ? 1 : 2);
  return Object.keys(map).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Une somme par devise, jamais additionnée d'une devise à l'autre :
 * « 216,00 USD + 12,00 EUR ». `bare` retire le code quand la seule devise est
 * celle du titre, pour ne pas le répéter à chaque ligne. Une somme nulle garde
 * sa devise si on la connaît (`fallback` sinon), et ne s'invente pas le dollar.
 */
export function formatMinorMap(
  map: MinorByCurrency,
  locale: string,
  opts: { bare?: string; fallback?: string | null } = {},
): string {
  const keys = currencies(map);
  const list = keys.filter((c) => map[c] !== 0);
  if (list.length === 0) {
    const c = opts.bare ?? keys[0] ?? opts.fallback ?? null;
    if (!c) return '0';
    return c === opts.bare ? amountOf(0, c, locale) : `${amountOf(0, c, locale)} ${c.toUpperCase()}`;
  }
  if (opts.bare && list.length === 1 && list[0] === opts.bare) return amountOf(map[opts.bare], opts.bare, locale);
  return list.map((c) => `${amountOf(map[c], c, locale)} ${c.toUpperCase()}`).join(' + ');
}

function hasAmount(map: MinorByCurrency | null | undefined): boolean {
  return !!map && Object.values(map).some((v) => v !== 0);
}

export interface CollectedView {
  mode: 'stripe' | 'derived';
  /** Le total brut : « 216,00 USD », ou par devise quand il y en a plusieurs. */
  headline: string;
  /** Packs, abonnements et audits toujours ; « autre » seulement s'il existe, signalé. */
  kinds: Array<{ kind: RevenueKind; amount: string; alert: boolean }>;
  net: string | null;
  paidOut: string | null;
  awaiting: string | null;
  /** Heure suisse de la lecture Stripe, « AAAA-MM-JJ HH:MM ». */
  readAt: string | null;
  refunded: string | null;
  /** Le classement a manqué une lecture : une partie des paiements est dans « autre ». */
  partial: boolean;
  netUnknown: number;
  testMode: boolean;
  /** Repli : paiements hors total (autre devise ou montant absent). */
  excluded: number;
}

/** La vue de la tuile, depuis un contrat déjà validé. */
export function collectedView(payload: StripeRevenuePayload, locale: string): CollectedView {
  const stripe = payload.source === 'stripe' ? payload.stripe : null;
  if (!stripe) {
    const d = payload.derived;
    const usd = (minor: number) => formatMinorMap({ usd: minor }, locale, { bare: 'usd' });
    return {
      mode: 'derived',
      headline: formatMinorMap({ usd: d.total_minor }, locale),
      kinds: [
        { kind: 'pack', amount: usd(d.by_kind.pack), alert: false },
        { kind: 'abonnement', amount: usd(d.by_kind.abonnement), alert: false },
        { kind: 'audit', amount: usd(d.by_kind.audit), alert: false },
      ],
      net: null,
      paidOut: null,
      awaiting: null,
      readAt: null,
      refunded: null,
      partial: false,
      netUnknown: 0,
      testMode: false,
      excluded: d.other_currency_payments + d.unusable_amount_payments,
    };
  }

  const gross = stripe.total.gross;
  const grossCurrencies = currencies(gross).filter((c) => gross[c] !== 0);
  // Une seule devise dans le total : les lignes de détail la sous-entendent.
  const bare = grossCurrencies.length <= 1 ? (grossCurrencies[0] ?? 'usd') : undefined;
  const kinds = REVENUE_KINDS
    .filter((k) => k !== 'autre' || stripe.by_kind.autre.count > 0)
    .map((k) => ({ kind: k, amount: formatMinorMap(stripe.by_kind[k].gross, locale, { bare }), alert: k === 'autre' }));
  // La devise de règlement du compte, lue et jamais supposée.
  const settlement = currencies(stripe.total.net)[0]
    ?? currencies(stripe.balance?.available ?? {})[0]
    ?? currencies(stripe.balance?.pending ?? {})[0]
    ?? null;
  const paid = stripe.payouts?.paid.amount ?? null;
  const zurich = toZurich(stripe.read_at);
  return {
    mode: 'stripe',
    headline: formatMinorMap(gross, locale, { fallback: 'usd' }),
    kinds,
    net: hasAmount(stripe.total.net) ? formatMinorMap(stripe.total.net, locale) : null,
    paidOut: paid ? formatMinorMap(paid, locale, { fallback: settlement }) : null,
    awaiting: stripe.awaiting_payout ? formatMinorMap(stripe.awaiting_payout, locale, { fallback: settlement }) : null,
    readAt: zurich === stripe.read_at ? null : zurich.slice(0, 16).replace('T', ' '),
    refunded: hasAmount(stripe.total.refunded) ? formatMinorMap(stripe.total.refunded, locale) : null,
    partial: !stripe.classification.invoices || !stripe.classification.sessions,
    netUnknown: stripe.total.net_unknown,
    testMode: stripe.livemode === false,
    excluded: 0,
  };
}
