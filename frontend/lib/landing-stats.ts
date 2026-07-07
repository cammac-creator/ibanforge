/**
 * Landing-page stats, sourced — not invented.
 *
 * Live values come from the free GET https://api.ibanforge.com/health:
 *   { bic_database_entries, ch_clearing_entries, ... }
 * fetched server-side with daily revalidation. The build must NEVER break on
 * a slow or dead API, so the fetch races a 4s timer (no AbortSignal — passing
 * a signal opts the request out of the Next.js data cache) and every failure
 * path falls back to the constants below.
 *
 * FALLBACK constants captured live on 2026-07-07 from /health — refresh
 * monthly alongside the BIC DB workflow (.github/workflows/refresh-bic.yml).
 */

export interface LandingStats {
  bicEntries: number
  chClearingEntries: number
}

const FALLBACK: LandingStats = {
  bicEntries: 121_610,
  chClearingEntries: 1_165,
}

/** Countries with IBAN validation — backend src/lib/countries.ts IBAN_LENGTHS (89 entries). */
export const SUPPORTED_COUNTRIES = 89

/**
 * Median server processing time (ms), as reported by the API itself in
 * `processing_ms`. Source: live responses captured 2026-07-07 (playground
 * examples.ts): 0.30 / 0.31 / 0.32 / 0.41 ms — 0.4 is the conservative round.
 * Not exposed on the free /health endpoint, hence a dated constant.
 */
export const P50_PROCESSING_MS = 0.4

interface HealthPayload {
  bic_database_entries?: unknown
  ch_clearing_entries?: unknown
}

export async function getLandingStats(): Promise<LandingStats> {
  try {
    const fetched = fetch("https://api.ibanforge.com/health", {
      next: { revalidate: 86_400 }, // daily
    }).then(async (res) => {
      if (!res.ok) return null
      return (await res.json()) as HealthPayload
    })

    // Race a plain timer instead of aborting: an AbortSignal would opt the
    // fetch out of the data cache, and a hung build is worse than a fallback.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000))
    const payload = await Promise.race([fetched.catch(() => null), timeout])
    if (!payload) return FALLBACK

    const bic = payload.bic_database_entries
    const ch = payload.ch_clearing_entries
    return {
      bicEntries: typeof bic === "number" && bic > 0 ? bic : FALLBACK.bicEntries,
      chClearingEntries: typeof ch === "number" && ch > 0 ? ch : FALLBACK.chClearingEntries,
    }
  } catch {
    return FALLBACK
  }
}
