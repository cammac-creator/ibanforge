"use client"

import Link from "next/link"
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react"
import { record } from "@/components/lens/response"
import { PUBLIC_API } from "@/lib/register-cta"
import { afterLoadIdle } from "./revue-idle"
import {
  ESSAI_DEFAULT,
  ESSAI_EXAMPLES,
  essaiAnswer,
  essaiValue,
  essaiWaiting,
  type EssaiAnswer,
  type EssaiCopy,
  type EssaiRow,
} from "./revue-essai-model"

/*
 * Chapter 03 of the home: a real check, no sign-up. The tester of the lens of
 * 16/09/2026 without its 3D: the same call to the relay /api/playground, only
 * on a gesture (a submit or an example), the same four examples, the same
 * guards (a stale answer is dropped, a request gives up after 12 s, an edit
 * clears the answer). The three lines wait with « À vérifier », « À identifier »
 * and « À rechercher »; the real answer rises in their place
 * (revue-scenes-engine.ts, loaded when the chapter comes near, never under
 * reduced motion). Nothing is stored.
 */

type Phase = "idle" | "edited" | "loading" | "live" | "error"

/** A date of a source ("2026-09") never parts at its hyphen. */
function Dated({ text }: { text: string }) {
  const parts = text.split(/(\d{4}-\d{2}(?:-\d{2})?)/)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rv-nw">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function Source({ source }: { source: EssaiRow["source"] }) {
  if (!source) return null
  return (
    <span className="rv-essai__src">
      <Dated text={source.before} />
      {source.code && <code>{source.code}</code>}
      <Dated text={source.after} />
    </span>
  )
}

const TONE: Record<EssaiRow["tone"], string> = {
  texte: "",
  mono: " rv-essai__v--mono",
  gris: " rv-essai__v--gris",
  rouge: " rv-essai__v--rouge",
  attente: " rv-essai__v--attente",
}

