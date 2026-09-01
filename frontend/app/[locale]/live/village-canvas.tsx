"use client"

/**
 * The living canvas, art edition: every visible element is a cut-out of
 * Claude-Alain's Midjourney boards (atlas in /public/village). The engine
 * draws ground+streets from a prerendered layer, then ONE painter's-order
 * pass interleaves buildings, décor and everyone who moves, then light
 * (additive halos), weather-of-embers, the quest spotlight and the night
 * vignette. All strings arrive translated via props.
 *
 * Honesty contract (spec §4): the hero only walks a path the API response
 * proved; clerks are openly decorative and never run the pipeline.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  W, H, SCALE, STATIONS, stationById, REGISTRY_CCS,
  loadWorldImages, paintGround, paintVignette, drawSprite, drawActor,
  SCENERY, HALOS, EMBER_ZONES, CHIMNEYS,
  type Actor, type StationGeo, type WorldImages,
} from "./world"
import { roadRoute } from "@/lib/village/roads"
import { naturalPath } from "@/lib/village/path"
import type { StationId, StepOutcome } from "@/lib/village/journey"

export interface NarratedStep {
  station: StationId
  who: string
  text: string
  outcome: StepOutcome
  holdMs: number
  regCc?: string | null
}

export interface StationTip { name: string; role: string; real: string }

export interface TrafficCourier {
  key: number
  kind: "full" | "library" | "fail"
  tint: number
  tip: StationTip
}

export interface Vignette {
  id: number
  kind: "caravan" | "watch" | "archive"
  lines: { who: string; text: string }[]
}

interface Props {
  labels: Record<string, string>
  laneLabel: string
  tips: Record<string, StationTip>
  heroTip: StationTip
  villagerTip: StationTip
  idle: { who: string; text: string }
  quest: { id: number; steps: NarratedStep[] } | null
  traffic?: TrafficCourier[]
  vignette?: Vignette | null
  onQuestEnd?: () => void
}

const COURIER_KINDS = ["cour-a", "cour-b", "cour-c"] as const
const COURIER_RUNS: Record<TrafficCourier["kind"], [number, number][]> = {
  full: [[-28, 192], [932, 192], [932, 342], [202, 342], [202, 498], [952, 498], [998, 498]],
  library: [[-28, 192], [430, 192], [-36, 192]],
  fail: [[-28, 192], [200, 192], [-36, 192]],
}
const HERO_SPEED = 156
const COURIER_SPEED = 220

/** Bespoke label spots (logical coords). The registry row staggers two lines
 * on the middle street so six close-set plaques cannot collide; the top-row
 * stations sit on their street's lower half so the courier line at y=192
 * stays mostly clear. */
const LABEL_AT: Record<string, [number, number]> = {
  gate: [80, 203], scribe: [196, 203], cutter: [306, 203], library: [414, 203],
  "reg-DE": [549, 346], "reg-AT": [614, 361], "reg-BE": [676, 346],
  "reg-BG": [736, 361], "reg-NL": [800, 346], "reg-FI": [867, 361],
  // the three counters stagger like the lane: their long names collide flat
  classifier: [270, 346], court: [366, 362], six: [460, 346],
  warehouse: [160, 56], tower: [380, 517], forge: [560, 518],
  archive: [140, 516], border: [280, 518], vigil: [906, 510],
}

interface Spark { x: number; y: number; vx: number; vy: number; l: number; c: string }
interface Puff { x: number; y: number; a: number; s: number; vy: number }
interface Seal { x: number; y: number; sprite: "coin" | "seal-x"; l: number }
interface Pulse { x: number; y: number; r: number; l: number }

