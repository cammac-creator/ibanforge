"use client"

import { useEffect, useRef, useState } from "react"

/**
 * The fold's product demo: three answers the API really gave (recorded on
 * 26/09/2026, never fetched on load), played as a loop. The IBAN types itself,
 * the checks light up one by one, then the verdict lands.
 *
 * The server renders the first scenario in full, so a visitor without
 * JavaScript, a crawler and the first paint all read a complete answer; the
 * loop only starts once the page has settled. It pauses on hover, on focus,
 * off screen and on demand (WCAG 2.2.2), and never moves under
 * prefers-reduced-motion, where the tabs still switch the scenario.
 */

export interface DemoRow {
  label: string
  value: string
  detail?: string
  state: "ok" | "bad" | "off"
}

export interface DemoScenario {
  tab: string
  iban: string
  rows: DemoRow[]
  verdict: string
  note: string
  tone: "ok" | "stop" | "fix"
}

export interface DemoCopy {
  aria: string
  request: string
  caption: string
  pause: string
  play: string
  scenarios: string
  ibanLabel: string
}

type Phase = "typing" | "rows" | "verdict" | "hold"

const TYPE_MS = 38
const ROW_MS = 420
const VERDICT_MS = 380
const HOLD_MS = 3400
const START_DELAY_MS = 1400

function Icon({ state }: { state: DemoRow["state"] }) {
  if (state === "ok")
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    )
  if (state === "bad")
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
      </svg>
    )
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 8h7" />
    </svg>
  )
}

export function VerdictDemo({ scenarios, copy }: { scenarios: DemoScenario[]; copy: DemoCopy }) {
  const root = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState(scenarios[0].iban.length)
  const [rows, setRows] = useState(scenarios[0].rows.length)
  const [phase, setPhase] = useState<Phase>("hold")
  const [animated, setAnimated] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [held, setHeld] = useState(false)
  const [visible, setVisible] = useState(true)

  const scenario = scenarios[index]
  const running = animated && playing && !held && visible

  // Decide once, after hydration, whether this view animates at all.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (reduce.matches) return
    const start = window.setTimeout(() => {
      setAnimated(true)
      setTyped(0)
      setRows(0)
      setPhase("typing")
    }, START_DELAY_MS)
    const onChange = () => {
      if (reduce.matches) {
        setAnimated(false)
        setTyped(Number.MAX_SAFE_INTEGER)
        setRows(Number.MAX_SAFE_INTEGER)
        setPhase("hold")
      }
    }
    reduce.addEventListener("change", onChange)
    return () => {
      window.clearTimeout(start)
      reduce.removeEventListener("change", onChange)
    }
  }, [])

  // Off screen or in a background tab, nothing moves.
  useEffect(() => {
    const el = root.current
    if (!el || !("IntersectionObserver" in window)) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    const onVis = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onVis)
    return () => {
      io.disconnect()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [])

  // The loop: one timer at a time, re-armed from the current phase.
  useEffect(() => {
    if (!running) return
    let timer = 0
    if (phase === "typing") {
      if (typed < scenario.iban.length) timer = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS)
      else timer = window.setTimeout(() => setPhase("rows"), ROW_MS)
    } else if (phase === "rows") {
      if (rows < scenario.rows.length) timer = window.setTimeout(() => setRows((n) => n + 1), ROW_MS)
      else timer = window.setTimeout(() => setPhase("verdict"), VERDICT_MS)
    } else if (phase === "verdict") {
      timer = window.setTimeout(() => setPhase("hold"), HOLD_MS)
    } else {
      timer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % scenarios.length)
        setTyped(0)
        setRows(0)
        setPhase("typing")
      }, 600)
    }
    return () => window.clearTimeout(timer)
  }, [running, phase, typed, rows, scenario, scenarios.length])

  function choose(i: number) {
    setIndex(i)
    if (animated) {
      setTyped(0)
      setRows(0)
      setPhase("typing")
      setPlaying(true)
    } else {
      setTyped(Number.MAX_SAFE_INTEGER)
      setRows(Number.MAX_SAFE_INTEGER)
    }
  }

  const verdictShown = !animated || phase === "verdict" || phase === "hold"
  const shownIban = scenario.iban.slice(0, typed)

  return (
    <div
      ref={root}
      className="vdemo"
      data-tone={verdictShown ? scenario.tone : "wait"}
      role="group"
      aria-label={copy.aria}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="vdemo-bar">
        <span className="vdemo-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <code>{copy.request}</code>
        {animated && (
          <button
            type="button"
            className="vdemo-toggle"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={!playing}
            aria-label={playing ? copy.pause : copy.play}
          >
            {playing ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5.5 4v8M10.5 4v8" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5.5 3.5l7 4.5-7 4.5z" />
              </svg>
            )}
          </button>
        )}
      </div>

      <div className="vdemo-iban">
        <span className="vdemo-label">{copy.ibanLabel}</span>
        <code aria-hidden="true">
          {shownIban}
          <span className="vdemo-caret" data-on={animated && phase === "typing"} />
        </code>
        <span className="sr-only">{scenario.iban}</span>
      </div>

      <ul className="vdemo-rows">
        {scenario.rows.map((row, k) => (
          <li key={`${index}-${row.label}`} data-state={row.state} data-on={k < rows}>
            <span className="vdemo-ico">
              <Icon state={row.state} />
            </span>
            <span className="vdemo-rl">{row.label}</span>
            <span className="vdemo-rv">
              {row.value}
              {row.detail && <small>{row.detail}</small>}
            </span>
          </li>
        ))}
      </ul>

      <div className="vdemo-verdict" data-on={verdictShown}>
        <span className="vdemo-pill">{scenario.verdict}</span>
        <p>{scenario.note}</p>
      </div>

      <div className="vdemo-tabs" role="tablist" aria-label={copy.scenarios}>
        {scenarios.map((s, k) => (
          <button
            key={s.tab}
            type="button"
            role="tab"
            aria-selected={k === index}
            data-tone={s.tone}
            onClick={() => choose(k)}
          >
            <span className="vdemo-tabdot" aria-hidden="true" />
            {s.tab}
          </button>
        ))}
      </div>
      <p className="vdemo-caption">{copy.caption}</p>
    </div>
  )
}
