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
  W, H, SCALE, STATIONS, stationById, REGISTRY_CCS, LANE_X, LANE_DOOR_Y,
  loadWorldImages, paintGround, paintVignette, drawSprite, drawActor, drawSigns,
  SCENERY, HALOS, EMBER_ZONES, CHIMNEYS,
  type Actor, type StationGeo, type WorldImages,
} from "./world"
import { roadRoute } from "@/lib/village/roads"
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

  const world = useRef({
    img: null as WorldImages | null,
    groundLayer: null as HTMLCanvasElement | null,
    vignetteLayer: null as HTMLCanvasElement | null,
    hero: { x: -30, y: 192, dir: 1, kind: "hero", face: "side", hidden: true } as Actor,
    clerks: [0, 1, 2, 3, 4].map((i) => ({
      x: 70 + i * 26, y: 440 + (i % 3) * 24, dir: 1 as const,
      kind: `clerk${i}` as Actor["kind"],
      wt: i * 1.9, tx: undefined as number | undefined, ty: undefined as number | undefined,
    })),
    watcher: { x: 900, y: 494, dir: -1, kind: "clerk5", face: "down" } as Actor,
    archivist: { x: 246, y: 506, dir: 1, kind: "clerk4", face: "down" } as Actor,
    couriers: [] as { key: number; tip: StationTip; actor: Actor; pts: [number, number][]; i: number }[],
    seenCouriers: new Set<number>(),
    cart: null as { x: number; y: number; dir: 1 | -1 } | null,
    veilLayer: null as HTMLCanvasElement | null,
    sparks: [] as Spark[], puffs: [] as Puff[], seals: [] as Seal[], pulses: [] as Pulse[],
    embers: [] as { x: number; y: number; vx: number; p: number }[],
    flies: [] as { x: number; y: number; p: number }[],
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
        w.embers = Array.from({ length: 14 }, (_, i) => {
          const [zx, zy] = EMBER_ZONES[i % EMBER_ZONES.length]
          return { x: zx + (Math.random() - 0.5) * 40, y: zy - Math.random() * 30, vx: (Math.random() - 0.5) * 0.1, p: Math.random() * 6 }
        })
        w.flies = Array.from({ length: 9 }, () => ({ x: Math.random() * W, y: 240 + Math.random() * 280, p: Math.random() * 6 }))
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
          if (c.wt <= 0) { c.wt = 2.5 + Math.random() * 4; c.tx = 56 + Math.random() * 130; c.ty = 428 + Math.random() * 84 }
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
        // chimney + forge smoke
        if (Math.floor(t / 420) !== Math.floor((t - dt) / 420) && w.puffs.length < 26) {
          for (const [cx, cy] of CHIMNEYS) w.puffs.push({ x: cx + 2, y: cy - 46, a: 0.5, s: 0.5, vy: 0.16 })
          w.puffs.push({ x: 416, y: 368, a: 0.55, s: 0.7, vy: 0.2 })
        }
        // idle forge sparkle
        if (Math.random() < 0.05) w.sparks.push({ x: 410 + (Math.random() - 0.5) * 30, y: 470, vx: (Math.random() - 0.5) * 0.8, vy: -Math.random() * 1.2 - 0.3, l: 30, c: "#FDE68A" })
      }
      w.sparks = w.sparks.filter((s) => --s.l > 0); w.sparks.forEach((s) => { s.x += s.vx; s.y += s.vy; s.vy += 0.04 })
      w.puffs = w.puffs.filter((p) => (p.a -= 0.004) > 0); w.puffs.forEach((p) => { p.y -= p.vy; p.s += 0.006 })
      w.seals = w.seals.filter((s) => --s.l > 0)
      w.pulses = w.pulses.filter((p) => --p.l > 0); w.pulses.forEach((p) => { p.r += 0.7 })

      /* -- draw -- */
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
      ctx.drawImage(w.groundLayer!, 0, 0)

      type Entity = { base: number; draw: () => void }
      const ents: Entity[] = SCENERY.map((p) => ({
        base: p.base,
        draw: () => drawSprite(ctx, img, p.sprite, p.cx, p.base, { scale: p.scale }),
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
      drawSigns(ctx, img)

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
      // lantern / flame halos
      for (let i = 0; i < HALOS.length; i++) {
        const [hx, hy, hr, hs] = HALOS[i]
        const pulse = w.reduced ? 1 : 0.86 + 0.14 * Math.sin(t / 520 + i * 1.7)
        const g = ctx.createRadialGradient(hx, hy, 2, hx, hy, hr * pulse)
        g.addColorStop(0, `rgba(255,190,90,${0.34 * hs})`)
        g.addColorStop(1, "rgba(255,190,90,0)")
        ctx.globalAlpha = 1
        ctx.fillStyle = g
        ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2)
      }
      ctx.restore()

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
        vc.fillStyle = "rgba(6,6,12,0.46)"; vc.fillRect(0, 0, W, H)
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

      // crisp labels (screen space)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.font = "600 13px var(--font-sans, system-ui), sans-serif"
      ctx.textAlign = "center"
      const label = (text: string, lx: number, ly: number) => {
        const wpx = ctx.measureText(text).width + 12
        ctx.fillStyle = "rgba(18,16,20,0.72)"; ctx.fillRect(lx - wpx / 2, ly - 13, wpx, 17)
        ctx.strokeStyle = "rgba(245,158,11,0.55)"; ctx.strokeRect(lx - wpx / 2 + 0.5, ly - 12.5, wpx - 1, 16)
        ctx.fillStyle = "#FDE68A"; ctx.fillText(text, lx, ly)
      }
      for (const s of STATIONS) {
        if (s.cc && !(w.focus && w.focus.id === s.id)) continue
        const txt = labels[s.id]
        if (txt) label(txt, s.cx * SCALE, (s.by - 6) * SCALE)
      }
      label(laneLabel, 700 * SCALE, 16 * SCALE)
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
    return async (a: Actor, pts: [number, number][], speed: number) => {
      for (const [tx, ty] of pts) {
        if (w.gen !== genAtStart) return false
        if (w.reduced) {
          a.x = tx; a.y = ty
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
    let anchor: [number, number] = [-28, 192]
    let inLane = false

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
        if (inLane) { await walk([[LANE_X, 192]]); inLane = false; anchor = [LANE_X, 192] }
        if (!(await walk(roadRoute(anchor, [952, 498])))) return
        await walk([[998, 498]])
        break
      }

      if (target) {
        const wantLane = step.station === "registry"
        if (inLane && !wantLane) { if (!(await walk([[LANE_X, 192]]))) return; inLane = false; anchor = [LANE_X, 192] }
        if (wantLane) {
          if (!inLane) {
            if (!(await walk(roadRoute(anchor, [LANE_X, 192])))) return
            if (!(await walk([[LANE_X, LANE_DOOR_Y]]))) return
            inLane = true
          }
          if (!(await walk([target.door]))) return
        } else if (anchor[0] !== target.anchor[0] || anchor[1] !== target.anchor[1]) {
          if (!(await walk(roadRoute(anchor, target.anchor)))) return
          if (target.door[0] !== target.anchor[0] || target.door[1] !== target.anchor[1]) {
            if (!(await walk([target.door]))) return
          }
          anchor = target.anchor
        }
        w.focus = target
      }

      setNarr({ who: step.who, text: step.text })
      if (step.station === "gate") w.seals.push({ x: 80, y: 150, sprite: "coin", l: 90 })
      if (step.station === "scribe" && step.outcome === "fail") w.seals.push({ x: 200, y: 140, sprite: "seal-x", l: 110 })
      if (step.station === "registry" && target) w.pulses.push({ x: target.cx, y: target.base - 60, r: 6, l: 40 })
      if (step.station === "tower") w.pulses.push({ x: 196, y: 200, r: 6, l: 40 })
      if (step.station === "forge") {
        for (let i = 0; i < 24; i++) w.sparks.push({ x: 430 + (Math.random() - 0.5) * 40, y: 470, vx: (Math.random() - 0.5) * 1.8, vy: -Math.random() * 2 - 0.5, l: 30 + Math.random() * 20, c: "#FDE68A" })
        w.seals.push({ x: 410, y: 420, sprite: step.outcome === "fail" ? "seal-x" : "coin", l: 120 })
      }
      if (!(await sleep(step.holdMs))) return
    }
    if (w.gen !== gen) return
    w.veil = false; w.focus = null; w.hero.hidden = true
    onQuestEnd?.()
  }, [makeMove, makeSleep, onQuestEnd])

  useEffect(() => {
    if (quest && quest.steps.length > 0) void runQuest(quest.steps)
  }, [quest, runQuest])
  useEffect(() => { setNarr(idle) }, [idle])

  /* ---------- traffic couriers ---------- */
  useEffect(() => {
    if (!traffic) return
    const w = world.current
    for (const [idx, op] of traffic.entries()) {
      if (w.seenCouriers.has(op.key) || w.couriers.length >= 8) continue
      w.seenCouriers.add(op.key)
      const pts = COURIER_RUNS[op.kind]
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
      if (!(await rollCart(76, -40, 930, REGISTRY_CCS.map((_, i) => 540 + i * 64)))) return
      line(1); if (!(await sleep(2800))) return
      line(2)
      if (!(await rollCart(342, 990, 236, []))) return
      w.pulses.push({ x: 196, y: 220, r: 8, l: 46 })
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
      if (!(await move(w.archivist, [[230, 500]], 60))) return
      for (let i = 0; i < 6; i++) {
        if (w.gen !== gen) return
        for (let k = 0; k < 7; k++) w.sparks.push({ x: 222 + (Math.random() - 0.5) * 16, y: 486, vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 1.5 - 0.3, l: 26, c: "#E8863C" })
        w.puffs.push({ x: 222, y: 470, a: 0.5, s: 0.5, vy: 0.18 })
        if (!(await sleep(600))) return
      }
      line(1); if (!(await sleep(2800))) return
      if (!(await move(w.archivist, [[246, 506]], 60))) return
    }
    if (w.gen !== gen) return
    setNarr(idle)
    onQuestEnd?.()
  }, [idle, makeMove, makeSleep, onQuestEnd])

  useEffect(() => {
    if (vignette) void runVignette(vignette)
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
          break
        }
      }
    }
    setTip(found ? { x: e.clientX, y: e.clientY, tip: found } : null)
  }

  return (
    <div className="relative">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={W * SCALE}
          height={H * SCALE}
          onMouseMove={onMove}
          onMouseLeave={() => setTip(null)}
          onClick={onMove}
          className="block w-full cursor-crosshair"
          style={{ imageRendering: "auto", aspectRatio: "16/9", background: "#0B0E16" }}
        />
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