export function VillageCanvas({ labels, laneLabel, tips, heroTip, villagerTip, idle, quest, traffic, vignette, onQuestEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceRef = useRef<HTMLCanvasElement>(null)
  const [narr, setNarr] = useState<{ who: string; text: string }>(idle)
  const [tip, setTip] = useState<{ x: number; y: number; tip: StationTip } | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** station under the mouse — drives the DOM label lift and the cursor;
   * the canvas glow reads the ref (per-frame), this state feeds the DOM */
  const [hoverId, setHoverId] = useState<string | null>(null)

  const world = useRef({
    img: null as WorldImages | null,
    groundLayer: null as HTMLCanvasElement | null,
    vignetteLayer: null as HTMLCanvasElement | null,
    hero: { x: -30, y: 192, dir: 1, kind: "hero", face: "side", hidden: true } as Actor,
    // the villagers mill about the market square (the registry lane's old
    // ground): north of the top street, out of every pipeline lane
    clerks: [0, 1, 2, 3, 4].map((i) => ({
      x: 560 + i * 62, y: 116 + (i % 3) * 22, dir: 1 as const,
      kind: `clerk${i}` as Actor["kind"],
      wt: i * 1.9, tx: undefined as number | undefined, ty: undefined as number | undefined,
    })),
    watcher: { x: 900, y: 494, dir: -1, kind: "clerk5", face: "down" } as Actor,
    archivist: { x: 126, y: 502, dir: 1, kind: "clerk4", face: "down" } as Actor,
    couriers: [] as { key: number; tip: StationTip; actor: Actor; pts: [number, number][]; i: number }[],
    seenCouriers: new Set<number>(),
    cart: null as { x: number; y: number; dir: 1 | -1 } | null,
    veilLayer: null as HTMLCanvasElement | null,
    sparks: [] as Spark[], puffs: [] as Puff[], seals: [] as Seal[], pulses: [] as Pulse[],
    embers: [] as { x: number; y: number; vx: number; p: number }[],
    flies: [] as { x: number; y: number; p: number }[],
    /** daylight ambience: drifting pollen motes and a few butterflies */
    pollen: [] as { x: number; y: number; p: number; s: number }[],
    wings: [] as { cx: number; cy: number; p: number; c: string }[],
    /** the walked path, item 4: points the hero has actually covered */
    trail: [] as [number, number][],
    /** station under the mouse — read by the draw pass for the golden lift */
    hover: null as string | null,
    veil: false, focus: null as StationGeo | null, gen: 0, reduced: false,
  })

  /* ---------- asset loading ---------- */
  useEffect(() => {
    let stop = false
    loadWorldImages()
      .then((img) => {
        if (stop) return
        const w = world.current
        w.img = img
        const g = document.createElement("canvas")
        g.width = W; g.height = H
        paintGround(g.getContext("2d")!, img)
        w.groundLayer = g
        const v = document.createElement("canvas")
        v.width = W; v.height = H
        paintVignette(v.getContext("2d")!)
        w.vignetteLayer = v
        // ambience seeds
        w.embers = Array.from({ length: 10 }, (_, i) => {
          const [zx, zy] = EMBER_ZONES[i % EMBER_ZONES.length]
          return { x: zx + (Math.random() - 0.5) * 30, y: zy - Math.random() * 24, vx: (Math.random() - 0.5) * 0.1, p: Math.random() * 6 }
        })
        // no fireflies in daylight — the day breathes with pollen motes and a
        // few butterflies over the planters instead (item 3, 01/09)
        w.flies = []
        w.pollen = Array.from({ length: 16 }, () => ({
          x: Math.random() * W, y: Math.random() * H, p: Math.random() * 7, s: 0.6 + Math.random() * 0.8,
        }))
        const BLOOMS: [number, number][] = [[502, 176], [652, 170], [148, 192], [860, 492]]
        w.wings = BLOOMS.slice(0, 4).map(([bx, by], i) => ({
          cx: bx, cy: by - 12, p: i * 1.7, c: ["#F472B6", "#FBBF24", "#93C5FD", "#F9A8D4"][i],
        }))
        setLoaded(true)
      })
      .catch(() => { /* stays on the loading veil; a reload retries */ })
    return () => { stop = true }
  }, [])

  /* ---------- render loop ---------- */
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !loaded) return
    const ctx = cv.getContext("2d")
    if (!ctx) return
    const w = world.current
    w.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    ctx.imageSmoothingEnabled = false
    let raf = 0
    let last = 0

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const img = w.img
      if (!img) return
      const dt = Math.min(50, t - last); last = t

      /* -- simulate -- */
      if (!w.reduced) {
        for (const c of w.clerks) {
          c.wt -= dt / 1000
          if (c.wt <= 0) { c.wt = 2.5 + Math.random() * 4; c.tx = 540 + Math.random() * 340; c.ty = 104 + Math.random() * 66 }
          const a = c as unknown as Actor
          if (c.tx !== undefined && c.ty !== undefined) {
            const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy)
            if (d > 1.5) { c.x += (dx / d) * dt * 0.02; c.y += (dy / d) * dt * 0.02; a.dir = dx < 0 ? -1 : 1; a.moving = true }
            else a.moving = false
          }
        }
        for (const cr of w.couriers) {
          const [tx, ty] = cr.pts[cr.i]
          const dx = tx - cr.actor.x, dy = ty - cr.actor.y
          const d = Math.hypot(dx, dy)
          const step = (COURIER_SPEED * dt) / 1000
          if (d <= step) { cr.actor.x = tx; cr.actor.y = ty; cr.i++ }
          else {
            cr.actor.x += (dx / d) * step; cr.actor.y += (dy / d) * step
            cr.actor.dir = dx < 0 ? -1 : 1
            cr.actor.face = Math.abs(dx) >= Math.abs(dy) ? "side" : dy < 0 ? "up" : "down"
            cr.actor.moving = true
          }
        }
        w.couriers = w.couriers.filter((cr) => cr.i < cr.pts.length)
        for (const e of w.embers) {
          e.y -= dt * 0.014; e.x += e.vx + Math.sin(t / 700 + e.p) * 0.05
          if (e.y < 40 || Math.random() < 0.002) {
            const [zx, zy] = EMBER_ZONES[Math.floor(Math.random() * EMBER_ZONES.length)]
            e.x = zx + (Math.random() - 0.5) * 40; e.y = zy
          }
        }
        for (const f of w.flies) { f.x += Math.sin(t / 900 + f.p) * 0.18; f.y += Math.cos(t / 1100 + f.p) * 0.12 }
        for (const g of w.pollen) {
          g.x += 0.05 + Math.sin(t / 1300 + g.p) * 0.12
          g.y += Math.cos(t / 1700 + g.p) * 0.08 - 0.012
          if (g.x > W + 4) g.x = -4
          if (g.y < -4) g.y = H + 4
        }
        // forge chimney smoke
        if (Math.floor(t / 460) !== Math.floor((t - dt) / 460) && w.puffs.length < 18) {
          for (const [cx, cy] of CHIMNEYS) w.puffs.push({ x: cx, y: cy - 44, a: 0.45, s: 0.55, vy: 0.17 })
        }
        // idle hearth sparkle
        if (Math.random() < 0.04) w.sparks.push({ x: 522 + (Math.random() - 0.5) * 24, y: 468, vx: (Math.random() - 0.5) * 0.8, vy: -Math.random() * 1.2 - 0.3, l: 30, c: "#FDE68A" })
      }
      w.sparks = w.sparks.filter((s) => --s.l > 0); w.sparks.forEach((s) => { s.x += s.vx; s.y += s.vy; s.vy += 0.04 })
      w.puffs = w.puffs.filter((p) => (p.a -= 0.004) > 0); w.puffs.forEach((p) => { p.y -= p.vy; p.s += 0.006 })
      w.seals = w.seals.filter((s) => --s.l > 0)
      w.pulses = w.pulses.filter((p) => --p.l > 0); w.pulses.forEach((p) => { p.r += 0.7 })

      /* -- draw -- */
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
      ctx.drawImage(w.groundLayer!, 0, 0)

      // the walked path (item 4): a dotted golden ribbon over the ground and
      // UNDER everything that stands — the proof of where the hero has been
      if (w.trail.length > 1) {
        // two passes: a soft dark underlay so the ribbon reads on the brown
        // streets too, then golden stitches on top (amber alone vanished on
        // earth — measured on the first headless capture)
        ctx.save()
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(w.trail[0][0], w.trail[0][1])
        for (const [px, py] of w.trail) ctx.lineTo(px, py)
        ctx.strokeStyle = "rgba(70,40,8,0.38)"
        ctx.lineWidth = 5
        ctx.stroke()
        ctx.strokeStyle = "rgba(255,205,70,0.95)"
        ctx.lineWidth = 2.2
        ctx.setLineDash([6, 7])
        ctx.lineDashOffset = w.reduced ? 0 : -t / 60
        ctx.stroke()
        ctx.restore()
      }

      type Entity = { base: number; draw: () => void }
      const ents: Entity[] = SCENERY.map((p) => ({
        base: p.base,
        draw: () => {
          // the hovered station lifts a breath and glows warm — the "you are
          // pointing at me" answer the operator asked for (item 3)
          const hot = p.id !== undefined && p.id === w.hover
          if (hot) {
            ctx.save()
            ctx.shadowColor = "rgba(255,190,70,0.95)"
            ctx.shadowBlur = 16
            drawSprite(ctx, img, p.sprite, p.cx, p.base, { scale: p.scale, flip: p.flip, dy: -2 })
            ctx.restore()
            drawSprite(ctx, img, p.sprite, p.cx, p.base, { scale: p.scale, flip: p.flip, dy: -2 })
          } else {
            drawSprite(ctx, img, p.sprite, p.cx, p.base, { scale: p.scale, flip: p.flip })
          }
        },
      }))
      const actors: Actor[] = [
        ...(w.clerks as unknown as Actor[]), ...w.couriers.map((c) => c.actor),
        w.watcher, w.archivist, w.hero,
      ]
      for (const a of actors) {
        if (!a.hidden) ents.push({ base: a.y, draw: () => drawActor(ctx, img, a, t, w.reduced) })
      }
      if (w.cart) {
        const c = w.cart
        ents.push({ base: c.y + 10, draw: () => drawSprite(ctx, img, "cart", c.x, c.y + 10, { flip: c.dir < 0 }) })
      }
      ents.sort((a, b) => a.base - b.base)
      for (const e of ents) e.draw()

      // smoke, sparks, embers, fireflies
      for (const p of w.puffs) drawSprite(ctx, img, "smoke", p.x, p.y, { alpha: p.a, scale: p.s })
      for (const s of w.sparks) { ctx.fillStyle = s.c; ctx.fillRect(s.x, s.y, 1.6, 1.6) }
      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      for (const e of w.embers) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 300 + e.p)
        ctx.fillStyle = "#F59E0B"; ctx.fillRect(e.x, e.y, 1.4, 1.4)
      }
      for (const f of w.flies) {
        ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t / 500 + f.p))
        ctx.fillStyle = "#FDE68A"; ctx.fillRect(f.x, f.y, 1.2, 1.2)
      }
      for (const g of w.pollen) {
        ctx.globalAlpha = 0.10 + 0.14 * (0.5 + 0.5 * Math.sin(t / 800 + g.p))
        ctx.fillStyle = "#FFFBEB"; ctx.fillRect(g.x, g.y, g.s, g.s)
      }
      // lantern / flame halos
      for (let i = 0; i < HALOS.length; i++) {
        const [hx, hy, hr, hs] = HALOS[i]
        const pulse = w.reduced ? 1 : 0.86 + 0.14 * Math.sin(t / 520 + i * 1.7)
        const rr = hr * 1.3
        const g = ctx.createRadialGradient(hx, hy, 2, hx, hy, rr * pulse)
        g.addColorStop(0, `rgba(255,196,100,${0.44 * hs})`)
        g.addColorStop(1, "rgba(255,196,100,0)")
        ctx.globalAlpha = 1
        ctx.fillStyle = g
        ctx.fillRect(hx - rr, hy - rr, rr * 2, rr * 2)
      }
      ctx.restore()

      // butterflies over the planters: a figure-eight and a two-pixel flap
      for (const b of w.wings) {
        const u = w.reduced ? b.p : t / 760 + b.p
        const bx = b.cx + Math.sin(u) * 20
        const by = b.cy + Math.sin(u * 2) * 8
        const flap = w.reduced ? 1 : 0.4 + 1.4 * Math.abs(Math.sin(t / 90 + b.p))
        ctx.fillStyle = b.c
        ctx.fillRect(bx - flap - 0.6, by - 0.8, flap, 1.6)
        ctx.fillRect(bx + 0.6, by - 0.8, flap, 1.6)
        ctx.fillStyle = "#3F3F46"
        ctx.fillRect(bx - 0.5, by - 1, 1, 2.4)
      }

      // floating seals (verdicts)
      for (const s of w.seals) {
        const yy = s.y - (110 - s.l) * 0.2
        drawSprite(ctx, img, s.sprite, s.x, yy, { alpha: Math.min(1, s.l / 30) })
      }
      for (const p of w.pulses) {
        ctx.strokeStyle = "#FBBF24"; ctx.globalAlpha = p.l / 40
        ctx.strokeRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); ctx.globalAlpha = 1
      }

      // quest spotlight — the veil is pierced on its OWN layer, so the holes
      // reveal the lit world underneath instead of the dark page behind it
      if (w.veil) {
        if (!w.veilLayer) { w.veilLayer = document.createElement("canvas"); w.veilLayer.width = W; w.veilLayer.height = H }
        const vc = w.veilLayer.getContext("2d")!
        vc.setTransform(1, 0, 0, 1, 0, 0)
        vc.clearRect(0, 0, W, H)
        vc.fillStyle = "rgba(6,6,12,0.36)"; vc.fillRect(0, 0, W, H)
        vc.globalCompositeOperation = "destination-out"
        const hole = (x: number, y: number, r: number) => {
          const g = vc.createRadialGradient(x, y, 8, x, y, r)
          g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)")
          vc.fillStyle = g; vc.fillRect(x - r, y - r, r * 2, r * 2)
        }
        hole(w.hero.x, w.hero.y - 16, 104)
        if (w.focus) hole(w.focus.cx, w.focus.base - w.focus.bh / 2, 126)
        vc.globalCompositeOperation = "source-over"
        ctx.drawImage(w.veilLayer, 0, 0)
      }

      ctx.drawImage(w.vignetteLayer!, 0, 0)
      // Labels left the canvas on 01/09: painted plaques scale down with it,
      // and at laptop widths they blurred into illegibility — the operator's
      // report, twice. They are DOM now (see the overlay in the JSX below):
      // browser text at screen pixels, crisp at every size.
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [labels, laneLabel, loaded])

  /* ---------- movement helpers ---------- */
  const makeSleep = useCallback((genAtStart: number) => {
    const w = world.current
    // Tick-counted rather than wall-clock: virtual-time capture tools and
    // hidden tabs then advance the film consistently with the timers.
    return async (ms: number) => {
      let left = w.reduced ? Math.min(ms, 400) : ms
      while (left > 0) {
        if (w.gen !== genAtStart) return false
        const tick = document.hidden ? 300 : 16
        await new Promise((r) => setTimeout(r, tick))
        left -= tick
      }
      return w.gen === genAtStart
    }
  }, [])

  const makeMove = useCallback((genAtStart: number) => {
    const w = world.current
    return async (a: Actor, rawPts: [number, number][], speed: number) => {
      const pts = w.reduced ? rawPts : naturalPath([[a.x, a.y], ...rawPts]).slice(1)
      for (const [tx, ty] of pts) {
        if (w.gen !== genAtStart) return false
        if (w.reduced) {
          a.x = tx; a.y = ty
          if (a === w.hero) w.trail.push([tx, ty])
          await new Promise((r) => setTimeout(r, 120))
          continue
        }
        const d = Math.hypot(tx - a.x, ty - a.y)
        const n = Math.max(1, (d / speed) * 60)
        const sx = (tx - a.x) / n, sy = (ty - a.y) / n
        a.dir = sx < 0 ? -1 : 1
        a.face = Math.abs(sx) >= Math.abs(sy) ? "side" : sy < 0 ? "up" : "down"
        a.moving = true
        for (let i = 0; i < n; i++) {
          if (w.gen !== genAtStart) return false
          a.x += sx; a.y += sy
          // the walked ribbon (item 4): hero only, sampled every few pixels,
          // hard-capped so a long session can never grow it unbounded
          if (a === w.hero) {
            const lastP = w.trail[w.trail.length - 1]
            if (!lastP || Math.hypot(a.x - lastP[0], a.y - lastP[1]) >= 4) {
              w.trail.push([a.x, a.y])
              if (w.trail.length > 800) w.trail.shift()
            }
          }
          await new Promise((r) => setTimeout(r, 16))
        }
        a.x = tx; a.y = ty; a.moving = false
      }
      a.face = "down"
      return true
    }
  }, [])

  /* ---------- quest runner ---------- */
  const runQuest = useCallback(async (steps: NarratedStep[]) => {
    const w = world.current
    const gen = ++w.gen
    const sleep = makeSleep(gen)
    const move = makeMove(gen)
    const walk = (pts: [number, number][]) => move(w.hero, pts, HERO_SPEED)

    w.hero.hidden = false; w.hero.x = -30; w.hero.y = 192; w.hero.face = "side"; w.hero.dir = 1
    w.veil = true; w.focus = null
    w.trail = [[w.hero.x, w.hero.y]]
    let anchor: [number, number] = [-28, 192]

    for (const step of steps) {
      if (w.gen !== gen) return
      const failExit = step.station === "exit" && step.outcome === "fail"
      let target: StationGeo | null = null
      if (step.station === "registry") {
        const cc = step.regCc && (REGISTRY_CCS as readonly string[]).includes(step.regCc) ? step.regCc : "DE"
        target = stationById[`reg-${cc}`]
      } else if (step.station !== "exit") {
        target = stationById[step.station] ?? null
      }

      if (failExit) {
        w.focus = null
        setNarr({ who: step.who, text: step.text })
        w.hero.dir = -1
        await walk([[80, 192], [-40, 192]])
        break
      }
      if (step.station === "exit") {
        w.focus = null
        setNarr({ who: step.who, text: step.text })
        if (!(await walk([...roadRoute(anchor, [952, 498]), [998, 498]]))) return
        break
      }

      if (target) {
        // Every door now opens straight onto a street (the registry lane
        // moved down to the middle street), so one continuous stroll covers
        // the road AND the doorstep: the spline blends them into a single
        // walk instead of a stop-then-shuffle at the anchor.
        if (anchor[0] !== target.anchor[0] || anchor[1] !== target.anchor[1]) {
          const pts = roadRoute(anchor, target.anchor)
          if (target.door[0] !== target.anchor[0] || target.door[1] !== target.anchor[1]) pts.push(target.door)
          if (!(await walk(pts))) return
          anchor = target.anchor
        }
        w.focus = target
      }

      setNarr({ who: step.who, text: step.text })
      if (step.station === "gate") w.seals.push({ x: 80, y: 140, sprite: "coin", l: 90 })
      if (step.station === "scribe" && step.outcome === "fail") w.seals.push({ x: 204, y: 116, sprite: "seal-x", l: 110 })
      if (step.station === "registry" && target) w.pulses.push({ x: target.cx, y: target.base - 60, r: 6, l: 40 })
      if (step.station === "tower") w.pulses.push({ x: 380, y: 372, r: 6, l: 40 })
      if (step.station === "forge") {
        for (let i = 0; i < 24; i++) w.sparks.push({ x: 522 + (Math.random() - 0.5) * 36, y: 468, vx: (Math.random() - 0.5) * 1.8, vy: -Math.random() * 2 - 0.5, l: 30 + Math.random() * 20, c: "#FDE68A" })
        w.seals.push({ x: 540, y: 398, sprite: step.outcome === "fail" ? "seal-x" : "coin", l: 120 })
      }
      if (!(await sleep(step.holdMs))) return
    }
    if (w.gen !== gen) return
    w.veil = false; w.focus = null; w.hero.hidden = true
    onQuestEnd?.()
  }, [makeMove, makeSleep, onQuestEnd])

  // Play each quest id ONCE. The effect also fires when runQuest is recreated
  // (its onQuestEnd prop is an inline closure upstream, so any page re-render
  // — the 5s traffic poll included — renews it); without the id guard the
  // same quest replayed forever on the live site.
  const playedQuest = useRef(0)
  useEffect(() => {
    if (quest && quest.steps.length > 0 && quest.id !== playedQuest.current) {
      playedQuest.current = quest.id
      void runQuest(quest.steps)
    }
  }, [quest, runQuest])
  useEffect(() => { setNarr(idle) }, [idle])

  /* ---------- traffic couriers ---------- */
  useEffect(() => {
    if (!traffic) return
    const w = world.current
    for (const [idx, op] of traffic.entries()) {
      if (w.seenCouriers.has(op.key) || w.couriers.length >= 8) continue
      w.seenCouriers.add(op.key)
      const pts = naturalPath(COURIER_RUNS[op.kind])
      w.couriers.push({
        key: op.key, tip: op.tip, pts, i: 1,
        actor: {
          x: pts[0][0] - (idx % 3) * 10, y: pts[0][1], dir: 1,
          kind: COURIER_KINDS[op.tint % COURIER_KINDS.length], face: "side", moving: true,
        },
      })
    }
  }, [traffic])

  /* ---------- vignettes ---------- */
  const runVignette = useCallback(async (v: Vignette) => {
    const w = world.current
    const gen = ++w.gen
    const sleep = makeSleep(gen)
    const move = makeMove(gen)
    const line = (i: number) => { if (v.lines[i]) setNarr(v.lines[i]) }
    const rollCart = async (y: number, fromX: number, toX: number, stops: number[]) => {
      const dir: 1 | -1 = toX > fromX ? 1 : -1
      w.cart = { x: fromX, y, dir }
      const points = [...stops, toX]
      for (const sx of points) {
        while (w.cart && (dir > 0 ? w.cart.x < sx : w.cart.x > sx)) {
          if (w.gen !== gen) { w.cart = null; return false }
          w.cart.x += dir * (w.reduced ? 14 : 1.4)
          await new Promise((r) => setTimeout(r, 16))
        }
        if (stops.includes(sx)) {
          w.pulses.push({ x: sx, y: y - 30, r: 6, l: 40 })
          if (!(await sleep(420))) { w.cart = null; return false }
        }
      }
      w.cart = null
      return true
    }

    w.hero.hidden = true
    if (v.kind === "caravan") {
      line(0)
      // leg 1 — arrival on the caravan road, unloading at the warehouse
      if (!(await rollCart(76, -40, 930, [120]))) return
      // leg 2 — down the middle street, one delivery at every registry door
      // (right to left: the descending sort matches the cart's direction)
      const houseStops = STATIONS.filter((s) => s.cc).map((s) => s.cx).sort((a, b) => b - a)
      if (!(await rollCart(342, 990, 236, houseStops))) return
      line(1); if (!(await sleep(2800))) return
      line(2)
      // leg 3 — the watchlist goes to the watchtower on the bottom street
      const towerX = stationById["tower"].cx
      if (!(await rollCart(498, 990, towerX + 56, []))) return
      w.pulses.push({ x: towerX, y: 400, r: 8, l: 46 })
      if (!(await sleep(2400))) return
    } else if (v.kind === "watch") {
      line(0)
      const tour: [number, number][] = [[900, 498], [214, 498], [202, 342], [716, 342], [920, 342], [900, 468]]
      for (const p of tour) {
        if (!(await move(w.watcher, [p], 130))) return
        w.pulses.push({ x: w.watcher.x, y: w.watcher.y - 30, r: 5, l: 36 })
      }
      if (!(await move(w.watcher, [[900, 494]], 130))) return
      line(1); if (!(await sleep(2800))) return
    } else {
      line(0)
      // the burn happens at the brazier painted into the vault sprite's door
      if (!(await move(w.archivist, [[150, 498]], 60))) return
      for (let i = 0; i < 6; i++) {
        if (w.gen !== gen) return
        for (let k = 0; k < 7; k++) w.sparks.push({ x: 133 + (Math.random() - 0.5) * 14, y: 478, vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 1.5 - 0.3, l: 26, c: "#E8863C" })
        w.puffs.push({ x: 133, y: 462, a: 0.5, s: 0.5, vy: 0.18 })
        if (!(await sleep(600))) return
      }
      line(1); if (!(await sleep(2800))) return
      if (!(await move(w.archivist, [[126, 502]], 60))) return
    }
    if (w.gen !== gen) return
    setNarr(idle)
    onQuestEnd?.()
  }, [idle, makeMove, makeSleep, onQuestEnd])

  const playedVignette = useRef(0)
  useEffect(() => {
    if (vignette && vignette.id !== playedVignette.current) {
      playedVignette.current = vignette.id
      void runVignette(vignette)
    }
  }, [vignette, runVignette])

  /* ---------- narration portrait ---------- */
  useEffect(() => {
    if (!loaded) return
    const f = faceRef.current
    const img = world.current.img
    if (!f || !img) return
    const c = f.getContext("2d")
    if (!c) return
    c.imageSmoothingEnabled = false
    c.fillStyle = "#141218"; c.fillRect(0, 0, 44, 44)
    const fr = img.meta["hero-front"]
    if (fr) {
      const s = 38 / fr.h
      c.drawImage(img.atlas, fr.x, fr.y, fr.w, fr.h, 22 - (fr.w * s) / 2, 4, fr.w * s, fr.h * s)
    }
  }, [loaded])

  /* ---------- hover cards ---------- */
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    const w = world.current
    let found: StationTip | null = null
    let station: string | null = null
    const near = (a: Actor) => !a.hidden && Math.abs(mx - a.x) < 14 && Math.abs(my - (a.y - 20)) < 26
    const courier = w.couriers.find((cr) => near(cr.actor))
    if (courier) found = courier.tip
    else if (near(w.hero)) found = heroTip
    else if (near(w.watcher)) found = tips.vigil ?? null
    else if (near(w.archivist)) found = tips.archive ?? null
    else if ((w.clerks as unknown as Actor[]).some(near)) found = villagerTip
    else {
      for (const s of STATIONS) {
        if (mx >= s.bx && mx <= s.bx + s.bw && my >= s.by && my <= s.by + s.bh) {
          found = tips[s.id] ?? null
          station = s.id
          break
        }
      }
    }
    w.hover = station
    setHoverId(station)
    setTip(found ? { x: e.clientX, y: e.clientY, tip: found } : null)
  }
  const onLeave = () => {
    world.current.hover = null
    setHoverId(null)
    setTip(null)
  }

  return (
    <div className="relative">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={W * SCALE}
          height={H * SCALE}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onClick={onMove}
          className="block w-full"
          style={{ imageRendering: "auto", aspectRatio: "16/9", background: "#0B0E16", cursor: hoverId ? "pointer" : "crosshair" }}
        />
        {/* Labels are DOM, not paint (01/09): plaques painted into the canvas
            scale down with it and blurred illegible at laptop widths — the
            operator's report, twice. Browser text stays at screen pixels.
            pointer-events-none: the canvas under them owns the mouse. */}
        {loaded && (
          <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
            {STATIONS.filter((s) => labels[s.id]).map((s) => {
              const [lx, ly] = LABEL_AT[s.id] ?? [s.cx, s.base + 12]
              const hot = hoverId === s.id
              return (
                <span
                  key={s.id}
                  className="absolute -translate-x-1/2 whitespace-nowrap rounded-md border font-bold transition-transform duration-150"
                  style={{
                    left: `${(lx / W) * 100}%`,
                    top: `${(ly / H) * 100}%`,
                    fontSize: s.cc ? 10 : 11.5,
                    lineHeight: 1.1,
                    padding: "2px 7px",
                    background: hot ? "#FDE68A" : "rgba(255,247,228,0.94)",
                    borderColor: hot ? "#B45309" : "#8A5A28",
                    color: "#4A2E10",
                    boxShadow: "0 1px 0 rgba(74,46,16,0.35)",
                    transform: `translateX(-50%)${hot ? " scale(1.18)" : ""}`,
                  }}
                >
                  {labels[s.id]}
                </span>
              )
            })}
            <span
              className="absolute rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider"
              style={{ left: `${(712 / W) * 100}%`, top: `${(226 / H) * 100}%`, transform: "translateX(-50%)",
                background: "rgba(255,247,228,0.9)", borderColor: "#8A5A28", color: "#6B4A18" }}
            >
              {laneLabel}
            </span>
          </div>
        )}
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-sm tracking-widest uppercase"
            style={{ background: "#0B0E16", color: "#FDE68A" }}>
            ⚒ …
          </div>
        )}
      </div>
      <div
        className="flex items-start gap-3 border-t-2 px-4 py-3"
        style={{ borderColor: "var(--primary)", background: "var(--card)", minHeight: 66 }}
        aria-live="polite"
      >
        <canvas ref={faceRef} width={44} height={44} className="shrink-0 rounded border" style={{ imageRendering: "pixelated", borderColor: "var(--border)", background: "#141218" }} />
        <div className="text-[15px] leading-relaxed">
          <span className="block text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--primary)" }}>
            {narr.who}
          </span>
          {narr.text}
        </div>
      </div>
      {tip && (
        <div
          className="pointer-events-none fixed z-30 max-w-[300px] px-4 py-3 text-[13px] leading-snug"
          style={{
            left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 310 : tip.x),
            top: tip.y + 10,
            color: "#2A2115",
            borderStyle: "solid",
            borderWidth: 14,
            borderImage: "url(/village/frame.png) 110 fill / 14px stretch",
            filter: "drop-shadow(4px 5px 0 rgba(5,5,10,.5))",
          }}
        >
          <div className="font-semibold">{tip.tip.name}</div>
          <div style={{ color: "#6B5327" }}>{tip.tip.role}</div>
          <div className="mt-1 border-t border-dashed pt-1 font-mono text-[11.5px]" style={{ borderColor: "rgba(120,83,9,.4)", color: "#7C4A08" }}>
            {tip.tip.real}
          </div>
        </div>
      )}
    </div>
  )
}
