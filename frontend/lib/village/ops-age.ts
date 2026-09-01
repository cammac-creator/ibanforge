/**
 * Age of a logged operation, in whole minutes, from the timestamp the feed
 * serves. stats.sqlite writes `created_at` in TWO shapes — the SQLite default
 * `YYYY-MM-DD HH:MM:SS` (UTC, no zone marker) and the ISO `…T…Z` of
 * application inserts — and a reader that assumes one of them has already
 * produced a 500 on the dashboard (12/08/2026). Both are read here.
 */
export function opAgeMinutes(t: string, nowMs: number): number | null {
  if (!t) return null
  const iso = t.includes('T') ? t : t.replace(' ', 'T')
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`
  const ms = Date.parse(zoned)
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.floor((nowMs - ms) / 60_000))
}
