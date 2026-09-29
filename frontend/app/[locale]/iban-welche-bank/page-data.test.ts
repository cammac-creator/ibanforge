import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { readBankCode } from "@/lib/iban-bank-finder"
import { chIidFile, deBlzFile } from "@/lib/registers"
import sitemap from "../../sitemap"
import type { WelcheBankCopy, WelcheBankLocale } from "./copy"
import { COPY_DE } from "./copy-de"
import { COPY_EN } from "./copy-en"
import { COPY_FR } from "./copy-fr"
import {
  CODE_ARTICLE_PATH,
  finderRegisters,
  jsonLdScript,
  registerEditions,
  welcheBankCopy,
  welcheBankJsonLd,
  welcheBankMetadata,
} from "./page-data"

const LOCALES: WelcheBankLocale[] = ["en", "fr", "de"]
const RAW: Record<WelcheBankLocale, WelcheBankCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE }

/** The question each reader types, which the H1 is and the title carries. */
const QUESTION: Record<WelcheBankLocale, string> = {
  de: "Welche Bank gehört zu dieser IBAN?",
  en: "Which bank does this IBAN belong to?",
  fr: "À quelle banque appartient cet IBAN ?",
}

const CANONICAL: Record<WelcheBankLocale, string> = {
  en: "https://ibanforge.com/iban-welche-bank",
  fr: "https://ibanforge.com/fr/iban-welche-bank",
  de: "https://ibanforge.com/de/iban-welche-bank",
}

const FRONTEND = process.cwd()
const HERE = resolve(FRONTEND, "app/[locale]/iban-welche-bank")

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === "object") return Object.values(value).flatMap(strings)
  return []
}

