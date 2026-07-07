import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Check } from "lucide-react"
import { JsonViewer } from "@/components/json-viewer"
import { RiskChip } from "@/components/ui/risk-chip"
import { DEFAULT_RESULT } from "@/app/[locale]/playground/examples"
import { cn } from "@/lib/utils"

/**
 * Compact, server-rendered version of the playground result card for the hero.
 * Mirrors the visual language of app/[locale]/playground/result-card.tsx
 * (banner, pills, clearing section, colored JSON) without importing its client
 * logic. Data = the REAL /v1/iban/validate response for CH1000230000000012345
 * (UBS, IID 00230), imported from the playground examples so both stay in sync.
 */

interface IbanDemo {
  iban: string
  valid: boolean
  formatted: string
  country: { code: string; name: string }
  bic: { code: string; bank_name: string; city: string }
  sepa: { member: boolean; schemes: string[]; vop_required: boolean }
  clearing: {
    iid: string
    name: string
    sic: boolean
    instant_payments_chf: boolean
    eurosic: boolean
    qr_iid: string | null
  }
  processing_ms: number
}

const demo = DEFAULT_RESULT.iban as unknown as IbanDemo

/** Truthful excerpt of the payload above — what the JSON pane shows. */
const JSON_EXTRACT = {
  valid: demo.valid,
  bic: { code: demo.bic.code, bank_name: demo.bic.bank_name },
  clearing: {
    iid: demo.clearing.iid,
    sic: demo.clearing.sic,
    instant_payments_chf: demo.clearing.instant_payments_chf,
    eurosic: demo.clearing.eurosic,
  },
  processing_ms: demo.processing_ms,
}

function codeToFlag(code: string): string {
  if (code.length !== 2) return "🏳️"
  const A = 0x1f1e6
  const cc = code.toUpperCase()
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65))
}

function Pill({
  children,
  tone = "ok",
}: {
  children: React.ReactNode
  tone?: "ok" | "amber"
}) {
  const styles: Record<string, string> = {
    ok: "border-[color:var(--risk-low-bd)] text-[color:var(--risk-low-fg)] bg-[color:var(--risk-low-bg)]",
    amber:
      "border-[color:rgba(245,158,11,.28)] text-[var(--amber-300)] bg-[color:rgba(245,158,11,.10)]",
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] font-medium tracking-caps",
        styles[tone]
      )}
    >
      {children}
    </span>
  )
}

function ServiceMark({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.8125rem] text-[var(--fg-2)]">
      {label}
      <Check className="size-3.5" style={{ color: "var(--ok)" }} />
    </span>
  )
}

export async function HeroDemo({ locale }: { locale: string }) {
  const t = await getTranslations("home.demo")

  return (
    <div className="card-surface rounded-xl border overflow-hidden text-left">
      {/* ── glanceable banner ─────────────────────────────────────────────── */}
      <div className="border-b border-[var(--hairline)] p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold border-[color:var(--risk-low-bd)] text-[color:var(--risk-low-fg)] bg-[color:var(--risk-low-bg)]">
            ✓ {t("valid")}
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-sm text-[var(--fg-2)]">
            <span className="text-base leading-none">{codeToFlag(demo.country.code)}</span>
            {demo.country.code}
          </span>
          <span className="min-w-0 truncate text-sm font-medium text-[var(--fg-1)]">
            {demo.bic.bank_name}
          </span>
          <span className="ml-auto inline-flex items-baseline gap-1 font-mono text-xs text-[var(--fg-4)]">
            <span className="tnum text-[var(--fg-2)]">{demo.processing_ms.toFixed(2)}</span>
            <span>ms</span>
            <span className="text-[var(--fg-5)]">{t("server")}</span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RiskChip level="low" score="clean" />
          {demo.sepa.schemes.includes("SCT") && <Pill tone="ok">SCT</Pill>}
          {demo.sepa.schemes.includes("SDD") && <Pill tone="ok">SDD</Pill>}
          <Pill tone="amber">IID {demo.clearing.iid}</Pill>
          <span className="font-mono text-xs text-[var(--fg-3)]">{demo.bic.code}</span>
        </div>
      </div>

      {/* ── Swiss clearing section (the exclusive bit) ────────────────────── */}
      <div className="p-4">
        <div className="rounded-lg border border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-3.5">
          <div className="eyebrow mb-2.5">{t("clearingTitle")}</div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {demo.clearing.sic && <ServiceMark label="SIC" />}
            {demo.clearing.instant_payments_chf && <ServiceMark label="Instant CHF" />}
            {demo.clearing.eurosic && <ServiceMark label="euroSIC" />}
          </div>
        </div>
      </div>

      {/* ── colored JSON excerpt ──────────────────────────────────────────── */}
      <div className="border-t border-[var(--hairline)] bg-[var(--ink-0)] px-4 py-3 overflow-x-auto">
        <JsonViewer data={JSON_EXTRACT} className="text-[0.75rem]" />
      </div>

      {/* ── footer: what this is + try it live ────────────────────────────── */}
      <div className="border-t border-[var(--hairline)] px-4 py-2.5 flex items-center justify-between gap-3">
        <span className="font-mono text-[0.6875rem] text-[var(--fg-5)] truncate">
          POST /v1/iban/validate
        </span>
        <Link
          href={`/${locale}/playground`}
          className="shrink-0 font-mono text-xs font-medium text-[var(--amber-400)] hover:text-[var(--amber-300)] transition-colors"
        >
          {t("tryLive")} →
        </Link>
      </div>
    </div>
  )
}
