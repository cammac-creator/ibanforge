"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildJourney, type JourneyStep } from "@/lib/village/journey"
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
  const [error, setError] = useState<string | null>(null)
  const [quest, setQuest] = useState<{ id: number; steps: NarratedStep[] } | null>(null)
  const questId = useRef(0)
  const [traffic, setTraffic] = useState<TrafficCourier[]>([])
  const lastOpId = useRef(0)
  const [vignette, setVignette] = useState<Vignette | null>(null)
  const vignetteId = useRef(0)
  const [freshness, setFreshness] = useState<{ sources: Record<string, string>; overall: string | null }>({ sources: {}, overall: null })

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
    const toCourier = (op: FeedOp): TrafficCourier => {
      const typeKey = OP_TYPES.has(op.type) ? op.type : "unknown"
      return {
        key: op.id,
        kind: !op.success ? "fail" : op.type === "bic_lookup" ? "library" : "full",
        tint: op.id,
        tip: {
          name: t("traffic.name"),
          role: t("traffic.role", {
            type: t(`traffic.types.${typeKey}`),
            country: op.country ?? "—",
            result: op.success ? "✓" : "✗",
          }),
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
        if (seedOnly) return
        const fresh = ops.slice(0, 6).reverse().map(toCourier)
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
        text = step.outcome === "fail"
          ? t("steps.exit.fail")
          : ms !== null ? t("steps.exit.ok", { ms: String(ms) }) : t("steps.exit.okNoMs")
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
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = iban.replace(/\s+/g, "")
    if (!value || busy || running) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: mode, value }),
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
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
      <p className="mt-2 max-w-[68ch] text-muted-foreground">{t("lede")}</p>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "iban" | "compliance")} className="mt-6">
        <TabsList>
          <TabsTrigger value="iban">{t("mode.iban")}</TabsTrigger>
          <TabsTrigger value="compliance">{t("mode.compliance")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
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
      {error && <p className="mt-2 text-sm" style={{ color: "var(--err, #F87171)" }}>{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border shadow-sm">
        <VillageCanvas
          labels={labels}
          laneLabel={t("lane")}
          tips={tips}
          heroTip={{ name: t("tips.hero.name"), role: t("tips.hero.role"), real: t("tips.hero.real") }}
          villagerTip={{ name: t("tips.villager.name"), role: t("tips.villager.role"), real: t("tips.villager.real") }}
          idle={{ who: t("who.village"), text: t("idle") }}
          quest={quest}
          traffic={traffic}
          vignette={vignette}
          onQuestEnd={() => setRunning(false)}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
      </div>

      <p className="mt-3 max-w-[75ch] text-sm text-muted-foreground">{t("honesty")}</p>
    </main>
  )
}
