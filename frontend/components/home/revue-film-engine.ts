import { gsap } from "gsap"

/*
 * The motion of the home film, loaded when the film comes near the screen
 * (revue-film.tsx), never with the first paint.
 *
 * Direction D, chosen by Claude-Alain on 27/09/2026, as the mockups of
 * 28/09/2026 set it: the loop of the magazine (a payment, the IBAN read part by
 * part, the bank confirmed, the same invoice with a code no bank holds, the
 * verdict held long, 20.6 s) and, on demand, the third example of the credits
 * mockup, a typo (9.6 s). Two gestures only, the rise from a mask and the pull
 * into focus, on the curve cubic-bezier(.2, .8, .2, 1). The timings are theirs.
 *
 * Plays only while visible, the tab shown and nobody paused it. Every still
 * frame is complete without this file (revue.css, `data-fixe`).
 */

export type FilmHandle = {
  /** 0: the real bank, 1: the code no bank holds, 2: the typo. */
  select(example: number): void
  destroy(): void
}

export type FilmOptions = {
  buttons: HTMLButtonElement[]
  pauseLabel: string
  playLabel: string
  /** 0 when the loop first plays, 3 when it first reaches its verdict (cta-beacon.tsx). */
  onStation(station: 0 | 3): void
  /** The example on screen changed, so the static frames can follow if motion stops. */
  onExample(example: number): void
}

const DUREE = 20.6
const COUPURE = 10.33
const DEBUT_B = 10.35
const NOIR = 20.58
const DUREE_S = 9.6
/* The frame of each example when the film is paused. */
const CLES = [8.7, 17.5]
const CLE_S = 6.4
const VERDICT = 13.7

const GRIS = "#8a8a94"
const NONLU = "rgba(138, 138, 148, .6)"
const BLANC = "#f5f3ef"
const AMBRE = "#fbbf24"
const ROUGE = "#f87171"
const LIGNE = "#3f3f46"
const S = "power3.in"
const L = "sine.inOut"

/* A cubic Bézier, as in CSS: the signature curve and a softer one for the focus. */
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const solve = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-6) return t
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 40; i++) {
      const e = sx(t)
      if (Math.abs(e - x) < 1e-6) return t
      if (x > e) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)))
}

const E = bezier(0.2, 0.8, 0.2, 1)
const DOUX = bezier(0.16, 1, 0.3, 1)
const CLEARED = "transform,opacity,visibility,filter,color,backgroundColor,--rvap"

