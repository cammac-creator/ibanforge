"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GetKeyButton } from "@/components/api-key-dialog"
import { buildJourney, type JourneyStep } from "@/lib/village/journey"
import { opAgeMinutes } from "@/lib/village/ops-age"
import { LIVE_EXAMPLES } from "@/lib/village/examples"
import { parseLiveParams } from "@/lib/village/permalink"
import { buildRail, type RailRow, type RailState } from "@/lib/village/rail"
import { RailPanel, type RailStrings } from "./rail"
import { VillageCanvas, type NarratedStep, type StationTip, type TrafficCourier, type Vignette } from "./village-canvas"

const OP_TYPES = new Set([
  "iban_validate", "iban_batch", "bic_lookup", "iban_compliance",
  "ch_clearing_lookup", "iban_format", "reference_validate", "address_check",
])
interface FeedOp { id: number; t: string; type: string; country: string | null; success: boolean }

const DEMO_IBAN = "DE89 3704 0044 0532 0130 00"
const KNOWN_REASONS = new Set([
  "invalid_format", "unsupported_country", "wrong_length",
  "checksum_failed", "invalid_check_digits", "invalid_bban_structure",
])
const STATION_IDS = [
  "gate", "scribe", "cutter", "library", "six", "court",
  "classifier", "border", "tower", "forge", "archive", "warehouse", "vigil",
] as const
const RAIL_NAME_KEYS = [
  "gate", "scribe", "cutter", "library", "registry", "six", "court",
  "classifier", "border", "tower", "forge", "exit", "modulus", "pra",
] as const
const RAIL_STATES: RailState[] = ["idle", "skipped", "current", "done", "warn", "fail"]

type Mode = "iban" | "compliance"
type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null)

/** What a finished quest leaves behind — the response, verbatim, and its route. */
interface QuestResult {
  iban: string
  mode: Mode
  data: Rec
  steps: NarratedStep[]
}

/* ---------- atlas badge (the ingot, the broken seal) ---------- */
let atlasCache: Promise<{ img: HTMLImageElement; meta: Record<string, { x: number; y: number; w: number; h: number }> }> | null = null
function loadAtlas() {
  if (!atlasCache) {
    atlasCache = (async () => {
      const [meta, img] = await Promise.all([
        fetch("/village/atlas.json").then((r) => r.json()),
        new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image()
          i.onload = () => resolve(i)
          i.onerror = reject
          i.src = "/village/atlas.png"
        }),
      ])
      return { img, meta }
    })()
  }
  return atlasCache
}

function AtlasBadge({ frame, tint, size = 64 }: { frame: string; tint?: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let stop = false
    loadAtlas()
      .then(({ img, meta }) => {
        const f = meta[frame]
        const c = ref.current
        if (stop || !f || !c) return
        const ctx = c.getContext("2d")
        if (!ctx) return
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, size, size)
        const s = Math.min((size - 8) / f.w, (size - 8) / f.h)
        const w = f.w * s, h = f.h * s
        ctx.drawImage(img, f.x, f.y, f.w, f.h, (size - w) / 2, (size - h) / 2, w, h)
        if (tint) {
          ctx.globalCompositeOperation = "source-atop"
          ctx.globalAlpha = 0.55
          ctx.fillStyle = tint
          ctx.fillRect(0, 0, size, size)
          ctx.globalAlpha = 1
          ctx.globalCompositeOperation = "source-over"
        }
      })
      .catch(() => { /* the badge simply stays blank */ })
    return () => { stop = true }
  }, [frame, tint, size])
  return <canvas ref={ref} width={size} height={size} className="shrink-0" style={{ imageRendering: "pixelated" }} aria-hidden />
}

