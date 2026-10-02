import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import captured from "@/app/[locale]/playground/captured-iban.json"
import { ESSAI_DEFAULT, ESSAI_EXAMPLES, essaiAnswer, essaiCopy, essaiValue, essaiWaiting } from "./revue-essai-model"

const messages = { en, fr, de } as const
const copyOf = (locale: keyof typeof messages) =>
  essaiCopy(messages[locale].home.lens.hero, messages[locale].home.demo, messages[locale].playground.verdict)
const copy = copyOf("fr")

/* Answers written the way the API writes them, reduced to what the trial reads.
   The bank codes and registers are public data. */
const REGISTER = "Deutsche Bundesbank Bankleitzahlendatei"
const notAllocated = {
  valid: true,
  checks: { iban_structure: "pass", iban_checksum: "pass", bank_code: "fail" },
  bank_code_check: {
    value: "12345678",
    status: "not_in_register",
    reason: "not_allocated",
    register: REGISTER,
    authoritative: true,
    as_of: "2026-09",
  },
  bic: null,
}
const typo = { iban: "CH1100230000000012345", valid: false, error: "checksum_failed" }

describe("the trial of chapter 03, on arrival", () => {
  it("waits with the tester's own words, nothing answered yet", () => {
    expect(essaiWaiting(copy).map((row) => row.value)).toEqual(["À vérifier", "À identifier", "À rechercher"])
    expect(essaiWaiting(copy).every((row) => row.tone === "attente" && row.source === null)).toBe(true)
  })

  it("offers the tester's four examples, the German bank in the field", () => {
    expect(ESSAI_EXAMPLES).toEqual([
      "CH10 0023 0000 0000 1234 5",
      "DE89 3704 0044 0532 0130 00",
      "DE65 1234 5678 0532 0130 00",
      "CH11 0023 0000 0000 1234 5",
    ])
    expect(ESSAI_EXAMPLES[ESSAI_DEFAULT]).toBe("DE89 3704 0044 0532 0130 00")
    expect(copy.examples).toEqual(["Suisse", "Allemagne", "Code sans banque", "Une erreur"])
    expect(essaiValue(" de89 3704 0044 0532 0130 00 ")).toBe("DE89370400440532013000")
  })

  it.each(["en", "fr", "de"] as const)("has every word it needs (%s)", (locale) => {
    const words = copyOf(locale)
    const missing = Object.entries(words).filter(([, value]) => value === undefined || value === "")
    expect(missing).toEqual([])
    expect(words.confirmed).toContain("{code}")
    expect(words.notAllocated).toContain("{code}")
  })
})

