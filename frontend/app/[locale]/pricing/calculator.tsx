"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"

interface EndpointDef {
  key: string
  path: string
  /** Real x402 per-call price in USD (mirror of the live 402 quotes). */
  cost: number
  /**
   * Billing units per HTTP request. Batch is priced per IBAN but one request
   * carries up to 100 IBANs — and one request consumes one prepaid credit.
   */
  unitsPerRequest: number
}

const ENDPOINTS: readonly EndpointDef[] = [
  { key: "validate", path: "/v1/iban/validate", cost: 0.005, unitsPerRequest: 1 },
  { key: "batch", path: "/v1/iban/batch", cost: 0.002, unitsPerRequest: 100 },
  { key: "bic", path: "/v1/bic/:code", cost: 0.003, unitsPerRequest: 1 },
  { key: "chClearing", path: "/v1/ch/clearing/:iid", cost: 0.003, unitsPerRequest: 1 },
  { key: "compliance", path: "/v1/iban/compliance", cost: 0.02, unitsPerRequest: 1 },
]

const FREE_KEY_MONTHLY_REQUESTS = 200
const MAX_VOLUME = 10_000_000

/** Live prepaid pack prices in USD — same numbers as the checkout above. */
const PACK_1K = 5
const PACK_5K = 20
const PACK_25K = 80

function formatCost(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

/**
 * Cheapest combination of prepaid packs covering `calls` credits.
 * Packs come in 1k/$5, 5k/$20, 25k/$80; at equal price, prefer more credits.
 */
function packQuote(calls: number): { price: number; credits: number } {
  const thousands = Math.ceil(calls / 1000)
  const big = Math.floor(thousands / 25)
  const rest = thousands % 25
  // Cover the remainder with 5k/1k packs — or one extra 25k when cheaper.
  let bestPrice = PACK_25K
  let bestThousands = 25
  for (let fives = 0; fives * 5 <= rest + 4; fives++) {
    const ones = Math.max(0, rest - fives * 5)
    const price = fives * PACK_5K + ones * PACK_1K
    const covered = fives * 5 + ones
    if (price < bestPrice || (price === bestPrice && covered > bestThousands)) {
      bestPrice = price
      bestThousands = covered
    }
  }
  if (rest === 0) {
    bestPrice = 0
    bestThousands = 0
  }
  return {
    price: big * PACK_25K + bestPrice,
    credits: (big * 25 + bestThousands) * 1000,
  }
}

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
    setVolumes((v) => ({ ...v, [key]: raw.replace(/[^0-9]/g, "").slice(0, 8) }))
  }

  function parseVolume(raw: string): number {
    const n = parseInt(raw, 10)
    if (isNaN(n) || n < 0) return 0
    return Math.min(n, MAX_VOLUME)
  }

  function formatNumber(n: number): string {
    return new Intl.NumberFormat(locale).format(n)
  }

  const rows = ENDPOINTS.map((ep) => {
    const volume = parseVolume(volumes[ep.key])
    return { ...ep, volume, label: t(`endpoints.${ep.key}`), total: volume * ep.cost }
  })

  // The big number is the true sum of every line shown above — nothing less.
  const paygTotal = rows.reduce((sum, r) => sum + r.total, 0)
  const totalRequests = rows.reduce(
    (sum, r) => sum + Math.ceil(r.volume / r.unitsPerRequest),
    0
  )

  const pack = packQuote(totalRequests)
  const packSavings = paygTotal > 0 ? Math.round((1 - pack.price / paygTotal) * 100) : 0
  const showFreeKey = totalRequests > 0 && totalRequests <= FREE_KEY_MONTHLY_REQUESTS
  // Show the prepaid anchor whenever packs are at least price-equal — the
  // "never expire" upside is real even at parity. Never show a worse price.
  const showPacks = totalRequests > FREE_KEY_MONTHLY_REQUESTS && pack.price <= paygTotal

  return (
    <div
      className="rounded-xl border p-6 flex flex-col gap-5"
      style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
    >
      {/* Per-endpoint volume table — each line is editable and counted. */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--ink-4)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr
              className="border-b"
              style={{ borderColor: "var(--ink-4)", background: "var(--ink-2)" }}
            >
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">
                {t("table.endpoint")}
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">
                {t("callsHeader")}
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs hidden sm:table-cell">
                {t("table.rate")}
              </th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">
                {t("table.monthlyCost")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.key}
                className={i < rows.length - 1 ? "border-b" : ""}
                style={{ borderColor: "var(--hairline)" }}
              >
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-foreground">{row.label}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground sm:hidden">
                    {formatCost(row.cost)}/{t("perCall")}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={volumes[row.key]}
                    onChange={(e) => handleChange(row.key, e.target.value)}
                    aria-label={`${row.label} — ${t("callsHeader")}`}
                    className="h-8 w-20 sm:w-24 ml-auto text-right font-mono text-xs tnum"
                  />
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                  {formatCost(row.cost)}/{t("perCall")}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tnum">
                  {row.volume > 0 ? (
                    <span className="text-amber-500">{formatCost(row.total)}</span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Honest summary — the sum of the lines above, plus the cheaper rail if any. */}
      <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-5 py-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">{t("summary.total")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("summary.note")}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold font-mono text-amber-500 tnum">
              {formatCost(paygTotal)}
            </p>
            <p className="text-xs text-muted-foreground">{t("summary.payg")}</p>
          </div>
        </div>
        {(showFreeKey || showPacks) && (
          <p
            className="text-xs text-muted-foreground border-t pt-3"
            style={{ borderColor: "rgba(245, 158, 11, 0.15)" }}
          >
            {showFreeKey
              ? t("summary.freeKey")
              : packSavings >= 1
                ? t("summary.packs", {
                    credits: formatNumber(pack.credits),
                    price: formatCost(pack.price),
                    percent: `${packSavings}%`,
                  })
                : t("summary.packsEven", {
                    credits: formatNumber(pack.credits),
                    price: formatCost(pack.price),
                  })}
          </p>
        )}
      </div>
    </div>
  )
}
