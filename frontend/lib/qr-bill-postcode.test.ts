import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { unverifiedPostcodes } from "./qr-bill-postcode"

const party = (status: string | null, postal_code = "2501", town = "Biel") => ({
  present: true,
  address: { postal_code, town },
  sps_check: { postcode_locality: status === null ? null : { status } },
})
const absent = { present: false, address: {}, sps_check: null }

describe("les NPA que le répertoire de swisstopo n'a pas vérifiés (29.10.2026)", () => {
  it("liste une case postale probable et un répertoire illisible, jamais un couple vérifié ou contredit", () => {
    expect(
      unverifiedPostcodes({ creditor: party("not_verifiable"), ultimate_debtor: party("match", "9400", "Rorschach") }),
    ).toEqual([{ party: "creditor", status: "not_verifiable", postcode: "2501", town: "Biel" }])
    expect(
      unverifiedPostcodes({
        creditor: party("directory_unavailable", "8001", "Zürich"),
        ultimate_debtor: party("directory_unavailable", "9400", "Rorschach"),
      }).map((u) => [u.party, u.status]),
    ).toEqual([
      ["creditor", "directory_unavailable"],
      ["debtor", "directory_unavailable"],
    ])
    for (const status of ["match", "town_mismatch", "other_country", "postcode_not_listed", null]) {
      expect(unverifiedPostcodes({ creditor: party(status), ultimate_debtor: absent }), String(status)).toEqual([])
    }
    // Une adresse combinée (type K) n'a pas de sps_check.
    expect(
      unverifiedPostcodes({ creditor: { present: true, address: {}, sps_check: null }, ultimate_debtor: absent }),
    ).toEqual([])
  })

  it.each([
    ["en", en, /every rule passes/],
    ["fr", fr, /toutes les règles passent/],
    ["de", de, /alle Regeln bestanden/],
  ] as const)("a ses textes en %s, sans promettre une vérification", (_, messages, promise) => {
    const r = messages.qrBill.result
    expect(r.cleanUnverified).not.toMatch(promise)
    for (const key of ["postcodeNotVerifiable", "postcodeDirectoryUnavailable"] as const) {
      for (const slot of ["{party}", "{postcode}", "{town}"]) expect(r[key], `${key} ${slot}`).toContain(slot)
    }
    expect(r.postcodeNotVerifiable).toContain("swisstopo")
  })
})
