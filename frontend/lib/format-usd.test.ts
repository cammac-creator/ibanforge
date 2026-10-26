import { describe, it, expect } from "vitest"
import { formatUsd } from "./format-usd"

const NBSP = "\u00a0"

describe("Écrire un montant en dollars dans la langue de la page", () => {
  it("écrit le total au plafond du calculateur comme chaque langue l'attend", () => {
    expect(formatUsd(330000, "en", 2)).toBe("$330,000.00")
    expect(formatUsd(330000, "fr", 2)).toBe(`330${NBSP}000,00${NBSP}$`)
    expect(formatUsd(330000, "de", 2)).toBe(`330${NBSP}000,00${NBSP}$`)
  })

  it("garde deux décimales quand on les demande, zéro compris", () => {
    expect(formatUsd(5, "en", 2)).toBe("$5.00")
    expect(formatUsd(5, "fr", 2)).toBe(`5,00${NBSP}$`)
    expect(formatUsd(0, "de", 2)).toBe(`0,00${NBSP}$`)
  })

  it("écrit un prix de catalogue avec ses seuls chiffres", () => {
    expect(formatUsd(29, "en")).toBe("$29")
    expect(formatUsd(29, "fr")).toBe(`29${NBSP}$`)
    expect(formatUsd(4, "de")).toBe(`4${NBSP}$`)
    expect(formatUsd(0.005, "en")).toBe("$0.005")
    expect(formatUsd(0.005, "fr")).toBe(`0,005${NBSP}$`)
    expect(formatUsd(0.02, "de")).toBe(`0,02${NBSP}$`)
    expect(formatUsd(0.0032, "fr")).toBe(`0,0032${NBSP}$`)
    expect(formatUsd(160000, "en")).toBe("$160,000")
  })

  it("efface l'écart des nombres à virgule flottante", () => {
    expect(formatUsd(3 * 0.002, "en")).toBe("$0.006")
    expect(formatUsd(0.1 + 0.2, "fr")).toBe(`0,3${NBSP}$`)
  })

  it("lit la langue sans tenir compte de la région ni de la casse", () => {
    expect(formatUsd(1000, "en-GB", 2)).toBe("$1,000.00")
    expect(formatUsd(1000, "FR", 2)).toBe(`1${NBSP}000,00${NBSP}$`)
  })
})
