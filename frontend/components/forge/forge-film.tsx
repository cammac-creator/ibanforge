"use client"

/**
 * The forge film — four stations on ONE pinned screen, scrubbed by scroll.
 *
 * Engine: GSAP 3.15 (standard "no charge" licence) with ScrollTrigger,
 * SplitText and DrawSVG — bundled, started only with JS and motion allowed.
 * One master timeline, four station timelines added back to back: a station
 * enters (0→0.10), plays its beats (0.10→0.86) and leaves (0.90→1.0) BEFORE
 * the next one enters, so two stations never share the screen. ScrollTrigger
 * pins the screen for four station-lengths of scroll and scrubs the timeline
 * with a short lag, which is what makes the motion feel weighted.
 *
 * Rebuilt twice on 2026-09-04: a pin per station animated over 40vh and slid
 * away finished over a dead viewport ("it runs backwards"); then a manual
 * crossfade let two stations overlap ("they walk over each other"). Both
 * are gone by construction here.
 *
 * PE-safe: this component server-renders complete static content; every
 * hidden start state in globals.css is gated behind `html.js` +
 * `prefers-reduced-motion: no-preference`, and the engine bails out entirely
 * under reduced motion. Without JS the film reads as four stacked blocks.
 */

import { useEffect, useRef } from "react"
import { STATIONS } from "./forge-constants"

export interface FilmStrings {
  heading: string
  heat: {
    eyebrow: string; title: string; copy: string
    country: string; check: string; bank: string; account: string
    /** The IBAN and its parts, read aloud instead of the split characters. */
    ibanAria: string
  }
  strike: { eyebrow: string; title: string; valid: string }
  quench: {
    eyebrow: string; title: string; copy: string
    noMatch: string; lists: string
    fatf: string; sepa: string; risk: string
  }
  stamp: {
    eyebrow: string; title: string; copy: string
    iid: string; sic: string; eurosic: string; instant: string
  }
  ship: { eyebrow: string; title: string; head: string; tryLive: string; copy: string; processingMs: string }
}

/* Static SVG scenery, kept as trusted constants so the JSX stays legible.
   Nothing user-controlled flows in here. Elements the engine drives carry a
   class: turb, heat-glow, hammer, arcs, rp, sm, ring-c, flash, mark, cart,
   rail-l. The forge palette only: amber, red, steel, green — no cyan. */

const SCENE_HEAT = `<defs><radialGradient id="hglow" cx="50%" cy="100%" r="65%"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0.16"/><stop offset="55%" stop-color="#EF4444" stop-opacity="0.06"/><stop offset="100%" stop-color="#EF4444" stop-opacity="0"/></radialGradient><radialGradient id="hember" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FCD34D" stop-opacity="0.9"/><stop offset="45%" stop-color="#F59E0B" stop-opacity="0.55"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></radialGradient><filter id="haze" x="-5%" y="-10%" width="110%" height="120%"><feTurbulence class="turb" type="fractalNoise" baseFrequency="0.010 0.026" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter></defs><rect class="heat-glow" x="0" y="335" width="1200" height="340" fill="url(#hglow)" opacity="0.5"/><g class="floor" filter="url(#haze)"><polygon fill="#1A1310" points="0,675 0,616 130,596 260,622 390,600 540,630 700,604 860,628 1010,602 1200,624 1200,675"/><polygon fill="#120E09" points="0,675 0,642 110,624 250,650 400,628 560,654 720,632 880,652 1040,630 1200,648 1200,675"/><g><circle cx="180" cy="640" r="16" fill="url(#hember)"/><circle cx="415" cy="647" r="11" fill="url(#hember)" opacity="0.8"/><circle cx="655" cy="642" r="18" fill="url(#hember)"/><circle cx="905" cy="646" r="12" fill="url(#hember)" opacity="0.7"/><circle cx="1105" cy="638" r="14" fill="url(#hember)" opacity="0.85"/></g><g fill="#FCD34D"><rect x="174" y="636" width="13" height="4" rx="1" opacity="0.85"/><rect x="410" y="644" width="9" height="3" rx="1" opacity="0.6"/><rect x="648" y="638" width="15" height="4" rx="1" opacity="0.9"/><rect x="900" y="643" width="9" height="3" rx="1" opacity="0.55"/><rect x="1099" y="634" width="11" height="4" rx="1" opacity="0.7"/></g><g fill="#EF4444"><rect x="300" y="649" width="7" height="3" rx="1" opacity="0.5"/><rect x="770" y="648" width="8" height="3" rx="1" opacity="0.5"/><rect x="1010" y="650" width="6" height="3" rx="1" opacity="0.45"/></g></g>`

