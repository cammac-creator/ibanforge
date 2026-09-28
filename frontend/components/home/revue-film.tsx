"use client"

import Image from "next/image"
import { Fragment, useEffect, useRef, type ReactNode } from "react"
import { lensAssets } from "@/components/lens/assets"
import { filmFontsReady, fitFilm } from "./revue-fit"
import type { FilmHandle } from "./revue-film-engine"

/*
 * The film of the first chapter of the home (step 1 of « La revue », chosen by
 * Claude-Alain on 28/09/2026). It replaces the demo card of 27/09/2026 and
 * tells the same three answers the API gave on 26/09/2026, in the language of
 * direction D: one giant thing at a time.
 *
 * Everything the film says is rendered here, on the server, in the page's
 * language; every figure arrives formatted (no Intl in a client component).
 * The motion (revue-film-engine.ts, with GSAP) loads only when the film comes
 * near the screen. Without it, under reduced motion, or while the fonts are on
 * their way, each example shows its still frame, complete and readable.
 */

export type RevueFilmCopy = {
  aria: string
  ready: string
  amount: string
  payee: ReactNode
  reading: string
  parts: { country: string; check: string; bank: string; account: string }
  confirmed: string
  confirmedBy: ReactNode
  sameInvoice: string
  checkValid: string
  unallocated: string
  stopLines: string[]
  stopReason: ReactNode
  typo: string
  checksum: string
  fixLines: string[]
  fixNote: string
  pause: string
  play: string
  examples: string
  tabs: [string, string, string]
  figure: string
  caption: ReactNode
}

/* The still frame shown for each example when nothing moves. */
const FRAMES = ["3", "5", "7"]

/** One box per letter. Bebas Neue has no narrow no-break space: it becomes a fixed spacer. */
function Letters({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((ch, i) =>
        ch === " " ? (
          <span key={i} className="rv-d__fine" />
        ) : ch === " " || ch === " " ? (
          <Fragment key={i}>{ch}</Fragment>
        ) : (
          <span key={i} className="rv-d__l">
            {ch}
          </span>
        ),
      )}
    </>
  )
}

function Rising({ className, children }: { className: string; children: ReactNode }) {
  return (
    <p className={`${className} rv-d__m`}>
      <span className="rv-d__mi">{children}</span>
    </p>
  )
}

function Verdict({ lines, className = "" }: { lines: string[]; className?: string }) {
  return (
    <p className={`rv-d__geant rv-d__bebas rv-d__verdict ${className}`} data-rv-fit="lines" data-rv-kern="">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="rv-d__vl rv-d__m">
            <Letters text={line} />
          </span>
        </Fragment>
      ))}
    </p>
  )
}

type PartProps = {
  kind: "pays" | "cle" | "banque" | "compte"
  digits: string
  halo?: "ambre" | "rouge"
  label?: string
  red?: boolean
  rule?: boolean
  strike?: boolean
}

/** One part of an IBAN: its digits, and under them a hairline and what the part is. */
function Part({ kind, digits, halo, label, red, rule = true, strike }: PartProps) {
  return (
    <span className="rv-d__part" data-part={kind}>
      {halo && <span className={`rv-d__halo${halo === "rouge" ? " rv-d__halo--rouge" : ""}`} />}
      <span className="rv-d__pm">
        <Letters text={digits} />
      </span>
      {strike && <i className="rv-d__barre" />}
      {(label || (rule && halo)) && (
        <span className="rv-d__cote">
          {rule && <i className="rv-d__filet" />}
          {label && (
            <span className="rv-d__lgw">
              <span className={`rv-d__lg${red ? " rv-d__lg--rouge" : ""}`}>{label}</span>
            </span>
          )}
        </span>
      )}
    </span>
  )
}

