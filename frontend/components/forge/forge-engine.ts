/**
 * The film's engine: GSAP, ScrollTrigger, SplitText, DrawSVG and the four
 * station timelines. A separate module since 2026-09-05 (audit n° 2): loaded
 * by forge-film.tsx once the visitor approaches the film, or at idle, so its
 * 60 Ko and its DOM work (SplitText measures every character) no longer sit
 * in the page's first paint. Measured before the split: two thirds of the
 * start-up CPU on a phone went here, for a section three screens down.
 *
 * Bundled statically inside this chunk, not fetched piecemeal: the chunk is
 * requested well before the film is reached.
 */
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { SplitText } from "gsap/SplitText"
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin"
import type { ForgeFx, ForgeScene } from "./forge-scene"
import { STATIONS } from "./forge-constants"

const HOT = "#fff7ed", DULL = "#78716c", AMBER = "#f59e0b", RED = "#ef4444",
  STEEL = "#94a3b8", SILVER = "#cbd5e1", GREEN = "#4ade80"
const glow = (c: string) => `0 0 14px ${c}, 0 0 34px ${c}`

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
  const fx: ForgeFx = { heat: 0, hammer: -0.35, park: 0, glow: 0, quench: 0, steam: 0, ripple: 0, steel: 0, stamp: 0, flash: 0, decal: 0, ship: 0, cam: 0 }
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
  // aria "none": the default writes aria-label on each <b>, an attribute the
  // element may not carry (axe, 2026-09-05); the bar is aria-hidden and a
  // sr-only sentence before it reads the IBAN whole.
  const ibanSplit = new SplitText(qa(".iban-bar .seg b"), { type: "chars", aria: "none" })
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
  // the hammer leaves as the quench begins: swung back, then out of frame
  s1.fromTo(fx, { park: 0 }, { park: 1, duration: 0.22, ease: "power2.inOut" }, 0.02)
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
  let lastStation = -1
  const master = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: {
      trigger: root,
      // No ScrollTrigger pin since 2026-09-05: the screen is held by the CSS
      // (`.pin` is position: sticky inside a section that reserves the
      // track), which needs no spacer and cannot be left behind. The pinned
      // element stayed position: fixed over the next sections on a phone
      // after an instant jump past the film (an anchor, a scroll-to-top).
      start: "top top",
      end: () => `+=${Math.round(STATIONS * stationPx())}`,
      scrub: 0.75,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const active = Math.min(STATIONS - 1, Math.floor(self.progress * STATIONS))
        dots.forEach((d, i) => d.classList.toggle("on", i === active))
        if (active !== lastStation) {
          lastStation = active
          // heard by components/forge/cta-beacon.tsx: first pin, last station
          root.dispatchEvent(new CustomEvent("forge:station", { detail: active, bubbles: true }))
        }
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


/** Registers the plugins once and builds the film; returns its teardown. */
export function mountFilm(root: HTMLElement): () => void {
  gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin)
  return build(root)
}
