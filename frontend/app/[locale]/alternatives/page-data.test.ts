import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import catalogue from "@/data/onboarding.json"
import en from "@/messages/en.json"
import { formatDayWords } from "@/lib/date-words"
import { ENDPOINTS, PRO_MONTHLY_PRICE, PRO_MONTHLY_UNITS } from "@/lib/pricing-estimate"
import sitemap from "../../sitemap"
import type { AlternativesCopy, AlternativesLocale } from "./copy"
import { COPY_DE } from "./copy-de"
import { COPY_EN } from "./copy-en"
import { COPY_FR } from "./copy-fr"
import {
  ALTERNATIVES_PATH,
  alternativesCopy,
  alternativesJsonLd,
  indexMetadata,
  jsonLdScript,
  vendorMetadata,
  vendorPath,
} from "./page-data"
import { READ_ON, VENDORS, VENDOR_SLUGS, type VendorSlug } from "./vendors"

const LOCALES: AlternativesLocale[] = ["en", "fr", "de"]
const RAW: Record<AlternativesLocale, AlternativesCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE }
const FRONTEND = process.cwd()
const REPO = resolve(FRONTEND, "..")

const url = (locale: AlternativesLocale, path: string) =>
  `https://ibanforge.com${locale === "en" ? "" : `/${locale}`}${path}`

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === "object") return Object.values(value).flatMap(strings)
  return []
}

/** The word each language puts next to a provider's name in a search. */
const ALTERNATIVE: Record<AlternativesLocale, RegExp> = {
  en: /alternative/i,
  fr: /Alternative/,
  de: /Alternative/,
}

describe("les pages « alternative » : métadonnées", () => {
  for (const locale of LOCALES) {
    it.each(VENDOR_SLUGS)(`${locale} : %s porte le nom du fournisseur et le mot cherché`, (slug) => {
      const meta = vendorMetadata(locale, slug)
      const title = String(meta.title)
      expect(title).toContain(VENDORS[slug].name)
      expect(title).toMatch(ALTERNATIVE[locale])
      expect(title).not.toContain("IBANforge")
      expect(title.length).toBeLessThanOrEqual(62)
      const description = String(meta.description)
      expect(description).toContain(VENDORS[slug].name)
      expect(description.length).toBeLessThanOrEqual(170)
      expect(description.length).toBeGreaterThan(80)
      expect(meta.alternates?.canonical).toBe(url(locale, vendorPath(slug)))
      expect(meta.alternates?.languages).toEqual({
        en: url("en", vendorPath(slug)),
        fr: url("fr", vendorPath(slug)),
        de: url("de", vendorPath(slug)),
        "x-default": url("en", vendorPath(slug)),
      })
      const og = meta.openGraph as { url?: string; locale?: string; images?: Array<{ url: string }> }
      expect(og.url).toBe(url(locale, vendorPath(slug)))
      expect(og.locale).toBe({ en: "en_US", fr: "fr_FR", de: "de_DE" }[locale])
      expect(og.images?.[0]?.url).toMatch(/^https:\/\/ibanforge\.com\/.*og\?v=/)
    })
  }

  it.each(LOCALES)("%s : l'index, sa canonical et son hreflang", (locale) => {
    const meta = indexMetadata(locale)
    expect(meta.alternates?.canonical).toBe(url(locale, ALTERNATIVES_PATH))
    expect(Object.keys(meta.alternates?.languages ?? {})).toEqual(["en", "fr", "de", "x-default"])
    for (const slug of VENDOR_SLUGS) expect(String(meta.title)).toContain(VENDORS[slug].name)
  })

  it("le plan du site liste l'index et chaque page, dans les trois langues", () => {
    const urls = sitemap().map((e) => e.url)
    for (const locale of LOCALES) {
      expect(urls).toContain(url(locale, ALTERNATIVES_PATH))
      for (const slug of VENDOR_SLUGS) expect(urls).toContain(url(locale, vendorPath(slug)))
    }
  })
})

