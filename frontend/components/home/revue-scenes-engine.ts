import { gsap } from "gsap"
import { DOUX, E } from "./revue-ease"

/*
 * The motion of chapters 03 and 04 of the home, loaded with GSAP when one of
 * them comes near the screen (revue-essai.tsx, revue-voies.tsx), never with
 * the first paint, never under reduced motion. The two gestures of the mockup,
 * on its curve: the rise from a mask and the pull into focus.
 *
 * React owns every word: this file moves boxes (transform, opacity, filter,
 * colour) and gives them back with clearProps. The one text it writes is the
 * rolling counter of the file, into a layer React renders empty.
 *
 * Each still frame is complete without this file (revue.css).
 */

const L = "sine.inOut"
const GRIS = "#8a8a94"
const CLAIR = "#d4d4d8"
const BLANC = "#f5f3ef"
const AMBRE = "#fbbf24"
const ROUGE = "#f87171"
const LU = "rgba(138, 138, 148, .5)"

function q<T extends Element = HTMLElement>(root: ParentNode, sel: string): T | null {
  return root.querySelector<T>(sel)
}

function qa<T extends Element = HTMLElement>(root: ParentNode, sel: string): T[] {
  return Array.from(root.querySelectorAll<T>(sel))
}

/** The pull into focus: from transparent and blurred to sharp. */
function focus(t: gsap.core.Timeline, targets: Element | Element[] | null, at: number, duration = 0.9, blur = 8, stagger = 0) {
  if (!targets || (Array.isArray(targets) && targets.length === 0)) return
  t.fromTo(
    targets,
    { opacity: 0, filter: `blur(${blur}px)` },
    { opacity: 1, filter: "blur(0px)", duration, ease: DOUX, stagger },
    at,
  )
}

/* ── 03: an answer arrives ─────────────────────────────────────────────── */

/**
 * The lines of a real answer rise into place one after the other, format,
 * bank, BIC, each label lit amber while its value arrives; the verdict comes
 * into focus last (the mockup's 3.1 s, from the moment the answer is there).
 * Returns what stops it and gives every box back.
 */
export function revealAnswer(root: HTMLElement): () => void {
  const rows = qa(root, ".rv-essai__r")
  const verdict = q(root, ".rv-essai__verdict")
  const notices = q(root, ".rv-essai__notices")
  const touched: Element[] = []
  const t = gsap.timeline({ defaults: { ease: E } })
  rows.forEach((row, j) => {
    const at = j * 0.3
    const label = q(row, "dt")
    const value = q(row, ".rv-essai__v")
    const source = q(row, ".rv-essai__src")
    if (label) {
      touched.push(label)
      t.to(label, { color: AMBRE, duration: 0.25, ease: "none" }, at).to(label, { color: GRIS, duration: 0.25, ease: "none" }, at + 0.5)
    }
    if (value) {
      touched.push(value)
      t.fromTo(value, { yPercent: 115 }, { yPercent: 0, duration: 0.75 }, at)
    }
    if (source) {
      touched.push(source)
      t.fromTo(source, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: L }, at + 0.25)
    }
  })
  for (const el of [verdict, notices]) {
    if (!el) continue
    touched.push(el)
    focus(t, el, 0.95)
  }
  const release = () => gsap.set(touched, { clearProps: "transform,opacity,filter,color" })
  t.eventCallback("onComplete", release)
  return () => {
    t.kill()
    release()
  }
}

/* ── 04: one scene, three ways ─────────────────────────────────────────── */

export type WaysHandle = {
  /** A switch pressed: plays that way and stops the sequence. */
  select(n: number): void
  destroy(): void
}

export type WaysOptions = {
  buttons: HTMLButtonElement[]
  /** The counter's target, the row ceiling of the smaller audit. */
  total: number
  /** How the thousands are grouped: a fixed spacer (fr, de) or a comma (en). */
  sep: "," | "fine"
}

/* How long each way holds the stage: one IBAN, a whole file, your tools. */
const DUREES = [6.4, 11, 7]

/**
 * The scene of chapter 04. Once, on arrival: 01 « Commerzbank. » comes into
 * focus and the API frame lights up; 02 the counter rolls to the audit's
 * ceiling while the column scrolls under the amber reader, the flagged lines
 * struck in red, then the two stopped lines and their reason; 03 the three
 * frames give the same answer. Then it stays on 03. A switch chooses a way and
 * ends the sequence. Plays only on screen, tab shown.
 *
 * Something already on screen when the engine arrives is never hidden after
 * the fact: the scene keeps its still frame (the file).
 */
