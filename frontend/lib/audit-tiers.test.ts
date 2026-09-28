import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { AUDIT_TIERS, formatUsd } from "./audit-tiers"

/*
 * The site quotes the audit tiers from one constant; the API sells them from
 * another (src/lib/audit-file.ts). The API module is read as text, the way
 * src/lib/positioning.test.ts reads the site from the other side: importing it
 * here would pull its parser into the site's test run.
 */
const API = readFileSync(resolve(__dirname, "../../src/lib/audit-file.ts"), "utf8")

function apiTiers(): { rows: number; price: number }[] {
  const max = /export const AUDIT_MAX_ROWS = ([\d_]+);/.exec(API)?.[1]
  const block = /export const AUDIT_TIERS = \[([\s\S]*?)\] as const;/.exec(API)?.[1] ?? ""
  return [...block.matchAll(/\{\s*max_rows:\s*([\w_]+),\s*price:\s*(\d+),/g)].map((m) => ({
    rows: Number((m[1] === "AUDIT_MAX_ROWS" ? max : m[1])?.replace(/_/g, "")),
    price: Number(m[2]),
  }))
}

describe("the file audit tiers", () => {
  it("are the ones the API sells", () => {
    const tiers = apiTiers()
    expect(tiers, "src/lib/audit-file.ts no longer reads as expected").toHaveLength(2)
    expect(AUDIT_TIERS.map((t) => ({ rows: t.rows, price: t.price }))).toEqual(tiers)
  })

  it("are written in dollars the way the price list of each language writes them", () => {
    // The Pro plan is the reference: "$29" in English, "29 $" in French and German.
    expect(formatUsd(29, "en")).toBe(en.home.pricing.proPrice)
    expect(formatUsd(29, "fr")).toBe(fr.home.pricing.proPrice)
    expect(formatUsd(29, "de")).toBe(de.home.pricing.proPrice)
    expect(formatUsd(AUDIT_TIERS[0].price, "fr")).toBe("149\u00a0$")
  })
})
