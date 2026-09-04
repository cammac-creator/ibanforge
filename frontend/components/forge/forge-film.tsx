"use client"

/**
 * The forge film — four stations on ONE pinned screen, scrubbed by scroll.
 *
 * Rebuilt 2026-09-04 (evening) after Claude-Alain saw the film "run backwards":
 * with one sticky pin per station, a station animated over its short scrub
 * (40vh) and then slid away, finished, over a full viewport of dead scroll —
 * every beat seemed to happen at the end. Now a single 100svh pin holds the
 * four stations stacked; the section's height is the whole timeline
 * (4 × --film-s), and a global progress g ∈ [0,1] is split into a station
 * index and a local p ∈ [0,1] that drives every beat. Consecutive stations
 * crossfade over 14 % of a station; nothing on screen is ever idle.
 *
 * PE-safe by construction: this component server-renders complete static
 * content; every hidden start state in globals.css is gated behind
 * `html.js` + `prefers-reduced-motion: no-preference`, and the engine below
 * bails out entirely under reduced motion. Without JS the film reads as four
 * stacked, fully readable blocks.
 */

import { useEffect, useRef } from "react"

export interface FilmStrings {
  heading: string
  heat: {
    eyebrow: string; title: string; copy: string
    country: string; check: string; bank: string; account: string
  }
  strike: { eyebrow: string; title: string; note: string; valid: string; copy: string }
  quench: {
    eyebrow: string; title: string; copy: string
    noMatch: string; lists: string
    fatf: string; sepa: string; risk: string
  }
  stamp: {
    eyebrow: string; title: string; copy: string
    iid: string; sic: string; eurosic: string; instant: string
  }
  ship: { eyebrow: string; title: string; head: string; tryLive: string; copy: string }
}

/* Static SVG scenery + data-heavy markup, kept as trusted constants so the
   JSX stays legible. Nothing user-controlled flows in here. Elements the
   engine drives carry a class (heat-glow, hammer, arcs, rp, sm, ring, flash,
   mark, cart). */

const SCENE_HEAT = `<defs><radialGradient id="hglow" cx="50%" cy="100%" r="65%"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0.16"/><stop offset="55%" stop-color="#EF4444" stop-opacity="0.06"/><stop offset="100%" stop-color="#EF4444" stop-opacity="0"/></radialGradient><radialGradient id="hember" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FCD34D" stop-opacity="0.9"/><stop offset="45%" stop-color="#F59E0B" stop-opacity="0.55"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></radialGradient></defs><rect class="heat-glow" x="0" y="335" width="1200" height="340" fill="url(#hglow)" opacity="0.5"/><polygon fill="#1A1310" points="0,675 0,616 130,596 260,622 390,600 540,630 700,604 860,628 1010,602 1200,624 1200,675"/><polygon fill="#120E09" points="0,675 0,642 110,624 250,650 400,628 560,654 720,632 880,652 1040,630 1200,648 1200,675"/><g><circle cx="180" cy="640" r="16" fill="url(#hember)"/><circle cx="415" cy="647" r="11" fill="url(#hember)" opacity="0.8"/><circle cx="655" cy="642" r="18" fill="url(#hember)"/><circle cx="905" cy="646" r="12" fill="url(#hember)" opacity="0.7"/><circle cx="1105" cy="638" r="14" fill="url(#hember)" opacity="0.85"/></g><g fill="#FCD34D"><rect x="174" y="636" width="13" height="4" rx="1" opacity="0.85"/><rect x="410" y="644" width="9" height="3" rx="1" opacity="0.6"/><rect x="648" y="638" width="15" height="4" rx="1" opacity="0.9"/><rect x="900" y="643" width="9" height="3" rx="1" opacity="0.55"/><rect x="1099" y="634" width="11" height="4" rx="1" opacity="0.7"/></g><g fill="#EF4444"><rect x="300" y="649" width="7" height="3" rx="1" opacity="0.5"/><rect x="770" y="648" width="8" height="3" rx="1" opacity="0.5"/><rect x="1010" y="650" width="6" height="3" rx="1" opacity="0.45"/></g>`

