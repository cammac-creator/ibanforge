"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildJourney, type JourneyStep } from "@/lib/village/journey"
import { opAgeMinutes } from "@/lib/village/ops-age"
import { LIVE_EXAMPLES } from "@/lib/village/examples"
import { parseLiveParams } from "@/lib/village/permalink"
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

export default function LivePage() {
  const t = useTranslations("live")
  const [iban, setIban] = useState(DEMO_IBAN)
  const [mode, setMode] = useState<"iban" | "compliance">("iban")
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
  // /v1/ops/recent (type + country + outcome — never the content). The first
  // poll only sets the cursor, so page load does not replay old operations.
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
      who,
      text,
      outcome: step.outcome,
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

  const runValidation = async (value: string, questMode: "iban" | "compliance" = mode) => {
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

  return (
    <main className="mx-auto flex max-w-5xl flex-col px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
      <p className="mt-2 max-w-[68ch] text-muted-foreground">{t("lede")}</p>

      {/* mode and field on one row: the header stack pushed the narration bar
          under the fold on a 13" laptop (measured 1440×790) */}
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "iban" | "compliance")}>
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
      <div className="mt-2 flex flex-wrap items-center gap-2 max-sm:order-2 max-sm:mt-3">
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

      {/* Sized so the village AND its narration bar share the first screen on
          a 13" laptop (1440×790 measured: the bar sat 137 px under the fold). */}
      <div
        className="mx-auto mt-5 w-full overflow-hidden rounded-lg border shadow-sm max-sm:order-1 max-sm:mt-3"
        style={{ maxWidth: "max(560px, min(100%, calc((100dvh - 410px) * 16 / 9)))" }}
      >
        <VillageCanvas
          labels={labels}
          laneLabel={t("lane")}
          tips={tips}
          heroTip={{ name: t("tips.hero.name"), role: t("tips.hero.role"), real: t("tips.hero.real") }}
          villagerTip={{ name: t("tips.villager.name"), role: t("tips.villager.role"), real: t("tips.villager.real") }}
          idle={idle}
          canvasAlt={t("canvasAlt")}
          quest={quest}
          traffic={traffic}
          vignette={vignette}
          fast={fast}
          onQuestEnd={() => { setRunning(false); setFast(false) }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:order-3">
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

      <p className="mt-3 max-w-[75ch] text-sm text-muted-foreground max-sm:order-4">{t("ledeMore")}</p>
      <p className="mt-3 max-w-[75ch] text-sm text-muted-foreground max-sm:order-5">{t("honesty")}</p>
    </main>
  )
}
