import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { resultOrigin } from "./playground-origin"
import { SAVED_ON } from "@/app/[locale]/playground/examples"
import captured from "@/app/[locale]/playground/captured-iban.json"

const MESSAGES = { en, fr, de } as const

describe("the playground card says where its answer comes from", () => {
  it("names a received answer as the API's", () => {
    expect(resultOrigin(true, "2026-09-05").key).toBe("verdict.apiResponse")
  })

  it("dates a saved answer when its capture day is known", () => {
    expect(resultOrigin(false, "2026-09-05")).toEqual({
      key: "verdict.savedExampleOn",
      values: { date: "2026-09-05" },
    })
  })

  it("keeps the undated label when no capture day is known, or when it is malformed", () => {
    expect(resultOrigin(false).key).toBe("verdict.savedExample")
    expect(resultOrigin(false, "5 September").key).toBe("verdict.savedExample")
  })

  it("reads the IBAN tab's date from the capture file, the one the monthly refresh rewrites", () => {
    expect(captured.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(SAVED_ON.iban).toBe(captured.captured_at)
  })

  it.each(["en", "fr", "de"] as const)("the dated label (%s) carries the date and says it is not live", (lang) => {
    const label = MESSAGES[lang].playground.verdict.savedExampleOn
    expect(label).toContain("{date}")
    expect(label).toMatch(/not a live answer|pas une réponse en direct|keine Live-Antwort/)
  })
})
