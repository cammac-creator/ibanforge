"use client"

import { useEffect, useRef, useState } from "react"
import { useCountUp } from "@/components/use-count-up"
import { formatGrouped } from "@/lib/format-grouped"

export interface StatItem {
  value: number
  label: string
  /** fraction digits for formatting (default 0) */
  decimals?: number
  /** short unit appended after the number, e.g. "ms" */
  suffix?: string
}

/**
 * Landing stats band — big tabular-nums figures that count up once the band
 * scrolls into view (useCountUp, easeOutCubic, reduced-motion safe).
 *
 * PE-safe: the FINAL value is server-rendered; the count-up only replaces it
 * after hydration when the IntersectionObserver fires. No JS → real numbers.
 */
export function StatsBar({ stats, locale }: { stats: StatItem[]; locale: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const el = ref.current
    // No IntersectionObserver → keep the server-rendered final values, no animation.
    if (!el || !("IntersectionObserver" in window)) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setStarted(true)
            io.disconnect()
          }
        }
      },
      { threshold: 0.3 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10 max-w-6xl mx-auto px-4 w-full"
    >
      {stats.map((stat) => (
        <Stat key={stat.label} stat={stat} locale={locale} started={started} />
      ))}
    </div>
  )
}

function Stat({
  stat,
  locale,
  started,
}: {
  stat: StatItem
  locale: string
  started: boolean
}) {
  const decimals = stat.decimals ?? 0
  const animated = useCountUp(started ? stat.value : 0, 900)
  const shown = started ? animated : stat.value


  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="font-mono tnum text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--fg-1)]">
        {formatGrouped(shown, locale, decimals)}
        {stat.suffix && (
          <span className="ml-1.5 text-base font-normal text-[var(--fg-3)]">{stat.suffix}</span>
        )}
      </span>
      <span className="eyebrow">{stat.label}</span>
    </div>
  )
}
