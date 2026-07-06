"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Sober scroll-reveal. Fades + lifts its children into place once they enter
 * the viewport (fade + translateY 12→0, --dur-4 / --ease-out).
 *
 * Progressive enhancement: the hidden start state lives in CSS behind the `.js`
 * class (set by the head script in [locale]/layout.tsx), so content is fully
 * visible when JavaScript is off. Reduced-motion is honored two ways: the
 * global guard in globals.css forces it visible, and here we skip the observer
 * and reveal immediately.
 *
 * `delay` (ms) drives a simple stagger — pass i * 60 across a list.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce || !("IntersectionObserver" in window)) {
      el.classList.add("is-in")
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in")
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
