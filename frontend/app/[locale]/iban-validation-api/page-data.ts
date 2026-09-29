import type { Metadata } from "next"
import captured from "../playground/captured-iban.json"
import { countriesFile } from "@/lib/countries"
import { SAMPLE_IBAN, firstCallUrl } from "@/lib/first-call"
import { alternatesFor, ogImageFor, SITE_URL, urlFor } from "@/lib/seo"
import type { ApiPageCopy, ApiPageLocale } from "./copy"
import { COPY_DE } from "./copy-de"
import { COPY_EN } from "./copy-en"
import { COPY_FR } from "./copy-fr"

/**
 * Everything the IBAN validation API page shows that is not prose: its path,
 * its metadata and structured data, the first call in three languages, and the
 * two answers of the API it prints.
 *
 * Pure on purpose (no request context, no `getTranslations`), so that the
 * metadata of the three languages and the JSON-LD are tested as values rather
 * than read back from the source.
 *
 * Nothing printed here is written by hand: the example answer is the one the
 * playground captured from the API (`playground/captured-iban.json`, with its
 * date), the Swiss "check digits pass, bank code allocated to no one" answer
 * is the one `npm run pages:export-countries` recorded in `data/countries.json`,
 * and the number of IBAN countries is that export's count.
 */

export const API_PAGE_PATH = "/iban-validation-api"
export const API_BASE_URL = "https://api.ibanforge.com"

/** The `@id` of the product node the locale layout emits (components/json-ld.tsx). */
export const SOFTWARE_NODE_ID = "https://ibanforge.com/#software"

const COPIES: Record<ApiPageLocale, ApiPageCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE }

export function isApiPageLocale(locale: string): locale is ApiPageLocale {
  return locale === "en" || locale === "fr" || locale === "de"
}

/** The copy of a locale, the placeholders filled. English for an unknown locale. */
export function apiPageCopy(locale: string): ApiPageCopy {
  const copy = COPIES[isApiPageLocale(locale) ? locale : "en"]
  return fillCountries(copy, String(ibanCountryCount()))
}

function fillCountries<T>(value: T, count: string): T {
  if (typeof value === "string") return value.replaceAll("{countries}", count) as T
  if (Array.isArray(value)) return value.map((v) => fillCountries(v, count)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fillCountries(v, count)]),
    ) as T
  }
  return value
}

/** How many IBAN countries the last export read (ISO 13616 registry). */
export function ibanCountryCount(): number {
  return countriesFile().count
}

// ─── Dates, written out without Intl ──────────────────────────────────────────

const MONTHS: Record<ApiPageLocale, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
}

/**
 * `2026-09-25` as a reader of the locale writes it. Hand-rolled rather than
 * `toLocaleDateString`: the same string on every runtime, and this helper
 * stays safe to call from a client component should the page ever need it
 * (rule 8 of AGENTS.md).
 */
export function formatDay(isoDay: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay)
  if (!m) return isoDay
  const [, y, mo, d] = m
  const day = Number(d)
  const month = MONTHS[isApiPageLocale(locale) ? locale : "en"][Number(mo) - 1]
  if (!month) return isoDay
  if (locale === "de") return `${day}. ${month} ${y}`
  return `${day} ${month} ${y}`
}

// ─── The first call ───────────────────────────────────────────────────────────

export type SnippetKey = "curl" | "javascript" | "python"

export interface Snippet {
  key: SnippetKey
  label: string
  language: string
  code: string
}

/**
 * The keyless call, in the three shapes a developer pastes. No key and no
 * header beyond the content type: the keyless trial serves this route in full,
 * and a snippet that asked for a key first would hide the one door that needs
 * nothing. The key comes after, in one sentence of the page.
 */
export function firstCallSnippets(iban: string = SAMPLE_IBAN): Snippet[] {
  const url = firstCallUrl(API_BASE_URL)
  return [
    {
      key: "curl",
      label: "curl",
      language: "bash",
      code:
        `curl -X POST ${url} \\\n` +
        `  -H "Content-Type: application/json" \\\n` +
        `  -d '{"iban":"${iban}"}'`,
    },
    {
      key: "javascript",
      label: "JavaScript",
      language: "javascript",
      code:
        `const res = await fetch("${url}", {\n` +
        `  method: "POST",\n` +
        `  headers: { "Content-Type": "application/json" },\n` +
        `  body: JSON.stringify({ iban: "${iban}" }),\n` +
        `});\n` +
        `const answer = await res.json();\n` +
        `console.log(answer.valid, answer.bank_code_check?.status, answer.bic?.code);`,
    },
    {
      key: "python",
      label: "Python",
      language: "python",
      code:
        `import requests\n\n` +
        `r = requests.post(\n` +
        `    "${url}",\n` +
        `    json={"iban": "${iban}"},\n` +
        `    timeout=10,\n` +
        `)\n` +
        `answer = r.json()\n` +
        `print(answer["valid"], answer["bank_code_check"]["status"])`,
    },
  ]
}