const SCENE_STRIKE = `<defs><linearGradient id="srim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0.5"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></linearGradient></defs><g transform="translate(800,415) scale(0.72)"><g class="hammer" transform="rotate(-24 300 -60)" opacity="0.72"><rect x="255" y="-95" width="96" height="44" rx="6" fill="#221B13"/><rect x="292" y="-51" width="16" height="120" rx="5" fill="#1A140D"/></g><g class="arcs" stroke="#F59E0B" fill="none" stroke-linecap="round" opacity="0"><path d="M212,-18 q28,-34 74,-44" stroke-width="3"/><path d="M196,-40 q40,-52 108,-64" stroke-width="2" opacity="0.6"/></g><g opacity="0.62"><path fill="#191309" d="M18,0 L332,0 L332,40 Q332,52 318,54 L250,60 L236,132 L112,132 L98,60 Q40,58 12,34 Q-6,18 2,4 Z"/><polygon fill="#191309" points="92,132 256,132 300,186 48,186"/><rect x="18" y="0" width="314" height="6" fill="url(#srim)"/></g></g>`

const SCENE_QUENCH = `<defs><linearGradient id="qwater" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#94A3B8" stop-opacity="0.2"/><stop offset="100%" stop-color="#94A3B8" stop-opacity="0"/></linearGradient><radialGradient id="qsteam" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#E2E8F0" stop-opacity="0.9"/><stop offset="55%" stop-color="#E2E8F0" stop-opacity="0.35"/><stop offset="100%" stop-color="#E2E8F0" stop-opacity="0"/></radialGradient></defs><rect x="0" y="560" width="1200" height="115" fill="url(#qwater)"/><line x1="0" y1="560" x2="1200" y2="560" stroke="#CBD5E1" stroke-opacity="0.4" stroke-width="1.5"/><g transform="translate(600 586)"><ellipse class="rp" rx="52" ry="12" fill="none" stroke="#CBD5E1" stroke-width="2" opacity="0"/><ellipse class="rp" rx="52" ry="12" fill="none" stroke="#CBD5E1" stroke-width="1.6" opacity="0"/><ellipse class="rp" rx="52" ry="12" fill="none" stroke="#E2E8F0" stroke-width="1.2" opacity="0"/></g><g fill="url(#qsteam)"><circle class="sm" cx="520" cy="575" r="42" opacity="0"/><circle class="sm" cx="600" cy="580" r="54" opacity="0"/><circle class="sm" cx="690" cy="572" r="36" opacity="0"/><circle class="sm" cx="560" cy="590" r="30" opacity="0"/><circle class="sm" cx="650" cy="588" r="46" opacity="0"/><circle class="sm" cx="730" cy="584" r="26" opacity="0"/></g>`

