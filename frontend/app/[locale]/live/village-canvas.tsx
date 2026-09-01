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
  loadWorldImages, paintGround, paintVignette, drawSprite, drawActor, drawTinted,
  SCENERY, HALOS, EMBER_ZONES, CHIMNEYS,
  type Actor, type StationGeo, type WorldImages,
} from "./world"
import { roadRoute } from "@/lib/village/roads"
import { naturalPath } from "@/lib/village/path"
import type { StationId, StepOutcome } from "@/lib/village/journey"

export interface NarratedStep {
  station: StationId
  /** the journey step key (== station, or 'modulus' / 'pra' for a sub-step) */
  key: string
  who: string
  text: string
  outcome: StepOutcome
  /** the real values the step produced, for the rail's suffixes */
  params?: Record<string, string | number | boolean | null>
  holdMs: number
  regCc?: string | null
  /** Exit line built at the moment it shows, from the real on-screen seconds. */
  textAt?: (elapsedSec: number) => string
}

export interface StationTip { name: string; role: string; real: string }

export interface TrafficCourier {
  key: number
  /** when the operation was logged (either stats.sqlite timestamp shape) */
  t?: string
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
  tips: Record<string, StationTip>
  heroTip: StationTip
  villagerTip: StationTip
  idle: { who: string; text: string }
  canvasAlt: string
  quest: { id: number; steps: NarratedStep[] } | null
  traffic?: TrafficCourier[]
  vignette?: Vignette | null
  /** ⏩ holds ÷3, walks ×2 — the visitor who wants the proof, not the show */
  fast?: boolean
  /** a station lit from outside (the rail's hovered row) */
  highlight?: string | null
  /** a station whose card stays open (the rail's clicked row) */
  pinned?: string | null
  /** bump to abort whatever plays (the attract replay stops at the first gesture) */
  abortKey?: number
  onQuestEnd?: () => void
  /** index of the step whose line is now showing */
  onStep?: (index: number) => void
  /** the delivered (or refused) line is showing, after this many on-screen seconds */
  onExit?: (elapsedSec: number) => void
  /** the station under the mouse changed */
  onHover?: (id: string | null) => void
}

const COURIER_KINDS = ["cour-a", "cour-b", "cour-c"] as const
const COURIER_RUNS: Record<TrafficCourier["kind"], [number, number][]> = {
  full: [[-28, 192], [932, 192], [932, 342], [202, 342], [202, 498], [952, 498], [998, 498]],
  library: [[-28, 192], [655, 192], [-36, 192]],
  fail: [[-28, 192], [200, 192], [-36, 192]],
}
const HERO_SPEED = 156
const COURIER_SPEED = 220

/** Bespoke label spots (logical coords). The registry row staggers two lines
 * on the middle street so six close-set plaques cannot collide; the top-row
 * stations sit on their street's lower half so the courier line at y=192
 * stays mostly clear. */

interface Spark { x: number; y: number; vx: number; vy: number; l: number; c: string }
interface Puff { x: number; y: number; a: number; s: number; vy: number }
interface Seal { x: number; y: number; sprite: "coin" | "seal-x"; l: number; tint?: string }
interface Pulse { x: number; y: number; r: number; l: number }

