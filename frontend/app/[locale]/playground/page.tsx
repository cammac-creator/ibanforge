"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GetKeyButton } from "@/components/api-key-dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusDot } from "@/components/ui/status-dot"
import { ResultCard } from "./result-card"
import {
  MODES,
  CHIPS,
  DEFAULT_INPUT,
  DEFAULT_RESULT,
  type PlaygroundMode,
  type Chip,
} from "./examples"
import { localePath } from "@/lib/locale-path"

type Rec = Record<string, unknown>

const BUTTON_KEY: Record<PlaygroundMode, string> = {
  iban: "button.validate",
  bic: "button.lookup",
  compliance: "button.compliance",
  clearing: "button.clearing",
}

const TONE_COLOR: Record<Chip["tone"], string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  info: "var(--info)",
}

export default function PlaygroundPage() {
  const t = useTranslations("playground")
  const locale = useLocale()

  const [activeTab, setActiveTab] = useState<PlaygroundMode>("iban")
  const [inputs, setInputs] = useState<Record<PlaygroundMode, string>>({ ...DEFAULT_INPUT })
  const [results, setResults] = useState<Record<PlaygroundMode, Rec | null>>({ ...DEFAULT_RESULT })
  const [errors, setErrors] = useState<Record<PlaygroundMode, string | null>>({
    iban: null,
    bic: null,
    compliance: null,
    clearing: null,
  })
  const [loading, setLoading] = useState<PlaygroundMode | null>(null)
  const [seq, setSeq] = useState(0)

  async function run(mode: PlaygroundMode, value: string) {
    if (!value.trim()) return
    setLoading(mode)
    setErrors((e) => ({ ...e, [mode]: null }))

    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: mode, value: value.trim() }),
      })
      const data: Rec = await res.json()
      const hasResult =
        data && typeof data === "object" && ("valid" in data || "found" in data)

      if (hasResult) {
        // Field-level "invalid"/"not found" is a legitimate result, not an error.
        setResults((r) => ({ ...r, [mode]: data }))
        setSeq((s) => s + 1)
      } else {
        // Known codes come first: a raw route message must never reach the
        // visitor untranslated (a hardcoded English sentence once did, on the
        // French page).
        const msg =
          (data?.error === "playground_unavailable" && t("error.unavailable")) ||
          // The route's two other named refusals. Without these branches they
          // reached the visitor as the raw English `message` of an API error.
          (data?.error === "forbidden_origin" && t("error.forbiddenOrigin")) ||
          (data?.error === "rate_limited" && t("error.rateLimited")) ||
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          t("error.unexpected")
        setErrors((e) => ({ ...e, [mode]: msg }))
      }
    } catch {
      setErrors((e) => ({ ...e, [mode]: t("error.network") }))
    } finally {
      setLoading(null)
    }
  }

  function changeTab(mode: PlaygroundMode) {
    setActiveTab(mode)
    setSeq((s) => s + 1) // re-play the card reveal on tab switch
  }

  function onChip(chip: Chip) {
    const target = chip.toMode ?? activeTab
    if (chip.toMode && chip.toMode !== activeTab) setActiveTab(chip.toMode)
    setInputs((i) => ({ ...i, [target]: chip.value }))
    run(target, chip.value)
  }

  const result = results[activeTab]
  const error = errors[activeTab]
  const isLoading = loading === activeTab

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-14 sm:py-16">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="eyebrow inline-flex items-center gap-2">
          <StatusDot kind="live" />
          {t("eyebrow")}
        </span>
        <h1 className="font-mono text-4xl font-bold tracking-tight">
          {t("title.prefix")}
          <span className="text-amber-500">{t("title.highlight")}</span>
        </h1>
        <p className="max-w-xl text-base text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Tabs (segmented control) */}
      <section className="flex flex-col gap-5">
        {/* The page went straight from its `h1` to the footer's `h3`, a level
            skipped in the outline (WEB-19, audit 2026-09-01). This heading
            names the interactive block for a screen reader and closes the gap;
            it is `sr-only` because the eyebrow and the title above already say
            it to everyone else. */}
        <h2 className="sr-only">{t("sectionTitle")}</h2>
        <Tabs value={activeTab} onValueChange={(v) => changeTab(v as PlaygroundMode)}>
          <TabsList className="w-full flex-wrap sm:w-fit">
            {MODES.map((m) => (
              <TabsTrigger key={m} value={m} className="flex-1 sm:flex-none">
                {t(`tabs.${m}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Hint */}
        <p className="text-sm text-[var(--fg-4)]">{t(`hint.${activeTab}`)}</p>

        {/* Input + submit */}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            run(activeTab, inputs[activeTab])
          }}
        >
          <Input
            className="h-10 flex-1 font-mono"
            placeholder={t(`placeholder.${activeTab}`)}
            value={inputs[activeTab]}
            onChange={(e) => setInputs((i) => ({ ...i, [activeTab]: e.target.value }))}
            disabled={isLoading}
            autoComplete="off"
            spellCheck={false}
            aria-label={t(`tabs.${activeTab}`)}
          />
          <Button
            type="submit"
            disabled={isLoading || !inputs[activeTab].trim()}
            variant="amber"
            className="h-10 w-full sm:w-auto sm:min-w-28"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : t(BUTTON_KEY[activeTab])}
          </Button>
        </form>

        {/* Quick-example chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[0.6875rem] uppercase tracking-caps text-[var(--fg-5)]">
            {t("examples")}
          </span>
          {CHIPS[activeTab].map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChip(chip)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1 font-mono text-xs text-[var(--fg-3)] transition-colors hover:border-[var(--ink-5)] hover:text-[var(--fg-1)] disabled:opacity-50"
            >
              <span
                className="h-[6px] w-[6px] shrink-0 rounded-full"
                style={{ backgroundColor: TONE_COLOR[chip.tone] }}
              />
              {t(`chips.${chip.key}`)}
            </button>
          ))}
        </div>

        {/* Error banner (transport / payment only) */}
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Result */}
        {isLoading ? (
          <SkeletonCard />
        ) : (
          result && <ResultCard mode={activeTab} data={result} animateKey={seq} />
        )}
      </section>

      {/* Peak of intent. The visitor has just watched the API answer on their
          own input; until 2026-08-20 the only exit here was "See the docs",
          which sends the most convinced reader off to read instead of to
          build. The key comes first now, the docs stay one click away. */}
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">{t("docsPrompt")}</p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <GetKeyButton variant="amber" className="px-6">
            {t("getKey")}
          </GetKeyButton>
          <Button variant="outline" className="px-6" render={<Link href={localePath(locale, '/docs')} />}>
            {t("docsLink")}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* Stable-shape loading skeleton — matches the result card silhouette so there
   is zero layout shift when the real answer lands. */
function SkeletonCard() {
  return (
    <div className="card-surface overflow-hidden rounded-xl border">
      <div className="border-b border-[var(--hairline)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="pg-skeleton h-6 w-20 rounded-full" />
          <div className="pg-skeleton h-6 w-16 rounded-full" />
          <div className="pg-skeleton h-5 w-40 rounded" />
          <div className="pg-skeleton ml-auto h-4 w-24 rounded" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="pg-skeleton h-6 w-24 rounded-full" />
          <div className="pg-skeleton h-6 w-12 rounded-full" />
          <div className="pg-skeleton h-6 w-12 rounded-full" />
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-4">
            <div className="pg-skeleton mb-3 h-3 w-24 rounded" />
            <div className="space-y-2">
              <div className="pg-skeleton h-3 w-full rounded" />
              <div className="pg-skeleton h-3 w-4/5 rounded" />
              <div className="pg-skeleton h-3 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
