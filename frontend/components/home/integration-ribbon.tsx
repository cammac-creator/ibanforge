"use client"

import { useState, type ReactNode } from "react"

/**
 * What installs today, as a slow endless ribbon. The track holds the list
 * twice so the loop has no seam; the second copy is hidden from assistive
 * technology and from the keyboard, and disappears under reduced motion,
 * where the list simply wraps.
 *
 * The ribbon stops on hover, while a link inside it has the keyboard focus,
 * and on demand with the button (WCAG 2.2.2): a moving list that only a mouse
 * could stop left keyboard and touch visitors chasing their link.
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
      <div className="home-ribbon-viewport">
        <div className="home-ribbon-track">{children}</div>
      </div>
    </div>
  )
}