// ─── The answers the page prints ──────────────────────────────────────────────

function pick(source: unknown, keys: string[]): Record<string, unknown> {
  const o = source && typeof source === "object" ? (source as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in o) out[k] = o[k]
  return out
}

/**
 * The example answer, cut to the fields that say what was checked and against
 * which register. Every value is the API's own; only whole fields are left out.
 */
export function sampleAnswer(): { iban: string; capturedAt: string; json: string } {
  const r = captured.response as Record<string, unknown>
  const extract = {
    iban: r.iban,
    valid: r.valid,
    checks: r.checks,
    country: r.country,
    bic: pick(r.bic, ["code", "bank_name", "city", "source", "as_of", "basis", "authoritative"]),
    bank_code_check: pick(r.bank_code_check, ["value", "status", "register", "authoritative", "as_of"]),
    sepa: r.sepa,
  }
  return { iban: String(r.iban), capturedAt: captured.captured_at, json: JSON.stringify(extract, null, 2) }
}

/**
 * The official Swiss example of the IBAN registry: mod-97 passes, the SIX
 * BankMaster allocates its bank code to no one. Null if the export stopped
 * carrying an answer for it (the section is then left out, never invented).
 */
export function unallocatedExample(): { iban: string; exportedAt: string; json: string } | null {
  const file = countriesFile()
  const ch = file.countries.CH
  if (!ch?.api) return null
  const check = ch.api.bank_code_check as { reason?: string } | undefined
  if (ch.api.valid !== true || check?.reason !== "not_allocated") return null
  const extract = { iban: ch.example, valid: ch.api.valid, bank_code_check: ch.api.bank_code_check }
  return { iban: ch.example, exportedAt: file.generated_at, json: JSON.stringify(extract, null, 2) }
}

// ─── Metadata and structured data ─────────────────────────────────────────────

export function apiPageMetadata(locale: string): Metadata {
  const copy = apiPageCopy(locale)
  const url = urlFor(locale, API_PAGE_PATH)
  const og = ogImageFor(locale)
  // The layout's title template adds the brand to <title>; Open Graph and
  // Twitter take the string as it is, so they get it written out.
  const shareTitle = `${copy.meta.title} | IBANforge`
  return {
    title: copy.meta.title,
    description: copy.meta.description,
    // Canonical and hreflang together, from the one helper (lib/seo.ts).
    alternates: alternatesFor(locale, API_PAGE_PATH),
    // A page that declares `openGraph` replaces the layout's object whole, so
    // it names its URL and its image, or the share card points at the home.
    openGraph: {
      type: "website",
      locale: copy.meta.ogLocale,
      url,
      siteName: "IBANforge",
      title: shareTitle,
      description: copy.meta.description,
      images: [og],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: copy.meta.description,
      images: [og.url],
    },
  }
}

/**
 * A WebPage and its breadcrumb. The product itself, with its offers and the
 * free key, is the `SoftwareApplication` the locale layout already emits on
 * every page (`#software`): this page points at it as its main entity rather
 * than describing the product a second time. No `WebAPI` node either:
 * components/json-ld.tsx records why that type was dropped (2026-08).
 */
export function apiPageJsonLd(locale: string): Record<string, unknown> {
  const copy = apiPageCopy(locale)
  const url = urlFor(locale, API_PAGE_PATH)
  const og = ogImageFor(locale)
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: copy.meta.title,
        headline: copy.hero.h1,
        description: copy.meta.description,
        inLanguage: isApiPageLocale(locale) ? locale : "en",
        isPartOf: { "@type": "WebSite", name: "IBANforge", url: SITE_URL },
        about: { "@id": SOFTWARE_NODE_ID },
        mainEntity: { "@id": SOFTWARE_NODE_ID },
        breadcrumb: { "@id": `${url}#breadcrumb` },
        primaryImageOfPage: { "@type": "ImageObject", url: og.url, width: og.width, height: og.height },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: copy.breadcrumbHome, item: urlFor(locale) },
          { "@type": "ListItem", position: 2, name: copy.hero.h1, item: url },
        ],
      },
    ],
  }
}

/**
 * The JSON-LD as it goes into the <script> tag. `<` is escaped so that no
 * string of the copy can ever close the tag early.
 */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}
