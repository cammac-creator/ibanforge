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

/** Un prix en dollars tel que le site l’écrit : « $149 » en anglais, « 149 $ » ailleurs (lib/format-usd.ts). */
export { formatUsd } from "./format-usd"