export function RevueEssai({ copy, playgroundHref }: { copy: EssaiCopy; playgroundHref: string }) {
  const root = useRef<HTMLDivElement>(null)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const engine = useRef<typeof import("./revue-scenes-engine") | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [iban, setIban] = useState<string>(ESSAI_EXAMPLES[ESSAI_DEFAULT])
  const [phase, setPhase] = useState<Phase>("idle")
  const [answer, setAnswer] = useState<EssaiAnswer | null>(null)
  const [error, setError] = useState("")

  // The motion engine arrives with the chapter, and only when motion is allowed.
  useEffect(() => {
    const el = root.current
    if (!el) return
    let disposed = false
    // An answer still on its way when the page goes is dropped, like an edited one.
    const invalidate = () => {
      generation.current++
    }
    // The buttons wait for the script that answers them (same as the tester of the lens).
    void Promise.resolve().then(() => {
      if (!disposed) setHydrated(true)
    })
    const reduce = matchMedia("(prefers-reduced-motion: reduce)")
    const load = () => {
      if (reduce.matches || engine.current) return
      afterLoadIdle()
        .then(() => import("./revue-scenes-engine"))
        .then((module) => {
          if (!disposed) engine.current = module
        })
        .catch(() => {})
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        io.disconnect()
        load()
      },
      { rootMargin: "600px 0px" },
    )
    io.observe(el)
    return () => {
      disposed = true
      io.disconnect()
      request.current?.abort()
      invalidate()
    }
  }, [])

  // A real answer rises into place: before the paint, so its final frame never flashes first.
  useLayoutEffect(() => {
    const el = root.current
    if (!answer || !el || !engine.current) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    return engine.current.revealAnswer(el)
  }, [answer])

  function change(value: string) {
    generation.current++
    request.current?.abort()
    setIban(value)
    setAnswer(null)
    setPhase("edited")
    setError("")
  }

  async function submit(value = iban) {
    request.current?.abort()
    const run = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setAnswer(null)
    setPhase("loading")
    setError("")
    const timer = window.setTimeout(() => controller.abort(), 12000)
    try {
      const response = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "iban", value: essaiValue(value) }),
        signal: controller.signal,
      })
      const data: unknown = await response.json()
      if (run !== generation.current) return
      const body = record(data)
      const result = response.ok ? essaiAnswer(body, copy) : null
      if (!result) {
        setError(response.status === 429 || body.error === "rate_limited" ? copy.rateLimited : copy.unavailable)
        setPhase("error")
        return
      }
      setAnswer(result)
      setPhase("live")
    } catch {
      if (run === generation.current) {
        setError(copy.unavailable)
        setPhase("error")
      }
    } finally {
      window.clearTimeout(timer)
    }
  }

  const rows = answer ? answer.rows : essaiWaiting(copy)
  const labels = [copy.rows.format, copy.rows.bank, copy.rows.bic]
  const status = phase === "edited" ? copy.edited : phase === "error" ? error : null

  return (
    <div className="rv-essai" ref={root} data-phase={phase}>
      <form
        className="rv-essai__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label className="rv-kicker rv-essai__lab" htmlFor="rv-essai-iban">
          {copy.label}
        </label>
        <div className="rv-essai__ligne">
          <input
            id="rv-essai-iban"
            className="rv-essai__champ"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={50}
            value={iban}
            onChange={(event) => change(event.target.value)}
            aria-describedby="rv-essai-note"
            required
          />
          <button
            className="rv-essai__envoi"
            type="submit"
            disabled={!hydrated || phase === "loading" || !iban.trim()}
            data-evt="cta:journey-api"
          >
            {phase === "loading" ? copy.loading : copy.submit}
            <span className="rv-fl" aria-hidden="true">
              →
            </span>
          </button>
        </div>
        <div className="rv-essai__ex" role="group" aria-label={copy.examplesLabel}>
          {copy.examples.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={!hydrated}
              aria-pressed={iban === ESSAI_EXAMPLES[i]}
              onClick={() => {
                change(ESSAI_EXAMPLES[i])
                void submit(ESSAI_EXAMPLES[i])
              }}
            >
              {label}
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className="rv-essai__note" id="rv-essai-note">
          {copy.note}
        </p>
        {/* Without JavaScript the buttons stay disabled: say why, and where a
            real answer of the API can still be read (a GET, any browser). */}
        <noscript>
          <p className="rv-essai__note">
            {copy.noJs}{" "}
            <a className="rv-lien rv-souple" href={`${PUBLIC_API}/v1/demo`}>
              {`${PUBLIC_API.replace("https://", "")}/v1/demo`}
            </a>
          </p>
        </noscript>
      </form>
      <div aria-live="polite" aria-busy={phase === "loading"}>
        <dl className="rv-essai__res">
          {rows.map((row, i) => (
            <div className="rv-essai__r" key={i}>
              <dt className="rv-kicker">{labels[i]}</dt>
              <dd>
                <span className="rv-essai__vm">
                  <span className={`rv-essai__v${TONE[row.tone]}`}>{row.value}</span>
                </span>
                <Source source={row.source} />
              </dd>
            </div>
          ))}
        </dl>
        {answer ? (
          <Fragment>
            <p className="rv-essai__verdict" data-ton={answer.verdict.tone}>
              <span className="rv-essai__vd">{answer.verdict.label}</span>
              <span className="rv-essai__vn">{answer.verdict.note}</span>
            </p>
            {answer.notices.length > 0 && (
              <ul className="rv-essai__notices">
                {answer.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            )}
          </Fragment>
        ) : status ? (
          <p className="rv-essai__verdict" data-ton="neutre" role="status">
            <span className="rv-essai__vn">{status}</span>
          </p>
        ) : null}
      </div>
      <p className="rv-essai__pied">
        <Link className="rv-lien" href={playgroundHref}>
          {copy.playground}
          <span className="rv-fl" aria-hidden="true">
            ↗
          </span>
        </Link>
      </p>
    </div>
  )
}