describe("« Welche Bank gehört zu dieser IBAN ? » : métadonnées dans les trois langues", () => {
  it.each(LOCALES)("%s : le H1 est la question, le titre la porte, la description dit le piège", (locale) => {
    const meta = welcheBankMetadata(locale)
    const copy = welcheBankCopy(locale)
    expect(copy.hero.h1).toBe(QUESTION[locale])
    expect(String(meta.title)).toContain(QUESTION[locale])
    expect(String(meta.title)).not.toContain("IBANforge")
    expect(String(meta.description)).toContain("DE")
    expect(String(meta.description).length).toBeLessThanOrEqual(170)
    expect(String(meta.description).length).toBeGreaterThan(80)
  })

  it.each(LOCALES)("%s : canonical sur sa propre adresse, et le jeu hreflang complet", (locale) => {
    const meta = welcheBankMetadata(locale)
    expect(meta.alternates?.canonical).toBe(CANONICAL[locale])
    expect(meta.alternates?.languages).toEqual({
      en: CANONICAL.en,
      fr: CANONICAL.fr,
      de: CANONICAL.de,
      "x-default": CANONICAL.en,
    })
    const og = meta.openGraph as { url?: string; images?: Array<{ url: string }>; locale?: string }
    expect(og.url).toBe(CANONICAL[locale])
    expect(og.images?.[0]?.url).toMatch(/^https:\/\/ibanforge\.com\/.*og\?v=/)
    expect(og.locale).toBe({ en: "en_US", fr: "fr_FR", de: "de_DE" }[locale])
  })

  it.each(LOCALES)("%s : un JSON-LD valide, une WebPage et son fil d'Ariane", (locale) => {
    const script = jsonLdScript(welcheBankJsonLd(locale))
    expect(script).not.toContain("<")
    const ld = JSON.parse(script) as { "@graph": Array<Record<string, unknown>> }
    expect(ld["@graph"].map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList"])
    expect(ld["@graph"][0].url).toBe(CANONICAL[locale])
    expect(ld["@graph"][0].headline).toBe(QUESTION[locale])
  })

  it("le plan du site la liste dans les trois langues", () => {
    const urls = sitemap().map((e) => e.url)
    for (const locale of LOCALES) expect(urls).toContain(CANONICAL[locale])
  })
})

describe("les listes passées au navigateur", () => {
  const registers = finderRegisters()

  it("portent chaque Bankleitzahl et chaque IID des exports, et rien d'autre que des chiffres", () => {
    const de = deBlzFile()
    const ch = chIidFile()
    expect(registers.deCodes.length).toBe(Object.keys(de.entries).length * 8)
    expect(registers.chCodes.length).toBe(Object.keys(ch.entries).length * 5)
    expect(registers.deCodes).toMatch(/^\d+$/)
    expect(registers.chCodes).toMatch(/^\d+$/)
    const retired = Object.values(de.entries).filter((e) => e.register.retired)
    expect(Object.keys(registers.deRetired).length).toBe(retired.length)
    for (const e of retired) expect(registers.deRetired[e.register.blz]).toBe(e.register.successor_blz)
  })

  it("restent légères : des codes seulement, sans nom ni ville", () => {
    const size = JSON.stringify(registers).length
    expect(size).toBeLessThan(60_000)
    const retiredValues = Object.entries(registers.deRetired).flat().filter((v): v is string => v !== null)
    for (const v of retiredValues) expect(v).toMatch(/^\d{8}$/)
    expect(Object.keys(registers).sort()).toEqual(["chCodes", "deCodes", "deRetired"])
  })

  it("répondent comme l'API sur les exemples connus", () => {
    expect(readBankCode("DE89 3704 0044 0532 0130 00", registers)).toMatchObject({
      status: "allocated",
      path: "/blz/37040044",
      checksum: "pass",
    })
    // The API answers not_allocated for this code (the 07.09 article prints it).
    expect(readBankCode("DE37 9999 9999 0123 4567 89", registers)).toMatchObject({ status: "not-in-register", path: null })
    expect(readBankCode("DE84100601980123456789", registers)).toMatchObject({ status: "retired", successor: "37060193" })
    // The official Swiss example: mod 97 passes, the SIX BankMaster allocates the IID to no one.
    expect(readBankCode("CH9300762011623852957", registers)).toMatchObject({ status: "not-in-register", checksum: "pass" })
    expect(readBankCode(chIidFile().entries["30000"].example_iban, registers)).toMatchObject({ status: "allocated", path: "/iid/30000" })
  })

  it("donnent les éditions des deux registres", () => {
    const { de, ch } = registerEditions()
    expect(de).toMatch(/^\d{4}-\d{2}$/)
    expect(ch).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("le composant du navigateur n'envoie rien", () => {
  const source = readFileSync(resolve(HERE, "finder.tsx"), "utf8")
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  it("est un composant client sans appel réseau, sans formulaire, sans balise d'événement", () => {
    expect(source.startsWith('"use client"')).toBe(true)
    for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "<form", "data-evt", "name=", "action="]) {
      expect(code, forbidden).not.toContain(forbidden)
    }
  })

  it("ne précharge aucune page de code : chaque lien porte prefetch={false}", () => {
    const links = code.match(/<Link\b[\s\S]*?>/g) ?? []
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toContain("prefetch={false}")
  })

  it("ne formate rien avec Intl et n'importe aucun module qui lit le disque", () => {
    expect(code).not.toMatch(/\bIntl\b|toLocale/)
    expect(code).not.toContain("@/lib/registers")
    expect(code).not.toContain("./page-data")
  })
})

describe("les pages vers lesquelles le champ mène existent", () => {
  it.each(["blz/[blz]", "at/[code]", "iid/[iid]", "playground", "iban-validation-api"])("%s", (route) => {
    expect(existsSync(resolve(FRONTEND, `app/[locale]/${route}/page.tsx`))).toBe(true)
  })

  it.each(LOCALES)("%s : l'article de code existe", (locale) => {
    const slug = CODE_ARTICLE_PATH.replace("/blog/", "")
    expect(existsSync(resolve(FRONTEND, `content/${locale}/blog/${slug}.mdx`))).toBe(true)
  })
})

describe("les trois langues", () => {
  it("ont la même forme", () => {
    const shape = (c: WelcheBankCopy) => ({
      trap: c.trap.paragraphs.length,
      rows: c.countries.rows.map((r) => r.cc),
      yes: c.tells.yes.length,
      no: c.tells.no.length,
      keys: Object.keys(c.finder.partialBody),
    })
    expect(shape(COPY_FR)).toEqual(shape(COPY_EN))
    expect(shape(COPY_DE)).toEqual(shape(COPY_EN))
  })

  it("utilisent les mêmes gabarits dans chaque phrase", () => {
    const placeholders = (c: WelcheBankCopy) =>
      strings(c.finder).map((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(","))
    expect(placeholders(COPY_FR)).toEqual(placeholders(COPY_EN))
    expect(placeholders(COPY_DE)).toEqual(placeholders(COPY_EN))
  })

  it("s'écrivent sans tiret long", () => {
    for (const locale of LOCALES) expect(strings(RAW[locale]).filter((s) => s.includes("—")), locale).toEqual([])
  })
})
