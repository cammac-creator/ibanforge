import { describe, expect, it } from "vitest"
import { DEFAULT_RESULT } from "@/app/[locale]/playground/examples"
import { groupIban, isShowable, responseLines, serverMs } from "./response-lines"

const text = (lines: ReturnType<typeof responseLines>) =>
  lines.map((l) => l.map((t) => t.text).join("")).join("\n")

describe("responseLines", () => {
  it("projects the captured UBS payload onto the reading order; long groups become blocks", () => {
    const out = text(responseLines(DEFAULT_RESULT.iban))
    expect(out).toBe(
      [
        "{",
        '  "valid": true,',
        '  "country": { "code": "CH", "name": "Switzerland" },',
        '  "bic": {',
        '    "code": "UBSWCHZH",',
        '    "bank_name": "UBS Switzerland AG",',
        '    "city": "Zürich"',
        "  },",
        '  "clearing": {',
        '    "iid": "00230",',
        '    "sic": true,',
        '    "eurosic": true,',
        '    "instant_payments_chf": true,',
        '    "qr_iid": null',
        "  },",
        '  "sepa": { "member": true, "schemes": ["SCT", "SDD"] },',
        '  "issuer": { "type": "bank" },',
        '  "risk_indicators": { "country_risk": "standard", "sepa_reachable": true },',
        '  "processing_ms": 0.41',
        "}",
      ].join("\n"),
    )
  })

  it("never invents a key the API did not send", () => {
    const out = text(responseLines({ valid: true, bic: { code: "DEUTDEFF" } }))
    expect(out).toBe(['{', '  "valid": true,', '  "bic": { "code": "DEUTDEFF" }', "}"].join("\n"))
    expect(out).not.toContain("clearing")
  })

  it("colours keys, strings and scalars apart", () => {
    const [, first] = responseLines({ valid: true })
    expect(first.find((t) => t.cls === "k")?.text).toBe('"valid"')
    expect(first.find((t) => t.cls === "n")?.text).toBe("true")
  })

  it("degrades to empty braces on garbage", () => {
    expect(text(responseLines(null))).toBe("{\n}")
    expect(text(responseLines("nope"))).toBe("{\n}")
  })
})

describe("serverMs / groupIban / isShowable", () => {
  it("reads the processing time only when it is a sane number", () => {
    expect(serverMs(DEFAULT_RESULT.iban)).toBe(0.41)
    expect(serverMs({ processing_ms: "0.41" })).toBeNull()
    expect(serverMs({ processing_ms: -1 })).toBeNull()
    expect(serverMs(undefined)).toBeNull()
  })

  it("prints an IBAN in groups of four", () => {
    expect(groupIban("CH1000230000000012345")).toBe("CH10 0023 0000 0000 1234 5")
    expect(groupIban("CH10 0023 0000 0000 1234 5")).toBe("CH10 0023 0000 0000 1234 5")
  })

  it("shows a live answer only when it is valid and names a bank", () => {
    expect(isShowable(DEFAULT_RESULT.iban)).toBe(true)
    expect(isShowable({ valid: false, error: "invalid_checksum" })).toBe(false)
    expect(isShowable({ valid: true })).toBe(false)
    expect(isShowable({ error: "playground_unavailable" })).toBe(false)
  })
})