const SCENE_STAMP = `<defs><radialGradient id="sflash" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFF7ED" stop-opacity="0.95"/><stop offset="45%" stop-color="#F59E0B" stop-opacity="0.45"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></radialGradient></defs><g transform="translate(930,300)"><circle class="flash" r="190" fill="url(#sflash)" opacity="0"/><circle class="ring-c" r="158" fill="none" stroke="#3B352E" stroke-width="3" opacity="0.55"/><g class="ring"><circle r="126" fill="none" stroke="#3B352E" stroke-width="1.5" stroke-dasharray="10 16" opacity="0.5"/></g><g stroke="#3B352E" stroke-width="2.5" opacity="0.55"><line x1="0" y1="-158" x2="0" y2="-140"/><line x1="0" y1="158" x2="0" y2="140"/><line x1="-158" y1="0" x2="-140" y2="0"/><line x1="158" y1="0" x2="140" y2="0"/></g><g class="mark" transform="translate(-46,-46)" fill="#F59E0B" opacity="0.16"><rect x="10" y="38" width="80" height="16"/><polygon points="24,54 76,54 62,78 38,78"/><polygon points="34,78 66,78 76,92 24,92"/><rect x="22" y="26" width="8" height="9"/><rect x="34" y="16" width="8" height="19"/><rect x="46" y="8" width="8" height="27"/><rect x="58" y="16" width="8" height="19"/><rect x="70" y="26" width="8" height="9"/></g></g>`

const SCENE_SHIP = `<defs><linearGradient id="ptrail" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0.4"/></linearGradient><radialGradient id="piglow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0.3"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></radialGradient></defs><g opacity="0.6"><g stroke="#3B352E"><line class="rail-l" x1="0" y1="646" x2="1200" y2="596" stroke-width="3"/><line class="rail-l" x1="0" y1="668" x2="1200" y2="630" stroke-width="2.5"/><g stroke-width="2"><line x1="90" y1="648" x2="82" y2="668"/><line x1="270" y1="641" x2="264" y2="663"/><line x1="450" y1="633" x2="446" y2="657"/><line x1="630" y1="626" x2="628" y2="652"/><line x1="810" y1="618" x2="810" y2="646"/><line x1="990" y1="611" x2="992" y2="640"/><line x1="1170" y1="603" x2="1174" y2="635"/></g></g><g class="cart"><ellipse cx="700" cy="612" rx="120" ry="26" fill="url(#piglow)"/><rect x="560" y="601" width="130" height="6" rx="3" fill="url(#ptrail)"/><g transform="rotate(-2.4 700 606)"><rect x="652" y="592" width="96" height="20" rx="3" fill="#26201A"/><rect x="652" y="592" width="96" height="4" rx="2" fill="#F59E0B" opacity="0.55"/><circle cx="700" cy="602" r="6" fill="#F59E0B" opacity="0.5"/></g></g></g>`

// The mod-97 rearrangement, one span per digit with its authored scatter
// vector (CSS vars for the static resting state, data attributes for the
// engine); the parent carries the readable aria-label.
const MOD_DIGITS: Array<[string, number, number]> = [
  ["0", -26, -18], ["0", 18, 22], ["2", -9, 14], ["3", 31, -11], ["0", -22, 8],
  ["0", 12, -24], ["0", -33, -6], ["0", 7, 19], ["0", 24, 12], ["0", -14, -21],
  ["0", 9, 26], ["0", -28, 5], ["1", 16, -15], ["2", -6, 23], ["3", 29, -9],
  ["4", -19, -13], ["5", 11, 17], ["1", -31, 9], ["2", 21, -19], ["1", -8, -25],
  ["7", 26, 14], ["1", -16, 20], ["0", 13, -12],
]

const MOD_LINE = MOD_DIGITS.map(
  ([d, dx, dy]) =>
    `<span style="--dx:${dx}px;--dy:${dy}px" data-dx="${dx}" data-dy="${dy}" aria-hidden="true">${d}</span>`,
).join("")

