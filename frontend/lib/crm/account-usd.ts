/**
 * What one account is worth in dollars, and how sure we are of the figure.
 *
 * 🚨 This is a MIRROR of `accountUsd` / `creditPackUsd` in
 * `src/lib/business-summary.ts`. The two live in separate builds (this frontend
 * ships from Vercel, that API from Railway) with no shared package between
 * them, so the rule is written twice on purpose. Both copies must move
 * together: a revenue line drawn here and a revenue line served by /v1/admin
 * that disagree is exactly the class of defect the CRM keeps producing when one
 * number has two origins.
 *
 * Why it replaces the flat price lookup that stood here before (findings
 * DASH-12 and DASH-17, 2026-09-01):
 *
 *  1. A price table answers "what does this pack cost today", never "what did
 *     this customer pay". A price change, a discount or a partial refund makes
 *     it wrong retroactively, across the whole history, with nothing on screen
 *     to say it went wrong. So a stored amount always wins.
 *  2. A bundle size that was not on the list used to be worth exactly zero, so
 *     a hand-granted pack or a future tier silently vanished from the revenue
 *     total. A customer missing from the line is a worse error than an
 *     approximate one, as long as the approximation says it is one.
 */

/** Stripe pack price by credit bundle, in USD. */
export const CREDIT_PACK_USD: Record<number, number> = {
  1000: 5,
  5000: 20,
  25000: 80,
};

/**
 * Dollars for a pack. An unknown size is priced pro rata on the nearest known
 * tier rather than dropped, and the answer says it is not exact.
 */
export function creditPackUsd(credits: number): { usd: number; exact: boolean } {
  const known = CREDIT_PACK_USD[credits];
  if (known != null) return { usd: known, exact: true };
  const tiers = Object.keys(CREDIT_PACK_USD)
    .map(Number)
    .sort((a, b) => a - b);
  const nearest = tiers.reduce((best, t) => (Math.abs(t - credits) < Math.abs(best - credits) ? t : best));
  const rate = CREDIT_PACK_USD[nearest] / nearest;
  return { usd: Math.round(credits * rate * 100) / 100, exact: false };
}

/** Where a dollar figure came from, so a deduction is never read as a receipt. */
export type AmountSource = 'measured' | 'deduced';

/**
 * Dollars for one account, preferring what was actually charged.
 *
 * Only a USD amount counts as measured. Converting another currency here would
 * mean inventing a rate and a date, which is the same class of error the stored
 * column exists to end.
 */
export function accountUsd(k: {
  creditsTotal: number | null;
  amountPaidMinor?: number | null;
  amountPaidCurrency?: string | null;
}): { usd: number; source: AmountSource; exact: boolean } {
  if (k.amountPaidMinor != null && (k.amountPaidCurrency ?? '').toLowerCase() === 'usd') {
    return { usd: Math.round(k.amountPaidMinor) / 100, source: 'measured', exact: true };
  }
  const deduced = creditPackUsd(k.creditsTotal ?? 0);
  return { usd: deduced.usd, source: 'deduced', exact: deduced.exact };
}
