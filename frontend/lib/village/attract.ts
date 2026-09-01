/**
 * Attract mode — the village plays itself ONCE for a visitor who does
 * nothing, by replaying a recorded, dated, real answer (never a call: an API
 * call per idle visitor would manufacture the traffic the village shows).
 * Pure decisions only; the page owns the timers and the listeners.
 */

export interface AttractInput {
  /** milliseconds since the canvas was painted */
  idleMs: number
  /** any pointer, key, wheel or touch since the page opened */
  interacted: boolean
  /** at least half the canvas is on screen */
  visible: boolean
  /** document.hidden */
  hidden: boolean
  /** prefers-reduced-motion */
  reduced: boolean
  /** already played this session */
  played: boolean
  /** a quest or a vignette is running */
  running: boolean
}

export const ATTRACT_AFTER_MS = 6000

export function shouldAttract(i: AttractInput): boolean {
  return (
    i.idleMs >= ATTRACT_AFTER_MS &&
    !i.interacted && i.visible && !i.hidden && !i.reduced && !i.played && !i.running
  )
}

/** The film for this visit: the playlist rotated by a visit counter. */
export function pickDemo<T extends string>(playlist: readonly T[], visitCount: number): T {
  const n = Number.isFinite(visitCount) && visitCount > 0 ? Math.floor(visitCount) : 0
  return playlist[n % playlist.length]
}
