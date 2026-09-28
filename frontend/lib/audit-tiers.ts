/**
 * The two tiers of the file audit, as the API sells them: the row ceiling and
 * the price in US dollars (src/lib/audit-file.ts, `AUDIT_TIERS` and
 * `AUDIT_MAX_ROWS`).
 *
 * The site cannot import that module (it pulls the spreadsheet parser and the
 * enrichment), so the figures are written once more here, and only here, for
 * every page of the site that quotes them. audit-tiers.test.ts reads the API
 * file as text and fails when a price or a ceiling moves on one side only.
 */
export const AUDIT_TIERS = [
  { rows: 5_000, price: 149 },
  { rows: 20_000, price: 349 },
] as const

/** A price in US dollars as the site writes it: "$149" in English, "149 $" elsewhere (no-break space). */
export function formatUsd(amount: number, locale: string): string {
  return locale.toLowerCase().startsWith("en") ? `$${amount}` : `${amount}\u00a0$`
}
