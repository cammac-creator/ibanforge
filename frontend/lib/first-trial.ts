import { PACK_ENTRY_PRICE, PRO_MONTHLY_PRICE } from "./pricing-estimate"
import { formatUsd } from "./format-usd"

/**
 * The two prices of the lines shown under a first valid answer (components/first-trial-prices.tsx),
 * as the page writes them, ready to be put in the `playground.firstTrial` messages.
 *
 * Read from `lib/pricing-estimate.ts`, the file the pricing page and the home read their Pro price
 * and their cheapest pack from, never copied here; written in the language of the page by
 * `formatUsd`, which does no `Intl` (AGENTS.md rule 8).
 */
export function firstTrialPrices(locale: string): { pro: string; pack: string } {
  return { pro: formatUsd(PRO_MONTHLY_PRICE, locale), pack: formatUsd(PACK_ENTRY_PRICE, locale) }
}
