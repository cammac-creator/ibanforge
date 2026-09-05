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
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { SplitText } from "gsap/SplitText"
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin"
import type { ForgeFx, ForgeScene } from "./forge-scene"

export interface FilmStrings {
  heading: string
  heat: {
    eyebrow: string; title: string; copy: string
    country: string; check: string; bank: string; account: string
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
  ship: { eyebrow: string; title: string; head: string; tryLive: string; copy: string }
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
  <span class="k">"processing_ms"</span>: <span class="n">0.41</span>
}`
const JSON_LINES = JSON_OUT.split("\n").map((l) => `<span class="jl">${l}</span>`).join("")

const STATIONS = 4

const HOT = "#fff7ed", DULL = "#78716c", AMBER = "#f59e0b", RED = "#ef4444",
  STEEL = "#94a3b8", SILVER = "#cbd5e1", GREEN = "#4ade80"
const glow = (c: string) => `0 0 14px ${c}, 0 0 34px ${c}`

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

/** Builds the whole film on the mounted DOM; returns its teardown. */
function build(root: HTMLElement) {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)
  const qa = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel))
  const pin = q<HTMLElement>(".pin")
  if (!pin) return () => {}

  const stations = qa<HTMLElement>(".st").map((el) => ({
    el,
    inner: el.querySelector<HTMLElement>(".st-inner"),
    scenes: Array.from(el.querySelectorAll<SVGElement>(".scene")),
    title: el.querySelector<HTMLElement>(".st-title"),
    eyebrow: el.querySelector<HTMLElement>(".st-eyebrow"),
    copy: el.querySelector<HTMLElement>(".st-copy"),
  }))
  const splits: Array<{ revert: () => void }> = []
  const mobile = () => window.innerWidth < 720
  // the CSS reserves 4 × --film-s (120vh, 110vh on a phone) as the track
  const stationPx = () => window.innerHeight * (mobile() ? 1.1 : 1.2)
  // The heat haze (an animated displacement filter over the ember floor)
  // is the one effect that costs frames on WebKit and small machines.
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)
  const richMotion = !mobile() && !safari && (navigator.hardwareConcurrency ?? 4) >= 6

  // The numbers the 3D forge reads. Tweened by the station timelines below
  // whether or not the scene loads: they are cheap, and the scene arrives
  // on its own schedule on wide screens with WebGL.
  const fx: ForgeFx = { heat: 0, hammer: -0.35, glow: 0, quench: 0, steam: 0, ripple: 0, steel: 0, stamp: 0, flash: 0, decal: 0, ship: 0, cam: 0 }
  let scene3d: ForgeScene | null = null
  const glCanvas = q<HTMLCanvasElement>(".forge-gl")
  const webgl = (() => {
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")) } catch { return false }
  })()
  const want3d = !!glCanvas && !mobile() && webgl && window.innerWidth >= 900

  ScrollTrigger.config({ ignoreMobileResize: true })

  // ── the sparks: a small particle system on a canvas, fired at the strike ──
  const canvas = q<HTMLCanvasElement>(".sparks-canvas")
  const ctx = canvas ? canvas.getContext("2d") : null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  interface Spark { x: number; y: number; vx: number; vy: number; l: number; d: number; s: number; w: number }
  let parts: Spark[] = []
  let ticking = false
  const draw = () => {
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (parts.length === 0) {
      gsap.ticker.remove(draw)
      ticking = false
      return
    }
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
  const modLine = q<HTMLElement>(".mod-line")
  const burst = () => {
    if (mobile() || !ctx || !canvas || !modLine || !canvas.parentElement) return
    const r = canvas.parentElement.getBoundingClientRect()
    canvas.width = Math.floor(r.width * dpr)
    canvas.height = Math.floor(r.height * dpr)
    const ml = modLine.getBoundingClientRect()
    const cx = (ml.left + ml.width / 2 - r.left) * dpr
    const cy = (ml.top + ml.height / 2 - r.top) * dpr
    for (let i = 0; i < 120 && parts.length < 200; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = (2 + Math.random() * 8) * dpr
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3.5 * dpr,
        l: 1, d: 0.011 + Math.random() * 0.02, s: (0.8 + Math.random() * 2.2) * dpr, w: Math.random() })
    }
    if (!ticking) { ticking = true; gsap.ticker.add(draw) }
  }

  // ── shared enter / exit of a station ──
  // The first station is already on screen while the film scrolls into
  // view, so it does not fade in: an empty pinned screen is what a visitor
  // would see otherwise. Its words are there from the start; the beats
  // begin once the screen is pinned.
  const enter = (tl: gsap.core.Timeline, i: number) => {
    const s = stations[i]
    // the scenery drifts a little slower than the words: depth, cheaply
    tl.fromTo(s.scenes, { y: 22, scale: 1.05 }, { y: -22, scale: 1.05, duration: 1, ease: "none" }, 0)
    if (i === 0) {
      gsap.set(s.el, { autoAlpha: 1 })
      return
    }
    tl.fromTo(s.el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 0)
    tl.fromTo(s.scenes, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.14, ease: "power2.out" }, 0)
    if (s.title) {
      const split = new SplitText(s.title, { type: "words" })
      splits.push(split)
      tl.fromTo(split.words, { y: 28, autoAlpha: 0, rotationX: -35 }, { y: 0, autoAlpha: 1, rotationX: 0, duration: 0.08, stagger: 0.012, ease: "power3.out" }, 0.01)
    }
    tl.fromTo([s.eyebrow, s.copy].filter(Boolean), { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.08, ease: "power2.out" }, 0.03)
  }
  const exit = (tl: gsap.core.Timeline, i: number) => {
    const s = stations[i]
    tl.to(s.inner, { y: -30, autoAlpha: 0, duration: 0.08, ease: "power2.in" }, 0.90)
    tl.to(s.el, { autoAlpha: 0, duration: 0.05 }, 0.95)
  }
  const show = (tl: gsap.core.Timeline, target: gsap.TweenTarget, at: number, dur = 0.05) =>
    tl.fromTo(target, { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: dur, ease: "power2.out" }, at)

  // ── station 0 · heat, then the strike ──
  const s0 = gsap.timeline()
  enter(s0, 0)
  const ibanSplit = new SplitText(qa(".iban-bar .seg b"), { type: "chars" })
  splits.push(ibanSplit)
  // colour per character, the glow once on the bar: WebKit repaints
  // per-character text shadows dearly (long frames measured 2026-09-04)
  s0.fromTo(ibanSplit.chars, { color: DULL }, { color: HOT, duration: 0.16, stagger: 0.006, ease: "power2.inOut" }, 0.08)
  s0.fromTo(q(".iban-bar"),
    { textShadow: "0 0 0px rgba(245,158,11,0), 0 2px 0px rgba(239,68,68,0)" },
    { textShadow: "0 0 18px rgba(245,158,11,0.6), 0 2px 44px rgba(239,68,68,0.3)", duration: 0.22, ease: "power2.inOut" }, 0.14)
  s0.fromTo(q(".heat-glow"), { opacity: 0.35 }, { opacity: 1, duration: 0.3, ease: "power1.inOut" }, 0.08)
  const segColors = [AMBER, RED, STEEL, GREEN]
  qa<HTMLElement>(".seg").forEach((seg, i) => {
    s0.fromTo(seg, { borderColor: "rgba(0,0,0,0)" }, { borderColor: segColors[i], duration: 0.04 }, 0.12 + i * 0.08)
    show(s0, seg.querySelector("i"), 0.13 + i * 0.08, 0.04)
  })
  // the struck digits exist only from the strike's wind-up: nothing to read before
  s0.fromTo(q(".mod-line"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.04 }, 0.42)
  const digits = qa<HTMLElement>(".mod-line span")
  s0.fromTo(digits,
    { x: (i) => Number(digits[i].dataset.dx) * 1.9, y: (i) => Number(digits[i].dataset.dy) * 1.9, rotation: () => gsap.utils.random(-40, 40), autoAlpha: 0.4 },
    { x: 0, y: 0, rotation: 0, autoAlpha: 1, duration: 0.14, stagger: { each: 0.004, from: "random" }, ease: "power3.inOut" }, 0.44)
  s0.fromTo(fx, { heat: 0 }, { heat: 1, duration: 0.3, ease: "power1.inOut" }, 0.08)
  s0.to(fx, { hammer: -0.95, duration: 0.16, ease: "power2.out" }, 0.40)
  s0.to(fx, { hammer: 0.32, duration: 0.04, ease: "power4.in" }, 0.56)
  s0.to(fx, { hammer: -0.35, duration: 0.18, ease: "elastic.out(1, 0.45)" }, 0.60)
  s0.fromTo(fx, { glow: 0 }, { glow: 1, duration: 0.01 }, 0.60)
  s0.to(fx, { glow: 0, duration: 0.16, ease: "power2.out" }, 0.61)
  const hammer = q(".hammer")
  s0.to(hammer, { attr: { transform: "rotate(-76 300 -60)" }, duration: 0.16, ease: "power2.out" }, 0.40)
  s0.to(hammer, { attr: { transform: "rotate(8 300 -60)" }, duration: 0.04, ease: "power4.in" }, 0.56)
  s0.to(hammer, { attr: { transform: "rotate(-24 300 -60)" }, duration: 0.18, ease: "elastic.out(1, 0.45)" }, 0.60)
  s0.fromTo(q(".arcs"), { opacity: 0 }, { opacity: 0.9, duration: 0.01 }, 0.595)
  s0.to(q(".arcs"), { opacity: 0, duration: 0.12 }, 0.61)
  s0.to(stations[0].inner, { keyframes: [{ x: -4, y: 2 }, { x: 4, y: -2 }, { x: -3, y: -1 }, { x: 2, y: 1 }, { x: 0, y: 0 }], duration: 0.03 }, 0.60)
  s0.fromTo(q(".stamp-ok"), { scale: 1.9, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.06, ease: "back.out(2.5)" }, 0.72)
  exit(s0, 0)

  // ── station 1 · quench ──
  const s1 = gsap.timeline()
  enter(s1, 1)
  s1.fromTo(fx, { cam: 0 }, { cam: 1, duration: 0.14, ease: "power2.inOut" }, 0)
  s1.fromTo(fx, { quench: 0 }, { quench: 1, duration: 0.22, ease: "power2.in" }, 0.06)
  s1.fromTo(fx, { steam: 0 }, { steam: 1, duration: 0.08 }, 0.26)
  s1.to(fx, { steam: 0, duration: 0.12 }, 0.84)
  s1.fromTo(fx, { ripple: 0 }, { ripple: 1, duration: 0.62, ease: "none" }, 0.26)
  s1.fromTo(fx, { steel: 0 }, { steel: 1, duration: 0.5, ease: "power1.inOut" }, 0.24)
  qa<HTMLElement>(".q-row").forEach((row, i) => {
    s1.fromTo(row, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.20, ease: "power2.inOut" }, 0.10 + i * 0.14)
    s1.to(row.querySelector(".q-res"), { textShadow: "0 0 14px rgba(203,213,225,0.55)", duration: 0.04 }, 0.30 + i * 0.14)
  })
  s1.fromTo(q(".q-hot"), { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.5, ease: "power1.inOut" }, 0.14)
  s1.fromTo(q(".q-cold"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: "power1.inOut" }, 0.14)
  qa(".rp").forEach((rp, k) => {
    s1.fromTo(rp, { scale: 1, opacity: 0.85, transformOrigin: "50% 50%" }, { scale: 7.5, opacity: 0, duration: 0.5, ease: "power1.out" }, 0.28 + k * 0.09)
  })
  qa(".sm").forEach((sm, k) => {
    const sx = (k % 2 ? 1 : -1) * 26
    s1.fromTo(sm, { y: 0, x: 0, opacity: 0 }, { keyframes: { y: [0, -120, -250], x: [0, sx * 0.5, sx], opacity: [0, 0.42, 0], easeEach: "none" }, duration: 0.56 }, 0.30 + k * 0.05)
  })
  qa<HTMLElement>(".q-badge").forEach((b, i) => show(s1, b, 0.64 + i * 0.08))
  exit(s1, 1)

  // ── station 2 · stamp ──
  const s2 = gsap.timeline()
  enter(s2, 2)
  s2.fromTo(fx, { cam: 1 }, { cam: 2, duration: 0.14, ease: "power2.inOut" }, 0)
  s2.to(fx, { quench: 0, duration: 0.14, ease: "power2.out" }, 0)
  s2.fromTo(fx, { stamp: 0 }, { stamp: 1, duration: 0.32, ease: "power4.in" }, 0.10)
  s2.fromTo(fx, { flash: 0 }, { flash: 1, duration: 0.02, yoyo: true, repeat: 1 }, 0.42)
  s2.fromTo(fx, { decal: 0 }, { decal: 1, duration: 0.1 }, 0.44)
  s2.to(fx, { stamp: 0.35, duration: 0.24, ease: "power2.out" }, 0.56)
  s2.fromTo(q(".ring-c"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.3, ease: "power2.inOut" }, 0.02)
  s2.fromTo(q(".ring"), { rotation: 0, transformOrigin: "50% 50%" }, { rotation: 70, duration: 0.88, ease: "none" }, 0.05)
  const seal = q<HTMLElement>(".seal")
  s2.fromTo(seal, { scale: 1.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.30, ease: "power4.in" }, 0.12)
  s2.to(seal, { boxShadow: "0 18px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,158,11,0.15), 0 0 44px rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.4)", duration: 0.04 }, 0.42)
  s2.fromTo(q(".flash"), { opacity: 0, scale: 0.6, transformOrigin: "50% 50%" }, { opacity: 0.8, scale: 1.15, duration: 0.03, yoyo: true, repeat: 1, ease: "power2.out" }, 0.415)
  s2.fromTo(q(".mark"), { scale: 1, opacity: 0.16, transformOrigin: "50% 50%" }, { scale: 1.35, opacity: 0.75, duration: 0.04, yoyo: true, repeat: 1, ease: "power2.out" }, 0.42)
  qa<HTMLElement>(".clr-chips li").forEach((li, i) => show(s2, li, 0.52 + i * 0.08))
  exit(s2, 2)

  // ── station 3 · ship (holds at the end: no exit) ──
  const s3 = gsap.timeline()
  enter(s3, 3)
  s3.fromTo(fx, { cam: 2 }, { cam: 3, duration: 0.16, ease: "power2.inOut" }, 0)
  s3.to(fx, { stamp: 0, duration: 0.1 }, 0)
  s3.fromTo(fx, { ship: 0 }, { ship: 1, duration: 0.8, ease: "power1.inOut" }, 0.05)
  s3.fromTo(qa(".rail-l"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.25, stagger: 0.03, ease: "power2.inOut" }, 0.02)
  s3.fromTo(q(".ship"), { y: 44, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.28, ease: "power3.out" }, 0.06)
  s3.fromTo(qa(".json-out .jl"), { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.05, stagger: 0.03, ease: "power1.out" }, 0.18)
  s3.fromTo(q(".cart"), { attr: { transform: "translate(-520 21.7)" } }, { attr: { transform: "translate(420 -17.5)" }, duration: 0.80, ease: "power1.inOut" }, 0.05)
  s3.to(q(".pill-ok"), { boxShadow: "0 0 0 4px rgba(74,222,128,0.18), 0 0 24px rgba(74,222,128,0.35)", duration: 0.05 }, 0.36)
  show(s3, q(".try-live"), 0.78)

  // ── the master: four stations back to back, scrubbed by the scroll ──
  const dots = qa<HTMLElement>(".film-dots li")
  const master = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: root,
      pin,
      start: "top top",
      end: () => `+=${Math.round(STATIONS * stationPx())}`,
      // the section already has the track's height (CSS): no spacer to add
      pinSpacing: false,
      scrub: 0.75,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const active = Math.min(STATIONS - 1, Math.floor(self.progress * STATIONS))
        dots.forEach((d, i) => d.classList.toggle("on", i === active))
      },
      onToggle: (self) => {
        haze.paused(!self.isActive)
        if (self.isActive) scene3d?.start()
        else scene3d?.stop()
      },
    },
  })
  master.add(s0, 0).add(s1, 1).add(s2, 2).add(s3, 3)
  // the strike fires once per pass, forward only
  master.call(() => {
    if ((master.scrollTrigger?.direction ?? 1) <= 0) return
    if (scene3d) scene3d.burst()
    else burst()
  }, [], 0.60)

  const rail = q<HTMLElement>(".rail")
  const railHead = q<HTMLElement>(".rail-head")
  if (rail && railHead) {
    master.fromTo(railHead, { y: 0 }, { y: () => rail.offsetHeight - 46, duration: STATIONS, ease: "none" }, 0)
    master.to(railHead, { keyframes: [
      { backgroundColor: RED, boxShadow: glow(RED), duration: 1.2 },
      { backgroundColor: STEEL, boxShadow: glow(STEEL), duration: 1.3 },
      { backgroundColor: SILVER, boxShadow: glow(SILVER), duration: 1.5 },
    ], ease: "none" }, 0)
  }

  // the ember floor shimmers with heat, on its own clock, only while pinned —
  // and only where the displacement filter is cheap enough
  const floor = q(".floor")
  if (!richMotion && floor) floor.removeAttribute("filter")
  const haze = richMotion
    ? gsap.to(q(".turb"), { attr: { baseFrequency: "0.014 0.020" }, duration: 4, yoyo: true, repeat: -1, ease: "sine.inOut", paused: true })
    : gsap.to({}, { duration: 1, paused: true })

  gsap.set(stations.slice(1).map((s) => s.el), { autoAlpha: 0 })
  gsap.set(stations[0].el, { autoAlpha: 1 })
  dots[0]?.classList.add("on")

  // ── the forge in 3D, on wide screens with WebGL: it replaces the SVG
  //    scenery once it is ready; the film runs the same either way ──
  let cancelled3d = false
  const onPointer = (e: PointerEvent) => scene3d?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1))
  const onResize3d = () => scene3d?.resize()
  if (want3d && glCanvas) {
    import("./forge-scene")
      .then(({ createForgeScene }) => {
        if (cancelled3d) return
        const sc = createForgeScene(glCanvas, { bloom: !new URLSearchParams(location.search).has("nobloom"), shadows: true, fx })
        scene3d = sc
        ;(window as unknown as { __forge?: unknown }).__forge = { fx, get scene() { return scene3d } }
        glCanvas.hidden = false
        root.classList.add("has-3d")
        window.addEventListener("pointermove", onPointer, { passive: true })
        window.addEventListener("resize", onResize3d, { passive: true })
        sc.resize()
        if (master.scrollTrigger?.isActive) sc.start()
      })
      .catch(() => { /* the SVG scenery stays */ })
  }
  // measure again once fonts and the first layout have settled
  const onFonts = () => ScrollTrigger.refresh()
  document.fonts?.ready.then(onFonts).catch(() => {})
  const settle = window.setTimeout(() => ScrollTrigger.refresh(), 600)

  return () => {
    cancelled3d = true
    window.removeEventListener("pointermove", onPointer)
    window.removeEventListener("resize", onResize3d)
    scene3d?.dispose()
    window.clearTimeout(settle)
    master.scrollTrigger?.kill()
    master.kill()
    haze.kill()
    gsap.ticker.remove(draw)
    parts = []
    splits.forEach((s) => s.revert())
  }
}

export function ForgeFilm({ t, playgroundHref }: { t: FilmStrings; playgroundHref: string }) {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return
    // Bundled, not fetched on demand: the on-demand chunk arrived 4 to 6 s
    // after the page (measured 2026-09-04), long enough for a visitor to
    // scroll past a film that had not started.
    gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin)
    return build(root)
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
              <p className="iban-bar">
                <span className="seg seg-cc"><b>CH</b><i>{t.heat.country}</i></span>
                <span className="seg seg-ck"><b>10</b><i>{t.heat.check}</i></span>
                <span className="seg seg-bank"><b>00230</b><i>{t.heat.bank}</i></span>
                <span className="seg seg-acct"><b>000000012345</b><i>{t.heat.account}</i></span>
              </p>
              <p
                className="mod-line"
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
                <pre className="json-out"><code dangerouslySetInnerHTML={{ __html: JSON_LINES }} /></pre>
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
