/**
 * Business summary — the numbers the weekly market-watch was missing.
 *
 * Pure, side-effect-free aggregation so it can be unit-tested; the SQL and the
 * auth live in src/routes/admin-business.ts.
 *
 * WHY THIS EXISTS
 *
 * The veille used to receive two inputs: request counters, and an open-web
 * search. With those ingredients it can only ever propose more visibility —
 * and visibility is essentially done while conversion is not. Everything here
 * is the other half: who bought, whether they ever used what they bought, who
 * uses the product every month without paying, and how concentrated a weekly
 * total really is.
 *
 * 🚨 WHAT MAY LEAVE THIS PROCESS
 *
 * The weekly report is composed in CI, so anything this returns transits an
 * external runner. The daily lifecycle radar was deliberately moved INTO the
 * API process so the full customer ledger would stop doing exactly that (see
 * lifecycle-radar-server.ts). This endpoint therefore emits **aggregates and
 * masked labels only** — key prefix and email domain, the same class the radar
 * already sends to Telegram. Never an email address, never a full ledger row.
 * Do not loosen this to "just add the email, it's easier to read".
 */
import { DEFAULT_MONTHLY_LIMIT, emailDomain, isInternal } from './lifecycle-radar.js';

// ---------------------------------------------------------------------------
// Inputs (plain rows, so tests need no database)
// ---------------------------------------------------------------------------

export interface BusinessKeyRow {
  key_prefix: string;
  email: string;
  monthly_limit: number | null;
  credits_total: number | null;
  credits_remaining: number | null;
  /**
   * What the card processor actually reported, in minor units, with its
   * currency. NULL on every row minted before this was recorded, and on any
   * payment the processor did not price for us.
   */
  amount_paid_minor: number | null;
  amount_paid_currency: string | null;
  /** Calls billed this calendar month. */
  used: number;
  used_all_time: number;
  /** Last 6 calendar months, oldest first. */
  series: number[];
}

export interface TrafficTotals {
  total: number;
  s402: number;
  s4xx: number;
  s5xx: number;
}

export interface PathCount {
  path: string;
  count: number;
}

export interface ClientCall {
  key_prefix: string;
  calls: number;
  active_days: number;
}

// ---------------------------------------------------------------------------
// Credit packs
// ---------------------------------------------------------------------------

/**
 * Pack sizes and their price, mirroring BUNDLES in src/routes/api-keys.ts.
 *
 * Duplicated rather than imported because a lib importing a route inverts the
 * dependency direction for one constant. A test asserts the two tables are
 * identical, so a price change cannot silently make this report lie.
 */
export const CREDIT_PACK_USD: Record<number, number> = {
  1000: 5,
  5000: 20,
  25000: 80,
};

/**
 * Dollars for a pack. Unknown sizes (a hand-granted pack, a future bundle)
 * are priced pro rata on the nearest known tier rather than dropped: a
 * customer missing from the revenue line is a worse error than an approximate
 * one, and the caller is told how many were estimated.
 */
export function creditPackUsd(credits: number): { usd: number; exact: boolean } {
  const known = CREDIT_PACK_USD[credits];
  if (known != null) return { usd: known, exact: true };
  const tiers = Object.keys(CREDIT_PACK_USD)
    .map(Number)
    .sort((a, b) => a - b);
  const nearest = tiers.reduce((best, t) =>
    Math.abs(t - credits) < Math.abs(best - credits) ? t : best,
  );
  const rate = CREDIT_PACK_USD[nearest] / nearest;
  return { usd: Math.round(credits * rate * 100) / 100, exact: false };
}

/** Where a dollar figure came from, so a deduction is never read as a receipt. */
export type AmountSource = 'measured' | 'deduced';

/**
 * Dollars for one account, preferring what was actually charged.
 *
 * The price table above is a DEDUCTION: it answers "what does this pack cost
 * today", not "what did this customer pay". Any price change, discount or
 * partial refund makes it wrong retroactively, across the whole history, with
 * nothing to show that it went wrong. So a stored amount always wins, and the
 * fallback says out loud that it is a fallback.
 *
 * Only a USD amount counts as measured. Converting another currency here would
 * mean inventing a rate and a date, which is the same class of error the stored
 * column exists to end.
 */
export function accountUsd(k: {
  credits_total: number | null;
  amount_paid_minor: number | null;
  amount_paid_currency: string | null;
}): { usd: number; source: AmountSource; exact: boolean } {
  if (k.amount_paid_minor != null && (k.amount_paid_currency ?? '').toLowerCase() === 'usd') {
    return { usd: Math.round(k.amount_paid_minor) / 100, source: 'measured', exact: true };
  }
  const deduced = creditPackUsd(k.credits_total ?? 0);
  return { usd: deduced.usd, source: 'deduced', exact: deduced.exact };
}