const SCENE_STRIKE = `<defs><linearGradient id="srim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0.5"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></linearGradient></defs><g transform="translate(800,415) scale(0.72)"><g class="hammer" transform="rotate(-24 300 -60)" opacity="0.7"><rect x="255" y="-95" width="96" height="44" rx="6" fill="#221B13"/><rect x="292" y="-51" width="16" height="120" rx="5" fill="#1A140D"/></g><g class="arcs" stroke="#F59E0B" fill="none" stroke-linecap="round" opacity="0"><path d="M212,-18 q28,-34 74,-44" stroke-width="3"/><path d="M196,-40 q40,-52 108,-64" stroke-width="2" opacity="0.6"/></g><g opacity="0.62"><path fill="#191309" d="M18,0 L332,0 L332,40 Q332,52 318,54 L250,60 L236,132 L112,132 L98,60 Q40,58 12,34 Q-6,18 2,4 Z"/><polygon fill="#191309" points="92,132 256,132 300,186 48,186"/><rect x="18" y="0" width="314" height="6" fill="url(#srim)"/></g></g>`

const SCENE_QUENCH = `<defs><linearGradient id="qwater" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38BDF8" stop-opacity="0.22"/><stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/></linearGradient><filter id="qblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter></defs><rect x="0" y="560" width="1200" height="115" fill="url(#qwater)"/><line x1="0" y1="560" x2="1200" y2="560" stroke="#38BDF8" stroke-opacity="0.35" stroke-width="1.5"/><g transform="translate(600 586)"><ellipse class="rp" rx="52" ry="12" fill="none" stroke="#38BDF8" stroke-width="2" opacity="0"/><ellipse class="rp" rx="52" ry="12" fill="none" stroke="#38BDF8" stroke-width="1.6" opacity="0"/><ellipse class="rp" rx="52" ry="12" fill="none" stroke="#7DD3FC" stroke-width="1.2" opacity="0"/></g><g filter="url(#qblur)" fill="#BAE6FD"><circle class="sm" cx="520" cy="575" r="26" opacity="0"/><circle class="sm" cx="600" cy="580" r="34" opacity="0"/><circle class="sm" cx="690" cy="572" r="22" opacity="0"/><circle class="sm" cx="560" cy="590" r="18" opacity="0"/><circle class="sm" cx="650" cy="588" r="28" opacity="0"/><circle class="sm" cx="730" cy="584" r="16" opacity="0"/></g>`

const SCENE_STAMP = `<g transform="translate(930,300)"><circle class="flash" r="172" fill="#FFF7ED" opacity="0"/><circle r="158" fill="none" stroke="#3B352E" stroke-width="3" opacity="0.55"/><g class="ring"><circle r="126" fill="none" stroke="#3B352E" stroke-width="1.5" stroke-dasharray="10 16" opacity="0.5"/></g><g stroke="#3B352E" stroke-width="2.5" opacity="0.55"><line x1="0" y1="-158" x2="0" y2="-140"/><line x1="0" y1="158" x2="0" y2="140"/><line x1="-158" y1="0" x2="-140" y2="0"/><line x1="158" y1="0" x2="140" y2="0"/></g><g class="mark" transform="translate(-46,-46)" fill="#F59E0B" opacity="0.16"><rect x="10" y="38" width="80" height="16"/><polygon points="24,54 76,54 62,78 38,78"/><polygon points="34,78 66,78 76,92 24,92"/><rect x="22" y="26" width="8" height="9"/><rect x="34" y="16" width="8" height="19"/><rect x="46" y="8" width="8" height="27"/><rect x="58" y="16" width="8" height="19"/><rect x="70" y="26" width="8" height="9"/></g></g>`

