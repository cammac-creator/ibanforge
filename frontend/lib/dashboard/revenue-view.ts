/**
 * What the revenue card is allowed to call money — audit DASH-01 / DASH-02,
 * 2026-09-01.
 *
 * 🚨 Three separate figures were being read as one:
 *   - `total_revenue_usdc_clean` is x402 ATTEMPTED (it passed the payment
 *     middleware's verify step; nothing observed the chain), printed with a `$`;
 *   - `balance_usdc` is a wallet BALANCE, which goes DOWN when we spend;
 *   - the card rail was an em dash hard-coded in the JSX with a "Non configuré"
 *     badge, while credit packs had been sold on it.
 *
 * The rules encoded here: dollars and USDC are never summed (that needs a rate
 * and a date nobody has); an unknown external share is `null`, never 0; and a
 * pack paid in USDC is already inside the on-chain total, so it is never added
 * to it a second time.
 */

export interface RailTotalView {
  count: number;
  usd: number;
}

export interface PacksSoldView {
  count: number;
  usd: number;
  by_rail: { card: RailTotalView; usdc: RailTotalView; unknown: RailTotalView };
  granted_count: number;
  deduced_count: number;
  partly_deduced: boolean;
  last_sale_at: string | null;
}

export interface OnChainView {
  total_received_usdc?: number;
  received_external_usdc?: number | null;
  received_internal_usdc?: number | null;
}

export interface Collected {
  /** Dollars taken on the card rail. `null` while the sales are not loaded. */
  cardUsd: number | null;
  /**
   * USDC settled on chain by someone who is not us. `null` means CANNOT TELL —
   * either the scan has not run, or X402_INTERNAL_PAYERS is unset so our own
   * settlements cannot be told apart. It must never be rendered as zero.
   */
  externalUsdc: number | null;
  externalKnown: boolean;
  packsCount: number | null;
  /** At least one dollar above is a price deduced from the pack table. */
  partlyDeduced: boolean;
}

export function collected(packs: PacksSoldView | null, chain: OnChainView | null): Collected {
  const externalUsdc = chain == null ? null : (chain.received_external_usdc ?? null);
  return {
    cardUsd: packs == null ? null : packs.by_rail.card.usd,
    externalUsdc,
    externalKnown: externalUsdc !== null,
    packsCount: packs == null ? null : packs.count,
    partlyDeduced: packs?.partly_deduced ?? false,
  };
}
