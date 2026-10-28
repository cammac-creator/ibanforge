import { describe, it, expect } from "vitest"
import { ENDPOINTS, endpointCost, formatCost, freeKeyTier, packQuote, PRO_MONTHLY_PRICE, PRO_MONTHLY_UNITS } from "./pricing-estimate"
import en from "../messages/en.json"
import fr from "../messages/fr.json"
import de from "../messages/de.json"
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
            if (credits >= units) candidates.push({ credits, price: large * 80 + medium * 20 + small * 4 })
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

describe("Écrire un coût calculé dans la langue de la page", () => {
  const NBSP = "\u00a0"

  it("garde les centimes, zéro et plafond du calculateur compris", () => {
    expect(formatCost(0, "en")).toBe("$0.00")
    expect(formatCost(5, "en")).toBe("$5.00")
    expect(formatCost(5, "fr")).toBe(`5,00${NBSP}$`)
    expect(formatCost(330000, "en")).toBe("$330,000.00")
    expect(formatCost(330000, "de")).toBe(`330${NBSP}000,00${NBSP}$`)
  })

  it("ne réduit pas à zéro un coût de moins d'un centime", () => {
    expect(formatCost(0.002, "en")).toBe("$0.002")
    expect(formatCost(3 * 0.003, "fr")).toBe(`0,009${NBSP}$`)
  })

  it("donne un prix à chaque route du tableau des tarifs, dans chaque langue", () => {
    for (const messages of [en, fr, de]) {
      const routes = Object.values(messages.pricing.endpoints).map((e) => e.path)
      expect(routes).toHaveLength(ENDPOINTS.length)
      for (const path of routes) expect(endpointCost(path), path).toBeGreaterThan(0)
    }
    expect(() => endpointCost("/v1/inconnue")).toThrow()
  })
})