// The REAL captured /v1/iban/validate payload for the UBS example — the same
// single source of truth the playground ships (playground/examples.ts).
// One <span class="jl"> per line, so the answer can print itself in.
const JSON_OUT = `{
  <span class="k">"valid"</span>: <span class="n">true</span>,
  <span class="k">"bic"</span>: {
    <span class="k">"code"</span>: <span class="s">"UBSWCHZH"</span>,
    <span class="k">"bank_name"</span>: <span class="s">"UBS Switzerland AG"</span>
  },
  <span class="k">"clearing"</span>: {
    <span class="k">"iid"</span>: <span class="s">"00230"</span>,
    <span class="k">"sic"</span>: <span class="n">true</span>,
    <span class="k">"eurosic"</span>: <span class="n">true</span>,
    <span class="k">"instant_payments_chf"</span>: <span class="n">true</span>
  },
  <span class="k">"sepa"</span>: { <span class="k">"member"</span>: <span class="n">true</span>, <span class="k">"schemes"</span>: [<span class="s">"SCT"</span>, <span class="s">"SDD"</span>] },
  <span class="k">"risk_indicators"</span>: { <span class="k">"country_risk"</span>: <span class="s">"standard"</span> },
  <span class="k">"processing_ms"</span>: <span class="n">__MS__</span>
}`
// The one latency figure of the page (lib/landing-stats P50_PROCESSING_MS),
// handed down by the page; the literal is ours, never user input.
const jsonLines = (ms: string) =>
  JSON_OUT.replace("__MS__", ms).split("\n").map((l) => `<span class="jl">${l}</span>`).join("")

