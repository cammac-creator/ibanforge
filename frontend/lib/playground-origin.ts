/**
 * Where the answer on a playground card comes from, as a message key.
 *
 * Until 16/09/2026 the page said "Every answer below is a real, live response"
 * over an answer saved weeks earlier, and on 24/09/2026 an assistant still
 * quoted it as a live call. A saved answer now says so on its card, with the
 * day it was captured when that day is known. The date is passed through as
 * written (YYYY-MM-DD): no Intl in a client component (AGENTS.md, rule 8).
 */
export type ResultOrigin =
  | { key: "verdict.apiResponse"; values?: undefined }
  | { key: "verdict.savedExample"; values?: undefined }
  | { key: "verdict.savedExampleOn"; values: { date: string } }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function resultOrigin(received: boolean, savedOn?: string): ResultOrigin {
  if (received) return { key: "verdict.apiResponse" }
  if (savedOn && ISO_DAY.test(savedOn)) return { key: "verdict.savedExampleOn", values: { date: savedOn } }
  return { key: "verdict.savedExample" }
}