export function RevueFilm({ copy }: { copy: RevueFilmCopy }) {
  const root = useRef<HTMLDivElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const { pause, play } = copy

  useEffect(() => {
    const el = root.current
    const box = group.current
    if (!el || !box) return
    const buttons = Array.from(box.querySelectorAll<HTMLButtonElement>(".rv-ex"))
    const reduce = matchMedia("(prefers-reduced-motion: reduce)")
    let disposed = false
    let film: FilmHandle | null = null
    let loading = false
    let near = false
    let shown = 1
    // An example picked while the engine loads is played once it arrives.
    let chosen = false

    // Before the fonts and the engine, the end of the story stays hidden (4 s at most).
    let waiting = 0
    const stopWaiting = () => {
      window.clearTimeout(waiting)
      el.classList.remove("rv-d--attente")
    }
    if (!reduce.matches) {
      el.classList.add("rv-d--attente")
      waiting = window.setTimeout(stopWaiting, 4000)
    }

    const still = (n: number) => {
      shown = n
      el.setAttribute("data-fixe", FRAMES[n])
      buttons.forEach((b, i) => {
        if (i === n) b.setAttribute("aria-current", "true")
        else b.removeAttribute("aria-current")
        b.style.removeProperty("--rv-p")
      })
    }

    const fonts = filmFontsReady(el).then(() => {
      if (!disposed) fitFilm(el)
    })
    // A font that arrives after the three seconds of filmFontsReady: measure again.
    const refit = () => {
      if (!disposed) fitFilm(el)
    }
    document.fonts?.addEventListener?.("loadingdone", refit)

    const start = () => {
      if (film || loading || disposed || reduce.matches || !near) return
      loading = true
      Promise.all([fonts, import("./revue-film-engine")])
        .then(([, engine]) => {
          loading = false
          if (disposed || film || reduce.matches) return
          film = engine.createFilm(el, {
            buttons,
            pauseLabel: pause,
            playLabel: play,
            onStation: (station) => el.dispatchEvent(new CustomEvent("forge:station", { detail: station, bubbles: true })),
            onExample: (n) => {
              shown = n
            },
          })
          if (chosen) film.select(shown, false)
          stopWaiting()
        })
        .catch(() => {
          loading = false
          stopWaiting()
        })
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        near = true
        io.disconnect()
        start()
      },
      { rootMargin: "600px 0px" },
    )
    io.observe(el)

    const onReduce = () => {
      if (reduce.matches) {
        film?.destroy()
        film = null
        still(shown)
        stopWaiting()
      } else {
        start()
      }
    }
    reduce.addEventListener("change", onReduce)

    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>(".rv-ex")
      const n = button ? buttons.indexOf(button) : -1
      if (n < 0) return
      if (film) film.select(n)
      else {
        chosen = true
        still(n)
      }
    }
    box.addEventListener("click", onClick)

    return () => {
      disposed = true
      window.clearTimeout(waiting)
      document.fonts?.removeEventListener?.("loadingdone", refit)
      io.disconnect()
      reduce.removeEventListener("change", onReduce)
      box.removeEventListener("click", onClick)
      film?.destroy()
      film = null
    }
  }, [pause, play])

  return (
    <div className="rv-film">
      <div className="rv-d" id="rv-film" ref={root}>
        <div className="rv-d__scene">
          <div className="rv-d__fond" aria-hidden="true">
            <Image className="rv-d__img" src={lensAssets.finale} alt="" width={1536} height={1024} unoptimized loading="lazy" />
            <div className="rv-d__voile" />
          </div>
          <div className="rv-d__col" role="img" aria-label={copy.aria}>
            {/* 1. The payment about to leave. */}
            <div className="rv-d__plan rv-d__plan--1">
              <div className="rv-d__haut">
                <Rising className="rv-d__sur">
                  <span className="rv-d__point rv-d__point--ambre">
                    <i className="rv-d__pouls" />
                  </span>
                  {copy.ready}
                </Rising>
                <p className="rv-d__geant rv-d__bebas rv-d__montant" data-rv-fit="one" data-rv-kern="">
                  <span className="rv-d__m">
                    <Letters text={copy.amount} />
                  </span>
                </p>
              </div>
              <div className="rv-d__bas">
                <Rising className="rv-d__leg">{copy.payee}</Rising>
              </div>
            </div>

            {/* 2. The IBAN, read part by part. */}
            <div className="rv-d__plan rv-d__plan--2">
              <div className="rv-d__haut">
                <Rising className="rv-d__sur">{copy.reading}</Rising>
                <p className="rv-d__iban">
                  <span className="rv-d__ibl">
                    <Part kind="pays" digits="DE" halo="ambre" label={copy.parts.country} />
                    <Part kind="cle" digits="89" halo="ambre" label={copy.parts.check} />
                  </span>{" "}
                  <span className="rv-d__ibl">
                    <Part kind="banque" digits="3704 0044" halo="ambre" label={copy.parts.bank} />
                  </span>{" "}
                  <span className="rv-d__ibl">
                    <Part kind="compte" digits="0532 0130 00" halo="ambre" label={copy.parts.account} />
                  </span>
                </p>
              </div>
            </div>

            {/* 3. The bank, pulled into focus. */}
            <div className="rv-d__plan rv-d__plan--3">
              <div className="rv-d__haut">
                <Rising className="rv-d__sur rv-d__sur--vert">
                  <span className="rv-d__point rv-d__point--vert">
                    <i className="rv-d__pouls" />
                  </span>
                  {copy.confirmed}
                </Rising>
                <p className="rv-d__geant rv-d__banque" data-rv-fit="one">
                  Commerzbank.
                </p>
              </div>
              <div className="rv-d__bas rv-d__bas--banque">
                <Rising className="rv-d__leg">{copy.confirmedBy}</Rising>
                <Rising className="rv-d__bic">
                  <span className="rv-d__bic-lib">BIC</span>
                  <span className="rv-d__code">COBADEFFXXX</span>
                </Rising>
              </div>
            </div>

            {/* 4. The same invoice, another IBAN: the check passes, no bank holds the code. */}
            <div className="rv-d__plan rv-d__plan--4">
              <div className="rv-d__haut">
                <Rising className="rv-d__sur">{copy.sameInvoice}</Rising>
                <p className="rv-d__iban">
                  <span className="rv-d__ibl">
                    <Part kind="pays" digits="DE" />
                    <Part kind="cle" digits="65" halo="ambre" label={copy.checkValid} />
                  </span>{" "}
                  <span className="rv-d__ibl">
                    <Part kind="banque" digits="1234 5678" strike label={copy.unallocated} red rule={false} />
                  </span>{" "}
                  <span className="rv-d__ibl">
                    <Part kind="compte" digits="0532 0130 00" />
                  </span>
                </p>
              </div>
            </div>

            {/* 5. The verdict, held long. */}
            <div className="rv-d__plan rv-d__plan--5">
              <div className="rv-d__haut">
                <Rising className="rv-d__sur rv-d__preuve">
                  DE65 <span className="rv-d__raye">1234 5678</span> 0532 0130 00
                </Rising>
                <Verdict lines={copy.stopLines} />
              </div>
              <div className="rv-d__bas">
                <i className="rv-d__regle" />
                <Rising className="rv-d__leg rv-d__raison">{copy.stopReason}</Rising>
              </div>
            </div>

            {/* 6. The third example: a typo, the check digits do not match. */}
            <div className="rv-d__plan rv-d__plan--6">
              <div className="rv-d__haut">
                <Rising className="rv-d__sur">{copy.typo}</Rising>
                <p className="rv-d__iban">
                  <span className="rv-d__ibl">
                    <Part kind="pays" digits="DE" />
                    <Part kind="cle" digits="89" halo="rouge" />
                  </span>{" "}
                  <span className="rv-d__ibl">
                    <Part kind="banque" digits="3704 0044" />
                  </span>{" "}
                  <span className="rv-d__ibl">
                    <Part kind="compte" digits="0532 0130 01" />
                  </span>
                </p>
              </div>
              <div className="rv-d__bas">
                <Rising className="rv-d__leg rv-d__leg--rouge">{copy.checksum}</Rising>
              </div>
            </div>

            {/* 7. Its verdict. */}
            <div className="rv-d__plan rv-d__plan--7">
              <div className="rv-d__haut">
                <Rising className="rv-d__sur rv-d__preuve">DE89 3704 0044 0532 0130 01</Rising>
                <Verdict lines={copy.fixLines} className="rv-d__saisie" />
              </div>
              <div className="rv-d__bas">
                <i className="rv-d__regle" />
                <Rising className="rv-d__leg rv-d__raison">{copy.fixNote}</Rising>
              </div>
            </div>
          </div>
          <button className="rv-d__pause" type="button" aria-label={copy.pause}>
            <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false">
              <circle className="rv-d__anneau-fond" cx="18" cy="18" r="16.5" />
              <circle
                className="rv-d__anneau"
                cx="18"
                cy="18"
                r="16.5"
                transform="rotate(-90 18 18)"
                strokeDasharray="103.67"
                strokeDashoffset="103.67"
              />
              <g className="rv-d__ic-pause" fill="currentColor">
                <rect x="13.5" y="12.5" width="2.6" height="11" rx="1" />
                <rect x="19.9" y="12.5" width="2.6" height="11" rx="1" />
              </g>
              <path
                className="rv-d__ic-lire"
                fill="currentColor"
                d="M15 12.4v11.2c0 .6.7 1 1.2.7l8.4-5.6c.4-.3.4-1 0-1.3l-8.4-5.6c-.5-.4-1.2 0-1.2.6z"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="rv-grille rv-film__legende">
        <p className="rv-figcap">
          <span className="rv-figcap__num">{copy.figure}</span>
          <span>{copy.caption}</span>
        </p>
        <div className="rv-exemples" role="group" aria-labelledby="rv-exemples-titre" ref={group}>
          <p className="rv-kicker rv-exemples__titre" id="rv-exemples-titre">
            {copy.examples}
          </p>
          {copy.tabs.map((label, i) => (
            <button
              key={i}
              className="rv-ex"
              type="button"
              aria-controls="rv-film"
              aria-current={i === 1 ? "true" : undefined}
              data-evt={`film:example-${"abc"[i]}`}
            >
              <span className="rv-ex__lettre" aria-hidden="true">
                {"ABC"[i]}
              </span>
              {label}
              <i className="rv-ex__barre" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