export function createWays(scene: HTMLElement, options: WaysOptions): WaysHandle {
  const { buttons, total, sep } = options
  const planO = q(scene, ".rv-plan4--outils")
  const planF = q(scene, ".rv-plan4--fichier")
  if (!planO || !planF) return { select: () => {}, destroy: () => {} }
  const planOuts = planO
  const planFile = planF
  const frames = qa(planOuts, ".rv-o__cadre")
  const api = q(planOuts, ".rv-o__cadre--api")
  const roule = q(planFile, ".rv-f__roule")

  let tl: gsap.core.Timeline | null = null
  let state: "neuf" | "arme" | "joue" | "fini" = "neuf"
  let visible = false
  let auto = true
  let shown: "outils" | "fichier" | null = null

  function mark(n: number) {
    scene.setAttribute("data-voie", String(n))
    buttons.forEach((b, i) => {
      if (i === n) b.setAttribute("aria-current", "true")
      else b.removeAttribute("aria-current")
      b.style.setProperty("--rv-p", "0")
    })
  }

  /** The rolling counter, written into its own layer. */
  function writeCounter(value: number) {
    if (!roule) return
    const v = Math.round(value)
    if (v < 1000) {
      roule.replaceChildren(String(v))
      return
    }
    const rest = String(v % 1000).padStart(3, "0")
    if (sep === ",") roule.replaceChildren(`${Math.floor(v / 1000)},${rest}`)
    else {
      const spacer = document.createElement("span")
      spacer.className = "rv-fine"
      roule.replaceChildren(String(Math.floor(v / 1000)), spacer, rest)
    }
  }

  function playable() {
    return visible && !document.hidden
  }

  function update() {
    if (!tl) return
    if (playable()) tl.play()
    else tl.pause()
  }

  /** Everything back to the CSS: the still frame. */
  function undo() {
    tl?.kill()
    tl = null
    gsap.set([planOuts, planFile, ...qa(planOuts, "*"), ...qa(planFile, "*")], {
      clearProps: "opacity,visibility,filter,transform,color",
    })
    planFile.classList.remove("rv-f--anime")
    roule?.replaceChildren()
    buttons.forEach((b) => b.style.removeProperty("--rv-p"))
    shown = null
  }

  /** Way 02: the file read line by line. */
  function fileTimeline(): gsap.core.Timeline {
    planFile.classList.add("rv-f--anime")
    const windowEl = q(planFile, ".rv-f__fenetre")
    const list = q(planFile, ".rv-f__liste")
    const lines = qa(planFile, ".rv-f__liste li")
    const unit = q(planFile, ".rv-f__unite")
    const number = q(planFile, ".rv-f__nombre")
    const stopped = q(planFile, ".rv-f__arretees")
    const stoppedTitle = q(planFile, ".rv-f__sur")
    const stops = qa(planFile, ".rv-f__arr")
    const count = { v: 0 }
    const n = lines.length
    const s0 = 0.7
    const d = 4.2
    const t = gsap.timeline({ paused: true, defaults: { ease: E } })
    t.call(() => {
      count.v = 0
      writeCounter(0)
    }, undefined, 0)
    focus(t, number, 0, 0.95, 12)
    focus(t, unit, 0.2, 0.8, 4)
    if (stopped) t.fromTo(stopped, { autoAlpha: 0 }, { autoAlpha: 0, duration: 0.01 }, 0)
    if (windowEl) t.fromTo(windowEl, { autoAlpha: 0, filter: "blur(8px)" }, { autoAlpha: 1, filter: "blur(0px)", duration: 0.8, ease: DOUX }, 0.12)
    if (list && n > 1) {
      t.fromTo(list, { yPercent: -(0.5 / n) * 100 }, { yPercent: -((n - 0.5) / n) * 100, duration: d, ease: "none" }, s0)
    }
    t.fromTo(count, { v: 0 }, { v: total, duration: d, ease: "none", onUpdate: () => writeCounter(count.v) }, s0)
    lines.forEach((li, i) => {
      const at = s0 + (d * i) / Math.max(1, n - 1)
      if (li.classList.contains("rv-f__signalee")) {
        t.fromTo(li, { color: LU }, { color: ROUGE, duration: 0.18, ease: "none" }, at - 0.06)
        const bar = q(li, ".rv-f__barre")
        if (bar) t.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power2.inOut" }, at)
      } else {
        t.fromTo(li, { color: LU }, { color: AMBRE, duration: 0.12, ease: "none" }, at - 0.06).to(
          li,
          { color: CLAIR, duration: 0.45, ease: L },
          at + 0.14,
        )
      }
    })
    const f = s0 + d + 0.25
    if (windowEl) t.to(windowEl, { autoAlpha: 0, filter: "blur(10px)", duration: 0.5, ease: "power2.in" }, f)
    if (stopped) t.set(stopped, { autoAlpha: 1 }, f + 0.5)
    focus(t, stoppedTitle, f + 0.5, 0.7, 6)
    stops.forEach((row, i) => {
      const at = f + 0.65 + i * 0.45
      focus(t, q(row, ".rv-f__arr-iban"), at, 0.85, 10)
      const bar = q(row, ".rv-f__barre")
      if (bar) t.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.inOut" }, at + 0.45)
      focus(t, q(row, ".rv-f__raison"), at + 0.6, 0.7, 5)
    })
    t.call(() => {
      count.v = total
      writeCounter(total)
    }, undefined, f + 2.2)
    return t
  }

  /** A segment: from the plan on stage to the plan of way n, played, then held. */
  function segment(n: number): gsap.core.Timeline {
    const from = shown
    let at = 0
    const t = gsap.timeline({ paused: true, defaults: { ease: E } })
    if (n === 1) {
      if (from === "outils") {
        t.to(planOuts, { opacity: 0, filter: "blur(10px)", duration: 0.45, ease: "power2.in" }, 0)
        at = 0.5
      }
      t.set(planOuts, { autoAlpha: 0 }, at).set(planFile, { autoAlpha: 1, opacity: 1, filter: "blur(0px)" }, at)
      const file = fileTimeline()
      file.paused(false)
      t.add(file, at + 0.05)
      shown = "fichier"
    } else {
      const entering = from !== "outils"
      if (from === "fichier") {
        t.to(planFile, { opacity: 0, filter: "blur(10px)", duration: 0.45, ease: "power2.in" }, 0)
        at = 0.5
      }
      t.set(planFile, { autoAlpha: 0 }, at).set(planOuts, { autoAlpha: 1, opacity: 1, filter: "blur(0px)" }, at)
      if (entering) {
        const verdict = q(planOuts, ".rv-o__si")
        if (verdict) t.fromTo(verdict, { yPercent: 112 }, { yPercent: 0, duration: 0.8 }, at + 0.1)
        const bank = q(planOuts, ".rv-o__geant")
        if (bank) {
          t.fromTo(
            bank,
            { opacity: 0, filter: "blur(18px)", scale: 0.965 },
            { opacity: 1, filter: "blur(0px)", scale: 1, duration: 1.5, ease: DOUX },
            at,
          )
        }
        focus(t, q(planOuts, ".rv-o__leg"), at + 0.5, 0.8, 6)
      }
      frames.forEach((frame, i) => {
        const lit = n === 2 || frame === api
        const start = at + (entering ? 0.7 + i * 0.25 : 0.1 + i * 0.12)
        if (entering) t.fromTo(frame, { opacity: 0, filter: "blur(10px)" }, { opacity: lit ? 1 : 0.3, filter: "blur(0px)", duration: 1 }, start)
        else t.to(frame, { opacity: lit ? 1 : 0.3, filter: "blur(0px)", duration: 0.6, ease: L }, start)
        if (lit) {
          t.fromTo(qa(frame, ".rv-o__arg"), { color: AMBRE }, { color: BLANC, duration: 0.7, ease: L, immediateRender: false }, start + 0.6)
        }
      })
      shown = "outils"
    }
    t.set({}, {}, DUREES[n])
    t.eventCallback("onUpdate", () => buttons[n]?.style.setProperty("--rv-p", t.progress().toFixed(4)))
    t.eventCallback("onComplete", () => {
      tl = null
      if (auto && n < 2) play(n + 1)
      else {
        state = "fini"
        buttons[n]?.style.setProperty("--rv-p", "0")
      }
    })
    return t
  }

  function play(n: number) {
    tl?.kill()
    tl = null
    mark(n)
    tl = segment(n)
    state = "joue"
    update()
  }

  /* Before its first entrance the scene waits, ready for way 01. */
  function arm() {
    if (state !== "neuf") return
    mark(0)
    gsap.set(planFile, { autoAlpha: 0 })
    gsap.set(planOuts, { autoAlpha: 1 })
    const verdict = q(planOuts, ".rv-o__si")
    if (verdict) gsap.set(verdict, { yPercent: 112 })
    const hidden = [q(planOuts, ".rv-o__geant"), q(planOuts, ".rv-o__leg"), ...frames].filter((el): el is HTMLElement => !!el)
    gsap.set(hidden, { opacity: 0 })
    shown = null
    state = "arme"
  }

  const first = new IntersectionObserver(
    (entries) => {
      first.disconnect()
      if (state !== "neuf") return
      if (entries[0]?.isIntersecting) state = "fini"
      else arm()
    },
    { threshold: 0 },
  )
  first.observe(scene)

  const stage = new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1]?.isIntersecting ?? false
      if (visible && state === "arme" && !document.hidden) {
        play(0)
        return
      }
      update()
    },
    { threshold: 0.3 },
  )
  stage.observe(scene)

  const onVisibility = () => {
    if (visible && state === "arme" && !document.hidden) play(0)
    else update()
  }
  document.addEventListener("visibilitychange", onVisibility)

  return {
    select(n: number) {
      auto = false
      if (state === "neuf") {
        first.disconnect()
        state = "fini"
      }
      play(n)
      const r = scene.getBoundingClientRect()
      if (r.bottom < 60 || r.top > window.innerHeight - 120) scene.scrollIntoView({ behavior: "smooth", block: "center" })
    },
    destroy() {
      first.disconnect()
      stage.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      undo()
      mark(1)
    },
  }
}
