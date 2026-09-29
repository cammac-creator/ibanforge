import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import catalogue from "@/data/onboarding.json"
import { countriesFile } from "@/lib/countries"
import { SAMPLE_IBAN } from "@/lib/first-call"
import { doorForPath, originForSignup } from "@/lib/key-origin"
import { ENDPOINTS, PRO_MONTHLY_PRICE, PRO_MONTHLY_UNITS } from "@/lib/pricing-estimate"
import { urlFor } from "@/lib/seo"
import sitemap from "../../sitemap"
import captured from "../playground/captured-iban.json"
import type { ApiPageCopy, ApiPageLocale } from "./copy"
import { COPY_DE } from "./copy-de"
import { COPY_EN } from "./copy-en"
import { COPY_FR } from "./copy-fr"
import {
  API_PAGE_PATH,
  SOFTWARE_NODE_ID,
  apiPageCopy,
  apiPageJsonLd,
  apiPageMetadata,
  firstCallSnippets,
  formatDay,
  jsonLdScript,
  sampleAnswer,
  unallocatedExample,
} from "./page-data"

const LOCALES: ApiPageLocale[] = ["en", "fr", "de"]
const RAW: Record<ApiPageLocale, ApiPageCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE }

/** The query each language's reader types, which the title, the H1 and the description carry. */
const QUERY: Record<ApiPageLocale, string> = {
  en: "IBAN validation API",
  fr: "API de validation IBAN",
  de: "IBAN prüfen per API",
}

const CANONICAL: Record<ApiPageLocale, string> = {
  en: "https://ibanforge.com/iban-validation-api",
  fr: "https://ibanforge.com/fr/iban-validation-api",
  de: "https://ibanforge.com/de/iban-validation-api",
}

const FRONTEND = process.cwd()
const REPO = resolve(FRONTEND, "..")

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === "object") return Object.values(value).flatMap(strings)
  return []
}

describe("la page « API de validation IBAN » : métadonnées dans les trois langues", () => {
  it.each(LOCALES)("%s : titre, H1 et description portent la requête de la langue", (locale) => {
    const meta = apiPageMetadata(locale)
    const copy = apiPageCopy(locale)
    expect(String(meta.title)).toContain(QUERY[locale])
    expect(copy.hero.h1).toBe(QUERY[locale])
    expect(String(meta.description)).toContain(QUERY[locale])
    // The layout's template appends " | IBANforge": the page never writes the brand twice.
    expect(String(meta.title)).not.toContain("IBANforge")
    // A snippet longer than this is cut by the result page.
    expect(String(meta.description).length).toBeLessThanOrEqual(170)
    expect(String(meta.description).length).toBeGreaterThan(80)
  })

  it.each(LOCALES)("%s : canonical sur sa propre adresse, et le jeu hreflang complet", (locale) => {
    const meta = apiPageMetadata(locale)
    expect(meta.alternates?.canonical).toBe(CANONICAL[locale])
    expect(meta.alternates?.languages).toEqual({
      en: CANONICAL.en,
      fr: CANONICAL.fr,
      de: CANONICAL.de,
      "x-default": CANONICAL.en,
    })
  })

  it.each(LOCALES)("%s : la carte de partage nomme l'adresse et l'image de la page", (locale) => {
    const meta = apiPageMetadata(locale)
    const og = meta.openGraph as { url?: string; images?: Array<{ url: string }>; locale?: string; title?: string }
    expect(og.url).toBe(CANONICAL[locale])
    expect(og.images?.[0]?.url).toMatch(/^https:\/\/ibanforge\.com\/.*og\?v=/)
    expect(og.locale).toBe({ en: "en_US", fr: "fr_FR", de: "de_DE" }[locale])
    expect(og.title).toContain(QUERY[locale])
    const tw = meta.twitter as { card?: string; images?: string[] }
    expect(tw.card).toBe("summary_large_image")
    expect(tw.images?.[0]).toBe(og.images?.[0]?.url)
  })
})

describe("le plan du site", () => {
  it("liste la page dans les trois langues, à son adresse canonique", () => {
    const urls = sitemap().map((entry) => entry.url)
    for (const locale of LOCALES) {
      expect(urls).toContain(CANONICAL[locale])
      expect(urlFor(locale, API_PAGE_PATH)).toBe(CANONICAL[locale])
    }
  })
})