// ---------------------------------------------------------------------------
// Traffic classification
// ---------------------------------------------------------------------------

/**
 * Paths that answer a catalog, not a customer. Roughly half of all traffic is
 * robots reading our own descriptions, which is what four months of work on
 * discovery was FOR — reporting it mixed in with API calls hides both.
 */
const DISCOVERY_PATHS = new Set([
  '/mcp',
  '/.well-known/x402',
  '/.well-known/ai-plugin.json',
  '/openapi.json',
  '/llms.txt',
  '/robots.txt',
  '/',
]);

export function isDiscoveryPath(path: string): boolean {
  return DISCOVERY_PATHS.has(path) || path.startsWith('/.well-known/');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Buyers who paid without ever giving an address: an agent that bought a pack
 * over x402, or a Stripe checkout with no address captured. `emailDomain`
 * returns '' for these, and a blank domain in a report reads as a bug.
 *
 * 🚨 They are COUNTED AS CUSTOMERS here, which is deliberately not what
 * src/lib/internal-accounts.ts does — its regex folds `credits-buyer` and
 * `stripe-buyer` into the internal bucket. Both are right for their own job:
 * the CRM is a contact tool, and an account with no address is nothing it can
 * act on; this is a revenue report, and no address is not no money. On an
 * agent-native API an anonymous paying agent is the customer we are betting
 * on, so erasing it from the revenue line would hide the only evidence the bet
 * is working.
 */
const ANONYMOUS_BUYERS: Record<string, string> = {
  'credits-buyer': 'anonyme (x402)',
  'stripe-buyer': 'anonyme (Stripe)',
  'oem-subscriber': 'anonyme (OEM)',
};

function accountLabel(email: string): string {
  const anon = ANONYMOUS_BUYERS[email.trim().toLowerCase()];
  if (anon) return anon;
  return emailDomain(email) || 'sans domaine';
}

/** How many paying accounts the payload lists before it starts counting instead. */
export const MAX_LISTED_ACCOUNTS = 12;

/**
 * Floor for "regular user". Two calls spread over two months is not a habit,
 * and a list that calls it one buries the accounts that are. Seen on the first
 * production run: a key with a couple of lifetime calls sat in the same list
 * as one with hundreds.
 */
export const STEADY_MIN_CALLS = 10;

export interface CreditAccount {
  key_prefix: string;
  domain: string;
  sold: number;
  consumed: number;
  pct: number;
  usd: number;
  /** 'deduced' means the price table answered, not the processor. */
  amount_source: AmountSource;
}

export interface SteadyUnpaid {
  key_prefix: string;
  domain: string;
  months_active: number;
  used_this_month: number;
  used_all_time: number;
  series: number[];
}

export interface BusinessSummary {
  window_days: number;
  credits: {
    sold_credits: number;
    sold_usd: number;
    /** A pack size the price table does not know, priced pro rata. */
    sold_usd_is_estimate: boolean;
    /** Paying accounts whose dollars came from the table, not the processor. */
    sold_usd_deduced_accounts: number;
    consumed_credits: number;
    consumption_pct: number;
    paying_accounts: number;
    /** Paying accounts that consumed under 5% of what they bought. */
    idle_accounts: number;
    accounts: CreditAccount[];
    /** Paying accounts beyond MAX_LISTED_ACCOUNTS. Never truncate in silence. */
    accounts_omitted: number;
  };
  keys: {
    total: number;
    external: number;
    never_called: number;
    active_this_month: number;
    at_cap_this_month: number;
  };
  steady_unpaid: SteadyUnpaid[];
  steady_unpaid_omitted: number;
  clients: {
    distinct: number;
    active_days: number;
    /** Share of windowed calls made by the single busiest key, in percent. */
    top_share_pct: number;
  };
  traffic: {
    total: number;
    payment_required: number;
    errors: number;
    error_pct: number;
    discovery: number;
    discovery_pct: number;
  };
}

/** A paying account is one that was granted a credit pack, however it paid. */
function isPaying(k: BusinessKeyRow): boolean {
  return (k.credits_total ?? 0) > 0;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function buildBusinessSummary(input: {
  keys: BusinessKeyRow[];
  traffic: TrafficTotals;
  paths: PathCount[];
  clients: ClientCall[];
  windowDays: number;
}): BusinessSummary {
  const { traffic, paths, clients, windowDays } = input;
  const external = input.keys.filter((k) => !isInternal(k.email));

  // --- credits ------------------------------------------------------------
  const paying = external.filter(isPaying);
  let soldCredits = 0;
  let soldUsd = 0;
  let estimated = false;
  let deducedAccounts = 0;
  const accounts: CreditAccount[] = [];
  for (const k of paying) {
    const sold = k.credits_total ?? 0;
    const consumed = Math.max(sold - (k.credits_remaining ?? sold), 0);
    const price = accountUsd(k);
    soldCredits += sold;
    soldUsd += price.usd;
    // Kept meaning exactly what it meant before: a pack size the price table
    // does not know, priced pro rata. It is NOT the same statement as "this
    // figure came from the table rather than the processor", which is counted
    // separately — collapsing the two would lose the distinction this column
    // was added to create.
    if (!price.exact) estimated = true;
    if (price.source === 'deduced') deducedAccounts++;
    accounts.push({
      key_prefix: k.key_prefix,
      domain: accountLabel(k.email),
      sold,
      consumed,
      pct: pct(consumed, sold),
      usd: price.usd,
      amount_source: price.source,
    });
  }
  accounts.sort((a, b) => b.sold - a.sold);
  // Totals are computed over EVERY paying account; only the printed list is
  // capped. Capping first would silently shrink the revenue line.
  const consumedCredits = accounts.reduce((t, a) => t + a.consumed, 0);
  const idleAccounts = accounts.filter((a) => a.pct < 5).length;
  const listedAccounts = accounts.slice(0, MAX_LISTED_ACCOUNTS);

  // --- keys ---------------------------------------------------------------
  const atCap = external.filter((k) => {
    if (isPaying(k)) return false; // a credit key is not held by the monthly quota
    const limit = k.monthly_limit ?? DEFAULT_MONTHLY_LIMIT;
    return limit > 0 && k.used >= limit;
  }).length;

  // --- steady unpaid ------------------------------------------------------
  //
  // The daily radar reports TRANSITIONS: quota crossed, pack bought and left
  // idle, account gone quiet. Someone who calls every month, never pays, and
  // never reaches the cap crosses nothing, so the radar is silent on precisely
  // the most engaged unpaid user in the base. This is the standing view that
  // fills that hole.
  const steady: SteadyUnpaid[] = external
    .filter((k) => !isPaying(k))
    .map((k) => {
      const series = k.series ?? [];
      const recent = series.slice(-2);
      return {
        key_prefix: k.key_prefix,
        domain: accountLabel(k.email),
        months_active: series.filter((n) => n > 0).length,
        used_this_month: k.used,
        used_all_time: k.used_all_time,
        series,
        _live: recent.some((n) => n > 0),
      };
    })
    .filter((s) => s.months_active >= 2 && s._live && s.used_all_time >= STEADY_MIN_CALLS)
    .map(({ _live, ...s }) => s)
    .sort((a, b) => b.used_all_time - a.used_all_time);

  // --- traffic ------------------------------------------------------------
  //
  // 402 is a 4xx, and a 402 is the paywall answering an anonymous probe: the
  // product working, not a fault. Folding it into "errors" both frightens and
  // hides — it buried a 5xx rate worth being proud of.
  const errors = Math.max(traffic.s4xx - traffic.s402, 0) + traffic.s5xx;
  const discovery = paths.filter((p) => isDiscoveryPath(p.path)).reduce((t, p) => t + p.count, 0);

  const windowedCalls = clients.reduce((t, c) => t + c.calls, 0);
  const busiest = clients.reduce((m, c) => Math.max(m, c.calls), 0);

  return {
    window_days: windowDays,
    credits: {
      sold_credits: soldCredits,
      sold_usd: Math.round(soldUsd * 100) / 100,
      sold_usd_is_estimate: estimated,
      // How many of the paying accounts contributed a figure the price table
      // produced rather than the processor. Every historical row is one, since
      // nothing was stored before; it should fall toward zero as new payments
      // land, and a rise means the write path stopped working.
      sold_usd_deduced_accounts: deducedAccounts,
      consumed_credits: consumedCredits,
      consumption_pct: pct(consumedCredits, soldCredits),
      paying_accounts: paying.length,
      idle_accounts: idleAccounts,
      accounts: listedAccounts,
      accounts_omitted: accounts.length - listedAccounts.length,
    },
    keys: {
      total: input.keys.length,
      external: external.length,
      never_called: external.filter((k) => k.used_all_time <= 0).length,
      active_this_month: external.filter((k) => k.used > 0).length,
      at_cap_this_month: atCap,
    },
    steady_unpaid: steady.slice(0, MAX_LISTED_ACCOUNTS),
    steady_unpaid_omitted: Math.max(steady.length - MAX_LISTED_ACCOUNTS, 0),
    clients: {
      distinct: clients.length,
      active_days: clients.reduce((m, c) => Math.max(m, c.active_days), 0),
      top_share_pct: pct(busiest, windowedCalls),
    },
    traffic: {
      total: traffic.total,
      payment_required: traffic.s402,
      errors,
      error_pct: pct(errors, traffic.total),
      discovery,
      discovery_pct: pct(discovery, traffic.total),
    },
  };
}

// ---------------------------------------------------------------------------
// Packs sold, by rail — DASH-01 / DASH-02 (audit 2026-09-01)
// ---------------------------------------------------------------------------

/**
 * 🚨 Why this exists.
 *
 * The dashboard's revenue card had two halves and both of them lied. The USDC
 * half showed a wallet BALANCE (a figure that goes DOWN when we spend) beside a
 * "total received" that mixes our own test payments in; the card half showed an
 * em dash hard-coded in the JSX and a "Non configuré" badge, while five credit
 * packs had been sold, one of them on 2026-08-27 with no matching USDC line in
 * daily_stats — i.e. paid by card, by the rail the page said did not exist.
 * Meanwhile the headline KPI read "$0.2590 Revenus totaux", which is ATTEMPTED
 * x402 and not money at all.
 *
 * A revenue figure that cannot name its rail is not a revenue figure. This
 * answers, per rail: how many packs, for how many dollars, and how many of
 * those dollars are a DEDUCTION from the price table rather than an amount the
 * processor reported.
 */
export type PaymentRail = 'card' | 'usdc' | 'unknown';

export interface PackKeyRow {
  email: string;
  credits_total: number | null;
  amount_paid_minor: number | null;
  amount_paid_currency: string | null;
  stripe_session_id: string | null;
  x402_payment_ref: string | null;
  issued_by_us: number | null;
  created_at: string | null;
}

export interface RailTotal {
  count: number;
  usd: number;
}

export interface PacksSold {
  count: number;
  usd: number;
  by_rail: Record<PaymentRail, RailTotal>;
  /** Packs handed over without payment (pilots, comps). Never money. */
  granted_count: number;
  /** How many of `count` were priced from the table instead of a receipt. */
  deduced_count: number;
  /** True as soon as one dollar of `usd` is a deduction. The UI must say so. */
  partly_deduced: boolean;
  last_sale_at: string | null;
}

/**
 * Which rail carried the money. Stripe writes its session id, the x402 credits
 * flow writes its payment reference; a pack with neither predates both columns
 * or was granted, and 'unknown' says that instead of guessing a rail.
 */
export function packRail(k: PackKeyRow): PaymentRail {
  if (k.stripe_session_id) return 'card';
  if (k.x402_payment_ref) return 'usdc';
  return 'unknown';
}

export function packsSold(rows: PackKeyRow[]): PacksSold {
  const empty = (): RailTotal => ({ count: 0, usd: 0 });
  const out: PacksSold = {
    count: 0,
    usd: 0,
    by_rail: { card: empty(), usdc: empty(), unknown: empty() },
    granted_count: 0,
    deduced_count: 0,
    partly_deduced: false,
    last_sale_at: null,
  };

  for (const k of rows) {
    if ((k.credits_total ?? 0) <= 0) continue;
    // Internal accounts are our own tests; the two placeholder buyers
    // (credits-buyer, stripe-buyer) are NOT internal to this module and are
    // counted, for the reason spelled out above ANONYMOUS_BUYERS: an anonymous
    // paying agent is the customer this API is betting on.
    if (isInternal(k.email)) continue;
    // A pack we handed over is a cost, not a receipt.
    if (k.issued_by_us) {
      out.granted_count += 1;
      continue;
    }

    const price = accountUsd(k);
    const rail = packRail(k);
    out.count += 1;
    out.usd = Math.round((out.usd + price.usd) * 100) / 100;
    out.by_rail[rail].count += 1;
    out.by_rail[rail].usd = Math.round((out.by_rail[rail].usd + price.usd) * 100) / 100;
    if (price.source === 'deduced') out.deduced_count += 1;
    if (k.created_at && (out.last_sale_at === null || k.created_at > out.last_sale_at)) {
      out.last_sale_at = k.created_at;
    }
  }

  out.partly_deduced = out.deduced_count > 0;
  return out;
}