const SCENE_SHIP = `<defs><linearGradient id="ptrail" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0.4"/></linearGradient><radialGradient id="piglow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#F59E0B" stop-opacity="0.3"/><stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/></radialGradient></defs><g opacity="0.6"><g stroke="#3B352E"><line x1="0" y1="646" x2="1200" y2="596" stroke-width="3"/><line x1="0" y1="668" x2="1200" y2="630" stroke-width="2.5"/><g stroke-width="2"><line x1="90" y1="648" x2="82" y2="668"/><line x1="270" y1="641" x2="264" y2="663"/><line x1="450" y1="633" x2="446" y2="657"/><line x1="630" y1="626" x2="628" y2="652"/><line x1="810" y1="618" x2="810" y2="646"/><line x1="990" y1="611" x2="992" y2="640"/><line x1="1170" y1="603" x2="1174" y2="635"/></g></g><g class="cart"><ellipse cx="700" cy="612" rx="120" ry="26" fill="url(#piglow)"/><rect x="560" y="601" width="130" height="6" rx="3" fill="url(#ptrail)"/><g transform="rotate(-2.4 700 606)"><rect x="652" y="592" width="96" height="20" rx="3" fill="#26201A"/><rect x="652" y="592" width="96" height="4" rx="2" fill="#F59E0B" opacity="0.55"/><circle cx="700" cy="602" r="6" fill="#F59E0B" opacity="0.5"/></g></g></g>`

// The mod-97 rearrangement, one span per digit with its authored scatter
// vector; the parent carries the readable aria-label.
const MOD_DIGITS: Array<[string, number, number]> = [
  ["0", -26, -18], ["0", 18, 22], ["2", -9, 14], ["3", 31, -11], ["0", -22, 8],
  ["0", 12, -24], ["0", -33, -6], ["0", 7, 19], ["0", 24, 12], ["0", -14, -21],
  ["0", 9, 26], ["0", -28, 5], ["1", 16, -15], ["2", -6, 23], ["3", 29, -9],
  ["4", -19, -13], ["5", 11, 17], ["1", -31, 9], ["2", 21, -19], ["1", -8, -25],
  ["7", 26, 14], ["1", -16, 20], ["0", 13, -12],
]

const MOD_LINE = MOD_DIGITS.map(
  ([d, dx, dy]) => `<span style="--dx:${dx}px;--dy:${dy}px" aria-hidden="true">${d}</span>`,
).join("")

// The REAL captured /v1/iban/validate payload for the UBS example — the same
// single source of truth the playground ships (playground/examples.ts).
// One <span class="jl"> per line, so the answer can print itself in.
const JSON_OUT = `{
  <span class="k">"iban"</span>: <span class="s">"CH1000230000000012345"</span>,
  <span class="k">"valid"</span>: <span class="n">true</span>,
  <span class="k">"country"</span>: { <span class="k">"code"</span>: <span class="s">"CH"</span>, <span class="k">"name"</span>: <span class="s">"Switzerland"</span> },
  <span class="k">"check_digits"</span>: <span class="s">"10"</span>,
  <span class="k">"bban"</span>: { <span class="k">"bank_code"</span>: <span class="s">"00230"</span>, <span class="k">"account_number"</span>: <span class="s">"000000012345"</span> },
  <span class="k">"sepa"</span>: { <span class="k">"member"</span>: <span class="n">true</span>, <span class="k">"schemes"</span>: [<span class="s">"SCT"</span>, <span class="s">"SDD"</span>], <span class="k">"vop_required"</span>: <span class="n">false</span> },
  <span class="k">"formatted"</span>: <span class="s">"CH10 0023 0000 0000 1234 5"</span>,
  <span class="k">"bic"</span>: { <span class="k">"code"</span>: <span class="s">"UBSWCHZH"</span>, <span class="k">"bank_name"</span>: <span class="s">"UBS Switzerland AG"</span>, <span class="k">"city"</span>: <span class="s">"Zürich"</span> },
  <span class="k">"issuer"</span>: { <span class="k">"type"</span>: <span class="s">"bank"</span>, <span class="k">"name"</span>: <span class="s">"UBS Switzerland AG"</span> },
  <span class="k">"risk_indicators"</span>: {
    <span class="k">"issuer_type"</span>: <span class="s">"bank"</span>,
    <span class="k">"country_risk"</span>: <span class="s">"standard"</span>,
    <span class="k">"test_bic"</span>: <span class="n">false</span>,
    <span class="k">"sepa_reachable"</span>: <span class="n">true</span>,
    <span class="k">"vop_coverage"</span>: <span class="n">false</span>
  },
  <span class="k">"clearing"</span>: {
    <span class="k">"iid"</span>: <span class="s">"00230"</span>,
    <span class="k">"name"</span>: <span class="s">"UBS Switzerland AG"</span>,
    <span class="k">"type"</span>: <span class="s">"bank"</span>,
    <span class="k">"town"</span>: <span class="s">"Zürich"</span>,
    <span class="k">"sic"</span>: <span class="n">true</span>,
    <span class="k">"instant_payments_chf"</span>: <span class="n">true</span>,
    <span class="k">"eurosic"</span>: <span class="n">true</span>,
    <span class="k">"qr_iid"</span>: <span class="n">null</span>
  },
  <span class="k">"processing_ms"</span>: <span class="n">0.41</span>
}`
const JSON_LINES = JSON_OUT.split("\n").map((l) => `<span class="jl">${l}</span>`).join("")