describe("les données structurées", () => {
  it.each(LOCALES)("%s : un JSON-LD valide, une WebPage et son fil d'Ariane", (locale) => {
    const script = jsonLdScript(apiPageJsonLd(locale))
    expect(script).not.toContain("<")
    const ld = JSON.parse(script) as { "@context": string; "@graph": Array<Record<string, unknown>> }
    expect(ld["@context"]).toBe("https://schema.org")
    const types = ld["@graph"].map((node) => node["@type"])
    expect(types).toEqual(["WebPage", "BreadcrumbList"])
    const page = ld["@graph"][0]
    expect(page.url).toBe(CANONICAL[locale])
    expect(page.inLanguage).toBe(locale)
    expect(page.name).toContain(QUERY[locale])
    expect(page.mainEntity).toEqual({ "@id": SOFTWARE_NODE_ID })
    const crumbs = ld["@graph"][1].itemListElement as Array<{ position: number; item: string }>
    expect(crumbs.map((c) => c.position)).toEqual([1, 2])
    expect(crumbs[1].item).toBe(CANONICAL[locale])
  })

  it("pointe vers le produit que la mise en page émet déjà, avec son offre gratuite", () => {
    // The product, its offers and the free key live in ONE node, emitted by
    // the locale layout on every page; this page references it by @id.
    const layoutLd = readFileSync(resolve(FRONTEND, "components/json-ld.tsx"), "utf8")
    expect(layoutLd).toContain(`'@id': '${SOFTWARE_NODE_ID}'`)
    expect(layoutLd).toContain("name: 'Free API key'")
    expect(layoutLd).toContain("price: '0'")
    for (const locale of LOCALES) {
      expect(JSON.stringify(apiPageJsonLd(locale))).not.toContain("WebAPI")
    }
  })
})

describe("le bouton de clé", () => {
  it("ouvre la fenêtre habituelle, et la clé naît sous la porte de la page", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8")
    expect(page).toContain('from "@/components/api-key-dialog"')
    expect(page).toContain("<GetKeyButton")
    for (const path of ["/iban-validation-api", "/fr/iban-validation-api", "/de/iban-validation-api"]) {
      expect(doorForPath(path)).toBe("site-api-page")
      expect(originForSignup(undefined, path)).toBe("site-api-page")
    }
    // A campaign tag still outranks the door, as everywhere else on the site.
    expect(originForSignup("npm-mcp", "/iban-validation-api")).toBe("npm-mcp")
  })

  it("n'envoie que des noms d'événement que l'API accepte", () => {
    // src/lib/web-events.ts drops any other shape in silence.
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8")
    const names = [...page.matchAll(/(?:data-)?evt="([^"]+)"/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(name).toMatch(/^(nav|cta|film):[a-z0-9][a-z0-9-]{0,31}$/)
  })
})