function Scene({ html, mid = false }: { html: string; mid?: boolean }) {
  return (
    <svg
      className="scene"
      viewBox="0 0 1200 675"
      preserveAspectRatio={mid ? "xMidYMid slice" : "xMidYMax slice"}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function ForgeFilm({ t, playgroundHref }: { t: FilmStrings; playgroundHref: string }) {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return
    // The engine (GSAP and the timelines) loads on the first of three signals:
    // the film comes within two screens, the visitor scrolls, or the page has
    // gone idle. Never during the first paint (audit 2026-09-05, n° 2), and
    // never as late as the 2026-09-04 on-demand chunk that arrived 4 to 6 s
    // after the page: at idle the network is quiet and the film is still two
    // screens away for anyone reading the fold.
    const el: HTMLElement = root
    let cancelled = false
    let started = false
    let teardown: (() => void) | null = null
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) start()
    }, { rootMargin: "200% 0px" })
    let idle: number | null = null
    function start() {
      if (started) return
      started = true
      io.disconnect()
      window.removeEventListener("scroll", start)
      if (idle !== null) (win.cancelIdleCallback ?? window.clearTimeout)(idle)
      import("./forge-engine")
        .then((m) => { if (!cancelled) teardown = m.mountFilm(el) })
        .catch(() => { /* the four stations stay readable, stacked */ })
    }
    io.observe(root)
    window.addEventListener("scroll", start, { once: true, passive: true })
    idle = win.requestIdleCallback
      ? win.requestIdleCallback(start, { timeout: 4000 })
      : window.setTimeout(start, 2500)
    return () => {
      cancelled = true
      io.disconnect()
      window.removeEventListener("scroll", start)
      if (idle !== null) (win.cancelIdleCallback ?? window.clearTimeout)(idle)
      teardown?.()
    }
  }, [])

  return (
    <section className="film" ref={rootRef} aria-labelledby="h-film">
      {/* One real h2 names the film; the stations are h3 beneath it. */}
      <h2 className="sr-only" id="h-film">{t.heading}</h2>
      <div className="pin">
        <canvas className="forge-gl" aria-hidden="true" hidden />
        <div className="rail" aria-hidden="true"><span className="rail-head" /></div>
        <ol className="film-dots" aria-hidden="true">
          {Array.from({ length: STATIONS }, (_, i) => <li key={i} />)}
        </ol>

        {/* 01 · HEAT + STRIKE */}
        <article className="st">
          <Scene html={SCENE_HEAT} />
          <Scene html={SCENE_STRIKE} />
          <canvas className="sparks-canvas" aria-hidden="true" />
          <div className="st-inner">
            <p className="st-eyebrow"><span className="st-num">01</span> <span className="eyebrow">{t.heat.eyebrow} · {t.strike.eyebrow}</span></p>
            <h3 className="st-title">{t.heat.title}</h3>
            <div className="st-stage">
              <p className="sr-only">{t.heat.ibanAria}</p>
              <p className="iban-bar" aria-hidden="true">
                <span className="seg seg-cc"><b>CH</b><i>{t.heat.country}</i></span>
                <span className="seg seg-ck"><b>10</b><i>{t.heat.check}</i></span>
                <span className="seg seg-bank"><b>00230</b><i>{t.heat.bank}</i></span>
                <span className="seg seg-acct"><b>000000012345</b><i>{t.heat.account}</i></span>
              </p>
              <p
                className="mod-line"
                role="img"
                aria-label="00230000000012345121710"
                dangerouslySetInnerHTML={{ __html: MOD_LINE }}
              />
              <p className="stamp-ok" data-t="">{t.strike.valid}</p>
            </div>
            <p className="st-copy">{t.heat.copy}</p>
          </div>
        </article>

        {/* 02 · QUENCH */}
        <article className="st">
          <div className="q-layer q-hot" aria-hidden="true" />
          <div className="q-layer q-cold" aria-hidden="true" />
          <Scene html={SCENE_QUENCH} />
          <div className="st-inner">
            <p className="st-eyebrow"><span className="st-num">02</span> <span className="eyebrow">{t.quench.eyebrow}</span></p>
            <h3 className="st-title">{t.quench.title}</h3>
            <div className="st-stage">
              <ul className="quench">
                {/* One message key carries the whole screened set ("OFAC · EU · UN"):
                    the sanctions-claims guard requires any line naming an authority
                    to name all of them, so the set is split here, never in i18n. */}
                {t.quench.lists.split('·').map((l) => (
                  <li className="q-row" key={l}><span>{l.trim()}</span><span className="q-res">{t.quench.noMatch}</span></li>
                ))}
              </ul>
              <p className="q-badges">
                <span className="q-badge" data-t="">{t.quench.fatf}</span>
                <span className="q-badge" data-t="">{t.quench.sepa}</span>
                <span className="q-badge risk" data-t="">{t.quench.risk}</span>
              </p>
            </div>
            <p className="st-copy">{t.quench.copy}</p>
          </div>
        </article>

        {/* 03 · STAMP */}
        <article className="st">
          <Scene html={SCENE_STAMP} mid />
          <div className="st-inner">
            <p className="st-eyebrow"><span className="st-num">03</span> <span className="eyebrow">{t.stamp.eyebrow}</span></p>
            <h3 className="st-title">{t.stamp.title}</h3>
            <div className="st-stage">
              <div className="seal">
                <p className="seal-bic">UBSWCHZH</p>
                <p className="seal-bank">UBS Switzerland AG</p>
                <p className="seal-city">Zürich · Switzerland</p>
              </div>
              <ul className="clr-chips">
                <li data-t="">{t.stamp.iid} <b>00230</b></li>
                <li data-t="">{t.stamp.sic} <b>✓</b></li>
                <li data-t="">{t.stamp.eurosic} <b>✓</b></li>
                <li data-t="">{t.stamp.instant} <b>✓</b></li>
              </ul>
            </div>
            <p className="st-copy">{t.stamp.copy}</p>
          </div>
        </article>

        {/* 04 · SHIP */}
        <article className="st">
          <Scene html={SCENE_SHIP} />
          <div className="st-inner">
            <p className="st-eyebrow"><span className="st-num">04</span> <span className="eyebrow">{t.ship.eyebrow}</span></p>
            <h3 className="st-title">{t.ship.title}</h3>
            <div className="st-stage">
              <figure className="ship">
                <figcaption className="ship-head"><span className="pill-ok">200 OK</span><span>{t.ship.head}</span></figcaption>
                <pre className="json-out"><code dangerouslySetInnerHTML={{ __html: jsonLines(t.ship.processingMs) }} /></pre>
              </figure>
              <p className="try-live" data-t=""><a className="btn-ghost-link" href={playgroundHref}>{t.ship.tryLive}</a></p>
            </div>
            <p className="st-copy">{t.ship.copy}</p>
          </div>
        </article>
      </div>
    </section>
  )
}