const STATIONS = 4

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

    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k
    const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
    const sub = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
    const bump = (p: number, at: number, w: number) => Math.max(0, 1 - Math.abs(p - at) / w)
    const mix = (a: number[], b: number[], k: number) =>
      `rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`
    const DULL = [120, 113, 108], HOT = [255, 247, 237], AMBER = [245, 158, 11],
      RED = [239, 68, 68], BLUE = [56, 189, 248], STEEL = [148, 163, 184]

    const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)
    const qa = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel))
    const rail = q<HTMLElement>(".rail")
    const railHead = q<HTMLElement>(".rail-head")
    const dots = qa<HTMLElement>(".film-dots li")
    const ibanBar = q<HTMLElement>(".iban-bar")
    const segs = qa<HTMLElement>(".seg")
    const heatGlow = q<SVGElement>(".heat-glow")
    const hammer = q<SVGElement>(".hammer")
    const arcs = q<SVGElement>(".arcs")
    const modLine = q<HTMLElement>(".mod-line")
    const qRows = qa<HTMLElement>(".q-row")
    const qHot = q<HTMLElement>(".q-hot")
    const qCold = q<HTMLElement>(".q-cold")
    const ripples = qa<SVGElement>(".rp")
    const steam = qa<SVGElement>(".sm")
    const seal = q<HTMLElement>(".seal")
    const ring = q<SVGElement>(".ring")
    const flash = q<SVGElement>(".flash")
    const mark = q<SVGElement>(".mark")
    const ship = q<HTMLElement>(".ship")
    const jls = qa<HTMLElement>(".json-out .jl")
    const cart = q<SVGElement>(".cart")
    const pill = q<HTMLElement>(".pill-ok")
    const stations = qa<HTMLElement>(".st").map((el) => ({
      el,
      inner: el.querySelector<HTMLElement>(".st-inner"),
      scenes: Array.from(el.querySelectorAll<SVGElement>(".scene")),
      tags: Array.from(el.querySelectorAll<HTMLElement>("[data-t]")),
    }))
    const N = stations.length
    const OV = 0.14 // the crossfade, as a share of one station's scroll

    let vh = window.innerHeight
    let mobile = window.innerWidth < 720
    let sparksOn = !mobile
    let filmTop = 0, filmH = 0, railH = 0, strikeFlag = false
    const headH = 46

    const canvas = q<HTMLCanvasElement>(".sparks-canvas")
    const ctx = canvas ? canvas.getContext("2d") : null
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    interface Spark { x: number; y: number; vx: number; vy: number; l: number; d: number; s: number; w: number }
    let parts: Spark[] = []
    let needClear = false

    const resizeCanvas = () => {
      if (!canvas || !canvas.parentElement) return
      const r = canvas.parentElement.getBoundingClientRect()
      canvas.width = Math.floor(r.width * dpr)
      canvas.height = Math.floor(r.height * dpr)
    }
    const burst = () => {
      if (!sparksOn || !ctx || !canvas || !modLine) return
      const host = canvas.getBoundingClientRect()
      const ml = modLine.getBoundingClientRect()
      const cx = (ml.left + ml.width / 2 - host.left) * dpr
      const cy = (ml.top + ml.height / 2 - host.top) * dpr
      for (let i = 0; i < 110 && parts.length < 180; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = (2 + Math.random() * 8) * dpr
        parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3.5 * dpr,
          l: 1, d: 0.011 + Math.random() * 0.02, s: (0.8 + Math.random() * 2.2) * dpr, w: Math.random() })
      }
    }
    const drawSparks = () => {
      if (!ctx || !canvas) return
      if (parts.length === 0) {
        if (needClear) { ctx.clearRect(0, 0, canvas.width, canvas.height); needClear = false }
        return
      }
      needClear = true
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = "lighter"
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.x += p.vx; p.y += p.vy; p.vy += 0.14 * dpr; p.vx *= 0.985; p.l -= p.d
        if (p.l <= 0) { parts.splice(i, 1); continue }
        ctx.fillStyle = `rgba(${p.w < 0.5 ? "245,158,11" : "239,68,68"},${(p.l * 0.9).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.s * p.l + 0.4, 0, 6.2832)
        ctx.fill()
      }
      ctx.globalCompositeOperation = "source-over"
    }

    const measure = () => {
      vh = window.innerHeight
      mobile = window.innerWidth < 720
      sparksOn = !mobile
      const r = root.getBoundingClientRect()
      filmTop = r.top + window.scrollY
      filmH = root.offsetHeight
      railH = rail ? rail.offsetHeight : 0
      resizeCanvas()
    }

    // ── Station 0 · heat, then the strike ──
    // The address heats and splits (0.04→0.36), the hammer winds up
    // (0.40→0.56) while the rearranged digits fly into place, and comes
    // down at 0.60: sparks, a shake, the checksum stamp.
    const heat = (p: number) => {
      const e = ease(sub(p, 0.04, 0.36))
      if (ibanBar) {
        ibanBar.style.color = mix(DULL, HOT, e)
        ibanBar.style.textShadow =
          `0 0 ${(18 * e).toFixed(1)}px rgba(245,158,11,${(0.6 * e).toFixed(3)}),` +
          `0 2px ${(48 * e).toFixed(1)}px rgba(239,68,68,${(0.32 * e).toFixed(3)})`
      }
      if (heatGlow) heatGlow.setAttribute("opacity", (0.35 + 0.65 * e).toFixed(3))
      segs.forEach((sg) => {
        sg.classList.toggle("lit", p >= parseFloat(sg.getAttribute("data-lt") || "1"))
      })
      if (modLine) {
        const k = 1 - ease(sub(p, 0.44, 0.60))
        modLine.style.setProperty("--k", k.toFixed(4))
      }
      if (hammer) {
        let deg: number
        if (p < 0.40) deg = -24
        else if (p < 0.56) deg = -24 - 52 * ease(sub(p, 0.40, 0.56))
        else if (p < 0.60) deg = -76 + 84 * Math.pow(sub(p, 0.56, 0.60), 2)
        else deg = 8 - 32 * ease(sub(p, 0.60, 0.78))
        hammer.setAttribute("transform", `rotate(${deg.toFixed(1)} 300 -60)`)
      }
      if (arcs) arcs.setAttribute("opacity", (p >= 0.59 ? 0.9 * (1 - sub(p, 0.60, 0.74)) : 0).toFixed(3))
      if (p >= 0.60 && !strikeFlag) {
        strikeFlag = true
        burst()
        const inner = stations[0]?.inner
        if (inner) {
          inner.classList.add("shake")
          setTimeout(() => inner.classList.remove("shake"), 400)
        }
      }
      if (p < 0.5) strikeFlag = false
    }
    // ── Station 1 · quench ──
    // Three lists screened one after the other (0.08→0.58), the heat gives
    // way to cold, ripples spread and steam rises off the water.
    const quench = (p: number) => {
      qRows.forEach((row, i) => {
        const rp = ease(sub(p, 0.08 + i * 0.14, 0.30 + i * 0.14))
        row.style.clipPath = `inset(0 ${(100 - rp * 100).toFixed(2)}% 0 0)`
        row.classList.toggle("done", rp >= 1)
      })
      const cold = ease(sub(p, 0.12, 0.70))
      if (qHot) qHot.style.opacity = (1 - cold).toFixed(3)
      if (qCold) qCold.style.opacity = cold.toFixed(3)
      ripples.forEach((rp, k) => {
        const s = sub(p, 0.26 + k * 0.09, 0.80 + k * 0.09)
        rp.setAttribute("transform", `scale(${(1 + s * 6.5).toFixed(3)})`)
        rp.setAttribute("opacity", (s > 0 && s < 1 ? (1 - s) * 0.75 : 0).toFixed(3))
      })
      steam.forEach((sm, k) => {
        const s = sub(p, 0.28 + k * 0.05, 0.86 + k * 0.05)
        sm.setAttribute("transform", `translate(${((k % 2 ? 1 : -1) * s * 24).toFixed(1)} ${(-s * 250).toFixed(1)})`)
        sm.setAttribute("opacity", (4 * s * (1 - s) * 0.38).toFixed(3))
      })
    }
    // ── Station 2 · stamp ──
    // The seal drops and sets at 0.44 (a flash, the mark kicks), the ring
    // turns with the scroll, the clearing chips follow.
    const stamp = (p: number) => {
      const s = ease(sub(p, 0.10, 0.44))
      if (seal) {
        seal.style.opacity = s.toFixed(3)
        seal.style.transform = `scale(${(1.45 - 0.45 * s).toFixed(4)})`
        seal.classList.toggle("set", s >= 1)
      }
      if (ring) ring.setAttribute("transform", `rotate(${(p * 70).toFixed(1)})`)
      if (flash) flash.setAttribute("opacity", (bump(p, 0.45, 0.06) * 0.32).toFixed(3))
      if (mark) {
        const sc = 1 + 0.38 * bump(p, 0.45, 0.09)
        mark.setAttribute("transform", `translate(-46 -46) translate(50 50) scale(${sc.toFixed(3)}) translate(-50 -50)`)
        mark.setAttribute("opacity", (0.16 + 0.5 * bump(p, 0.45, 0.12)).toFixed(3))
      }
    }
    // ── Station 3 · ship ──
    // The answer card rises (0.06→0.34) and prints itself line by line
    // (0.18→0.72) while the cart rolls along the rail; 200 OK lights up.
    const shipFn = (p: number) => {
      const s = ease(sub(p, 0.06, 0.34))
      if (ship) {
        ship.style.opacity = s.toFixed(3)
        ship.style.transform = `translateY(${(44 - 44 * s).toFixed(1)}px)`
      }
      const count = Math.round(ease(sub(p, 0.18, 0.72)) * jls.length)
      jls.forEach((l, i) => l.classList.toggle("on", i < count))
      if (cart) {
        const dx = -520 + 940 * ease(sub(p, 0.05, 0.85))
        cart.setAttribute("transform", `translate(${dx.toFixed(1)} ${(-dx * 0.0417).toFixed(1)})`)
      }
      if (pill) pill.classList.toggle("on", p >= 0.36)
    }
    const updaters = [heat, quench, stamp, shipFn]

    let raf = 0
    let running = false
    const frame = () => {
      const y = window.scrollY
      const g = clamp01((y - filmTop) / Math.max(1, filmH - vh))
      const x = g * N

      stations.forEach((s, i) => {
        const local = x - i
        let f: number
        if (local < 0) f = i === 0 ? 1 : local < -OV ? 0 : ease(1 + local / OV)
        else if (local <= 1) f = 1
        else f = i === N - 1 ? 1 : local > 1 + OV ? 0 : ease(1 - (local - 1) / OV)
        const p = clamp01(local)
        const dy = local < 0 ? (1 - f) * 36 : local > 1 ? -(1 - f) * 26 : 0
        s.el.style.opacity = f.toFixed(3)
        s.el.style.transform = `translateY(${dy.toFixed(1)}px)`
        s.el.classList.toggle("live", f > 0.001)
        s.tags.forEach((el) => {
          el.classList.toggle("on", p >= parseFloat(el.getAttribute("data-t") || "1"))
        })
        // The scenery drifts a little slower than the words: depth, cheaply.
        s.scenes.forEach((sc) => {
          sc.style.transform = `translateY(${((0.5 - p) * 28).toFixed(1)}px) scale(1.05)`
        })
        updaters[i]?.(p)
      })

      if (railHead && railH) {
        railHead.style.transform = `translateY(${(g * (railH - headH)).toFixed(1)}px)`
        let col: string
        if (g < 0.3) col = mix(AMBER, RED, (g / 0.3) * 0.6)
        else if (g < 0.55) col = mix(RED, BLUE, sub(g, 0.3, 0.55))
        else col = mix(BLUE, STEEL, sub(g, 0.55, 1) * 0.5)
        railHead.style.background = col
        railHead.style.boxShadow = `0 0 14px ${col}, 0 0 34px ${col}`
      }
      const active = Math.min(N - 1, Math.floor(x))
      dots.forEach((d, i) => d.classList.toggle("on", i === active))

      drawSparks()
      if (running) raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }
    // The loop runs only while the film is within one viewport of the screen.
    const gate =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) start()
              else stop()
            },
            { rootMargin: "100% 0px 100% 0px" },
          )
        : null

    measure()
    window.addEventListener("resize", measure, { passive: true })
    window.addEventListener("load", measure)
    const settle = setTimeout(measure, 700) // fonts settling shifts offsets
    if (gate) gate.observe(root)
    else start()

    return () => {
      stop()
      gate?.disconnect()
      clearTimeout(settle)
      window.removeEventListener("resize", measure)
      window.removeEventListener("load", measure)
      parts = []
    }
  }, [])

  return (
    <section className="film" ref={rootRef} aria-labelledby="h-film">
      {/* One real h2 names the film; the stations are h3 beneath it. */}
      <h2 className="sr-only" id="h-film">{t.heading}</h2>
      <div className="pin">
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
              <p className="iban-bar"><span className="seg seg-cc" data-lt="0.10">CH</span><span className="seg seg-ck" data-lt="0.18">10</span><span className="seg seg-bank" data-lt="0.26">00230</span><span className="seg seg-acct" data-lt="0.34">000000012345</span></p>
              <ul className="parse">
                <li data-t="0.10"><span className="pdot pdot-cc" aria-hidden="true" />{t.heat.country}</li>
                <li data-t="0.18"><span className="pdot pdot-ck" aria-hidden="true" />{t.heat.check}</li>
                <li data-t="0.26"><span className="pdot pdot-bank" aria-hidden="true" />{t.heat.bank}</li>
                <li data-t="0.34"><span className="pdot pdot-acct" aria-hidden="true" />{t.heat.account}</li>
              </ul>
              <p className="mod-note" data-t="0.40">{t.strike.note}</p>
              <p
                className="mod-line"
                aria-label="00230000000012345121710"
                dangerouslySetInnerHTML={{ __html: MOD_LINE }}
              />
              <p className="mod-eq" data-t="0.66">mod 97 = <b>1</b></p>
              <p className="stamp-ok" data-t="0.72">{t.strike.valid}</p>
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
                <span className="q-badge" data-t="0.64">{t.quench.fatf}</span>
                <span className="q-badge" data-t="0.72">{t.quench.sepa}</span>
                <span className="q-badge risk" data-t="0.80">{t.quench.risk}</span>
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
                <li data-t="0.52">{t.stamp.iid} <b>00230</b></li>
                <li data-t="0.60">{t.stamp.sic} <b>✓</b></li>
                <li data-t="0.68">{t.stamp.eurosic} <b>✓</b></li>
                <li data-t="0.76">{t.stamp.instant} <b>✓</b></li>
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
                <pre className="json-out"><code dangerouslySetInnerHTML={{ __html: JSON_LINES }} /></pre>
              </figure>
              <p data-t="0.78"><a className="btn-ghost-link" href={playgroundHref}>{t.ship.tryLive}</a></p>
            </div>
            <p className="st-copy">{t.ship.copy}</p>
          </div>
        </article>
      </div>
    </section>
  )
}
