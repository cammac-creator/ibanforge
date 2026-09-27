"use client"

import { useState, type ReactNode } from "react"

/**
 * What installs today, as a slow endless ribbon. The track holds the list
 * twice so the loop has no seam; the second copy is hidden from assistive
 * technology and from the keyboard, and disappears under reduced motion,
 * where the list simply wraps.
 *
 * The ribbon stops on hover and on demand with the button (WCAG 2.2.2): a
 * moving list that only a mouse could stop left keyboard and touch visitors
 * chasing their link. While a link inside it has the keyboard focus
 * (:focus-visible, never a mouse click), the loop is taken off and the list
 * sits at its start, so the browser can scroll any link into view; paused, a
 * link already slid past the left edge could never come back. When the focus
 * leaves, the list returns to its start.
 */
export function IntegrationRibbon({
  label,
  description,
  pause,
  play,
  children,
}: {
  label: string
  description: string
  pause: string
  play: string
  children: ReactNode
}) {
  const [paused, setPaused] = useState(false)

  return (
    <div className="home-ribbon" role="group" aria-label={label} data-paused={paused}>
      <p className="sr-only">{description}</p>
      <div className="home-ribbon-head">
        <button
          type="button"
          className="home-ribbon-toggle"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? play : pause}
        >
          {paused ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 3.5l7 4.5-7 4.5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 4v8M10.5 4v8" />
            </svg>
          )}
        </button>
      </div>
      <div
        className="home-ribbon-viewport"
        onFocus={(event) => {
          // Chromium leaves a half-visible link where it is: bring the whole
          // card in, for the keyboard only (a click must not move the list).
          const target = event.target as HTMLElement
          let keyboard = false
          try {
            keyboard = target.matches(":focus-visible")
          } catch {
            keyboard = false
          }
          if (keyboard) target.scrollIntoView({ block: "nearest", inline: "nearest" })
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.scrollLeft = 0
        }}
      >
        <div className="home-ribbon-track">{children}</div>
      </div>
    </div>
  )
}