describe("les données structurées ne notent jamais un concurrent", () => {
  it.each(LOCALES)("%s : une WebPage et son fil d'Ariane, rien d'autre", (locale) => {
    for (const slug of [...VENDOR_SLUGS, null] as Array<VendorSlug | null>) {
      const script = jsonLdScript(alternativesJsonLd(locale, slug))
      expect(script).not.toContain("<")
      expect(script).not.toMatch(/Product|Review|Rating|Offer/)
      const ld = JSON.parse(script) as { "@graph": Array<Record<string, unknown>> }
      expect(ld["@graph"].map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList"])
    }
  })
})

describe("les faits sur les fournisseurs", () => {
  it("sont datés du jour de la relecture que /compare cite aussi", () => {
    expect(READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(en.compare.footnote).toContain(formatDayWords(READ_ON, "en"))
    for (const locale of LOCALES) {
      const copy = alternativesCopy(locale)
      expect(copy.labels.readOn).toContain(formatDayWords(READ_ON, locale))
      expect(copy.labels.sources).toContain(formatDayWords(READ_ON, locale))
    }
  })

  it("renvoient chacun à ses sources publiques, en https", () => {
    for (const slug of VENDOR_SLUGS) {
      expect(VENDORS[slug].sources.length).toBeGreaterThan(0)
      for (const s of VENDORS[slug].sources) expect(s.url).toMatch(/^https:\/\//)
    }
  })

  it("n'affirment jamais une absence chez un autre (une page muette ne prouve rien)", () => {
    const absence =
      /\b(lacks?|does not (offer|support|have|provide)|doesn't|no MCP|without MCP|n'a pas|ne propose pas|ne fournit pas|bietet kein|hat kein|fehlt)\b/i
    for (const locale of LOCALES) {
      for (const slug of VENDOR_SLUGS) {
        const v = RAW[locale].vendors[slug]
        const found = [...v.strengths, ...v.prices, v.summary, v.lead].filter((s) => absence.test(s))
        expect(found, `${locale} ${slug}`).toEqual([])
      }
    }
  })

  it("gardent la même forme dans les trois langues", () => {
    const shape = (c: AlternativesCopy) =>
      VENDOR_SLUGS.map((slug) => ({
        slug,
        strengths: c.vendors[slug].strengths.length,
        prices: c.vendors[slug].prices.length,
        betterFor: c.vendors[slug].betterFor.length,
        note: Boolean(c.vendors[slug].note),
        // Every figure of a price list appears in each language.
        figures: c.vendors[slug].prices.map((p) => (p.match(/\d+/g) ?? []).join("").length),
      }))
    expect(shape(COPY_FR)).toEqual(shape(COPY_EN))
    expect(shape(COPY_DE)).toEqual(shape(COPY_EN))
  })
})

describe("les prix d'IBANforge suivent ceux que l'API applique", () => {
  const group = (n: number, locale: AlternativesLocale) =>
    String(n).replace(/\B(?=(\d{3})+(?!\d))/g, { en: ",", fr: " ", de: "." }[locale])
  const usd = (amount: string, locale: AlternativesLocale) =>
    locale === "en" ? `$${amount}` : `${amount.replace(".", ",")} $`

  it.each(LOCALES)("%s : Pro, les packs et x402", (locale) => {
    const [pro, packs, x402] = RAW[locale].ours.paid
    expect(pro).toContain(usd(String(PRO_MONTHLY_PRICE), locale))
    expect(pro).toContain(group(PRO_MONTHLY_UNITS, locale))
    const links = readFileSync(resolve(REPO, "src/lib/payment-links.ts"), "utf8")
    const offers = [...links.matchAll(/\{ slug: '(\w+)', credits: (\d+), priceUsd: (\d+) \}/g)]
    expect(offers.length).toBe(3)
    for (const [, , credits, price] of offers) {
      expect(packs).toContain(group(Number(credits), locale))
      expect(packs).toContain(usd(price, locale))
    }
    const cost = (key: string) => ENDPOINTS.find((e) => e.key === key)!.cost
    expect(x402).toContain(usd(String(cost("validate")), locale))
    expect(x402).toContain(usd(String(cost("batch")), locale))
  })

  it.each(LOCALES)("%s : les portes gratuites, une phrase chacune", (locale) => {
    const [trial, key] = RAW[locale].ours.free
    expect(trial).toContain(`${catalogue.restTrialWeekly} `)
    expect(key).toContain(`${catalogue.claimedMonthly} `)
    // The trial's figure and the key's never share a sentence.
    expect(key).not.toMatch(new RegExp(`(?<![\\d.,])${catalogue.restTrialWeekly}(?![\\d.,])`))
    const trialLine = RAW[locale].ours.items.find((s) => s.includes("POST /v1/iban/validate"))
    expect(trialLine).toContain(`${catalogue.restTrialWeekly} `)
  })

  it.each(LOCALES)("%s : les calculs reprennent les prix des packs", (locale) => {
    const v = RAW[locale].vendors
    expect(v.ibanapi.calculation).toContain(usd("8", locale))
    expect(v["iban-com"].calculation).toContain(usd("8", locale))
    expect(v.abstractapi.calculation).toContain(usd("20", locale))
  })
})

describe("les liens", () => {
  it.each(["compare", "iban-validation-api", "playground", "pricing", "alternatives", "alternatives/[vendor]"])(
    "la page %s existe",
    (route) => {
      expect(existsSync(resolve(FRONTEND, `app/[locale]/${route}/page.tsx`))).toBe(true)
    },
  )

  it("aucun gabarit ne reste non rempli, hors {name} que la page remplit", () => {
    for (const locale of LOCALES) {
      const left = strings(alternativesCopy(locale)).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
      expect(new Set(left), locale).toEqual(new Set(["name"]))
    }
  })

  it("s'écrivent sans tiret long", () => {
    for (const locale of LOCALES) expect(strings(RAW[locale]).filter((s) => s.includes("—")), locale).toEqual([])
  })
})
