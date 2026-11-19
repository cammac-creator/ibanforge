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

/**
 * Les mises en garde de l'échéance telles qu'elles étaient avant ce lot
 * (19.11.2026) : copie figée, la page ne doit pas les altérer.
 */
const DEADLINE = {
  en: "Address type K has not been permitted in a QR-bill since 21.11.2025 (SIX, QR-bill IG 2.3). The banks guarantee payment of such a QR-bill only until the end of September 2026 (UBS: 30.09.2026; ZKB: end of September 2026 at the latest). A type K QR-bill may therefore be refused at payment: reissue it with type S. From 14.11.2026, the Swiss Payment Standards require a structured or hybrid address in a payment order, with the town and country in their own fields. The SIC system does not validate addresses: each bank decides. Some still accept domestic Swiss payments for now; a SEPA or international payment without a town may be rejected. Also redo the standing orders and templates captured from a type K QR-bill.",
  fr: "Le type K n'est plus permis dans une QR-facture depuis le 21.11.2025 (SIX, IG QR-facture 2.3). Les banques n'en garantissent le paiement que jusqu'à fin septembre 2026 (UBS : 30.09.2026 ; ZKB : au plus tard fin septembre 2026). Une QR-facture K risque donc d'être refusée au paiement : réémettez-la en type S. Dès le 14.11.2026, les Swiss Payment Standards exigent dans un ordre de paiement une adresse structurée ou hybride, avec la localité et le pays dans leurs propres champs. Le système SIC ne valide pas les adresses : chaque banque décide. Certaines acceptent encore, pour un temps, les paiements suisses ; un paiement SEPA ou international sans localité peut être rejeté. Refaites aussi les ordres permanents et les modèles saisis depuis une QR-facture K.",
  de: "Der Adresstyp K ist in einer QR-Rechnung seit dem 21.11.2025 nicht mehr zulässig (SIX, IG QR-Rechnung 2.3). Die Banken garantieren die Zahlung einer solchen QR-Rechnung nur bis Ende September 2026 (UBS: 30.09.2026; ZKB: längstens bis Ende September 2026). Eine QR-Rechnung mit Typ K kann daher bei der Zahlung abgewiesen werden: Stellen Sie sie mit Typ S neu aus. Ab dem 14.11.2026 verlangen die Swiss Payment Standards in einem Zahlungsauftrag eine strukturierte oder hybride Adresse, mit Ort und Land in eigenen Feldern. Das SIC-System prüft die Adressen nicht: Jede Bank entscheidet selbst. Manche akzeptieren Inlandzahlungen vorläufig weiter; eine SEPA- oder Auslandzahlung ohne Ort kann abgewiesen werden. Erfassen Sie auch die Daueraufträge und Vorlagen neu, die aus einer QR-Rechnung mit Typ K übernommen wurden.",
} as const

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

  // Que chaque texte cité soit bien celui que l'outil rend est vérifié à la racine :
  // src/lib/swiss-qr-bill-guide.test.ts. Ici, seulement l'égalité entre les langues.
  it("garde les textes de detail identiques dans les trois langues", () => {
    const messages = (m: typeof en) => Object.values(m.qrBillGuide.rules.items).map((r) => r.detail)
    expect(messages(fr)).toEqual(messages(en))
    expect(messages(de)).toEqual(messages(en))
  })

  it.each(LANGS)("tient entre 1 200 et 1 800 mots de texte de fond en %s", (_, messages) => {
    const { more: _more, ...body } = messages.qrBillGuide
    void _more
    const words = strings(body, ["code", "detail"]).join(" ").split(/\s+/).filter(Boolean).length
    expect(words).toBeGreaterThanOrEqual(1200)
    expect(words).toBeLessThanOrEqual(1800)
  })

  it.each(LANGS)("garde en %s la mise en garde de l'échéance, mot pour mot", (lang, messages) => {
    expect(messages.qrBill.deadline).toBe(DEADLINE[lang])
  })

  it("ne pose aucun balisage de questions fréquentes (Google l'a retiré)", () => {
    const page = readFileSync(join(import.meta.dirname, "..", "app", "[locale]", "tools", "qr-bill", "page.tsx"), "utf8")
    expect(page).not.toMatch(/FAQPage|JsonLd/)
  })
})
