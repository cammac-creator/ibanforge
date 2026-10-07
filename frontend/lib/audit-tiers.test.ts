import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { AUDIT_TIERS, formatUsd } from "./audit-tiers"
import { formatGrouped } from "./format-grouped"

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

  /*
   * The /audit page and the home read the tiers from the constant (07/10/2026);
   * the words around them still quote a price or a ceiling in a sentence (the
   * title, the description, the step "149 $ by card"). They cannot call a
   * function, so this is what keeps them from drifting: every price they write
   * is a tier's price, and every tier's ceiling is written, grouped the way the
   * language groups it.
   */
  it.each([
    ["en", en],
    ["fr", fr],
    ["de", de],
  ] as const)("are the only ones the words of the audit quote (%s)", (locale, m) => {
    const words = [JSON.stringify(m.audit), m.pricing.audit.text, m.home.pricing.auditText].join(" ")
    const prices = locale === "en" ? [...words.matchAll(/\$(\d+)/g)] : [...words.matchAll(/(\d+)[\u00a0 ]\$/g)]
    const allowed = AUDIT_TIERS.map((t) => t.price)
    expect(prices.length).toBeGreaterThan(0)
    for (const [, amount] of prices) expect(allowed).toContain(Number(amount))
    const flat = words.replace(/[\u00a0\u202f]/g, " ")
    for (const tier of AUDIT_TIERS) expect(flat).toContain(formatGrouped(tier.rows, locale).replace(/\u00a0/g, " "))
  })

  it("are never typed on the /audit page itself", () => {
    const page = readFileSync(resolve(__dirname, "../app/[locale]/audit/page.tsx"), "utf8")
    expect(page).toContain("AUDIT_TIERS")
    for (const tier of AUDIT_TIERS) {
      expect(page).not.toMatch(new RegExp(`\\b${tier.price}\\b`))
      expect(page).not.toMatch(new RegExp(`\\b${tier.rows}\\b|${formatGrouped(tier.rows, "en")}`))
    }
  })
})