export function createFilm(root: HTMLElement, options: FilmOptions): FilmHandle {
  const q = <T extends Element = HTMLElement>(sel: string, ctx: ParentNode = root) => ctx.querySelector<T>(sel)
  const qa = <T extends Element = HTMLElement>(sel: string, ctx: ParentNode = root) =>
    Array.from(ctx.querySelectorAll<T>(sel))
  const pause = q<HTMLButtonElement>(".rv-d__pause")
  const anneau = q<SVGCircleElement>(".rv-d__anneau")
  const { buttons } = options

  let tl: gsap.core.Timeline | null = null
  let tlS: gsap.core.Timeline | null = null
  let visible = false
  let pausedByUser = false
  let started = false
  let example = 0
  let mode = ""
  let reachedVerdict = false

  function show(t: gsap.core.Timeline, plan: Element, at: number) {
    t.fromTo(plan, { autoAlpha: 0, filter: "blur(0px)" }, { autoAlpha: 1, filter: "blur(0px)", duration: 0.01, ease: "none" }, at)
  }
  function hide(t: gsap.core.Timeline, plan: Element, at: number) {
    t.to(plan, { autoAlpha: 0, duration: 0.01, ease: "none" }, at)
  }
  function rise(t: gsap.core.Timeline, el: Element | null, at: number, duration = 0.8) {
    if (el) t.fromTo(el, { yPercent: 112 }, { yPercent: 0, duration }, at)
  }
  function defocus(t: gsap.core.Timeline, plan: Element, at: number) {
    t.to(plan, { opacity: 0, filter: "blur(10px)", duration: 0.45, ease: "power2.in" }, at)
  }

  /* The loop: shots 1 to 5. */
  function buildLoop(): gsap.core.Timeline {
    const t = gsap.timeline({ paused: true, repeat: -1, defaults: { ease: E } })
    const img = q(".rv-d__img")
    const p = qa(".rv-d__plan")

    // The light of the floor drifts slowly, warmer at the bank, colder at the verdict.
    if (img) {
      t.fromTo(img, { scale: 1.05, xPercent: 0 }, { scale: 1, xPercent: -1.2, duration: DUREE / 2, ease: L }, 0).to(
        img,
        { scale: 1.05, xPercent: 0, duration: DUREE / 2, ease: L },
        DUREE / 2,
      )
      const o0 = parseFloat(getComputedStyle(img).opacity) || 0.42
      t.fromTo(img, { opacity: o0 }, { opacity: o0 * 1.45, duration: 1.6, ease: L }, 6.3)
        .to(img, { opacity: o0, duration: 1.2, ease: L }, 9.6)
        .to(img, { opacity: o0 * 0.5, duration: 1.8, ease: L }, 13.4)
        .to(img, { opacity: o0, duration: 0.8, ease: L }, DUREE - 0.8)
    }
    if (anneau) t.fromTo(anneau, { attr: { "stroke-dashoffset": 103.67 } }, { attr: { "stroke-dashoffset": 0 }, duration: DUREE, ease: "none" }, 0)

    // Shot 1: the amount (0 to 2.6 s).
    const p1 = p[0]
    const amount = qa(".rv-d__montant .rv-d__l", p1)
    show(t, p1, 0)
    rise(t, q(".rv-d__sur .rv-d__mi", p1), 0.02)
    t.fromTo(amount, { yPercent: 104 }, { yPercent: 0, duration: 1.05, stagger: 0.045 }, 0.1)
      .fromTo(q(".rv-d__montant", p1), { "--rvap": -0.03 }, { "--rvap": 0, duration: 1.9, ease: "power2.out" }, 0.1)
      .fromTo(q(".rv-d__pouls", p1), { scale: 1, opacity: 0.6 }, { scale: 3, opacity: 0, duration: 1.1, ease: "power1.out", repeat: 1, repeatDelay: 0.05 }, 0.35)
    rise(t, q(".rv-d__leg .rv-d__mi", p1), 0.72)
    t.to(amount, { yPercent: -104, duration: 0.42, stagger: 0.018, ease: S }, 2.02).to(
      qa(".rv-d__sur .rv-d__mi, .rv-d__leg .rv-d__mi", p1),
      { yPercent: -112, duration: 0.4, ease: S },
      2.02,
    )
    hide(t, p1, 2.62)

    // Shot 2: the IBAN read part by part (2.65 to 6.55 s).
    const p2 = p[1]
    show(t, p2, 2.65)
    rise(t, q(".rv-d__sur .rv-d__mi", p2), 2.66)
    t.fromTo(qa(".rv-d__l", p2), { yPercent: 104 }, { yPercent: 0, duration: 0.85, stagger: 0.016 }, 2.7)
    qa(".rv-d__part", p2).forEach((part, i) => {
      const a = 3.5 + i * 0.46
      t.fromTo(part, { color: NONLU }, { color: AMBRE, duration: 0.32, ease: L }, a)
        .fromTo(q(".rv-d__halo", part), { opacity: 0 }, { opacity: 1, duration: 0.38, ease: L }, a)
        .fromTo(q(".rv-d__filet", part), { scaleX: 0, backgroundColor: AMBRE }, { scaleX: 1, duration: 0.5 }, a)
        .fromTo(q(".rv-d__lg", part), { yPercent: 115, color: BLANC }, { yPercent: 0, duration: 0.5 }, a + 0.04)
        .to(part, { color: BLANC, duration: 0.42, ease: L }, a + 0.5)
        .to(q(".rv-d__halo", part), { opacity: 0, duration: 0.42, ease: L }, a + 0.5)
        .to(q(".rv-d__filet", part), { backgroundColor: LIGNE, duration: 0.42, ease: L }, a + 0.5)
        .to(q(".rv-d__lg", part), { color: GRIS, duration: 0.42, ease: L }, a + 0.5)
    })
    defocus(t, p2, 6.1)
    hide(t, p2, 6.56)

    // Shot 3: the bank, pulled into focus (6.6 to 10.3 s).
    const p3 = p[2]
    show(t, p3, 6.6)
    rise(t, q(".rv-d__sur .rv-d__mi", p3), 6.62)
    t.fromTo(q(".rv-d__pouls", p3), { scale: 1, opacity: 0.6 }, { scale: 3, opacity: 0, duration: 1.1, ease: "power1.out" }, 6.9).fromTo(
      q(".rv-d__banque", p3),
      { opacity: 0, filter: "blur(18px)", scale: 0.965 },
      { opacity: 1, filter: "blur(0px)", scale: 1, duration: 1.5, ease: DOUX },
      6.64,
    )
    rise(t, q(".rv-d__leg .rv-d__mi", p3), 7.12)
    rise(t, q(".rv-d__bic .rv-d__mi", p3), 7.24)
    defocus(t, p3, 9.85)
    hide(t, p3, 10.31)

    // Shot 4: the second IBAN, the check passes, the bank does not exist (10.35 to 13.65 s).
    const p4 = p[3]
    const key = q("[data-part='cle']", p4)
    const bank = q("[data-part='banque']", p4)
    show(t, p4, DEBUT_B)
    rise(t, q(".rv-d__sur .rv-d__mi", p4), 10.36)
    t.fromTo(qa(".rv-d__l", p4), { yPercent: 104 }, { yPercent: 0, duration: 0.85, stagger: 0.016 }, 10.4)
    if (key && bank) {
      t.fromTo(key, { color: NONLU }, { color: AMBRE, duration: 0.32, ease: L }, 11.2)
        .fromTo(q(".rv-d__halo", key), { opacity: 0 }, { opacity: 1, duration: 0.38, ease: L }, 11.2)
        .fromTo(q(".rv-d__filet", key), { scaleX: 0, backgroundColor: AMBRE }, { scaleX: 1, duration: 0.5 }, 11.2)
        .fromTo(q(".rv-d__lg", key), { yPercent: 115, color: BLANC }, { yPercent: 0, duration: 0.5 }, 11.24)
        .to(key, { color: BLANC, duration: 0.4, ease: L }, 11.9)
        .to(q(".rv-d__halo", key), { opacity: 0, duration: 0.4, ease: L }, 11.9)
        .to(q(".rv-d__filet", key), { backgroundColor: LIGNE, duration: 0.4, ease: L }, 11.9)
        .to(q(".rv-d__lg", key), { color: GRIS, duration: 0.4, ease: L }, 11.9)
        .fromTo(bank, { color: NONLU }, { color: BLANC, duration: 0.3, ease: L }, 11.95)
        .fromTo(q(".rv-d__barre", bank), { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: "power2.inOut" }, 12.15)
        .fromTo(q(".rv-d__pm", bank), { opacity: 1 }, { opacity: 0.38, duration: 0.5, ease: L }, 12.55)
        .fromTo(q(".rv-d__lg", bank), { yPercent: 115 }, { yPercent: 0, duration: 0.55 }, 12.5)
    }
    defocus(t, p4, 13.2)
    hide(t, p4, 13.66)

    // Shot 5: the verdict, held long (13.7 to 20.6 s).
    const p5 = p[4]
    show(t, p5, VERDICT)
    rise(t, q(".rv-d__preuve .rv-d__mi", p5), 13.72)
    t.fromTo(qa(".rv-d__verdict .rv-d__l", p5), { yPercent: 104 }, { yPercent: 0, duration: 0.95, stagger: 0.03 }, 13.8)
      .fromTo(q(".rv-d__verdict", p5), { "--rvap": -0.025 }, { "--rvap": 0, duration: 1.8, ease: "power2.out" }, 13.8)
      .fromTo(q(".rv-d__regle", p5), { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: "power3.inOut" }, 14.55)
    rise(t, q(".rv-d__raison .rv-d__mi", p5), 14.75)
    t.to(p5, { opacity: 0, filter: "blur(8px)", duration: 0.7, ease: "power2.in" }, DUREE - 0.75)
    hide(t, p5, DUREE - 0.04)

    t.eventCallback("onUpdate", () => {
      const time = t.time()
      if (!reachedVerdict && time >= VERDICT) {
        reachedVerdict = true
        options.onStation(3)
      }
      if (example === 2) return
      const now = time < COUPURE ? 0 : 1
      if (now !== example) mark(now)
      fill(now, now === 0 ? time / COUPURE : (time - COUPURE) / (DUREE - COUPURE))
    })
    return t
  }

  /* The third example, a typo: shots 6 and 7, played on demand. */
  function buildTypo(): gsap.core.Timeline {
    const t = gsap.timeline({ paused: true, defaults: { ease: E } })
    const p = qa(".rv-d__plan")
    const p6 = p[5]
    const p7 = p[6]
    if (anneau) t.fromTo(anneau, { attr: { "stroke-dashoffset": 103.67 } }, { attr: { "stroke-dashoffset": 0 }, duration: DUREE_S, ease: "none" }, 0)
    const key = q("[data-part='cle']", p6)
    show(t, p6, 0)
    rise(t, q(".rv-d__sur .rv-d__mi", p6), 0.02)
    t.fromTo(qa(".rv-d__l", p6), { yPercent: 104 }, { yPercent: 0, duration: 0.85, stagger: 0.016 }, 0.06)
    if (key) {
      t.fromTo(key, { color: NONLU }, { color: AMBRE, duration: 0.32, ease: L }, 0.86)
        .fromTo(q(".rv-d__filet", key), { scaleX: 0, backgroundColor: AMBRE }, { scaleX: 1, duration: 0.5 }, 0.86)
        .to(key, { color: ROUGE, duration: 0.3, ease: L }, 1.5)
        .to(q(".rv-d__filet", key), { backgroundColor: ROUGE, duration: 0.3, ease: L }, 1.5)
        .fromTo(q(".rv-d__halo", key), { opacity: 0 }, { opacity: 1, duration: 0.4, ease: L }, 1.5)
    }
    t.fromTo(qa("[data-part='banque'] .rv-d__pm, [data-part='compte'] .rv-d__pm", p6), { opacity: 1 }, { opacity: 0.38, duration: 0.5, ease: L }, 1.62)
    rise(t, q(".rv-d__leg .rv-d__mi", p6), 1.66, 0.6)
    t.to(p6, { opacity: 0, filter: "blur(10px)", duration: 0.45, ease: "power2.in" }, 3.05)
    hide(t, p6, 3.51)

    show(t, p7, 3.55)
    rise(t, q(".rv-d__preuve .rv-d__mi", p7), 3.57)
    t.fromTo(qa(".rv-d__verdict .rv-d__l", p7), { yPercent: 104 }, { yPercent: 0, duration: 0.95, stagger: 0.03 }, 3.65)
      .fromTo(q(".rv-d__verdict", p7), { "--rvap": -0.025 }, { "--rvap": 0, duration: 1.8, ease: "power2.out" }, 3.65)
      .fromTo(q(".rv-d__regle", p7), { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: "power3.inOut" }, 4.45)
    rise(t, q(".rv-d__raison .rv-d__mi", p7), 4.65)
    t.to(p7, { opacity: 0, filter: "blur(8px)", duration: 0.7, ease: "power2.in" }, DUREE_S - 0.75)
    hide(t, p7, DUREE_S - 0.04)
    t.eventCallback("onUpdate", () => fill(2, t.time() / DUREE_S))
    // Once the typo has been told, the loop starts again from the real bank.
    t.eventCallback("onComplete", () => select(0, false))
    return t
  }

  function mark(n: number) {
    example = n
    buttons.forEach((b, i) => {
      if (i === n) b.setAttribute("aria-current", "true")
      else {
        b.removeAttribute("aria-current")
        b.style.setProperty("--rv-p", "0")
      }
    })
    options.onExample(n)
  }

  function fill(n: number, progress: number) {
    buttons[n]?.style.setProperty("--rv-p", Math.max(0, Math.min(1, progress)).toFixed(4))
  }

  function active() {
    return example === 2 ? tlS : tl
  }

  function update() {
    if (!tl || !tlS) return
    const play = visible && !document.hidden && !pausedByUser
    const current = active()
    const other = current === tl ? tlS : tl
    other?.pause()
    if (!current) return
    if (!play) {
      current.pause()
      return
    }
    if (!started) {
      started = true
      mark(0)
      options.onStation(0)
      tl.play(0)
      return
    }
    current.play()
  }

  function build() {
    tl = buildLoop()
    tlS = buildTypo()
    mode = currentMode()
    root.removeAttribute("data-fixe")
    root.classList.add("rv-d--anime")
  }

  function clear() {
    tl?.kill()
    tlS?.kill()
    tl = null
    tlS = null
    gsap.set(qa(".rv-d__plan, .rv-d__plan *, .rv-d__img, .rv-d__anneau"), { clearProps: CLEARED })
  }

  function currentMode() {
    return root.getBoundingClientRect().width >= 760 ? "wide" : "narrow"
  }

  /* A chosen example: playing, it starts from its beginning; paused, it shows its frame. */
  function select(n: number, scroll = true) {
    if (!tl || !tlS) return
    if (!started) {
      started = true
      options.onStation(0)
    }
    mark(n)
    if (n === 2) {
      tl.pause()
      tl.seek(NOIR, false)
      tlS.pause(0)
      if (pausedByUser) tlS.seek(CLE_S, false)
      fill(2, tlS.time() / DUREE_S)
    } else {
      tlS.pause(0)
      tl.seek(pausedByUser ? CLES[n] : n === 0 ? 0 : DEBUT_B, false)
    }
    update()
    if (scroll) {
      const r = root.getBoundingClientRect()
      if (r.bottom < 60 || r.top > window.innerHeight - 120) {
        root.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
  }

  /* The layout changes at 760 px: the shots are rebuilt, at the same instant. */
  function recalibrate() {
    if (!tl || !tlS || currentMode() === mode) return
    const loopTime = tl.time()
    const typoTime = tlS.time()
    const wasTypo = example === 2
    clear()
    build()
    if (wasTypo) {
      tl?.seek(NOIR, false)
      tlS?.seek(typoTime, false)
    } else {
      tl?.seek(loopTime, false)
    }
    update()
  }

  function onPause() {
    pausedByUser = !pausedByUser
    root.classList.toggle("rv-d--pause", pausedByUser)
    pause?.setAttribute("aria-label", pausedByUser ? options.playLabel : options.pauseLabel)
    update()
  }

  build()
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting
      update()
    },
    { threshold: 0.2 },
  )
  io.observe(root)
  let resizeTimer = 0
  const onResize = () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(recalibrate, 200)
  }
  document.addEventListener("visibilitychange", update)
  window.addEventListener("resize", onResize)
  pause?.addEventListener("click", onPause)

  return {
    select,
    destroy() {
      io.disconnect()
      window.clearTimeout(resizeTimer)
      document.removeEventListener("visibilitychange", update)
      window.removeEventListener("resize", onResize)
      pause?.removeEventListener("click", onPause)
      clear()
      root.classList.remove("rv-d--anime", "rv-d--pause")
      pause?.setAttribute("aria-label", options.pauseLabel)
      buttons.forEach((b) => b.style.removeProperty("--rv-p"))
    },
  }
}
