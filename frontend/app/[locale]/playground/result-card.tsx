"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Copy, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { RiskChip } from "@/components/ui/risk-chip"
import { JsonViewer } from "@/components/json-viewer"
import { useCountUp } from "@/components/use-count-up"
import type { PlaygroundMode } from "./examples"

/* ── safe readers over the unknown API payload ─────────────────────────────── */
type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {})
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" ? v : null)
const isTrue = (v: unknown): boolean => v === true
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

type ChipLevel = "low" | "med" | "high" | "unknown"

function codeToFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "🏳️"
  const A = 0x1f1e6
  const cc = code.toUpperCase()
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65))
}

/* ── small presentational atoms ────────────────────────────────────────────── */
function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?: "neutral" | "ok" | "muted" | "amber"
}) {
  const styles: Record<string, string> = {
    neutral: "border-[var(--ink-4)] text-[var(--fg-2)] bg-[var(--ink-2)]",
    ok: "border-[color:var(--risk-low-bd)] text-[color:var(--risk-low-fg)] bg-[color:var(--risk-low-bg)]",
    amber: "border-[color:var(--amber-line,rgba(245,158,11,.28))] text-[var(--amber-300)] bg-[color:var(--amber-soft,rgba(245,158,11,.10))]",
    muted: "border-[var(--ink-4)] text-[var(--fg-4)] bg-transparent",
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

function BoolMark({ on }: { on: boolean }) {
  return on ? (
    <Check className="size-3.5" style={{ color: "var(--ok)" }} />
  ) : (
    <Minus className="size-3.5" style={{ color: "var(--fg-5)" }} />
  )
}

/** Sanctions row marker: red "sanctioned" when hit, green "clear" otherwise. */
function SanctionMark({ hit }: { hit: boolean }) {
  return hit ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
      ⚠ sanctioned
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <BoolMark on /> clear
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-4">
      <div className="eyebrow mb-3">{title}</div>
      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-[0.8125rem]">
        {children}
      </dl>
    </div>
  )
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[var(--fg-3)]">{k}</dt>
      <dd className="m-0 text-[var(--fg-2)] [overflow-wrap:anywhere]">{children}</dd>
    </>
  )
}

