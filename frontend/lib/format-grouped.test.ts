import { describe, expect, it } from "vitest"
import { formatGrouped } from "./format-grouped"

describe("formatGrouped", () => {
  it("groups thousands with a no-break space in French and German", () => {
    expect(formatGrouped(121773, "fr")).toBe("121 773")
    expect(formatGrouped(121773, "de")).toBe("121 773")
    expect(formatGrouped(1164, "fr-CH")).toBe("1 164")
  })
  it("uses a comma in English", () => {
    expect(formatGrouped(121773, "en")).toBe("121,773")
    expect(formatGrouped(89, "en")).toBe("89")
  })
  it("follows the locale for the decimal separator", () => {
    expect(formatGrouped(0.4, "fr", 1)).toBe("0,4")
    expect(formatGrouped(0.41, "de", 2)).toBe("0,41")
    expect(formatGrouped(0.4, "en", 1)).toBe("0.4")
    expect(formatGrouped(1234.5, "fr", 1)).toBe("1 234,5")
  })
  it("never depends on the runtime's ICU", () => {
    // the same call gives the same string wherever it runs
    expect(formatGrouped(76.34, "fr", 2)).toBe("76,34")
    expect(formatGrouped(-2500, "en")).toBe("-2,500")
  })
})
