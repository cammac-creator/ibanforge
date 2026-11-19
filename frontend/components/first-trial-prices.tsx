import Link from "next/link"
import { localePath } from "@/lib/locale-path"

/**
 * Two quiet lines for someone who has just watched the API answer a valid result on their own input
 * (Claude-Alain's decision of 19 November 2026, "Le compteur, et deux phrases"):
 * what to take in production, and what to take for a one-off need. Under the answer,
 * never over it: no pop-up, no banner, nothing that hides what they came to read.
 *
 * Nothing is written here that the site does not already say. The figures are read by
 * `lib/first-trial.ts` from `lib/pricing-estimate.ts`, the file the pricing page and the
 * home read their Pro price and their cheapest pack from. The lines come from the
 * `playground.firstTrial` messages and are handed in already written, so the component
 * also works where no client messages are mounted.
 *
 * Each link carries a `data-evt`: the beacon of the shell counts the click
 * (`cta:first-trial-pro`, `cta:first-trial-pack`), and the page it was shown on rides
 * with it, so one can tell whether the lines serve and where. No mail is sent, the
 * answer of the API is untouched.
 */
export const FIRST_TRIAL_EVENTS = { pro: "cta:first-trial-pro", pack: "cta:first-trial-pack" } as const

export function FirstTrialPrices({
  locale,
  pro,
  pack,
  className = "text-xs text-muted-foreground",
  linkClassName = "underline underline-offset-4 hover:text-foreground",
}: {
  locale: string
  pro: string
  pack: string
  className?: string
  linkClassName?: string
}) {
  return (
    <ul className={`flex flex-col gap-1 ${className}`} data-first-trial>
      <li>
        <Link href={localePath(locale, "/pricing#pro")} className={linkClassName} data-evt={FIRST_TRIAL_EVENTS.pro}>
          {pro}
        </Link>
      </li>
      <li>
        <Link href={localePath(locale, "/pricing#packs")} className={linkClassName} data-evt={FIRST_TRIAL_EVENTS.pack}>
          {pack}
        </Link>
      </li>
    </ul>
  )
}
