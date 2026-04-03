"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"

const ENDPOINTS = [
  {
    path: "/v1/iban/validate",
    method: "POST",
    cost: 0.005,
    label: "IBAN Validate",
    description: "Validate a single IBAN",
  },
  {
    path: "/v1/iban/batch",
    method: "POST",
    cost: 0.002,
    label: "IBAN Batch (per IBAN)",
    description: "Validate up to 100 IBANs",
  },
  {
    path: "/v1/bic/:code",
    method: "GET",
    cost: 0.003,
    label: "BIC Lookup",
    description: "Lookup BIC/SWIFT code",
  },
]

function formatCost(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n)
}

export function CostCalculator() {
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
          Calls per month
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
          <span className="text-sm text-muted-foreground">calls / month</span>
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
          Cost breakdown
        </p>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-900/60">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">
                  Endpoint
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">
                  Rate
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">
                  Monthly cost
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
                      {formatCost(ep.cost)}/call
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
            At{" "}
            <span className="text-foreground font-semibold font-mono">
              {formatNumber(callsPerMonth)}
            </span>{" "}
            calls/month per endpoint
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            You only pay for what you actually call
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold font-mono text-amber-500">
            {formatCost(ENDPOINTS[0].cost * callsPerMonth)}
          </p>
          <p className="text-xs text-muted-foreground">
            for /v1/iban/validate
          </p>
        </div>
      </div>
    </div>
  )
}
