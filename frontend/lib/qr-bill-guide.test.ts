import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"

/**
 * Le texte de fond de /tools/qr-bill (2026-11-19, « La QR-facture suisse »).
 *
 * Chaque code de constat cité dans le tableau doit exister dans le contrôle de
 * l'API : une page qui nomme un constat que l'outil ne rend pas ferait croire
 * à un contrôle qui n'existe pas. Le test lit le code de l'API à l'exécution
 * (jamais par un import : l'image du site ne copie que `frontend/`).
 */
const LANGS = [
  ["en", en],
  ["fr", fr],
  ["de", de],
] as const

const checkSource = readFileSync(join(import.meta.dirname, "..", "..", "src", "lib", "swiss-qr-bill.ts"), "utf8")

function strings(value: unknown, skip: string[] = []): string[] {
  if (typeof value === "string") return [value]
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => (skip.includes(k) ? [] : strings(v, skip)))
  return []
}

describe("le texte de fond de la page du contrôle de QR-facture", () => {
  it.each(LANGS)("cite en %s des codes de constat que le contrôle rend vraiment", (_, messages) => {
    const rows = Object.values(messages.qrBillGuide.rules.items)
    expect(rows.length).toBeGreaterThanOrEqual(12)
    for (const row of rows) {
      for (const code of row.code.split(",").map((c) => c.replace(/\(.*\)/, "").trim())) {
        expect(checkSource, `${code} n'est pas un constat du contrôle`).toContain(`'${code}'`)
      }
    }
  })

  it("garde les messages de l'outil identiques dans les trois langues, tels que l'API les rend", () => {
    const messages = (m: typeof en) => Object.values(m.qrBillGuide.rules.items).map((r) => r.message)
    expect(messages(fr)).toEqual(messages(en))
    expect(messages(de)).toEqual(messages(en))
  })

  it.each(LANGS)("tient entre 1 200 et 1 800 mots de texte de fond en %s", (_, messages) => {
    const { more: _more, ...body } = messages.qrBillGuide
    void _more
    const words = strings(body, ["code", "message"]).join(" ").split(/\s+/).filter(Boolean).length
    expect(words).toBeGreaterThanOrEqual(1200)
    expect(words).toBeLessThanOrEqual(1800)
  })

  it.each(LANGS)("garde en %s la mise en garde de l'échéance, mot pour mot", (_, messages) => {
    expect(messages.qrBill.deadline.length).toBeGreaterThan(300)
    expect(messages.qrBill.deadline).toMatch(/21\.11\.2025/)
    expect(messages.qrBill.deadline).toMatch(/14\.11\.2026/)
  })

  it("ne pose aucun balisage de questions fréquentes (Google l'a retiré)", () => {
    const page = readFileSync(join(import.meta.dirname, "..", "app", "[locale]", "tools", "qr-bill", "page.tsx"), "utf8")
    expect(page).not.toMatch(/FAQPage|JsonLd/)
  })
})
