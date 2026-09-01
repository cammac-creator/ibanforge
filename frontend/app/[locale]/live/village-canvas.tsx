"use client"

/**
 * The living canvas: renders the village, runs narrated quests, serves hover
 * cards. All strings arrive translated via props — the engine knows stations
 * and outcomes, never languages.
 *
 * Honesty contract (spec §4): the hero only walks a path the API response
 * proved; villagers are openly decorative and never run the pipeline.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  W, H, SCALE, P, STATIONS, stationById, REGISTRY_CCS,
  paintBackground, drawActor, brazier, px, type Actor, type StationGeo,
} from "./world"
import { roadRoute } from "@/lib/village/roads"
import type { StationId, StepOutcome } from "@/lib/village/journey"

export interface NarratedStep {
  station: StationId
  who: string
  text: string
  outcome: StepOutcome
  holdMs: number
  /** For 'registry': which country house to enter. */
  regCc?: string | null
}

export interface StationTip { name: string; role: string; real: string }

interface Props {
  labels: Record<string, string>
  laneLabel: string
  tips: Record<string, StationTip>
  heroTip: StationTip
  villagerTip: StationTip
  idle: { who: string; text: string }
  quest: { id: number; steps: NarratedStep[] } | null
  onQuestEnd?: () => void
}

interface Particle { x: number; y: number; vx: number; vy: number; l: number; c: string }
interface Smoke { x: number; y: number; r: number; l: number }
interface Seal { x: number; y: number; ok: boolean; l: number }