describe("les chiffres écrits à la main suivent ceux que l'API applique", () => {
  it("le catalogue exporté est celui des constantes de l'API", () => {
    const trial = readFileSync(resolve(REPO, "src/lib/trial.ts"), "utf8")
    const tiers = readFileSync(resolve(REPO, "src/lib/tiers.ts"), "utf8")
    expect(trial).toContain(`REST_TRIAL_WEEKLY_LIMIT = ${catalogue.restTrialWeekly};`)
    expect(tiers).toContain(`ANONYMOUS_MONTHLY_LIMIT = ${catalogue.anonymousMonthly};`)
    expect(tiers).toContain(`FREE_TIER_MONTHLY_LIMIT = ${catalogue.claimedMonthly};`)
  })

  it.each(LOCALES)("%s : les trois portes gratuites", (locale) => {
    const doors = RAW[locale].doors
    expect(doors.trial.body.startsWith(`${catalogue.restTrialWeekly} `)).toBe(true)
    expect(RAW[locale].firstCall.trial).toContain(` ${catalogue.restTrialWeekly} `)
    expect(doors.anonymous.body.startsWith(`${catalogue.anonymousMonthly} `)).toBe(true)
    expect(doors.claimed.title.startsWith(`${catalogue.claimedMonthly} `)).toBe(true)
  })

  const group = (n: number, locale: ApiPageLocale) =>
    String(n).replace(/\B(?=(\d{3})+(?!\d))/g, { en: ",", fr: " ", de: "." }[locale])
  const usd = (amount: string, locale: ApiPageLocale) =>
    locale === "en" ? `$${amount}` : `${amount.replace(".", ",")} $`

  it.each(LOCALES)("%s : Pro, les packs et x402, aux prix du code", (locale) => {
    const [pro, packs, x402] = RAW[locale].doors.paid
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
})

describe("ce que la page imprime vient de l'API", () => {
  it("l'exemple est l'IBAN du bac à sable, et sa réponse capturée", () => {
    expect(captured.response.iban).toBe(SAMPLE_IBAN)
    const answer = sampleAnswer()
    expect(answer.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const extract = JSON.parse(answer.json) as Record<string, Record<string, unknown>>
    const full = captured.response as unknown as Record<string, Record<string, unknown>>
    // Whole fields may be left out; no value is ever changed.
    for (const [field, value] of Object.entries(extract)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value)) expect(full[field][k], `${field}.${k}`).toEqual(v)
      } else {
        expect(full[field], field).toEqual(value)
      }
    }
    expect(extract.bank_code_check.authoritative).toBe(true)
    expect(extract.bic.as_of).toBeTruthy()
  })

  it("l'exemple suisse officiel passe le modulo 97 et son code n'est attribué à personne", () => {
    const example = unallocatedExample()
    expect(example).not.toBeNull()
    const extract = JSON.parse(example!.json) as { valid: boolean; bank_code_check: { reason: string; authoritative: boolean } }
    expect(extract.valid).toBe(true)
    expect(extract.bank_code_check.reason).toBe("not_allocated")
    expect(extract.bank_code_check.authoritative).toBe(true)
    for (const locale of LOCALES) expect(RAW[locale].mod97.body).toContain(example!.iban.replace(/(.{4})/g, "$1 ").trim())
  })

  it("le premier appel est le même dans les trois langages, sans clé", () => {
    const snippets = firstCallSnippets()
    expect(snippets.map((s) => s.key)).toEqual(["curl", "javascript", "python"])
    for (const s of snippets) {
      expect(s.code).toContain("https://api.ibanforge.com/v1/iban/validate")
      expect(s.code).toContain(SAMPLE_IBAN)
      expect(s.code).toMatch(/POST|post/)
      expect(s.code).not.toContain("Authorization")
    }
  })

  it("le nombre de pays est celui de l'export, jamais écrit à la main", () => {
    const count = String(countriesFile().count)
    for (const locale of LOCALES) {
      const all = strings(apiPageCopy(locale))
      expect(all.join("\n")).not.toContain("{countries}")
      expect(apiPageCopy(locale).hero.facts[0].startsWith(count)).toBe(true)
      expect(strings(RAW[locale]).join("\n")).not.toMatch(/\b89\b/)
    }
  })
})

describe("les trois langues", () => {
  it("ont la même forme et les mêmes liens, dans le même ordre", () => {
    const shape = (c: ApiPageCopy) => ({
      checks: c.checks.items.map((i) => i.field),
      notDo: c.notDo.items.length,
      facts: c.hero.facts.length,
      paid: c.doors.paid.length,
      links: c.tools.links.map((l) => l.href),
    })
    expect(shape(COPY_FR)).toEqual(shape(COPY_EN))
    expect(shape(COPY_DE)).toEqual(shape(COPY_EN))
  })

  it("ne mènent qu'à des pages qui existent", () => {
    for (const locale of LOCALES) {
      for (const { href } of RAW[locale].tools.links) {
        if (/^https?:/.test(href)) continue
        const doc = /^\/docs\/(.+)$/.exec(href)
        if (doc) {
          expect(existsSync(resolve(FRONTEND, `content/${locale}/docs/${doc[1]}.mdx`)), `${locale} ${href}`).toBe(true)
        } else {
          expect(existsSync(resolve(FRONTEND, `app/[locale]${href}/page.tsx`)), href).toBe(true)
        }
      }
    }
  })

  it("s'écrivent sans tiret long", () => {
    for (const locale of LOCALES) {
      const found = strings(RAW[locale]).filter((s) => s.includes("—"))
      expect(found, locale).toEqual([])
    }
  })

  it("écrivent la date comme un lecteur de la langue", () => {
    expect(formatDay("2026-09-25", "en")).toBe("25 September 2026")
    expect(formatDay("2026-09-25", "fr")).toBe("25 septembre 2026")
    expect(formatDay("2026-09-25", "de")).toBe("25. September 2026")
    expect(formatDay("not a date", "fr")).toBe("not a date")
  })
})
