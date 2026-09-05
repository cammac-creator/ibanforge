"use client"

/**
 * The fold's proof: one real request, played once, with its real latency.
 *
 * Audit 2026-09-04 (L1). The strongest artefact of the site — the captured
 * `/v1/iban/validate` answer with its Swiss clearing block — lived at the
 * fifth station of the film, 67 % of the page down. It now sits beside the
 * title, and it is not an animation of a response: after the address types
 * itself in, the browser calls the API through the playground relay and
 * prints what came back, with the server time the API reports and the round
 * trip measured on this very call.
 *
 * Honest by construction, in this order:
 *   - server render: the captured answer (playground/examples.ts), labelled
 *     as captured — so no JS, reduced motion and the first paint all show a
 *     complete, truthful response;
 *   - with JS and motion, once the fold is on screen: type, call, print;
 *   - if the call fails, times out, or the answer is not a valid IBAN with a
 *     bank behind it, the captured answer stays, still labelled as captured.
 * Bots that drive a browser (`navigator.webdriver`) and the reduced-motion
 * preference never trigger a call; a session replays from cache.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { formatGrouped } from "@/lib/format-grouped"
import { groupIban, isShowable, responseLines, serverMs } from "@/lib/forge/response-lines"

type Phase = "static" | "typing" | "calling" | "live" | "captured"

const CACHE_KEY = "ibf-fold-demo"
// Measured live on 2026-09-04: a cold relay + API round trip took ~2 s.
const CALL_TIMEOUT_MS = 4_000
const TYPE_EVERY_MS = 34

interface Cached {
  payload: Record<string, unknown>
  rtt: number
}

function readCache(): Cached | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Cached>
    return isShowable(parsed.payload) && typeof parsed.rtt === "number" ? (parsed as Cached) : null
  } catch {
    return null
  }
}

function writeCache(value: Cached) {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    /* private mode, quota: the demo simply calls again next time */
  }
}

export function FoldDemo({ iban, fallback }: { iban: string; fallback: Record<string, unknown> }) {
  const t = useTranslations("home.hero.demo")
  const locale = useLocale()
  const rootRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>("static")
  const [typed, setTyped] = useState<string>(groupIban(iban))
  const [payload, setPayload] = useState<Record<string, unknown>>(fallback)
  const [rtt, setRtt] = useState<number | null>(null)
  const [run, setRun] = useState(0)
  const busy = useRef(false)

  const play = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    const full = groupIban(iban)
    setPhase("typing")
    setTyped("")
    await new Promise<void>((resolve) => {
      let i = 0
      const id = window.setInterval(() => {
        i += 1
        setTyped(full.slice(0, i))
        if (i >= full.length) {
          window.clearInterval(id)
          resolve()
        }
      }, TYPE_EVERY_MS)
    })

    const cached = readCache()
    if (cached) {
      setPayload(cached.payload)
      setRtt(cached.rtt)
      setRun((n) => n + 1)
      setPhase("live")
      busy.current = false
      return
    }

    setPhase("calling")
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
    const t0 = performance.now()
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "iban", value: iban }),
        signal: controller.signal,
      })
      const elapsed = Math.round(performance.now() - t0)
      const data: unknown = await res.json()
      if (res.ok && isShowable(data)) {
        setPayload(data)
        setRtt(elapsed)
        writeCache({ payload: data, rtt: elapsed })
        setRun((n) => n + 1)
        setPhase("live")
      } else {
        setPayload(fallback)
        setRun((n) => n + 1)
        setPhase("captured")
      }
    } catch {
      setPayload(fallback)
      setRun((n) => n + 1)
      setPhase("captured")
    } finally {
      window.clearTimeout(timer)
      busy.current = false
    }
  }, [iban, fallback])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return
    if (navigator.webdriver) return
    if (!("IntersectionObserver" in window)) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          void play()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [play])

  const lines = responseLines(payload)
  const server = serverMs(payload)
  const settled = phase === "live" || phase === "captured" || phase === "static"

  let timing: string
  if (phase === "live" && server !== null && rtt !== null) {
    timing = t("live", { server: formatGrouped(server, locale, 2), rtt: formatGrouped(rtt, locale) })
  } else if (phase === "typing" || phase === "calling") {
    timing = t("calling")
  } else {
    timing = t("captured", { server: formatGrouped(server ?? 0.41, locale, 2) })
  }

  return (
    <div className="hero-proof" ref={rootRef} data-phase={phase}>
      <div className="hp-head">
        <span className="hp-method">
          <b>POST</b> /v1/iban/validate
        </span>
        <span className="hp-input">
          <span className="sr-only">{t("inputAria")} : </span>
          {typed}
          <span className="hp-caret" aria-hidden="true" />
        </span>
      </div>
      {/* A region that scrolls must be reachable from the keyboard (axe
          scrollable-region-focusable, 2026-09-05). */}
      <pre className="hp-body" role="region" aria-label={t("bodyAria")} tabIndex={0} data-run={run || undefined}>
        <code>
          {lines.map((line, i) => (
            <span className="hp-ln" style={{ "--i": i } as React.CSSProperties} key={`${run}-${i}`}>
              {line.map((tok, j) =>
                tok.cls ? (
                  <span className={tok.cls} key={j}>
                    {tok.text}
                  </span>
                ) : (
                  tok.text
                ),
              )}
            </span>
          ))}
        </code>
      </pre>
      <div className="hp-foot">
        <span className="pill-ok">200 OK</span>
        <span className="hp-timing">{timing}</span>
        <button
          type="button"
          className="hp-replay"
          onClick={() => void play()}
          disabled={!settled}
          aria-label={t("replayAria")}
        >
          ↻ {t("replay")}
        </button>
      </div>
    </div>
  )
}
