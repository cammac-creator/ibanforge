"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"

interface EndpointCostRow {
  path: string
  cost: number
  label: string
}

const ENDPOINT_COSTS: ReadonlyArray<Omit<EndpointCostRow, "label"> & { labelKey: string }> = [
  { path: "/v1/iban/validate",  cost: 0.005, labelKey: "validate" },
  { path: "/v1/iban/batch",     cost: 0.002, labelKey: "batch" },
  { path: "/v1/bic/:code",      cost: 0.003, labelKey: "bic" },
  { path: "/v1/ch/clearing/:iid", cost: 0.003, labelKey: "chClearing" },
  { path: "/v1/iban/compliance", cost: 0.02,  labelKey: "compliance" },
]

function formatCost(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

export function CostCalculator() {
  const t = useTranslations("pricing.calculator")
  const ENDPOINTS: EndpointCostRow[] = ENDPOINT_COSTS.map((e) => ({
    path: e.path,
    cost: e.cost,
    label: t(`endpoints.${e.labelKey}`),
  }))

  function formatNumber(n: number): string {
    // Use the page locale for number formatting (Intl auto-handles fr-CH, de-CH, en).
    return new Intl.NumberFormat(undefined).format(n)
  }

  const [callsPerMonth, setCallsPerMonth] = useState(1000)
  const [inputValue, setInputValue] = useState("1000")

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, "")
    setInputValue(raw)
    const parsed = parseInt(raw, 10)
    if (!isNaN(parsed) && parsed >= 0) {
      setCallsPerMonth(Math.min(parsed, 10_000_000))
    } else if (raw === "") {
      setCallsPerMonth(0)
    }
  }

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10)
    setCallsPerMonth(val)
    setInputValue(String(val))
  }

  const SLIDER_MAX = 100_000
  const sliderValue = Math.min(callsPerMonth, SLIDER_MAX)

  return (
    <div className="rounded-xl border border-border bg-zinc-900/50 p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">
          {t("callsPerMonth")}
        </label>
        <div className="flex gap-3 items-center">
          <Input
            type="text"
            inputMode="numeric"
            value={inputValue}
            onChange={handleInputChange}
            className="w-36 font-mono h-10"
            placeholder="1000"
          />
          <span className="text-sm text-muted-foreground">{t("callsPerMonthUnit")}</span>
        </div>
        <input
          type="range"
          min={0}
          max={SLIDER_MAX}
          step={100}
          value={sliderValue}
          onChange={handleSliderChange}
          className="w-full accent-amber-500 cursor-pointer"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0</span>
          <span>10k</span>
          <span>25k</span>
          <span>50k</span>
          <span>100k</span>
        </div>
      </div>

      {/* Breakdown table */}
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
          {t("costBreakdown")}
        </p>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-900/60">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">
                  {t("table.endpoint")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">
                  {t("table.rate")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">
                  {t("table.monthlyCost")}
                </th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((ep, i) => {
                const total = ep.cost * callsPerMonth
                return (
                  <tr
                    key={ep.path}
                    className={i < ENDPOINTS.length - 1 ? "border-b border-border" : ""}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-foreground">
                        {ep.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                      {formatCost(ep.cost)}/{t("perCall")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-amber-500 font-semibold">
                      {formatCost(total)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-5 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {t.rich("summary.line", {
              count: formatNumber(callsPerMonth),
              strong: (chunks) => (
                <span className="text-foreground font-semibold font-mono">{chunks}</span>
              ),
            })}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("summary.note")}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold font-mono text-amber-500">
            {formatCost(ENDPOINTS[0].cost * callsPerMonth)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("summary.forEndpoint", { path: ENDPOINTS[0].path })}
          </p>
        </div>
      </div>
    </div>
  )
}