describe("the trial of chapter 03, reading a real answer", () => {
  it("names a bank the national register confirms, with its source and date", () => {
    const answer = essaiAnswer(captured.response, copy)!
    expect(answer.rows[0]).toMatchObject({ value: "Valide", tone: "texte" })
    expect(answer.rows[1].value).toBe("UBS Switzerland AG")
    // The month is the register edition the monthly refresh captured
    // (captured-iban.json is rewritten by that robot): read it, never type it.
    expect(answer.rows[1].source).toEqual({
      before: "Code ",
      code: "00230",
      after: ` confirmé · SIX BankMaster (Swiss IID / BC-Nummer register) · ${captured.response.bank_code_check.as_of}`,
    })
    // The BIC comes from the same register, same date: its source is said once.
    expect(answer.rows[2]).toEqual({ value: "UBSWCHZH80A", tone: "mono", source: null })
    expect(answer.verdict).toEqual({ tone: "ok", label: "Banque confirmée", note: copy.noteOk })
  })

  it("names the BIC's own source when it is another one", () => {
    const answer = essaiAnswer(
      {
        valid: true,
        bank_code_check: { value: "37040044", status: "verified", authoritative: true, register: "Registre A", as_of: "2026-09" },
        bic: { code: "ALPHDEFFXXX", source: "GLEIF", as_of: "2026-08-30" },
      },
      copy,
    )!
    expect(answer.rows[2].source).toEqual({ before: "GLEIF · 2026-08-30", code: null, after: "" })
  })

  it("says « Do not send » only when the national register denies the code", () => {
    const answer = essaiAnswer(notAllocated, copy)!
    expect(answer.rows[0].value).toBe("Valide")
    expect(answer.rows[1]).toMatchObject({ value: "Aucune banque ne détient ce code", tone: "rouge" })
    expect(answer.rows[1].source).toEqual({ before: "Code ", code: "12345678", after: ` non attribué · ${REGISTER} · 2026-09` })
    expect(answer.rows[2]).toMatchObject({ value: "Non lu", tone: "gris" })
    expect(answer.verdict).toEqual({ tone: "stop", label: "Ne pas envoyer", note: copy.noteStop })
  })

  it("never turns an absence from a partial source into a refusal", () => {
    const partial = {
      valid: true,
      bank_code_check: { value: "12345", status: "not_in_register", reason: "not_allocated", authoritative: false },
    }
    const answer = essaiAnswer(partial, copy)!
    expect(answer.verdict.tone).toBe("neutre")
    expect(answer.verdict.label).toBe(copy.status.unknown)
    expect(answer.verdict.note).toBe(copy.checkBank)
    expect(answer.rows[1].tone).toBe("gris")
  })

  it("never confirms a bank a partial source only matches", () => {
    const matched = {
      valid: true,
      bank_code_check: { value: "30004", status: "verified", authoritative: false, institution: { name: "Société Alpha" } },
      bic: { code: "ALPHFRPP", source: "GLEIF" },
    }
    const answer = essaiAnswer(matched, copy)!
    expect(answer.rows[1].value).toBe("Société Alpha")
    expect(answer.rows[1].source?.before).toContain(copy.status.matched)
    expect(answer.verdict).toEqual({ tone: "neutre", label: copy.status.matched, note: copy.checkBank })
    expect(answer.verdict.label).not.toBe(copy.verdictOk)
  })

  it("asks to check the entry when the check digits do not match", () => {
    const answer = essaiAnswer(typo, copy)!
    expect(answer.rows.map((row) => row.value)).toEqual([
      "Les chiffres de contrôle ne correspondent pas",
      "Non lu",
      "Non lu",
    ])
    expect(answer.rows[0].tone).toBe("rouge")
    expect(answer.verdict).toEqual({ tone: "stop", label: "Vérifier la saisie", note: copy.noteFix })
  })

  it("keeps « one character is wrong » for a checksum, not for any malformed IBAN", () => {
    const answer = essaiAnswer({ valid: false, error: "invalid_length" }, copy)!
    expect(answer.rows[0].value).toBe(copy.structureInvalid)
    expect(answer.verdict.note).toBe(copy.fixStructure)
  })

  it("stops on a national check key that fails", () => {
    const answer = essaiAnswer(
      {
        valid: true,
        checks: { national_check_digits: "fail" },
        bank_code_check: { value: "30004", status: "verified", authoritative: true, institution: { name: "Société Alpha" } },
      },
      copy,
    )!
    expect(answer.verdict).toEqual({ tone: "stop", label: "Ne pas envoyer", note: copy.localCheckInvalid })
  })

  it("carries every credit and reservation of the sources, in full", () => {
    const answer = essaiAnswer(
      {
        ...notAllocated,
        bank_code_check: { ...notAllocated.bank_code_check, attribution: "Crédit complet de la source." },
        attribution: { text: "Réserve complète." },
      },
      copy,
    )!
    expect(answer.notices).toEqual(["Crédit complet de la source.", "Réserve complète."])
  })

  it("is no answer when the relay refused or failed", () => {
    expect(essaiAnswer({ error: "playground_unavailable" }, copy)).toBeNull()
    expect(essaiAnswer({ error: "rate_limited", message: "Too many" }, copy)).toBeNull()
    expect(essaiAnswer(null, copy)).toBeNull()
  })

  it.each(["en", "de"] as const)("speaks the page's language (%s)", (locale) => {
    const words = copyOf(locale)
    const answer = essaiAnswer(notAllocated, words)!
    expect(answer.verdict.label).toBe(messages[locale].home.demo.verdictStop)
    expect(answer.rows[1].source?.code).toBe("12345678")
    expect(answer.rows[1].source?.after).not.toContain("{code}")
  })
})
