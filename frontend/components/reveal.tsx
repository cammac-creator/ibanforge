"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * One IntersectionObserver for every Reveal on the page (audit 2026-09-04,
 * M8): the home mounted sixteen of them. Elements register with a callback;
 * the observer is created on first use and dropped when the last one leaves.
 */
let shared: IntersectionObserver | null = null
const pending = new Map<Element, () => void>()

function observe(el: Element, onEnter: () => void): () => void {
  if (!shared) {
    shared = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const cb = pending.get(entry.target)
          if (cb) {
            pending.delete(entry.target)
            shared?.unobserve(entry.target)
            cb()
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    )
  }
  pending.set(el, onEnter)
  shared.observe(el)
  return () => {
    pending.delete(el)
    shared?.unobserve(el)
    if (pending.size === 0) {
      shared?.disconnect()
      shared = null
    }
  }
}

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

    return observe(el, () => el.classList.add("is-in"))
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