export default function LivePage() {
  const t = useTranslations("live")
  const locale = useLocale()
  const [iban, setIban] = useState(DEMO_IBAN)
  const [mode, setMode] = useState<Mode>("iban")
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  // ⏩ the visitor who wants the proof, not the show: holds ÷3, walks ×2
  const [fast, setFast] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quest, setQuest] = useState<{ id: number; steps: NarratedStep[] } | null>(null)
  const questId = useRef(0)
  const [traffic, setTraffic] = useState<TrafficCourier[]>([])
  const lastOpId = useRef(0)
  const [vignette, setVignette] = useState<Vignette | null>(null)
  const vignetteId = useRef(0)
  const [freshness, setFreshness] = useState<{ sources: Record<string, string>; overall: string | null }>({ sources: {}, overall: null })
  // the rail and the clock: where the film is, how long it has been on screen
  const [progress, setProgress] = useState(-1)
  const [screenSec, setScreenSec] = useState(0)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [result, setResult] = useState<QuestResult | null>(null)
  const pending = useRef<QuestResult | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [copied, setCopied] = useState<"curl" | "link" | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [tick, setTick] = useState(0)

  // One stable object per locale. As an inline literal it changed identity on
  // every render — and the canvas resets its narration whenever `idle`
  // changes — so the 5 s traffic poll (which the quest's own call feeds) and
  // the end-of-quest re-render each wiped the line on screen: the mod-97
  // Scribe was never read, the delivered result lived 3.6 s. Measured on the
  // live site on 01/09/2026.
  const idle = useMemo(() => ({ who: t("who.village"), text: t("idle") }), [t])

  // Real freshness for the house plaques — served by the public /health.
  useEffect(() => {
    let stop = false
    fetch("/api/health-sources")
      .then((r) => r.json())
      .then((d: { sources?: Record<string, string>; overall?: string | null }) => {
        if (!stop) setFreshness({ sources: d.sources ?? {}, overall: d.overall ?? null })
      })
      .catch(() => { /* plaques simply stay dateless */ })
    return () => { stop = true }
  }, [])

  // Real-traffic feed: each courier is one genuine operation from
  // /v1/ops/recent (type + country + outcome — never the content).
  useEffect(() => {
    let stop = false
    // How old a replayed operation is, in the courier's own card — a replay
    // is never dressed up as live.
    const ageOf = (ts: string, now: number): string => {
      const m = opAgeMinutes(ts, now)
      if (m === null) return ""
      if (m < 1) return t("traffic.justNow")
      if (m < 60) return t("traffic.ago", { min: m })
      return t("traffic.agoHours", { h: Math.floor(m / 60) })
    }
    const toCourier = (op: FeedOp, when: string): TrafficCourier => {
      const typeKey = OP_TYPES.has(op.type) ? op.type : "unknown"
      const role = t("traffic.role", {
        type: t(`traffic.types.${typeKey}`),
        country: op.country ?? "—",
        result: op.success ? "✓" : "✗",
      })
      return {
        key: op.id,
        t: op.t,
        kind: !op.success ? "fail" : op.type === "bic_lookup" ? "library" : "full",
        tint: op.id,
        tip: {
          name: t("traffic.name"),
          role: when ? `${role} · ${when}` : role,
          real: t("traffic.real"),
        },
      }
    }
    const poll = async (seedOnly: boolean) => {
      if (stop || document.hidden) return
      try {
        const qs = lastOpId.current > 0 ? `?after=${lastOpId.current}` : ""
        const res = await fetch(`/api/ops${qs}`)
        const data = (await res.json()) as { ops?: FeedOp[] }
        const ops = Array.isArray(data.ops) ? data.ops : []
        if (ops.length === 0) return
        lastOpId.current = Math.max(lastOpId.current, ...ops.map((o) => o.id))
        if (seedOnly) {
          // Couriers from the first second (v9): the last three real
          // operations walk the road at once, each dated in its card. Before,
          // the first poll only set the cursor, and on a quiet site the road
          // stayed empty for minutes — the liveliest proof of the page never
          // showed to a one-minute visitor (conversion audit, 01/09/2026).
          const now = Date.now()
          setTraffic(ops.slice(0, 3).reverse().map((op) => toCourier(op, ageOf(op.t, now))))
          return
        }
        const fresh = ops.slice(0, 6).reverse().map((op) => toCourier(op, t("traffic.live")))
        setTraffic((prev) => [...prev.slice(-12), ...fresh])
      } catch {
        // feed is ambience — silence is the correct failure mode
      }
    }
    void poll(true)
    const iv = setInterval(() => void poll(false), 5000)
    return () => { stop = true; clearInterval(iv) }
  }, [t])

  // the on-screen clock while a quest runs; the exit line's own measure
  // (`elapsed`) takes over once delivered
  useEffect(() => {
    if (!running) return
    const start = Date.now()
    const iv = setInterval(() => setScreenSec(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(iv)
  }, [running])

  // the rail's traffic line ages ("il y a 4 min") without a new operation
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  // Escape closes a pinned card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPinnedId(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const check = (v: unknown) => (v ? "✓" : "—")

  const narrate = (step: JourneyStep, response: Record<string, unknown>): NarratedStep => {
    const p = step.params ?? {}
    const whoKey = step.key === "modulus" ? "cutter" : step.key === "pra" ? "court" : step.key
    const who = t(`who.${whoKey}`)
    let text: string
    let textAt: NarratedStep["textAt"]
    switch (step.key) {
      case "gate":
        text = p.paid ? t("steps.gate.paid", { cost: String(p.cost) }) : t("steps.gate.free")
        break
      case "scribe":
        text = step.outcome === "fail"
          ? t("steps.scribe.fail", {
              reason: t(`reasons.${KNOWN_REASONS.has(String(p.reason)) ? String(p.reason) : "unknown"}`),
            })
          : t("steps.scribe.ok", { cc: String(p.cc ?? "??") })
        break
      case "cutter":
        text = t("steps.cutter", { bankCode: String(p.bankCode ?? "—"), account: String(p.account ?? "—") })
        break
      case "modulus":
        text = step.outcome === "ok" ? t("steps.modulus.ok") : t("steps.modulus.warn")
        break
      case "library":
        text = p.found ? t("steps.library.found", { source: String(p.source ?? "—") }) : t("steps.library.miss")
        break
      case "registry":
        text = t("steps.registry", { register: String(p.register ?? "—"), bic: String(p.bic ?? "—") })
        break
      case "six":
        text = t("steps.six", { name: String(p.name ?? "—"), iid: String(p.iid ?? "—") })
        break
      case "court":
        text = p.status === "verified"
          ? t("steps.court.verified", { register: String(p.register ?? "—") })
          : t("steps.court.warn", { status: String(p.status) })
        break
      case "pra":
        text = p.authorised ? t("steps.pra.ok", { firm: String(p.firm ?? "—") }) : t("steps.pra.warn")
        break
      case "classifier": {
        const type = String(p.type ?? "other")
        const key = type === "bank" || type === "emi" || type === "neobank" ? type : "other"
        text = t(`steps.classifier.${key}`, { name: String(p.name ?? "—") })
        break
      }
      case "border":
        text = t("steps.border", { sepa: check(p.sepa), vop: check(p.vopParticipant) })
        break
      case "tower": {
        const score = String(p.score ?? "—")
        text = step.outcome === "ok"
          ? t("steps.tower.ok", { fatf: String(p.fatf ?? "—"), score })
          : step.outcome === "fail"
            ? t("steps.tower.fail", { score })
            : t("steps.tower.warn", { level: String(p.level), score })
        break
      }
      case "forge":
        text = p.bic ? t("steps.forge.ok", { bic: String(p.bic) }) : t("steps.forge.okNoBic")
        break
      case "exit": {
        const ms = typeof response.processing_ms === "number" ? response.processing_ms : null
        if (step.outcome === "fail") text = t("steps.exit.fail")
        else if (ms === null) text = t("steps.exit.okNoMs")
        else {
          // The on-screen duration is measured when the line shows, never
          // written into a translation (a hard-coded "thirty seconds" drifted
          // to 46 s as stations were added).
          textAt = (secs) => t("steps.exit.ok", { ms, secs })
          text = textAt(45)
        }
        break
      }
      default:
        text = ""
    }
    return {
      station: step.station,
      key: step.key,
      who,
      text,
      outcome: step.outcome,
      params: step.params,
      holdMs: Math.min(3600, Math.max(1800, 1500 + text.length * 16)),
      regCc: step.station === "registry" ? String(p.cc ?? "") : null,
      textAt,
    }
  }

  // The permalink: ?iban=…&mode=compliance fills the field, ?autoplay=1
  // starts the quest by itself — for shares, replays and filming.
  const autoplayed = useRef(false)
  useEffect(() => {
    if (autoplayed.current) return
    const p = parseLiveParams(window.location.search)
    if (!p.iban && !p.autoplay) return
    autoplayed.current = true
    const timer = setTimeout(() => {
      if (p.iban) { setIban(p.iban); setMode(p.mode) }
      if (p.autoplay) void runValidation((p.iban ?? DEMO_IBAN).replace(/\s+/g, ""), p.mode)
    }, p.autoplay ? 1200 : 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runValidation = async (value: string, questMode: Mode = mode) => {
    if (!value || busy || running) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: questMode, value }),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok && typeof data.valid !== "boolean") {
        setError(typeof data.message === "string" ? data.message : t("errors.generic"))
        return
      }
      const steps = buildJourney(data).map((s) => narrate(s, data))
      questId.current += 1
      pending.current = { iban: value, mode: questMode, data, steps }
      setResult(null)
      setShowJson(false)
      setPinnedId(null)
      setElapsed(null)
      setScreenSec(0)
      setProgress(0)
      setRunning(true)
      setQuest({ id: questId.current, steps })
    } catch {
      setError(t("errors.network"))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void runValidation(iban.replace(/\s+/g, ""))
  }

  const { labels, tips } = useMemo(() => {
    const labels: Record<string, string> = {}
    const tips: Record<string, StationTip> = {}
    const day = (s?: string | null) => (s ? s.slice(0, 10) : null)
    const plaque = (d: string | null) => (d ? ` · ${t("freshness.plaque", { date: d })}` : "")
    for (const id of STATION_IDS) {
      labels[id] = t(`labels.${id}`)
      tips[id] = { name: t(`labels.${id}`), role: t(`tips.${id}.role`), real: t(`tips.${id}.real`) }
    }
    // Real freshness plaques (spec §4): dates read from /health.bic_sources.
    tips.six.real += plaque(day(freshness.sources.six_group))
    tips.library.real += plaque(day(freshness.sources.gleif ?? freshness.sources.swiftcodes))
    tips.warehouse.real += plaque(day(freshness.overall))
    const regDates: Record<string, string | null> = {
      DE: day(freshness.sources.bundesbank),
      AT: day(freshness.sources.oenb),
      BE: day(freshness.overall), BG: day(freshness.overall),
      NL: day(freshness.sources.nbp ?? freshness.overall), FI: day(freshness.overall),
    }
    for (const cc of ["DE", "AT", "BE", "BG", "NL", "FI"]) {
      labels[`reg-${cc}`] = t(`labels.reg${cc}`)
      tips[`reg-${cc}`] = {
        name: t(`labels.reg${cc}`),
        role: t("tips.registry.role"),
        real: t("tips.registry.real") + plaque(regDates[cc]),
      }
    }
    return { labels, tips }
  }, [t, freshness])

  const playVignette = (kind: Vignette["kind"]) => {
    if (busy || running) return
    vignetteId.current += 1
    setRunning(true)
    const L = (k: string, params?: Record<string, string>) => ({ who: t(`vignettes.${kind}.who`), text: t(k, params) })
    const lines =
      kind === "caravan"
        ? [
            L("vignettes.caravan.l1", { date: freshness.overall?.slice(0, 10) ?? "—" }),
            L("vignettes.caravan.l2"),
            L("vignettes.caravan.l3"),
          ]
        : kind === "watch"
          ? [L("vignettes.watch.l1"), L("vignettes.watch.l2")]
          : [L("vignettes.archive.l1"), L("vignettes.archive.l2")]
    setVignette({ id: vignetteId.current, kind, lines })
  }

  /* ---------- the rail ---------- */
  const rail = useMemo(() => buildRail(quest?.steps ?? null, progress), [quest, progress])
  const visitedCc = quest?.steps.find((s) => s.station === "registry")?.regCc || "DE"
  const stationOf = (row: RailRow) => (row.station === "registry" ? `reg-${visitedCc}` : row.station)
  const lastOp = traffic.length ? traffic[traffic.length - 1] : null
  const lastSeen = (() => {
    if (!lastOp?.t) return t("rail.noneYet")
    // `tick` only exists to re-run this every 30 s
    const m = opAgeMinutes(lastOp.t, Date.now() + tick * 0)
    const when = m === null ? "" : m < 1 ? t("traffic.justNow") : m < 60 ? t("traffic.ago", { min: m }) : t("traffic.agoHours", { h: Math.floor(m / 60) })
    return t("rail.lastSeen", { when })
  })()
  const railStrings: RailStrings = {
    title: t("rail.title"),
    step: (n, total) => t("rail.step", { n, total }),
    names: Object.fromEntries(RAIL_NAME_KEYS.map((k) => [k, t(`rail.names.${k}`)])),
    groups: { formalities: t("rail.groups.formalities"), registers: t("rail.groups.registers"), frontier: t("rail.groups.frontier") },
    states: Object.fromEntries(RAIL_STATES.map((k) => [k, t(`rail.states.${k}`)])) as Record<RailState, string>,
    traffic: lastSeen,
  }

  /* ---------- the verdict ---------- */
  const verdict = useMemo(() => {
    if (!result) return null
    const d = result.data
    const valid = d.valid === true
    const country = rec(d.country), bic = rec(d.bic), issuer = rec(d.issuer), sepa = rec(d.sepa)
    const checkBank = rec(d.bank_code_check), compliance = rec(d.compliance)
    const ms = typeof d.processing_ms === "number" ? d.processing_ms : null
    const head = valid
      ? [t("verdict.valid"), typeof country?.code === "string" ? country.code : null, typeof issuer?.name === "string" ? issuer.name : null, typeof bic?.code === "string" ? `BIC ${bic.code}` : t("verdict.noBic")].filter(Boolean).join(" · ")
      : [t("verdict.invalid"), typeof d.error === "string" ? t(`reasons.${KNOWN_REASONS.has(d.error) ? d.error : "unknown"}`) : null].filter(Boolean).join(" · ")
    const facts = valid
      ? [
          checkBank?.status === "verified" ? t("verdict.registerOk") : null,
          sepa ? (sepa.member === true ? t("verdict.sepaOk") : t("verdict.sepaNo")) : null,
          sepa ? (sepa.vop_participant === true ? t("verdict.vopOk") : t("verdict.vopNo")) : null,
          typeof compliance?.risk_score === "number" ? t("verdict.risk", { score: compliance.risk_score }) : null,
        ].filter(Boolean).join(" · ")
      : ""
    const meta = valid
      ? t("verdict.meta", { steps: result.steps.length, ms: ms ?? "—", secs: elapsed ?? screenSec })
      : t("verdict.metaFail", { steps: result.steps.length })
    const path = result.mode === "compliance" ? "/v1/iban/compliance" : "/v1/iban/validate"
    const curl = `curl -X POST https://api.ibanforge.com${path} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $IBANFORGE_KEY" \\\n  -d '{"iban":"${result.iban}"}'`
    const link = `${typeof window !== "undefined" ? window.location.origin : "https://ibanforge.com"}/${locale}/live?iban=${encodeURIComponent(result.iban)}&mode=${result.mode}&autoplay=1`
    return { valid, head, facts, meta, curl, link }
  }, [result, elapsed, screenSec, t, locale])

  const copy = async (what: "curl" | "link", text: string) => {
    try { await navigator.clipboard.writeText(text) } catch { return }
    setCopied(what)
    setTimeout(() => setCopied(null), 2000)
  }

  const serverMs = result && typeof result.data.processing_ms === "number" ? result.data.processing_ms : null
  const clockSec = elapsed ?? (running ? screenSec : null)
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

  return (
    <main className="mx-auto flex max-w-5xl flex-col px-4 py-6 sm:py-8 xl:[@media(min-height:860px)]:max-w-[1290px]">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
      <p className="mt-2 max-w-[68ch] text-muted-foreground">{t("lede")}</p>

      {/* mode and field on one row: the header stack pushed the narration bar
          under the fold on a 13" laptop (measured 1440×790) */}
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="iban">{t("mode.iban")}</TabsTrigger>
            <TabsTrigger value="compliance">{t("mode.compliance")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          placeholder={DEMO_IBAN}
          aria-label={t("inputLabel")}
          className="w-full max-w-sm font-mono"
          maxLength={42}
        />
        <Button type="submit" disabled={busy || running}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {running ? t("running") : t("validate")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("anyIban")}</span>
      </form>
      {/* five example quests, one click each — stories a cold visitor could
          not tell from memory (a Swiss counter, a sanctions screen, a broken
          IBAN): the mod-97 seal breaking was coded and unreachable */}
      <div className="mt-2 flex flex-wrap items-center gap-2 max-sm:order-3 max-sm:mt-3">
        <span className="text-xs text-muted-foreground">{t("chips.label")}</span>
        {LIVE_EXAMPLES.map((e) => (
          <Button
            key={e.key}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || running}
            onClick={() => {
              setMode(e.mode)
              setIban(e.iban)
              void runValidation(e.iban.replace(/\s+/g, ""), e.mode)
            }}
          >
            {t(`chips.${e.key}`)}
          </Button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm" style={{ color: "var(--err, #F87171)" }}>{error}</p>}

      {/* The stage and the rail: a column beside the village on a large,
          tall screen; a strip under the narration everywhere else. The
          stage is sized so the village AND its narration bar share the
          first screen on a 13" laptop (1440×790 measured). */}
      <div className="mt-5 grid grid-cols-1 gap-3 max-sm:order-1 max-sm:mt-3 xl:[@media(min-height:860px)]:grid-cols-[minmax(0,1fr)_232px] xl:[@media(min-height:860px)]:items-start">
        <div
          className="relative mx-auto w-full overflow-hidden rounded-lg border shadow-sm"
          style={{ maxWidth: "max(560px, min(100%, calc((100dvh - 410px) * 16 / 9)))" }}
        >
          <VillageCanvas
            labels={labels}
            tips={tips}
            heroTip={{ name: t("tips.hero.name"), role: t("tips.hero.role"), real: t("tips.hero.real") }}
            villagerTip={{ name: t("tips.villager.name"), role: t("tips.villager.role"), real: t("tips.villager.real") }}
            idle={idle}
            canvasAlt={t("canvasAlt")}
            quest={quest}
            traffic={traffic}
            vignette={vignette}
            fast={fast}
            highlight={hoverId}
            pinned={pinnedId}
            onQuestEnd={() => {
              setRunning(false)
              setFast(false)
              if (pending.current) { setResult(pending.current); setProgress(pending.current.steps.length) }
            }}
            onStep={setProgress}
            onExit={setElapsed}
            onHover={setHoverId}
          />
          {/* the double clock: the slow-down is declared beside the real time */}
          {clockSec !== null && (
            <div
              className="pointer-events-none absolute right-2 top-2 z-10 rounded border px-2.5 py-1.5 font-mono text-[11px] leading-tight tabular-nums"
              style={{ background: "#F3E7C8", borderColor: "#7A5322", color: "#3A2A12", boxShadow: "2px 2px 0 rgba(10,8,4,0.38)" }}
              aria-hidden
            >
              <div className="flex justify-between gap-3"><span className="uppercase tracking-wider" style={{ color: "#7A5322" }}>{t("clock.screen")}</span><span>{mmss(clockSec)}</span></div>
              <div className="flex justify-between gap-3"><span className="uppercase tracking-wider" style={{ color: "#7A5322" }}>{t("clock.real")}</span><span>{serverMs !== null && !running ? `${serverMs.toLocaleString(locale)} ms` : "…"}</span></div>
              {serverMs !== null && !running && <div className="text-[9px]" style={{ color: "#9A8B74" }}>{t("clock.serverTime")}</div>}
            </div>
          )}
        </div>
        <RailPanel rail={rail} strings={railStrings} hoverId={hoverId} onHover={setHoverId} onPick={(id) => setPinnedId((p) => (p === id ? null : id))} stationOf={stationOf} />
      </div>

      {/* the verdict: what the visitor earned stays on the table, with the
          three exits a developer wants — the curl, the key, the JSON */}
      {verdict && result && (
        <section
          className="mt-3 flex flex-wrap items-start gap-4 rounded-lg border px-4 py-3 max-sm:order-2"
          style={{ background: "#F3E7C8", borderColor: "#7A5322", color: "#2A2115", boxShadow: "2px 2px 0 rgba(10,8,4,0.25)" }}
          aria-label={t("verdict.title")}
        >
          <AtlasBadge frame={verdict.valid ? "ingot" : "seal-x"} tint={verdict.valid ? undefined : "#B91C1C"} />
          <div className="min-w-[240px] flex-1">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "#7A5322" }}>{t("verdict.title")}</div>
            <div className="font-mono text-[13px]">{result.iban.replace(/(.{4})/g, "$1 ").trim()}</div>
            <div className="mt-1 text-[15px] font-semibold">{verdict.head}</div>
            {verdict.facts && <div className="text-[13px]" style={{ color: "#6B5327" }}>{verdict.facts}</div>}
            <div className="mt-1 font-mono text-[11.5px]" style={{ color: "#7C4A08" }}>{verdict.meta}</div>
          </div>
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <Button variant="outline" size="sm" onClick={() => void copy("curl", verdict.curl)}>⧉ {copied === "curl" ? t("verdict.copied") : t("verdict.copyCurl")}</Button>
            <GetKeyButton variant="amber" size="sm">🔑 {t("verdict.getKey")}</GetKeyButton>
            <Button variant="outline" size="sm" onClick={() => setShowJson((v) => !v)}>▸ {showJson ? t("verdict.hideJson") : t("verdict.showJson")}</Button>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="flex-1" disabled={busy || running} onClick={() => void runValidation(result.iban, result.mode)}>↻ {t("verdict.replay")}</Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => void copy("link", verdict.link)}>🔗 {copied === "link" ? t("verdict.linkCopied") : t("verdict.copyLink")}</Button>
            </div>
          </div>
          {showJson && (
            <pre className="w-full overflow-x-auto rounded border p-3 font-mono text-[11px] leading-snug" style={{ background: "#FDF8EC", borderColor: "rgba(122,83,34,.35)", color: "#2A2115" }}>
              {JSON.stringify(result.data, null, 2)}
            </pre>
          )}
        </section>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:order-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{t("vignettes.label")}</span>
        <Button variant="outline" size="sm" disabled={busy || running} onClick={() => playVignette("caravan")}>
          {t("vignettes.caravan.btn")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy || running} onClick={() => playVignette("watch")}>
          {t("vignettes.watch.btn")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy || running} onClick={() => playVignette("archive")}>
          {t("vignettes.archive.btn")}
        </Button>
        {running && (
          <Button variant="outline" size="sm" disabled={fast} onClick={() => setFast(true)}>
            ⏩ {t("faster")}
          </Button>
        )}
      </div>

      <p className="mt-3 max-w-[75ch] text-sm text-muted-foreground max-sm:order-5">{t("ledeMore")}</p>
      <p className="mt-3 max-w-[75ch] text-sm text-muted-foreground max-sm:order-6">{t("honesty")}</p>
    </main>
  )
}
