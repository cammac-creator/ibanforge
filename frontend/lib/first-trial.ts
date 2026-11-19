import { PACK_ENTRY_PRICE, PRO_MONTHLY_PRICE } from "./pricing-estimate"
import { formatUsd } from "./format-usd"

/**
 * Whether the two lines show under an answer of the playground: the API answered (`received`)
 * and the answer is a VALID one, an IBAN that checks out (`valid: true`) or a code that exists
 * (`found: true`). A refusal, an invalid input or an unknown code is a legitimate result too,
 * but not the moment to talk about prices. Shown under EVERY valid answer, not only the first.
 * On the home, the same moment is a verdict of tone `ok` (components/home/revue-essai.tsx).
 */
export function showsFirstTrial(received: boolean, result: Record<string, unknown> | null | undefined): boolean {
  return received && !!result && (result.valid === true || result.found === true)
}

/**
 * Whether the two lines show under the answer of the home tester: its verdict is of tone `ok`
 * (a valid IBAN, not a refusal, not "to fix"), and the lines were handed in.
 */
export function showsFirstTrialOnHome(
  answer: { verdict: { tone: string } } | null | undefined,
  firstTrial: unknown,
): boolean {
  return !!answer && answer.verdict.tone === "ok" && !!firstTrial
}

/**
 * The two prices of the lines shown under a valid answer (components/first-trial-prices.tsx),
 * as the page writes them, ready to be put in the `playground.firstTrial` messages.
 *
 * Read from `lib/pricing-estimate.ts`, the file the pricing page and the home read their Pro price
 * and their cheapest pack from, never copied here; written in the language of the page by
 * `formatUsd`, which does no `Intl` (AGENTS.md rule 8).
 */
export function firstTrialPrices(locale: string): { pro: string; pack: string } {
  return { pro: formatUsd(PRO_MONTHLY_PRICE, locale), pack: formatUsd(PACK_ENTRY_PRICE, locale) }
}
