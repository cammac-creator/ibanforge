import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { deBlzFile, getBlz } from "@/lib/registers"
import sitemap from "../../sitemap"
import type { GermanApiCopy, GermanApiLocale } from "./copy"
import { COPY_DE } from "./copy-de"
import { COPY_EN } from "./copy-en"
import { COPY_FR } from "./copy-fr"
import {
  allocatedExample,
  ALLOCATED_IBAN,
  curlExample,
  GERMAN_API_PATH,
  germanApiCopy,
  germanApiJsonLd,
  germanApiMetadata,
  jsonLdScript,
  notAllocatedExample,
  registerFacts,
} from "./page-data"

const LOCALES: GermanApiLocale[] = ["en", "fr", "de"]
const RAW: Record<GermanApiLocale, GermanApiCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE }
const FRONTEND = process.cwd()

const url = (locale: GermanApiLocale) => `https://ibanforge.com${locale === "en" ? "" : `/${locale}`}${GERMAN_API_PATH}`

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === "object") return Object.values(value).flatMap(strings)
  return []
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
  }
  return typeof value
}

describe("la réponse arrive avant le premier titre de section", () => {
  // Sans les commentaires, qui parlent du <h2 sans en être un.
  const page = readFileSync(resolve(FRONTEND, "app/[locale]/iban-api-deutschland/page.tsx"), "utf8").replace(
    /\{?\/\*[\s\S]*?\*\/\}?/g,
    "",
  )

  it("page.tsx rend la réponse directe avant le premier <h2", () => {
    const answer = page.indexOf("{copy.hero.answer}")
    const firstH2 = page.indexOf("<h2")
    expect(answer).toBeGreaterThan(-1)
    expect(firstH2).toBeGreaterThan(answer)
    expect(page.indexOf("<h1")).toBeLessThan(answer)
  })

  it("le rendu reste côté serveur : la page n'est pas un composant client", () => {
    expect(page).not.toContain('"use client"')
    expect(page).not.toMatch(/\buseEffect\b|\buseState\b/)
  })

  it.each(LOCALES)("%s : la réponse nomme la Bundesbank, la Bankleitzahl, le BIC et not_allocated", (locale) => {
    const { answer } = RAW[locale].hero
    for (const word of ["Bundesbank", "Bankleitzahl", "BIC", "not_allocated", "{asOf}"]) expect(answer).toContain(word)
    expect(RAW[locale].hero.h1).toContain("BIC")
  })
})

describe("le cadre est allemand et européen", () => {
  it.each(LOCALES)("%s : ni le titre, ni la réponse, ni l'en-tête ne parlent de la Suisse", (locale) => {
    const { meta, hero } = RAW[locale]
    expect(strings({ meta, hero }).join(" ")).not.toMatch(/Schweiz|Swiss|Suisse/i)
  })

  it.each(LOCALES)("%s : la Suisse n'apparaît que dans la section sur l'Europe", (locale) => {
    const { europe, ...rest } = RAW[locale]
    expect(strings(rest).join(" ")).not.toMatch(/Schweiz|Swiss|Suisse/i)
    expect(strings(europe).join(" ")).toMatch(/Schweiz|Switzerland|Suisse/)
  })

  it("nomme les mêmes registres complets que l'accueil", () => {
    const messages = JSON.parse(readFileSync(resolve(FRONTEND, "messages/de.json"), "utf8"))
    const NAMES: Record<string, string> = {
      DE: "Deutschland",
      AT: "Österreich",
      BE: "Belgien",
      SK: "Slowakei",
      CZ: "Tschechien",
      BG: "Bulgarien",
      CH: "Schweiz",
      LI: "Liechtenstein",
    }
    const codes = (messages.home.coverage.registerCodes as string).split(", ")
    expect(codes.length).toBe(Object.keys(NAMES).length)
    for (const code of codes) expect(COPY_DE.europe.full).toContain(NAMES[code])
  })
})

