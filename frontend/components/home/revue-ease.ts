/*
 * The curves of the home's motion, as CSS writes them, for the two engines
 * that load with GSAP (revue-film-engine.ts, revue-scenes-engine.ts). GSAP's
 * core knows no cubic-bezier() ease: this solves it.
 *
 * `E` is the signature of « La revue », cubic-bezier(.2, .8, .2, 1): every
 * rise from a mask and every pull into focus lands on it. `DOUX` is the softer
 * one of the focus on a giant word.
 */

/** A cubic Bézier, as in CSS. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
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

export const E = bezier(0.2, 0.8, 0.2, 1)
export const DOUX = bezier(0.16, 1, 0.3, 1)