export function VillageCanvas({ labels, tips, heroTip, villagerTip, idle, canvasAlt, quest, traffic, vignette, fast, highlight, pinned, abortKey, onQuestEnd, onStep, onExit, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceRef = useRef<HTMLCanvasElement>(null)
  const [narr, setNarr] = useState<{ who: string; text: string }>(idle)
  const [tip, setTip] = useState<{ x: number; y: number; side?: "right" | "left"; tip: StationTip } | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** station under the mouse — drives the DOM label lift and the cursor;
   * the canvas glow reads the ref (per-frame), this state feeds the DOM */
  const [hoverId, setHoverId] = useState<string | null>(null)
  /** the one banner allowed in the world: the station being worked, numbered */
  const [banner, setBanner] = useState<{ id: string; no: number; total: number; outcome: StepOutcome } | null>(null)
  const lastHover = useRef<string | null>(null)

  const world = useRef({
    img: null as WorldImages | null,
    groundLayer: null as HTMLCanvasElement | null,
    vignetteLayer: null as HTMLCanvasElement | null,
    hero: { x: -30, y: 192, dir: 1, kind: "hero", face: "side", hidden: true } as Actor,
    // the villagers mill about the well-side market corner, east of the
    // library: north of the top street, out of every pipeline lane
    // palier 0 of the casting (v9 tranche C): three clerks leave the market
    // crowd for their posts — librarian, sorter, usher — and turn to the hero
    // at their step. One villager keeps the market alive.
    clerks: [2].map((i) => ({
      x: 756 + i * 34, y: 114 + (i % 3) * 20, dir: 1 as const,
      kind: `clerk${i}` as Actor["kind"],
      wt: i * 1.9, tx: undefined as number | undefined, ty: undefined as number | undefined,
    })),
    agents: {
      library: { x: 722, y: 186, dir: -1, kind: "clerk3", face: "down" } as Actor,
      classifier: { x: 216, y: 346, dir: 1, kind: "clerk0", face: "down" } as Actor,
      court: { x: 346, y: 348, dir: -1, kind: "clerk1", face: "down" } as Actor,
    } as Record<string, Actor>,
    watcher: { x: 900, y: 494, dir: -1, kind: "clerk5", face: "down" } as Actor,
    archivist: { x: 126, y: 502, dir: 1, kind: "clerk4", face: "down" } as Actor,
    couriers: [] as { key: number; tip: StationTip; actor: Actor; pts: [number, number][]; i: number }[],
    seenCouriers: new Set<number>(),
    cart: null as { x: number; y: number; dir: 1 | -1 } | null,
    veilLayer: null as HTMLCanvasElement | null,
    sparks: [] as Spark[], puffs: [] as Puff[], seals: [] as Seal[], pulses: [] as Pulse[],
    /** transient sprites drawn where they are put (the ingot on the anvil,
     * the spark burst): atlas frames the village paid for and never drew */
    props: [] as { sprite: string; x: number; y: number; l: number; max: number; scale?: number }[],
    /* ---- juice grammar (v9 tranche C): every effect below is fired by a
       real step of the response, never by a timer of its own ---- */
    hitstopUntil: 0,
    flash: 0,
    shake: { amp: 0, t0: 0 },
    waves: [] as { x: number; y: number; max: number; t0: number; dur: number; c: string; w: number }[],
    /** the seal that stays on the forge façade until the next quest */
    stamp: null as { x: number; y: number; sprite: string; tint?: string } | null,
    drop: null as { sprite: string; x: number; y0: number; y1: number; t0: number; dur: number; tint?: string; landed: boolean } | null,
    /** parchment slips travelling between hands, counters and doors */
    cards: [] as { mode: "slip" | "split" | "pair"; ax: number; ay: number; bx: number; by: number; t0: number; dur: number; hold: number; dot?: boolean }[],
    slot: null as { x: number; y: number; w: number; h: number; t0: number; dur: number } | null,
    beam: null as { x1: number; y1: number; t0: number; dur: number; c: string } | null,
    barrier: 0, barrierTarget: 0,
    hearth: 1, hearthTarget: 1,
    veilBoost: 0, veilBoostTarget: 0,
    marks: [] as { x: number; y: number; t0: number }[],
    shutter: null as { x: number; y: number; t0: number } | null,
    towerColor: "rgba(255,196,100,",
    gestures: [] as { a: Actor; until: number }[],
    embers: [] as { x: number; y: number; vx: number; p: number }[],
    flies: [] as { x: number; y: number; p: number }[],
    /** daylight ambience: drifting pollen motes and a few butterflies */
    pollen: [] as { x: number; y: number; p: number; s: number }[],
    wings: [] as { cx: number; cy: number; p: number; c: string }[],
    /** the walked path: footprints the hero has actually left */
    trail: [] as { x: number; y: number; ang: number; side: 1 | -1 }[],
    trailAcc: 0,
    /** station under the mouse — read by the draw pass for the golden lift */
    hover: null as string | null,
    veil: false, focus: null as StationGeo | null, gen: 0, reduced: false, fast: false,
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
        const BLOOMS: [number, number][] = [[502, 176], [745, 172], [148, 192], [860, 492]]
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
      // a hitstop freezes the living (not the particles) for a few frames
      const frozen = t < w.hitstopUntil
      w.flash = w.flash > 0.01 ? w.flash * 0.55 : 0
      w.hearth += (w.hearthTarget - w.hearth) * 0.08
      w.veilBoost += (w.veilBoostTarget - w.veilBoost) * 0.1
      w.barrier += (w.barrierTarget - w.barrier) * 0.12
      w.waves = w.waves.filter((v) => t - v.t0 < v.dur)
      w.cards = w.cards.filter((c) => t - c.t0 < c.dur + c.hold)
      w.marks = w.marks.filter((m) => t - m.t0 < 1600)
      if (w.slot && t - w.slot.t0 > w.slot.dur) w.slot = null
      if (w.beam && t - w.beam.t0 > w.beam.dur) w.beam = null
      if (w.shutter && t - w.shutter.t0 > 2000) w.shutter = null
      w.gestures = w.gestures.filter((g) => { g.a.moving = t < g.until; return t < g.until })
      if (w.drop && !w.drop.landed && t >= w.drop.t0 + w.drop.dur) {
        // the seal lands: the one moment an effect leaves its building
        const d = w.drop
        d.landed = true
        w.stamp = { x: d.x, y: d.y1, sprite: d.sprite, tint: d.tint }
        if (!w.reduced) {
          w.hitstopUntil = t + 120
          w.flash = 0.22
          w.waves.push({ x: d.x, y: d.y1 + 6, max: 150, t0: t, dur: 900, c: "#FDE68A", w: 2.5 })
          w.waves.push({ x: d.x, y: d.y1 + 6, max: 420, t0: t, dur: 1100, c: "#FDE68A", w: 3 })
        } else {
          w.waves.push({ x: d.x, y: d.y1 + 6, max: 90, t0: t, dur: 600, c: "#FDE68A", w: 2 })
        }
        w.drop = null
      }
      if (!w.reduced && !frozen) {
        for (const c of w.clerks) {
          c.wt -= dt / 1000
          if (c.wt <= 0) { c.wt = 2.5 + Math.random() * 4; c.tx = 742 + Math.random() * 160; c.ty = 106 + Math.random() * 62 }
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
      w.props = w.props.filter((p) => --p.l > 0)
      w.pulses = w.pulses.filter((p) => --p.l > 0); w.pulses.forEach((p) => { p.r += 0.7 })

      /* -- draw -- */
      let sdx = 0, sdy = 0
      if (w.shake.amp > 0) {
        const age = t - w.shake.t0
        if (age > 220 || w.reduced) w.shake.amp = 0
        else { const k = w.shake.amp * Math.exp((-5 * age) / 220); sdx = Math.sin(t / 9) * k; sdy = Math.cos(t / 7) * k * 0.6 }
      }
      ctx.setTransform(SCALE, 0, 0, SCALE, sdx * SCALE, sdy * SCALE)
      ctx.drawImage(w.groundLayer!, 0, 0)

      // the walked path: hero FOOTPRINTS, quiet on grass and paving alike —
      // the animated dashed ribbon read as clutter (operator, 01/09 evening)
      if (w.trail.length) {
        ctx.save()
        ctx.fillStyle = "rgba(58,44,20,0.38)"
        for (const s of w.trail) {
          const px = s.x + Math.cos(s.ang + Math.PI / 2) * 2.2 * s.side
          const py = s.y + Math.sin(s.ang + Math.PI / 2) * 2.2 * s.side
          ctx.save()
          ctx.translate(px, py)
          ctx.rotate(s.ang)
          ctx.fillRect(-1.7, -1, 3.4, 2)
          ctx.restore()
        }
        ctx.restore()
      }

      type Entity = { base: number; draw: () => void }
      const ents: Entity[] = SCENERY.map((p) => ({
        base: p.base,
        draw: () => {
          // life at rest (v9): trees and grove lean one pixel on a slow sine,
          // tufts less — the gesture that turns an illustration into a world
          const sway = w.reduced ? 0
            : p.sprite.startsWith("tree") || p.sprite === "grove" ? Math.sin(t / 2800 + p.cx) * 1.0
            : p.sprite.startsWith("tuft") ? Math.sin(t / 1900 + p.cx) * 0.6
            : 0
          const cx = p.cx + sway
          // the hovered station lifts a breath and glows warm — the "you are
          // pointing at me" answer the operator asked for (item 3)
          const hot = p.id !== undefined && p.id === w.hover
          if (hot) {
            ctx.save()
            ctx.shadowColor = "rgba(255,190,70,0.95)"
            ctx.shadowBlur = 16
            drawSprite(ctx, img, p.sprite, cx, p.base, { scale: p.scale, flip: p.flip, dy: -2 })
            ctx.restore()
            drawSprite(ctx, img, p.sprite, cx, p.base, { scale: p.scale, flip: p.flip, dy: -2 })
          } else {
            drawSprite(ctx, img, p.sprite, cx, p.base, { scale: p.scale, flip: p.flip })
          }
        },
      }))
      const actors: Actor[] = [
        ...(w.clerks as unknown as Actor[]), ...w.couriers.map((c) => c.actor),
        ...Object.values(w.agents), w.watcher, w.archivist, w.hero,
      ]
      // the hero you can find (v9): a warm ring under his feet, drawn just
      // before him, and a sort tie-break so he never hides behind the house
      // he is visiting
      if (!w.hero.hidden) {
        ents.push({
          base: w.hero.y + 0.49,
          draw: () => {
            const pulse = w.reduced ? 1 : 0.86 + 0.14 * Math.sin(t / 700)
            const g = ctx.createRadialGradient(w.hero.x, w.hero.y, 2, w.hero.x, w.hero.y, 13 * pulse)
            g.addColorStop(0, "rgba(253,224,138,0.36)"); g.addColorStop(1, "rgba(253,224,138,0)")
            ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g
            ctx.fillRect(w.hero.x - 16, w.hero.y - 16, 32, 32); ctx.restore()
          },
        })
      }
      for (const a of actors) {
        if (!a.hidden) ents.push({ base: a === w.hero ? a.y + 0.5 : a.y, draw: () => drawActor(ctx, img, a, t, w.reduced) })
      }
      if (w.cart) {
        const c = w.cart
        ents.push({ base: c.y + 10, draw: () => drawSprite(ctx, img, "cart", c.x, c.y + 10, { flip: c.dir < 0 }) })
      }
      ents.sort((a, b) => a.base - b.base)
      for (const e of ents) e.draw()
      // transient props: the ingot cooling on the anvil, the spark burst
      for (const p of w.props) drawSprite(ctx, img, p.sprite, p.x, p.y, { alpha: Math.min(1, p.l / 30), scale: p.scale })
      // the seal that stays on the forge façade
      if (w.stamp) {
        if (w.stamp.tint) drawTinted(ctx, img, w.stamp.sprite, w.stamp.x, w.stamp.y, w.stamp.tint, 0.55)
        else drawSprite(ctx, img, w.stamp.sprite, w.stamp.x, w.stamp.y)
      }
      const outCubic = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3)
      const inQuad = (u: number) => Math.min(1, Math.max(0, u)) ** 2
      // the registry shutter: two panels open, the slip comes out, they close
      if (w.shutter) {
        const age = t - w.shutter.t0
        const open = age < 400 ? age / 400 : age < 1600 ? 1 : Math.max(0, 1 - (age - 1600) / 400)
        const { x, y } = w.shutter
        ctx.fillStyle = "#3A2A12"; ctx.fillRect(x - 6, y - 8, 12, 9)
        ctx.fillStyle = "#8B5E2B"
        ctx.fillRect(x - 6, y - 8, 6 * (1 - open), 9)
        ctx.fillRect(x + 6 - 6 * (1 - open), y - 8, 6 * (1 - open), 9)
      }
      // parchment slips between hands, counters and doors
      for (const c of w.cards) {
        const u = outCubic((t - c.t0) / c.dur)
        const alpha = t - c.t0 > c.dur + c.hold - 300 ? Math.max(0, (c.dur + c.hold - (t - c.t0)) / 300) : 1
        ctx.save(); ctx.globalAlpha = alpha
        const slip = (x: number, y: number, wdt = 12) => {
          ctx.fillStyle = "#F3E7C8"; ctx.fillRect(x - wdt / 2, y - 4, wdt, 8)
          ctx.strokeStyle = "#7A5322"; ctx.lineWidth = 1; ctx.strokeRect(x - wdt / 2 + 0.5, y - 3.5, wdt - 1, 7)
          ctx.fillStyle = "#9A8B74"; ctx.fillRect(x - wdt / 2 + 2, y - 1.5, wdt - 4, 1); ctx.fillRect(x - wdt / 2 + 2, y + 1, wdt - 5, 1)
        }
        if (c.mode === "slip") {
          const x = c.ax + (c.bx - c.ax) * u, y = c.ay + (c.by - c.ay) * u - Math.sin(u * Math.PI) * 10
          slip(x, y)
          if (c.dot) { ctx.fillStyle = "#B91C1C"; ctx.fillRect(x + 2, y - 3, 2.5, 2.5) }
        } else if (c.mode === "split") {
          // the BBAN cut into its fields: the slip parts into three that spread
          const gap = 9 * u
          ctx.fillStyle = "#F3E7C8"; ctx.strokeStyle = "#7A5322"; ctx.lineWidth = 1
          for (let k = -1; k <= 1; k++) {
            const x = c.ax + k * (5 + gap)
            ctx.fillRect(x - 2, c.ay - 4, 4, 8); ctx.strokeRect(x - 1.5, c.ay - 3.5, 3, 7)
          }
        } else {
          // Verification of Payee: two names laid over each other to see if they match
          const x1 = c.ax - 22 + 22 * u, x2 = c.ax + 22 - 22 * u
          slip(x1, c.ay, 14); slip(x2, c.ay + 2, 14)
          if (u > 0.98) { ctx.fillStyle = "#15803D"; ctx.fillRect(c.ax - 1, c.ay - 6, 2, 5); ctx.fillRect(c.ax + 1, c.ay - 4, 3, 2) }
        }
        ctx.restore()
      }
      // the pigeonhole that lit up (the issuer's class), the scribe's strokes
      if (w.slot) {
        const a = Math.max(0, 1 - (t - w.slot.t0) / w.slot.dur)
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.55 * a
        ctx.fillStyle = "#FDE68A"; ctx.fillRect(w.slot.x, w.slot.y, w.slot.w, w.slot.h); ctx.restore()
      }
      for (const m of w.marks) {
        const a = Math.max(0, 1 - (t - m.t0) / 1600)
        ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "#FDE68A"; ctx.fillRect(m.x, m.y, 1.5, 6); ctx.restore()
      }
      // the border barrier lifts for a SEPA member
      if (w.barrier > 0.01) {
        ctx.save(); ctx.translate(252, 494); ctx.rotate((-70 * Math.PI) / 180 * w.barrier)
        ctx.fillStyle = "#6B4423"; ctx.fillRect(0, -1.5, 46, 3)
        ctx.fillStyle = "#F3E7C8"; ctx.fillRect(10, -1.5, 8, 3); ctx.fillRect(28, -1.5, 8, 3)
        ctx.restore()
      }
      // the watchtower's beam finds the hero; its colour is the screen's outcome
      if (w.beam) {
        const u = (t - w.beam.t0) / w.beam.dur
        const a = u < 0.2 ? u / 0.2 : Math.max(0, 1 - (u - 0.2) / 0.8)
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.35 * a
        ctx.fillStyle = w.beam.c
        ctx.beginPath(); ctx.moveTo(380, 372); ctx.lineTo(w.beam.x1 - 14, w.beam.y1); ctx.lineTo(w.beam.x1 + 14, w.beam.y1); ctx.closePath(); ctx.fill()
        ctx.restore()
      }
      // the seal falling on the anvil
      if (w.drop) {
        const u = inQuad((t - w.drop.t0) / w.drop.dur)
        const y = w.drop.y0 + (w.drop.y1 - w.drop.y0) * u
        if (w.drop.tint) drawTinted(ctx, img, w.drop.sprite, w.drop.x, y, w.drop.tint, 0.55)
        else drawSprite(ctx, img, w.drop.sprite, w.drop.x, y)
      }
      // ground waves: ellipses, never circles — the 3/4 view flattens them
      for (const v of w.waves) {
        const u = (t - v.t0) / v.dur
        const r = v.max * outCubic(u)
        ctx.save(); ctx.globalAlpha = 0.5 * (1 - u); ctx.strokeStyle = v.c; ctx.lineWidth = v.w * (1 - u) + 0.5
        ctx.beginPath(); ctx.ellipse(v.x, v.y, r, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
      }
      // the player marker: a golden chevron bobbing over the hero's head
      // while a quest runs (Stardew's multiplayer marker)
      if (!w.hero.hidden && w.veil) {
        const bob = w.reduced ? 0 : Math.sin(t / 900) * 2
        const hx = w.hero.x, hy = w.hero.y - 44 + bob
        ctx.fillStyle = "#B45309"
        ctx.beginPath(); ctx.moveTo(hx - 5, hy - 7); ctx.lineTo(hx + 5, hy - 7); ctx.lineTo(hx, hy + 1); ctx.closePath(); ctx.fill()
        ctx.fillStyle = "#FDE68A"
        ctx.beginPath(); ctx.moveTo(hx - 4, hy - 6); ctx.lineTo(hx + 4, hy - 6); ctx.lineTo(hx, hy); ctx.closePath(); ctx.fill()
      }

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
        // the forge hearth (index 1) breathes slow and wide (and swells at the
        // strike); the braziers flicker; the tower's takes the screen's colour
        const pulse = w.reduced ? 1 : i === 1 ? 0.93 + 0.15 * Math.sin(t / 2400) : 0.86 + 0.14 * Math.sin(t / 520 + i * 1.7)
        const boost = i === 1 ? w.hearth : 1
        const rr = hr * 1.3 * boost
        const col = i === 0 ? w.towerColor : "rgba(255,196,100,"
        const g = ctx.createRadialGradient(hx, hy, 2, hx, hy, rr * pulse)
        g.addColorStop(0, `${col}${Math.min(0.9, 0.44 * hs * boost)})`)
        g.addColorStop(1, `${col}0)`)
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
        if (s.tint) drawTinted(ctx, img, s.sprite, s.x, yy, s.tint, 0.55, { alpha: Math.min(1, s.l / 30) })
        else drawSprite(ctx, img, s.sprite, s.x, yy, { alpha: Math.min(1, s.l / 30) })
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
        vc.fillStyle = `rgba(6,6,12,${(0.52 + w.veilBoost).toFixed(3)})`; vc.fillRect(0, 0, W, H)
        vc.globalCompositeOperation = "destination-out"
        const hole = (x: number, y: number, r: number) => {
          const g = vc.createRadialGradient(x, y, 8, x, y, r)
          g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)")
          vc.fillStyle = g; vc.fillRect(x - r, y - r, r * 2, r * 2)
        }
        hole(w.hero.x, w.hero.y - 16, 78)
        // the focus hole aims at the DOOR, not the middle of the façade
        if (w.focus) hole(w.focus.door[0], w.focus.door[1] - 22, 96)
        vc.globalCompositeOperation = "source-over"
        ctx.drawImage(w.veilLayer, 0, 0)
      }

      ctx.drawImage(w.vignetteLayer!, 0, 0)
      // the impact flash: white, two frames, never full strength
      if (w.flash > 0.01) { ctx.save(); ctx.globalAlpha = w.flash; ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H); ctx.restore() }
      // Labels left the canvas on 01/09: painted plaques scale down with it,
      // and at laptop widths they blurred into illegibility — the operator's
      // report, twice. They are DOM now (see the overlay in the JSX below):
      // browser text at screen pixels, crisp at every size.
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [loaded])

  /* ---------- movement helpers ---------- */
  const makeSleep = useCallback((genAtStart: number) => {
    const w = world.current
    // Tick-counted rather than wall-clock: virtual-time capture tools and
    // hidden tabs then advance the film consistently with the timers.
    return async (ms: number) => {
      // Reduced motion removes the walk (makeMove teleports), never the time
      // to read a line: capped at 400 ms it played a 45 s film in 6 s.
      let left = ms
      while (left > 0) {
        if (w.gen !== genAtStart) return false
        const tick = document.hidden ? 300 : 16
        await new Promise((r) => setTimeout(r, tick))
        left -= tick * (w.fast ? 3 : 1)
      }
      return w.gen === genAtStart
    }
  }, [])

  const makeMove = useCallback((genAtStart: number) => {
    const w = world.current
    return async (a: Actor, rawPts: [number, number][], speed: number) => {
      const pts = w.reduced ? rawPts : naturalPath([[a.x, a.y], ...rawPts]).slice(1)
      // a third of the film was transport: a long stroll (the whole move,
      // not the ~12 px spline samples it is cut into) goes ×1.5, approaches
      // keep the walking pace; ⏩ doubles everything
      let total = 0, px = a.x, py = a.y
      for (const [tx, ty] of pts) { total += Math.hypot(tx - px, ty - py); px = tx; py = ty }
      const boost = total > 300 ? 1.5 : 1
      for (const [tx, ty] of pts) {
        if (w.gen !== genAtStart) return false
        if (w.reduced) {
          const ang = Math.atan2(ty - a.y, tx - a.x)
          a.x = tx; a.y = ty
          if (a === w.hero) {
            w.trail.push({ x: tx, y: ty, ang, side: (w.trail.length % 2 ? 1 : -1) as 1 | -1 })
          }
          await new Promise((r) => setTimeout(r, 120))
          continue
        }
        const d = Math.hypot(tx - a.x, ty - a.y)
        const v = speed * boost * (w.fast ? 2 : 1)
        const n = Math.max(1, (d / v) * 60)
        const sx = (tx - a.x) / n, sy = (ty - a.y) / n
        a.dir = sx < 0 ? -1 : 1
        a.face = Math.abs(sx) >= Math.abs(sy) ? "side" : sy < 0 ? "up" : "down"
        a.moving = true
        for (let i = 0; i < n; i++) {
          if (w.gen !== genAtStart) return false
          a.x += sx; a.y += sy
          // footprints: hero only, one every ~9px of walk, alternating feet,
          // hard-capped so a long session can never grow the list unbounded
          if (a === w.hero) {
            w.trailAcc += Math.hypot(sx, sy)
            if (w.trailAcc >= 9) {
              w.trailAcc = 0
              const side = (w.trail.length % 2 ? 1 : -1) as 1 | -1
              w.trail.push({ x: a.x, y: a.y, ang: Math.atan2(sy, sx), side })
              if (w.trail.length > 400) w.trail.shift()
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
    w.trail = []; w.trailAcc = 0
    // a new quest clears what the last one left behind
    w.stamp = null; w.drop = null; w.cards = []; w.waves = []; w.slot = null; w.beam = null; w.marks = []; w.shutter = null
    w.barrierTarget = 0; w.hearthTarget = 1; w.veilBoostTarget = 0; w.towerColor = "rgba(255,196,100,"
    let anchor: [number, number] = [-28, 192]
    const startedAt = performance.now()
    const elapsed = () => Math.round((performance.now() - startedAt) / 1000)
    const now = () => performance.now()
    const R = w.reduced
    const wave = (x: number, y: number, max: number, dur: number, c = "#FDE68A", lw = 2) => w.waves.push({ x, y, max, t0: now(), dur, c, w: lw })
    const thump = (ms: number, amp: number) => { if (R) return; w.hitstopUntil = now() + ms; w.shake = { amp, t0: now() } }
    const gesture = (id: string) => {
      const a = w.agents[id]
      if (!a) return
      a.face = "side"; a.dir = w.hero.x < a.x ? -1 : 1
      w.gestures.push({ a, until: now() + 700 })
    }

    for (const [i, step] of steps.entries()) {
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
        setBanner(null)
        setNarr({ who: step.who, text: step.text })
        onStep?.(i)
        onExit?.(elapsed())
        w.hero.dir = -1
        await walk([[80, 192], [-40, 192]])
        break
      }
      if (step.station === "exit") {
        w.focus = null
        setBanner(null)
        const secs = elapsed()
        setNarr({ who: step.who, text: step.textAt ? step.textAt(secs) : step.text })
        onStep?.(i)
        onExit?.(secs)
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
      onStep?.(i)
      if (target) setBanner({ id: target.id, no: i + 1, total: steps.length, outcome: step.outcome })
      /* ---- the control points, each one a real step of the response ---- */
      const hx = w.hero.x, hy = w.hero.y
      const p = step.params ?? {}
      if (step.station === "gate") {
        w.seals.push({ x: 46, y: 140, sprite: "coin", l: 90 })
        wave(46, 196, 40, 700)
      }
      if (step.station === "scribe") {
        if (step.outcome === "fail") {
          w.seals.push({ x: 204, y: 116, sprite: "seal-x", l: 110, tint: "#B91C1C" })
          wave(210, 196, 70, 800, "#EF4444", 2.5); thump(90, 2.5)
        } else {
          // three strokes — length, characters, check digits — then the stamp
          for (let k = 0; k < 3; k++) { w.marks.push({ x: 199 + k * 7, y: 166, t0: now() }); if (!(await sleep(R ? 0 : 220))) return }
          thump(60, 1.5); wave(210, 196, 34, 600)
        }
      }
      if (step.key === "cutter") w.cards.push({ mode: "split", ax: 330, ay: 168, bx: 330, by: 168, t0: now(), dur: 900, hold: 1400 })
      if (step.station === "library" && p.found) {
        gesture("library")
        w.cards.push({ mode: "slip", ax: 712, ay: 168, bx: hx, by: hy - 34, t0: now(), dur: 700, hold: 1500, dot: true })
      }
      if (step.station === "registry" && target) {
        w.shutter = { x: target.door[0], y: target.door[1] - 26, t0: now() }
        if (!(await sleep(R ? 0 : 400))) return
        w.cards.push({ mode: "slip", ax: target.door[0], ay: target.door[1] - 24, bx: hx, by: hy - 34, t0: now(), dur: 600, hold: 1200, dot: true })
        w.pulses.push({ x: target.cx, y: target.base - 60, r: 6, l: 40 })
      }
      if (step.station === "six") {
        w.cards.push({ mode: "slip", ax: 420, ay: 322, bx: hx, by: hy - 34, t0: now(), dur: 600, hold: 1400 })
        if (p.sic) w.cards.push({ mode: "slip", ax: 420, ay: 322, bx: hx + 8, by: hy - 40, t0: now() + 300, dur: 600, hold: 1100 })
      }
      if (step.key === "court") { gesture("court"); if (step.outcome === "ok") { thump(60, 1.2); wave(326, 348, 40, 700) } else wave(326, 348, 30, 700, "#F97316", 1.5) }
      if (step.station === "classifier") {
        gesture("classifier")
        w.cards.push({ mode: "slip", ax: hx, ay: hy - 30, bx: 236, by: 316, t0: now(), dur: 600, hold: 200 })
        const type = String(p.type ?? "other")
        const idx = type === "bank" ? 0 : type === "emi" ? 1 : type === "neobank" ? 2 : 3
        w.slot = { x: 204 + idx * 20, y: 290, w: 16, h: 12, t0: now() + 600, dur: 1600 }
      }
      if (step.station === "border") {
        if (p.sepa) w.barrierTarget = 1
        if (!(await sleep(R ? 0 : 400))) return
        if (p.vopParticipant) w.cards.push({ mode: "pair", ax: 280, ay: 474, bx: 280, by: 474, t0: now(), dur: 900, hold: 1400 })
        else w.cards.push({ mode: "slip", ax: 258, ay: 474, bx: 300, by: 474, t0: now(), dur: 700, hold: 1200 })
      }
      if (step.station === "tower") {
        const c = step.outcome === "ok" ? "#FBBF24" : step.outcome === "fail" ? "#EF4444" : "#F97316"
        w.towerColor = step.outcome === "ok" ? "rgba(255,196,100," : step.outcome === "fail" ? "rgba(239,68,68," : "rgba(249,115,22,"
        w.beam = { x1: hx, y1: hy - 10, t0: now(), dur: 900, c }
        w.pulses.push({ x: 380, y: 372, r: 6, l: 40 })
        if (step.outcome === "fail") thump(80, 2)
      }
      if (step.station === "forge") {
        // THE CLIMAX (DA audit §3.12): the world tightens, the hearth swells,
        // the ingot glows white, three strikes — the third the strongest —
        // then the seal drops and its wave crosses the whole village
        const fail = steps.some((s) => s.station === "tower" && s.outcome === "fail")
        w.veilBoostTarget = 0.16; w.hearthTarget = 1.6
        if (!(await sleep(R ? 0 : 250))) return
        w.props.push({ sprite: "ingot", x: 522, y: 472, l: 220, max: 220 })
        if (!(await sleep(R ? 0 : 450))) return
        if (!R) {
          for (const k of [0, 1, 2]) {
            const strong = k === 2
            w.hitstopUntil = now() + (strong ? 120 : 90)
            w.flash = strong ? 0.16 : 0.1
            w.shake = { amp: strong ? 4.5 : 3, t0: now() }
            w.props.push({ sprite: "spark", x: 522, y: 476, l: 14, max: 14, scale: strong ? 1.35 : 1.0 })
            for (let n = 0; n < (strong ? 22 : 14); n++) w.sparks.push({ x: 522 + (Math.random() - 0.5) * 20, y: 470, vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2.4 - 0.6, l: 26 + Math.random() * 18, c: n % 3 ? "#FDE68A" : "#F59E0B" })
            wave(522, 480, strong ? 110 : 80, 700, "#FDE68A", 2)
            if (!(await sleep(300))) return
          }
          if (!(await sleep(150))) return
        }
        // the seal lands on the façade, between the hearth and the door — not
        // on the roof ridge where the old floating coin used to hover
        w.drop = { sprite: fail ? "seal-x" : "coin", x: 562, y0: R ? 446 : 330, y1: 446, t0: now(), dur: R ? 0 : 320, tint: fail ? "#B91C1C" : undefined, landed: false }
        if (!(await sleep(R ? 200 : 400))) return
        w.hearthTarget = 1; w.veilBoostTarget = 0
      }
      if (!(await sleep(step.holdMs))) return
    }
    if (w.gen !== gen) return
    w.veil = false; w.focus = null; w.hero.hidden = true
    w.barrierTarget = 0; w.hearthTarget = 1; w.veilBoostTarget = 0
    setBanner(null)
    onQuestEnd?.()
  }, [makeMove, makeSleep, onQuestEnd, onStep, onExit])

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
  // Fires on every identity change of `idle`, so the parent MUST hand over a
  // memoized object (page.tsx does): an inline literal re-fired this on each
  // traffic poll and erased the line a quest was showing. The content-keyed
  // form is refused by react-hooks/set-state-in-effect; this one is accepted.
  useEffect(() => { setNarr(idle) }, [idle])
  useEffect(() => { world.current.fast = !!fast }, [fast])
  // the attract replay stops dead at the visitor's first gesture: a new
  // generation invalidates the running quest, the hero leaves, the veil lifts
  useEffect(() => {
    if (!abortKey) return
    const w = world.current
    w.gen++
    w.hero.hidden = true
    w.veil = false
    w.focus = null
    w.trail = []
    const raf = requestAnimationFrame(() => { setBanner(null); setNarr(idle) })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abortKey])
  // the rail's hovered row lights its building like the mouse would
  useEffect(() => { world.current.hover = highlight ?? null }, [highlight])

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
          kind: COURIER_KINDS[op.tint % COURIER_KINDS.length], face: "side", moving: true, alpha: 0.86,
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
      // leg 1 — the caravan road, a stop at the depot's doorstep, then the
      // cart rolls on and vanishes BEHIND the warehouse: delivered
      if (!(await rollCart(76, -40, 930, [780]))) return
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
  // A station's card is ANCHORED beside its building (never over it, the
  // golden lift stays visible), flipped to the left near the window's edge
  // and lifted up in the lower third; an actor's card follows the mouse.
  const anchorFor = (s: StationGeo): { x: number; y: number; side: "right" | "left" } | null => {
    const cv = canvasRef.current
    if (!cv) return null
    const r = cv.getBoundingClientRect()
    const sx = r.width / W, sy = r.height / H
    const rightX = r.left + (s.bx + s.bw) * sx + 12
    const side: "right" | "left" = rightX + 300 > window.innerWidth ? "left" : "right"
    const x = side === "right" ? rightX : r.left + s.bx * sx - 12 - 300
    const y = Math.min(r.top + s.by * sy, window.innerHeight - 170)
    return { x, y, side }
  }
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    const w = world.current
    let found: StationTip | null = null
    let station: string | null = null
    // actors draw at 0.75 now — the hover box shrinks with them
    const near = (a: Actor) => !a.hidden && Math.abs(mx - a.x) < 11 && Math.abs(my - (a.y - 15)) < 20
    const courier = w.couriers.find((cr) => near(cr.actor))
    if (courier) found = courier.tip
    else if (near(w.hero)) found = heroTip
    else if (near(w.watcher)) found = tips.vigil ?? null
    else if (near(w.archivist)) found = tips.archive ?? null
    else if ((w.clerks as unknown as Actor[]).some(near)) found = villagerTip
    else if (near(w.agents.library)) { found = tips.library ?? null; station = "library" }
    else if (near(w.agents.classifier)) { found = tips.classifier ?? null; station = "classifier" }
    else if (near(w.agents.court)) { found = tips.court ?? null; station = "court" }
    else {
      for (const s of STATIONS) {
        if (mx >= s.bx && mx <= s.bx + s.bw && my >= s.by && my <= s.by + s.bh) {
          found = tips[s.id] ?? null
          station = s.id
          break
        }
      }
    }
    w.hover = station ?? highlight ?? null
    setHoverId(station)
    if (station !== lastHover.current) { lastHover.current = station; onHover?.(station) }
    const geo = station ? stationById[station] : null
    const a = geo ? anchorFor(geo) : null
    setTip(found ? (a ? { x: a.x, y: a.y, side: a.side, tip: found } : { x: e.clientX + 14, y: e.clientY + 10, tip: found }) : null)
  }
  const onLeave = () => {
    world.current.hover = highlight ?? null
    setHoverId(null)
    if (lastHover.current !== null) { lastHover.current = null; onHover?.(null) }
    setTip(pinned ? anchoredTip(pinned) : null)
  }
  // the rail's clicked row: its card opens beside the building and stays
  // (measured after commit — refs are not read during render)
  const anchoredTip = (id: string) => {
    const geo = stationById[id]
    const a = geo ? anchorFor(geo) : null
    return a && tips[id] ? { x: a.x, y: a.y, side: a.side, tip: tips[id] } : null
  }
  useEffect(() => {
    const raf = requestAnimationFrame(() => setTip(pinned ? anchoredTip(pinned) : null))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned])

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
          role="img"
          aria-label={canvasAlt}
          className="block w-full"
          style={{ imageRendering: "auto", aspectRatio: "16/9", background: "#0B0E16", cursor: hoverId ? "pointer" : "crosshair" }}
        />
        {/* The one text allowed over the picture (v9): the station being
            worked, numbered — the twenty permanent labels left the world,
            the rail beside the village names the rest. */}
        {loaded && banner && stationById[banner.id] && (() => {
          const s = stationById[banner.id]
          const dot = banner.outcome === "fail" ? "#B91C1C" : banner.outcome === "warn" ? "#B45309" : "#15803D"
          return (
            <span
              aria-hidden
              className="pointer-events-none absolute select-none whitespace-nowrap border font-bold"
              style={{
                left: `${(s.cx / W) * 100}%`,
                top: `${((s.by - 8) / H) * 100}%`,
                transform: "translate(-50%, -100%)",
                fontSize: 11.5, lineHeight: 1.1, padding: "3px 8px",
                background: "#F3E7C8", borderColor: "#7A5322", borderWidth: 1.5, borderRadius: 3,
                color: "#3A2A12", boxShadow: "2px 2px 0 rgba(10,8,4,0.38)",
              }}
            >
              <span className="mr-1 font-mono" style={{ color: "#7A5322" }}>{banner.no}/{banner.total}</span>
              {labels[banner.id] ?? banner.id}
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: dot }} />
            </span>
          )
        })()}
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
        aria-atomic="true"
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
          className="pointer-events-none fixed z-30 w-[300px] px-4 py-3 text-[13px] leading-snug"
          style={{
            left: tip.side ? tip.x : Math.min(tip.x, typeof window !== "undefined" ? window.innerWidth - 310 : tip.x),
            top: tip.y,
            color: "#2A2115",
            borderStyle: "solid",
            borderWidth: 14,
            borderImage: "url(/village/frame.png) 110 fill / 14px stretch",
            filter: "drop-shadow(4px 5px 0 rgba(5,5,10,.5))",
          }}
        >
          {tip.side && (
            <span
              aria-hidden
              className="absolute h-3.5 w-3.5 rotate-45"
              style={{ top: 22, [tip.side === "right" ? "left" : "right"]: -7, background: "#F3E7C8", borderLeft: "1.5px solid #7A5322", borderBottom: "1.5px solid #7A5322" }}
            />
          )}
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
