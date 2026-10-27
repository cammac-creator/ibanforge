"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { localePath } from "@/lib/locale-path"
import { formatGrouped } from "@/lib/format-grouped"
import { ENDPOINTS, MAX_VOLUME, formatCost, packQuote, freeKeyTier, PRO_MONTHLY_PRICE, PRO_MONTHLY_UNITS } from "@/lib/pricing-estimate"

export function CostCalculator() {
  const t = useTranslations("pricing.calculator")
  const locale = useLocale()

  const [volumes, setVolumes] = useState<Record<string, string>>({
    validate: "1000",
    batch: "0",
    bic: "0",
    chClearing: "0",
    compliance: "0",
  })

  function handleChange(key: string, raw: string) {
    const digits = raw.replace(/[^0-9]/g, "")
    setVolumes((v) => ({ ...v, [key]: digits ? String(Math.min(Number(digits), MAX_VOLUME)) : "" }))
  }

  function parseVolume(raw: string): number {
    const n = parseInt(raw, 10)
    if (isNaN(n) || n < 0) return 0
    return Math.min(n, MAX_VOLUME)
  }

  function formatNumber(n: number): string {
    return formatGrouped(n, locale)
  }

  const rows = ENDPOINTS.map((ep) => {
    const volume = parseVolume(volumes[ep.key])
    return { ...ep, volume, label: t(`endpoints.${ep.key}`), total: volume * ep.cost }
  })

  // The big number is the true sum of every line shown above — nothing less.
  const paygTotal = rows.reduce((sum, r) => sum + r.total, 0)
  // Credits / free-tier requests needed: 1 per unit, batch included.
  const totalUnits = rows.reduce((sum, r) => sum + r.volume, 0)

  const pack = packQuote(totalUnits)
  const freeTier = freeKeyTier(totalUnits)
  const proFits = totalUnits > 0 && totalUnits <= PRO_MONTHLY_UNITS

  return (
    <div
      className="rounded-xl border p-4 sm:p-6 flex flex-col gap-5"
      style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
    >
      {/* Per-endpoint volume table — each line is editable and counted.
          Sur téléphone, trois colonnes au lieu de quatre : le coût de la ligne
          passe sous son champ. À 390 px, la colonne « Coût mensuel » était
          coupée en allemand, et au volume maximal du formulaire (10 000 000)
          les champs et les montants l'étaient aussi (break-ui, 25.10.2026). */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--ink-4)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr
              className="border-b"
              style={{ borderColor: "var(--ink-4)", background: "var(--ink-2)" }}
            >
              <th className="px-3 sm:px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">
                {t("table.endpoint")}
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">
                {t("callsHeader")}
                <span className="block sm:hidden">{t("table.monthlyCost")}</span>
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs hidden sm:table-cell">
                {t("table.rate")}
              </th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs hidden sm:table-cell">
                {t("table.monthlyCost")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const cost = row.volume > 0 ? (
                <span className="text-amber-500">{formatCost(row.total)}</span>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )
              return (
                <tr
                  key={row.key}
                  className={i < rows.length - 1 ? "border-b" : ""}
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <td className="px-3 sm:px-4 py-2.5">
                    <span className="font-mono text-xs text-foreground">{row.label}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground sm:hidden">
                      {formatCost(row.cost)}/{row.key === "batch" ? "IBAN" : t("perCall")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={volumes[row.key]}
                      onChange={(e) => handleChange(row.key, e.target.value)}
                      aria-label={`${row.label} — ${t("callsHeader")}`}
                      autoComplete="off"
                      enterKeyHint="done"
                      // 16 px au doigt : sous 16 px, Safari iOS zoome la page sur
                      // le champ et ne dézoome plus (mobile-native). La largeur
                      // tient « 10000000 », le plafond du formulaire, à cette taille.
                      className="h-8 w-[6.75rem] sm:w-28 ml-auto text-right font-mono text-xs pointer-coarse:text-base tnum"
                    />
                    <span className="mt-1 block font-mono text-xs font-semibold tnum sm:hidden">{cost}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                    {formatCost(row.cost)}/{row.key === "batch" ? "IBAN" : t("perCall")}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tnum hidden sm:table-cell">
                    {cost}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Honest summary — the sum of the lines above, plus the cheaper rail if any. */}
      <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-5 py-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">{t("summary.total")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("summary.note")}</p>
          </div>
          {/* Sans `shrink-0` : la légende allemande, sur une ligne, était plus
              large que la carte et emportait le total hors du cadre à 390 px. */}
          <div className="ml-auto min-w-0 text-right">
            <p className="text-3xl font-bold font-mono text-amber-500 tnum">
              {formatCost(paygTotal)}
            </p>
            <p className="text-xs text-muted-foreground">{t("summary.payg")}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("summary.basis")}</p>
        {freeTier && <p className="rounded-md border border-amber-500/30 p-3 text-sm" role="status">{t(`summary.${freeTier}`)}</p>}
        {totalUnits > 0 && <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
          <a href="#packs" className="rounded-lg border border-border p-4 hover:border-amber-500/60 focus-visible:outline-2 focus-visible:outline-amber-500">
            <p className="text-xs text-muted-foreground">{t("summary.packTitle")}</p>
            <p className="text-xl font-mono font-semibold mt-1">{formatCost(pack.price)}</p>
            <p className="text-xs mt-2">{t("summary.packDetail", { credits: formatNumber(pack.credits) })}</p>
          </a>
          <a href={proFits ? "#pro" : localePath(locale, "/vendors")} className="rounded-lg border border-border p-4 hover:border-amber-500/60 focus-visible:outline-2 focus-visible:outline-amber-500">
            <p className="text-xs text-muted-foreground">{t("summary.proTitle")}</p>
            <p className="text-xl font-mono font-semibold mt-1">{proFits ? formatCost(PRO_MONTHLY_PRICE) : t("summary.overPro")}</p>
            <p className="text-xs mt-2">{t(proFits ? "summary.proDetail" : "summary.overProDetail", { credits: formatNumber(PRO_MONTHLY_UNITS) })}</p>
          </a>
        </div>}

      </div>
    </div>
  )
}
