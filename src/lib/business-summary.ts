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
  const tiers = Object.keys(CREDIT_PACK_USD).map(Number).sort((a, b) => a - b);
  const nearest = tiers.reduce((best, t) =>
    Math.abs(t - credits) < Math.abs(best - credits) ? t : best,
  );
  const rate = CREDIT_PACK_USD[nearest] / nearest;
  return { usd: Math.round(credits * rate * 100) / 100, exact: false };
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
    sold_usd_is_estimate: boolean;
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
  const accounts: CreditAccount[] = [];
  for (const k of paying) {
    const sold = k.credits_total ?? 0;
    const consumed = Math.max(sold - (k.credits_remaining ?? sold), 0);
    const price = creditPackUsd(sold);
    soldCredits += sold;
    soldUsd += price.usd;
    if (!price.exact) estimated = true;
    accounts.push({
      key_prefix: k.key_prefix,
      domain: accountLabel(k.email),
      sold,
      consumed,
      pct: pct(consumed, sold),
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
  const discovery = paths
    .filter((p) => isDiscoveryPath(p.path))
    .reduce((t, p) => t + p.count, 0);

  const windowedCalls = clients.reduce((t, c) => t + c.calls, 0);
  const busiest = clients.reduce((m, c) => Math.max(m, c.calls), 0);

  return {
    window_days: windowDays,
    credits: {
      sold_credits: soldCredits,
      sold_usd: Math.round(soldUsd * 100) / 100,
      sold_usd_is_estimate: estimated,
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