describe("les faits viennent de l'export, jamais du texte", () => {
  it("l'édition et les comptes sont ceux du fichier", () => {
    const entries = Object.values(deBlzFile().entries)
    const facts = registerFacts()
    expect(facts.asOf).toMatch(/^\d{4}-\d{2}$/)
    expect(facts.count).toBe(entries.length)
    expect(facts.retired).toBe(entries.filter((e) => e.register.retired).length)
    expect(facts.retired).toBeGreaterThan(0)
  })

  it.each(LOCALES)("%s : aucun gabarit de faits ne reste après le remplissage, ni aucun chiffre recopié", (locale) => {
    const filled = strings(germanApiCopy(locale)).join(" ")
    expect(filled).not.toMatch(/\{(asOf|count|retired|countries|readOn)\}/)
    const raw = strings(RAW[locale]).join(" ")
    // Ni un mois d'édition ni un nombre de codes tapés à la main.
    const { count } = registerFacts()
    const thousands = String(count).slice(0, -3)
    const rest = String(count).slice(-3)
    expect(raw).not.toMatch(new RegExp(`\\b${thousands}[ .,'’\\u202f]?${rest}\\b`))
    expect(raw).toContain("{count}")
    expect(raw).toContain("{retired}")
    expect(raw).not.toMatch(/\b(?:Stand|edition|édition)\s+(?:de\s+)?(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|novembre)/)
  })

  it("la réponse à l'IBAN modèle est celle du registre", () => {
    const answer = allocatedExample()
    const entry = getBlz("37040044")
    expect(answer).not.toBeNull()
    expect(answer?.iban).toBe(ALLOCATED_IBAN)
    expect(answer?.valid).toBe(true)
    expect(answer?.bank_code_check).toEqual(entry?.api.bank_code_check)
    expect(answer?.bic).toMatchObject({ basis: "national_register", authoritative: true, source: deBlzFile().source })
    expect(curlExample()).toContain(ALLOCATED_IBAN)
  })

  it("le code non attribué est absent du registre, et l'édition lue est la bonne", () => {
    expect(getBlz("99999999")).toBeNull()
    const answer = notAllocatedExample()
    expect(answer).toMatchObject({
      valid: true,
      bic: null,
      bank_code_check: { status: "not_in_register", reason: "not_allocated", authoritative: true, as_of: registerFacts().asOf },
    })
  })

  it("aucune valeur des registres EPC n'entre dans les exemples", () => {
    const shown = JSON.stringify([allocatedExample(), notAllocatedExample()])
    expect(shown).not.toMatch(/vop_participant|vop_register_status|register_source|register_as_of/)
  })
})

describe("les textes", () => {
  it("les trois langues ont la même forme", () => {
    expect(shape(COPY_FR)).toEqual(shape(COPY_DE))
    expect(shape(COPY_EN)).toEqual(shape(COPY_DE))
  })

  it.each(LOCALES)("%s : sans tiret long, sans chiffre d'essai, sans promesse de conformité", (locale) => {
    const text = strings(RAW[locale]).join("\n")
    expect(text).not.toContain("—")
    expect(text).not.toMatch(/\b25\b/)
    expect(text).not.toMatch(/konform|compliant|conforme/i)
  })

  it.each(LOCALES)("%s : le crédit exact de la Bundesbank et la date de la vérification du bénéficiaire", (locale) => {
    expect(RAW[locale].bundesbank.credit).toContain("Quelle: Deutsche Bundesbank")
    expect(RAW[locale].vop.duty.body).toMatch(/9\. Oktober 2025|9 October 2025|9 octobre 2025/)
    expect(RAW[locale].vop.what.body).toContain("2024/886")
    expect(RAW[locale].vop.sources.map((s) => s.read)).toEqual(["authorities", "authorities", "authorities", "regulation"])
  })

  it("aucune date d'application hors zone euro n'est annoncée", () => {
    for (const copy of Object.values(RAW)) expect(strings(copy.vop).join(" ")).not.toMatch(/2027/)
  })
})

describe("métadonnées, sitemap, données structurées", () => {
  it.each(LOCALES)("%s : titre et description à la bonne longueur, canonique et hreflang", (locale) => {
    const meta = germanApiMetadata(locale)
    const title = String(meta.title)
    expect(title).toContain("Bundesbank")
    expect(title).not.toContain("IBANforge")
    expect(title.length).toBeLessThanOrEqual(62)
    const description = String(meta.description)
    expect(description.length).toBeGreaterThan(80)
    expect(description.length).toBeLessThanOrEqual(170)
    expect(meta.alternates?.canonical).toBe(url(locale))
    expect(meta.alternates?.languages).toEqual({ en: url("en"), fr: url("fr"), de: url("de"), "x-default": url("en") })
  })

  it("figure au sitemap dans les trois langues", () => {
    const urls = sitemap().map((entry) => entry.url)
    for (const locale of LOCALES) expect(urls).toContain(url(locale))
  })

  it.each(LOCALES)("%s : une page web et son fil d'Ariane, rien sur un autre fournisseur", (locale) => {
    const script = jsonLdScript(germanApiJsonLd(locale))
    expect(script).not.toContain("<")
    const graph = JSON.parse(script)["@graph"] as Array<Record<string, unknown>>
    expect(graph.map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList"])
    expect(graph[0].inLanguage).toBe(locale)
  })
})
