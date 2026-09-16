import { describe, it, expect } from "vitest"
import { ENDPOINTS, freeKeyTier, packQuote, PRO_MONTHLY_PRICE, PRO_MONTHLY_UNITS } from "./pricing-estimate"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("Choisir une offre sans surestimer son quota", () => {
  it.each([[0, null], [1, "anonymous"], [25, "anonymous"], [26, "claimed"], [200, "claimed"], [201, null]] as const)("%i unités : %s", (units, expected) => {
    expect(freeKeyTier(units)).toBe(expected)
  })

  it("couvre le besoin au meilleur prix parmi toutes les combinaisons pertinentes", () => {
    for (const units of [0, 1, 999, 1000, 1001, 3999, 4001, 5001, 10000, 19999, 20001, 24999, 25001, 49999, 50001]) {
      const candidates = []
      for (let large = 0; large <= 3; large++) {
        for (let medium = 0; medium <= 12; medium++) {
          for (let small = 0; small <= 60; small++) {
            const credits = large * 25000 + medium * 5000 + small * 1000
            if (credits >= units) candidates.push({ credits, price: large * 80 + medium * 20 + small * 5 })
          }
        }
      }
      candidates.sort((a, b) => a.price - b.price || b.credits - a.credits)
      expect(packQuote(units)).toEqual(candidates[0])
    }
  })

  it("compte les IBAN d’un lot, pas seulement les appels HTTP", () => {
    const batch = ENDPOINTS.find((entry) => entry.key === "batch")!
    expect(10000 * batch.cost).toBe(20)
    expect(packQuote(10000)).toEqual({ price: 40, credits: 10000 })
    expect(PRO_MONTHLY_PRICE).toBe(29)
    expect(PRO_MONTHLY_UNITS).toBe(10000)
  })

  it("garde le plafond et le prix Pro alignés sur le contrat serveur", () => {
    const keys = readFileSync(resolve(process.cwd(), "../src/lib/api-keys.ts"), "utf8")
    const links = readFileSync(resolve(process.cwd(), "../src/lib/payment-links.ts"), "utf8")
    expect(keys).toContain(`PRO_MONTHLY_LIMIT = ${PRO_MONTHLY_UNITS.toString().replace("10000", "10_000")}`)
    expect(links).toContain(`PRO_PRICE_USD = ${PRO_MONTHLY_PRICE}`)
  })
})
