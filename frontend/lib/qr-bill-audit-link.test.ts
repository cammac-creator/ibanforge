import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { auditHrefFromQr, pointsToAudit } from "./qr-bill-audit-link"

const structured = { present: true, structured: true }
const combined = { present: true, structured: false }
const absent = { present: false, structured: null }

describe("le pont de la QR-facture vers l'audit", () => {
  it("ne s'affiche que pour une adresse combinée ou non structurée", () => {
    expect(pointsToAudit({ findings: [], creditor: structured, ultimate_debtor: absent })).toBe(false)
    expect(pointsToAudit({ findings: [], creditor: structured, ultimate_debtor: structured })).toBe(false)
    expect(pointsToAudit({ findings: [], creditor: combined, ultimate_debtor: absent })).toBe(true)
    expect(pointsToAudit({ findings: [], creditor: structured, ultimate_debtor: combined })).toBe(true)
    expect(
      pointsToAudit({ findings: [{ code: "combined_address" }], creditor: structured, ultimate_debtor: absent }),
    ).toBe(true)
    // Un type invalide n'est pas une adresse combinée : il a son propre constat.
    expect(
      pointsToAudit({ findings: [{ code: "address_type_invalid" }], creditor: { present: true, structured: null }, ultimate_debtor: absent }),
    ).toBe(false)
  })

  it("mène à la page d'audit de la langue, l'anglais à la racine", () => {
    expect(auditHrefFromQr("fr")).toBe("/fr/audit?src=qr")
    expect(auditHrefFromQr("de")).toBe("/de/audit?src=qr")
    expect(auditHrefFromQr("en")).toBe("/audit?src=qr")
  })

  it.each([
    ["fr", fr],
    ["de", de],
    ["en", en],
  ] as const)("a ses trois textes en %s, sans alarme sur l'échéance", (_, messages) => {
    const { title, text, link } = messages.qrBill.toAudit
    for (const s of [title, text, link]) {
      expect(s.length).toBeGreaterThan(0)
      expect(s).not.toMatch(/14\.11|novembre|November|refus|abgewiesen|rejected|\u2014/)
    }
  })

  it("est branché dans l'outil, balisé pour la mesure des clics", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "components", "qr-bill-client.tsx"), "utf8")
    expect(source).toContain('data-evt="cta:audit-from-qr"')
    expect(source).toContain("pointsToAudit(result)")
    expect(source).toContain("auditHrefFromQr(locale)")
  })
})