export function VillageCanvas({ labels, laneLabel, tips, heroTip, villagerTip, idle, quest, onQuestEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceRef = useRef<HTMLCanvasElement>(null)
  const [narr, setNarr] = useState<{ who: string; text: string }>(idle)
  const [tip, setTip] = useState<{ x: number; y: number; tip: StationTip } | null>(null)

  // Mutable world state lives in refs — the rAF loop reads them directly.
  const world = useRef({
    hero: { x: -14, y: 90, dir: 1, c1: P.heroCloak, c2: P.heroCloak2, eyes: true, satchel: true } as Actor,
    villagers: [0, 1, 2, 3].map((i) => ({
      x: 30 + i * 14, y: 210 + (i % 2) * 18, dir: 1 as const,
      c1: "#9BA3AF", c2: "#6B7280", scroll: i % 2 === 0,
      wt: i * 1.7, tx: undefined as number | undefined, ty: undefined as number | undefined,
    })),
    watcher: { x: 455, y: 218, dir: -1, c1: "#8FA0B5", c2: "#5B6B80", lantern: true } as Actor,
    archivist: { x: 119, y: 234, dir: 1, c1: "#B08968", c2: "#7C5A36" } as Actor,
    sparks: [] as Particle[], smokes: [] as Smoke[], seals: [] as Seal[],
    veil: false, focus: null as StationGeo | null, gen: 0,
    reduced: false, bg: null as HTMLCanvasElement | null,
  })

  /* ---------- render loop ---------- */
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext("2d")
    if (!ctx) return
    const w = world.current
    w.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!w.bg) {
      const bg = document.createElement("canvas")
      bg.width = W; bg.height = H
      paintBackground(bg.getContext("2d")!)
      w.bg = bg
    }
    ctx.imageSmoothingEnabled = false
    let raf = 0
    let last = 0
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(50, t - last); last = t
      // decorative villagers — never on the pipeline
      if (!w.reduced) {
        for (const v of w.villagers) {
          v.wt -= dt / 1000
          if (v.wt <= 0) { v.wt = 2 + Math.random() * 3; v.tx = 24 + Math.random() * 48; v.ty = 204 + Math.random() * 40 }
          if (v.tx !== undefined && v.ty !== undefined) {
            const dx = v.tx - v.x, dy = v.ty - v.y, d = Math.hypot(dx, dy)
            const vv = v as unknown as Actor
            if (d > 1) { v.x += (dx / d) * dt * 0.012; v.y += (dy / d) * dt * 0.012; vv.dir = dx < 0 ? -1 : 1; vv.moving = true }
            else vv.moving = false
          }
        }
      }
      w.sparks = w.sparks.filter((s) => --s.l > 0); w.sparks.forEach((s) => { s.x += s.vx; s.y += s.vy; s.vy += 0.05 })
      w.smokes = w.smokes.filter((s) => --s.l > 0); w.smokes.forEach((s) => { s.y -= 0.25; s.r += 0.04 })
      w.seals = w.seals.filter((s) => --s.l > 0)

      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
      ctx.drawImage(w.bg!, 0, 0)
      if (!w.reduced && Math.floor(t / 320) % 3 === 0 && w.smokes.length < 12) w.smokes.push({ x: 218, y: 184, r: 2, l: 70 })
      brazier(ctx, 110, 226, Math.floor(t / 400) % 2 === 0)
      const fl = Math.floor(t / 240) % 2
      px(ctx, 139, 92, 8, 4, fl ? P.fire : P.fireHi); px(ctx, 141, 89, 4, 3, fl ? P.fireHi : P.fire)

      const actors: Actor[] = [
        ...(w.villagers as unknown as Actor[]), w.watcher, w.archivist, w.hero,
      ].filter((a) => !a.hidden).sort((a, b) => a.y - b.y)
      actors.forEach((a) => drawActor(ctx, a, t, w.reduced))

      w.smokes.forEach((s) => { ctx.fillStyle = P.smoke; ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2) })
      w.sparks.forEach((s) => px(ctx, s.x, s.y, 1.6, 1.6, s.c))

      if (w.veil) {
        ctx.fillStyle = "rgba(41,37,30,0.34)"; ctx.fillRect(0, 0, W, H)
        ctx.save(); ctx.globalCompositeOperation = "destination-out"
        const hole = (x: number, y: number, r: number) => {
          const g = ctx.createRadialGradient(x, y, 4, x, y, r)
          g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)")
          ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2)
        }
        hole(w.hero.x, w.hero.y - 8, 46)
        if (w.focus) hole(w.focus.x + w.focus.w / 2, w.focus.y + w.focus.h / 2, 52)
        ctx.restore()
      }

      w.seals.forEach((s) => {
        const yy = s.y - (110 - s.l) * 0.12
        px(ctx, s.x - 6, yy - 6, 12, 12, s.ok ? P.ok : P.bad)
        px(ctx, s.x - 5, yy - 5, 10, 10, s.ok ? "#5FBF7B" : "#D4695F")
        if (s.ok) { px(ctx, s.x - 3, yy + 1, 2, 2, "#FFFBEB"); px(ctx, s.x - 1, yy + 2, 2, 2, "#FFFBEB"); px(ctx, s.x + 1, yy, 2, 2, "#FFFBEB"); px(ctx, s.x + 2, yy - 2, 2, 2, "#FFFBEB") }
        else { px(ctx, s.x - 3, yy - 3, 2, 2, "#FFFBEB"); px(ctx, s.x + 1, yy + 1, 2, 2, "#FFFBEB"); px(ctx, s.x + 1, yy - 3, 2, 2, "#FFFBEB"); px(ctx, s.x - 3, yy + 1, 2, 2, "#FFFBEB"); px(ctx, s.x - 1, yy - 1, 2, 2, "#FFFBEB") }
      })

      // crisp label pass (screen space)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.font = "600 11px var(--font-sans, system-ui), sans-serif"
      ctx.textAlign = "center"
      const drawLabel = (text: string, lx: number, ly: number) => {
        const wpx = ctx.measureText(text).width + 10
        ctx.fillStyle = "rgba(255,251,235,0.92)"; ctx.fillRect(lx - wpx / 2, ly - 11, wpx, 14)
        ctx.strokeStyle = "rgba(180,83,9,0.5)"; ctx.strokeRect(lx - wpx / 2 + 0.5, ly - 10.5, wpx - 1, 13)
        ctx.fillStyle = "#4A3410"; ctx.fillText(text, lx, ly)
      }
      for (const s of STATIONS) {
        if (s.flag !== undefined && !(w.focus && w.focus.id === s.id)) continue
        const label = labels[s.id]
        if (label) drawLabel(label, (s.x + s.w / 2) * SCALE, (s.y - 4) * SCALE)
      }
      drawLabel(laneLabel, 343 * SCALE, 14 * SCALE)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [labels, laneLabel])

  /* ---------- quest runner ---------- */
  const runQuest = useCallback(async (steps: NarratedStep[]) => {
    const w = world.current
    const gen = ++w.gen
    const alive = () => w.gen === gen
    const sleep = async (ms: number) => {
      const end = Date.now() + (w.reduced ? Math.min(ms, 400) : ms)
      while (Date.now() < end) {
        if (!alive()) return false
        await new Promise((r) => setTimeout(r, document.hidden ? 300 : 16))
        if (document.hidden) { /* hold the film while the tab is hidden */ }
      }
      return alive()
    }
    const walk = async (pts: [number, number][]) => {
      const a = w.hero
      for (const [tx, ty] of pts) {
        if (!alive()) return false
        if (w.reduced) { a.x = tx; a.y = ty; if (!(await sleep(120))) return false; continue }
        const d = Math.hypot(tx - a.x, ty - a.y)
        const steps60 = Math.max(1, (d / 78) * 60)
        const sx = (tx - a.x) / steps60, sy = (ty - a.y) / steps60
        a.dir = sx < 0 ? -1 : 1; a.moving = true
        for (let i = 0; i < steps60; i++) {
          if (!alive()) return false
          a.x += sx; a.y += sy
          await new Promise((r) => setTimeout(r, 16))
          if (document.hidden) await sleep(0)
        }
        a.x = tx; a.y = ty; a.moving = false
      }
      return true
    }

    w.hero.hidden = false; w.hero.x = -14; w.hero.y = 90
    w.veil = true; w.focus = null
    let anchor: [number, number] = [-14, 90]
    let inLane = false

    for (const step of steps) {
      if (!alive()) return
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
        await walk([[38, 90], [-16, 90]])
        break
      }

      if (step.station === "exit") {
        w.focus = null
        setNarr({ who: step.who, text: step.text })
        if (inLane) { await walk([[300, 90]]); inLane = false; anchor = [300, 90] }
        if (!(await walk(roadRoute(anchor, [470, 240])))) return
        await walk([[494, 240]])
        break
      }

      if (target) {
        const wantLane = step.station === "registry"
        if (inLane && !wantLane) { if (!(await walk([[300, 90]]))) return; inLane = false; anchor = [300, 90] }
        if (wantLane) {
          if (!inLane) {
            if (!(await walk(roadRoute(anchor, [300, 90])))) return
            if (!(await walk([[300, 62]]))) return
            inLane = true
          }
          if (!(await walk([target.door]))) return
        } else if (anchor[0] !== target.anchor[0] || anchor[1] !== target.anchor[1]) {
          if (!(await walk(roadRoute(anchor, target.anchor)))) return
          anchor = target.anchor
        }
        w.focus = target
      }

      setNarr({ who: step.who, text: step.text })
      if (step.station === "gate") w.sparks.push(...Array.from({ length: 8 }, () => ({ x: 38, y: 74, vx: (Math.random() - 0.5) * 1.6, vy: -Math.random() * 1.8 - 0.4, l: 26 + Math.random() * 18, c: P.winHi })))
      if (step.station === "scribe" && step.outcome === "fail") w.seals.push({ x: 98, y: 66, ok: false, l: 110 })
      if (step.station === "forge") {
        w.sparks.push(...Array.from({ length: 20 }, () => ({ x: 198, y: 226, vx: (Math.random() - 0.5) * 1.6, vy: -Math.random() * 1.8 - 0.4, l: 26 + Math.random() * 18, c: P.fireHi })))
        w.seals.push({ x: 198, y: 206, ok: step.outcome !== "fail", l: 110 })
      }
      if (!(await sleep(step.holdMs))) return
    }
    if (!alive()) return
    w.veil = false; w.focus = null; w.hero.hidden = true
    onQuestEnd?.()
  }, [onQuestEnd])

  useEffect(() => {
    if (quest && quest.steps.length > 0) void runQuest(quest.steps)
  }, [quest, runQuest])
  useEffect(() => { setNarr(idle) }, [idle])

  /* ---------- portrait ---------- */
  useEffect(() => {
    const f = faceRef.current
    if (!f) return
    const c = f.getContext("2d")
    if (!c) return
    c.imageSmoothingEnabled = false
    c.fillStyle = "#1C1C22"; c.fillRect(0, 0, 40, 40)
    c.setTransform(2.4, 0, 0, 2.4, 2, 2)
    drawActor(c, { x: 8, y: 13, dir: 1, c1: P.heroCloak, c2: P.heroCloak2, eyes: true }, 0, true)
  }, [])

  /* ---------- hover cards ---------- */
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    const w = world.current
    let found: StationTip | null = null
    const near = (a: Actor) => !a.hidden && Math.abs(mx - a.x) < 7 && Math.abs(my - (a.y - 8)) < 11
    if (near(w.hero)) found = heroTip
    else if (near(w.watcher)) found = tips.vigil ?? null
    else if (near(w.archivist)) found = tips.archive ?? null
    else if ((w.villagers as unknown as Actor[]).some(near)) found = villagerTip
    else {
      for (const s of STATIONS) {
        if (mx >= s.x - 2 && mx <= s.x + s.w + 2 && my >= s.y - 8 && my <= s.y + s.h + 2) {
          found = tips[s.id] ?? null
          break
        }
      }
    }
    setTip(found ? { x: e.clientX, y: e.clientY, tip: found } : null)
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={W * SCALE}
        height={H * SCALE}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
        onClick={onMove}
        className="block w-full cursor-crosshair"
        style={{ imageRendering: "pixelated", aspectRatio: "16/9", background: "#FDF6DC" }}
      />
      <div
        className="flex items-start gap-3 border-t-2 px-4 py-3"
        style={{ borderColor: "var(--primary)", background: "var(--card)", minHeight: 66 }}
        aria-live="polite"
      >
        <canvas ref={faceRef} width={40} height={40} className="shrink-0 rounded border" style={{ imageRendering: "pixelated", borderColor: "var(--border)", background: "#1C1C22" }} />
        <div className="text-[15px] leading-relaxed">
          <span className="block text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--primary)" }}>
            {narr.who}
          </span>
          {narr.text}
        </div>
      </div>
      {tip && (
        <div
          className="pointer-events-none fixed z-30 max-w-[290px] rounded border-2 px-3 py-2 text-[13px] leading-snug"
          style={{
            left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 300 : tip.x),
            top: tip.y + 10,
            background: "#FEF3C7", color: "#2A2115", borderColor: "#B45309",
            boxShadow: "4px 4px 0 rgba(9,9,11,.45)",
          }}
        >
          <div className="font-semibold">{tip.tip.name}</div>
          <div style={{ color: "#6B5327" }}>{tip.tip.role}</div>
          <div className="mt-1 border-t border-dashed pt-1 font-mono text-[11.5px]" style={{ borderColor: "rgba(180,83,9,.4)", color: "#7C4A08" }}>
            {tip.tip.real}
          </div>
        </div>
      )}
    </div>
  )
}