/* ── the two-level result card ─────────────────────────────────────────────── */
export function ResultCard({
  mode,
  data,
  animateKey,
}: {
  mode: PlaygroundMode
  data: Rec
  animateKey: number
}) {
  const t = useTranslations("playground")
  const tc = useTranslations("common")
  const [rawOpen, setRawOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  const serverMs = num(data.processing_ms) ?? 0
  const latency = useCountUp(serverMs, 600)

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  /* validity / found */
  const isValidMode = mode === "iban" || mode === "compliance"
  const ok = isValidMode ? isTrue(data.valid) : isTrue(data.found)
  const statusLabel = isValidMode
    ? ok
      ? t("glance.valid")
      : t("glance.invalid")
    : ok
      ? t("glance.found")
      : t("glance.notFound")

  const latencyPill = (
    <span className="ml-auto inline-flex items-baseline gap-1 font-mono text-xs text-[var(--fg-4)]">
      <span className="tnum text-[var(--fg-2)]">{latency.toFixed(2)}</span>
      <span>ms</span>
      <span className="text-[var(--fg-5)]">{t("glance.server")}</span>
    </span>
  )

  return (
    <div key={animateKey} className="card-surface pg-result-in rounded-xl border overflow-hidden">
      {/* ── glanceable banner ─────────────────────────────────────────────── */}
      <div className="border-b border-[var(--hairline)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
              ok
                ? "border-[color:var(--risk-low-bd)] text-[color:var(--risk-low-fg)] bg-[color:var(--risk-low-bg)]"
                : "border-destructive/40 text-destructive bg-destructive/10"
            )}
          >
            {ok ? "✓" : "✗"} {statusLabel}
          </span>
          <BannerIdentity mode={mode} data={data} />
          {latencyPill}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BannerPills mode={mode} data={data} t={t} />
        </div>
      </div>

      {/* ── readable sections ─────────────────────────────────────────────── */}
      {ok ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 pg-stagger">
          <Sections mode={mode} data={data} t={t} />
        </div>
      ) : (
        <div className="p-4 sm:p-5">
          <InvalidNote data={data} />
        </div>
      )}

      {/* ── raw JSON (collapsible + copy) ─────────────────────────────────── */}
      <div className="border-t border-[var(--hairline)]">
        <div className="flex items-center justify-between px-4 py-2.5 sm:px-5">
          <button
            onClick={() => setRawOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-caps text-[var(--fg-4)] transition-colors hover:text-[var(--fg-2)]"
            aria-expanded={rawOpen}
          >
            <span
              className="inline-block transition-transform"
              style={{ transform: rawOpen ? "rotate(90deg)" : "none" }}
            >
              ▸
            </span>
            {rawOpen ? t("raw.hide") : t("raw.show")}
          </button>
          <button
            onClick={copyJson}
            aria-label={copied ? tc("copied") : tc("copy")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              copied ? "text-[var(--ok)]" : "text-[var(--fg-4)] hover:text-[var(--fg-2)]"
            )}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? tc("copied") : tc("copy")}
          </button>
        </div>
        {rawOpen && (
          <div className="max-h-[420px] overflow-auto border-t border-[var(--hairline)] bg-[var(--ink-0)] px-4 py-3 sm:px-5">
            <JsonViewer data={data} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ── banner: identity line (flag, country, bank, BIC) ──────────────────────── */
function BannerIdentity({ mode, data }: { mode: PlaygroundMode; data: Rec }) {
  let country: string | null = null
  let name: string | null = null
  let bic: string | null = null

  if (mode === "iban" || mode === "compliance") {
    country = str(rec(data.country).code)
    name = str(rec(data.bic).bank_name) ?? str(rec(data.issuer).name)
    bic = str(rec(data.bic).code)
  } else if (mode === "bic") {
    country = str(rec(data.country).code)
    name = str(data.institution)
    bic = str(data.bic11) ?? str(data.bic)
  } else {
    country = str(rec(data.address).country)
    name = str(rec(data.institution).name)
    bic = str(data.bic)
  }

  return (
    <>
      {country && (
        <span className="inline-flex items-center gap-1.5 font-mono text-sm text-[var(--fg-2)]">
          <span className="text-base leading-none">{codeToFlag(country)}</span>
          {country}
        </span>
      )}
      {name && (
        <span className="min-w-0 truncate text-sm font-medium text-[var(--fg-1)]">{name}</span>
      )}
      {bic && (
        <span className="font-mono text-xs text-[var(--fg-3)]">{bic}</span>
      )}
    </>
  )
}

/* ── banner: pastilles (risk, SEPA, VoP, clearing) ─────────────────────────── */
function BannerPills({
  mode,
  data,
  t,
}: {
  mode: PlaygroundMode
  data: Rec
  t: ReturnType<typeof useTranslations>
}) {
  const pills: React.ReactNode[] = []

  // Risk chip
  if (mode === "compliance") {
    const c = rec(data.compliance)
    const level = complianceLevel(str(c.risk_level))
    pills.push(<RiskChip key="risk" level={level} score={scoreLabel(c.risk_score)} />)
  } else if (mode === "iban" && isTrue(data.valid)) {
    const ri = rec(data.risk_indicators)
    if (Object.keys(ri).length) {
      const { level, tag } = ibanRisk(ri)
      pills.push(<RiskChip key="risk" level={level} score={tag} />)
    }
  } else if (mode === "bic" && isTrue(data.is_test_bic)) {
    pills.push(<RiskChip key="risk" level="high" score="test BIC" />)
  }

  // SEPA schemes
  const sepa = rec(data.sepa)
  if (mode === "iban" || mode === "compliance") {
    if (isTrue(sepa.member)) {
      const schemes = arr(sepa.schemes).map(String)
      pills.push(<Pill key="sct" tone="ok">SCT</Pill>)
      if (schemes.includes("SDD")) pills.push(<Pill key="sdd" tone="ok">SDD</Pill>)
      if (schemes.includes("SCT_INST")) pills.push(<Pill key="inst" tone="ok">Instant</Pill>)
    } else {
      pills.push(<Pill key="nosepa" tone="muted">SEPA ✗</Pill>)
    }
  }

  // VoP
  if (mode === "compliance") {
    if (isTrue(rec(rec(data.compliance).vop).participant)) pills.push(<Pill key="vop" tone="ok">VoP</Pill>)
  } else if (mode === "iban" && (isTrue(sepa.vop_required) || isTrue(rec(data.risk_indicators).vop_coverage))) {
    pills.push(<Pill key="vop" tone="ok">VoP</Pill>)
  }

  // Clearing pastilles (iban tab, when populated)
  if (mode === "iban") {
    const cl = rec(data.clearing)
    if (str(cl.iid)) {
      pills.push(<Pill key="iid" tone="amber">IID {String(cl.iid)}</Pill>)
      if (isTrue(cl.sic)) pills.push(<Pill key="sic" tone="amber">SIC</Pill>)
      if (str(cl.qr_iid)) pills.push(<Pill key="qr" tone="amber">QR-IID</Pill>)
    }
  }

  // Clearing tab services
  if (mode === "clearing" && isTrue(data.found)) {
    const s = rec(data.payment_services)
    pills.push(<Pill key="iid" tone="amber">IID {String(data.iid)}</Pill>)
    if (isTrue(s.sic)) pills.push(<Pill key="sic" tone="amber">SIC</Pill>)
    if (isTrue(s.eurosic)) pills.push(<Pill key="euro" tone="amber">euroSIC</Pill>)
    if (isTrue(s.instant_payments_chf)) pills.push(<Pill key="inst" tone="amber">Instant</Pill>)
    if (str(data.qr_iid)) pills.push(<Pill key="qr" tone="amber">QR-IID</Pill>)
  }

  // vIBAN / EMI note
  const issuerType =
    mode === "iban" || mode === "compliance" ? str(rec(data.issuer).type) : null
  if (issuerType === "emi" || issuerType === "payment_institution") {
    pills.push(
      <span key="viban" className="w-full text-xs text-[var(--amber-300)] mt-1">
        {t("vibanNote")}
      </span>
    )
  }

  return <>{pills}</>
}

/* ── readable sections per mode ────────────────────────────────────────────── */
function Sections({
  mode,
  data,
  t,
}: {
  mode: PlaygroundMode
  data: Rec
  t: ReturnType<typeof useTranslations>
}) {
  if (mode === "iban") return <IbanSections data={data} t={t} />
  if (mode === "bic") return <BicSections data={data} t={t} />
  if (mode === "compliance") return <ComplianceSections data={data} t={t} />
  return <ClearingSections data={data} t={t} />
}

type SecProps = { data: Rec; t: ReturnType<typeof useTranslations> }

function IbanSections({ data, t }: SecProps) {
  const bban = rec(data.bban)
  const sepa = rec(data.sepa)
  const bic = rec(data.bic)
  const issuer = rec(data.issuer)
  const ri = rec(data.risk_indicators)
  const cl = rec(data.clearing)
  return (
    <>
      <Section title={t("section.account")}>
        <Row k="IBAN">{str(data.formatted) ?? str(data.iban)}</Row>
        <Row k="Bank code">{str(bban.bank_code)}</Row>
        <Row k="Account">{str(bban.account_number)}</Row>
        <Row k="Check">{str(data.check_digits)}</Row>
      </Section>
      <Section title={t("section.sepa")}>
        <Row k="Member"><BoolMark on={isTrue(sepa.member)} /></Row>
        <Row k="Schemes">{arr(sepa.schemes).map(String).join(" · ") || "—"}</Row>
        <Row k="VoP required"><BoolMark on={isTrue(sepa.vop_required)} /></Row>
      </Section>
      <Section title={t("section.issuer")}>
        <Row k="Type">
          <IssuerType type={str(issuer.type)} />
        </Row>
        <Row k="Name">{str(issuer.name)}</Row>
        <Row k="BIC">{str(bic.code)}</Row>
        <Row k="City">{str(bic.city)}</Row>
      </Section>
      {str(cl.iid) && (
        <Section title={t("section.clearing")}>
          <Row k="IID">{str(cl.iid)}</Row>
          <Row k="Institution">{str(cl.name)}</Row>
          <Row k="Town">{str(cl.town)}</Row>
          <Row k="SIC"><BoolMark on={isTrue(cl.sic)} /></Row>
          <Row k="Instant CHF"><BoolMark on={isTrue(cl.instant_payments_chf)} /></Row>
          <Row k="euroSIC"><BoolMark on={isTrue(cl.eurosic)} /></Row>
        </Section>
      )}
      <Section title={t("section.risk")}>
        <Row k="Issuer type">{str(ri.issuer_type)}</Row>
        <Row k="Country risk">{str(ri.country_risk)}</Row>
        <Row k="Test BIC"><BoolMark on={isTrue(ri.test_bic)} /></Row>
        <Row k="SEPA reachable"><BoolMark on={isTrue(ri.sepa_reachable)} /></Row>
      </Section>
    </>
  )
}

function BicSections({ data, t }: SecProps) {
  const address = rec(data.address)
  const hasAddr = isTrue(data.address_available) && Object.keys(address).length > 0
  return (
    <>
      <Section title={t("section.institution")}>
        <Row k="Name">{str(data.institution) || "—"}</Row>
        <Row k="Country">{str(rec(data.country).name) ?? str(rec(data.country).code)}</Row>
        <Row k="City">{str(data.city) || "—"}</Row>
        <Row k="Source">{str(data.source)}</Row>
        <Row k="Test BIC"><BoolMark on={isTrue(data.is_test_bic)} /></Row>
      </Section>
      <Section title={t("section.identifiers")}>
        <Row k="BIC8">{str(data.bic8)}</Row>
        <Row k="BIC11">{str(data.bic11)}</Row>
        <Row k="LEI">{str(data.lei) ?? "—"}</Row>
        <Row k="LEI status">{str(data.lei_status) ?? "—"}</Row>
      </Section>
      {hasAddr && (
        <Section title={t("section.address")}>
          <Row k="Street">{str(address.street)}</Row>
          <Row k="Post code">{str(address.post_code)}</Row>
          <Row k="City">{str(address.city)}</Row>
          <Row k="Country">{str(address.country)}</Row>
          <Row k="Source">{str(address.source)}</Row>
          <Row k="As of">{str(address.as_of)}</Row>
        </Section>
      )}
    </>
  )
}

function ComplianceSections({ data, t }: SecProps) {
  const c = rec(data.compliance)
  const sanctions = rec(c.sanctions)
  const reach = rec(c.reachability)
  const vop = rec(c.vop)
  const meta = rec(data.meta)
  const flags = arr(c.flags).map(String)
  const level = complianceLevel(str(c.risk_level))
  return (
    <>
      <Section title={t("section.score")}>
        <Row k="Score">
          <span className="inline-flex items-center gap-2">
            <RiskChip level={level} score={scoreLabel(c.risk_score)} />
          </span>
        </Row>
        <Row k="Level">{str(c.risk_level)}</Row>
        <Row k="Flags">{flags.length ? flags.join(" · ") : "—"}</Row>
      </Section>
      <Section title={t("section.sanctions")}>
        <Row k="Country"><SanctionMark hit={isTrue(sanctions.country_sanctioned)} /></Row>
        <Row k="Bank (BIC8)"><SanctionMark hit={isTrue(sanctions.bank_sanctioned)} /></Row>
        <Row k="FATF">{str(sanctions.fatf_status)}</Row>
        <Row k="Lists">{arr(sanctions.matched_lists).map(String).join(", ") || "none"}</Row>
      </Section>
      <Section title={t("section.reachability")}>
        <Row k="SEPA Instant"><BoolMark on={isTrue(reach.sepa_instant)} /></Row>
        <Row k="SCT"><BoolMark on={isTrue(reach.sct)} /></Row>
        <Row k="SDD"><BoolMark on={isTrue(reach.sdd)} /></Row>
      </Section>
      <Section title={t("section.vop")}>
        <Row k="Participant"><BoolMark on={isTrue(vop.participant)} /></Row>
        <Row k="Status">{str(vop.status)}</Row>
      </Section>
      <div className="sm:col-span-2 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-4">
        <div className="eyebrow mb-2">{t("section.scope")}</div>
        <p className="text-xs leading-relaxed text-[var(--fg-4)]">
          <span className="font-mono text-[var(--amber-300)]">{str(meta.scope)}</span> — {str(meta.disclaimer)}
        </p>
        <p className="mt-2 font-mono text-[0.6875rem] text-[var(--fg-5)]">
          {str(meta.sources)}
        </p>
      </div>
    </>
  )
}

function ClearingSections({ data, t }: SecProps) {
  const inst = rec(data.institution)
  const address = rec(data.address)
  const s = rec(data.payment_services)
  return (
    <>
      <Section title={t("section.institution")}>
        <Row k="Name">{str(inst.name)}</Row>
        <Row k="Type">{str(inst.type)}</Row>
        <Row k="IID">{str(data.iid)}</Row>
        <Row k="IID type">{str(inst.iid_type)}</Row>
      </Section>
      <Section title={t("section.address")}>
        <Row k="Street">{str(address.street)} {str(address.building_number)}</Row>
        <Row k="Post code">{str(address.post_code)}</Row>
        <Row k="Town">{str(address.town)}</Row>
        <Row k="Country">{str(address.country)}</Row>
      </Section>
      <Section title={t("section.services")}>
        <Row k="SIC"><BoolMark on={isTrue(s.sic)} /></Row>
        <Row k="RTGS CHF"><BoolMark on={isTrue(s.rtgs_chf)} /></Row>
        <Row k="Instant CHF"><BoolMark on={isTrue(s.instant_payments_chf)} /></Row>
        <Row k="euroSIC"><BoolMark on={isTrue(s.eurosic)} /></Row>
        <Row k="LSV BDD CHF"><BoolMark on={isTrue(s.lsv_bdd_chf)} /></Row>
        <Row k="LSV BDD EUR"><BoolMark on={isTrue(s.lsv_bdd_eur)} /></Row>
      </Section>
      <Section title={t("section.identifiers")}>
        <Row k="BIC">{str(data.bic)}</Row>
        <Row k="SIC IID">{str(data.sic_iid)}</Row>
        <Row k="QR-IID">{str(data.qr_iid) ?? "—"}</Row>
        <Row k="Valid on">{str(data.valid_on)}</Row>
      </Section>
    </>
  )
}

function IssuerType({ type }: { type: string | null }) {
  if (!type) return <>—</>
  const isViban = type === "emi" || type === "payment_institution"
  return (
    <span className={isViban ? "text-[var(--amber-300)]" : "text-[var(--fg-2)]"}>{type}</span>
  )
}

function InvalidNote({ data }: { data: Rec }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
      <div className="font-mono text-sm text-destructive">{str(data.error) ?? "invalid"}</div>
      {str(data.error_detail) && (
        <div className="mt-1 text-xs text-[var(--fg-4)]">{str(data.error_detail)}</div>
      )}
    </div>
  )
}

/* ── risk helpers ──────────────────────────────────────────────────────────── */
function complianceLevel(lvl: string | null): ChipLevel {
  if (lvl === "high" || lvl === "critical") return "high"
  if (lvl === "medium" || lvl === "elevated") return "med"
  // The API answers 'unassessable' when the IBAN failed validation: nothing was
  // screened. The old bare `return "low"` turned that into a green chip, which
  // is the defect the API fix exists to remove, reappearing one layer up.
  if (lvl === "unassessable") return "unknown"
  return "low"
}

/** The score to print. A null score is "—", never 0: 0 is the safest value. */
function scoreLabel(v: unknown): string {
  const n = num(v)
  return n === null || n === undefined ? "—" : `${n}/100`
}

function ibanRisk(ri: Rec): { level: ChipLevel; tag: string } {
  if (isTrue(ri.test_bic)) return { level: "high", tag: "test BIC" }
  const cr = str(ri.country_risk)
  if (cr === "high") return { level: "high", tag: "high-risk" }
  if (cr === "elevated") return { level: "med", tag: "elevated" }
  const it = str(ri.issuer_type)
  if (it === "emi" || it === "payment_institution") return { level: "med", tag: "vIBAN" }
  return { level: "low", tag: "clean" }
}
