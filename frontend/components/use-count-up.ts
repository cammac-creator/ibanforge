"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Count a number up from 0 to `target` over `durationMs` using requestAnimation-
 * Frame and an easeOutCubic curve. Respects reduced-motion by jumping straight
 * to the final value on the first frame (no visible animation). Returns the
 * current numeric value — the caller formats it (tabular-nums recommended).
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const start = performance.now()

    const tick = (now: number) => {
      // reduced-motion → t is 1 immediately, so we settle on `target` at once.
      const t = reduce ? 1 : Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setValue(target * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs])

  return value
}
