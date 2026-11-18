import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { calendarFile, systemsOf } from "@/lib/clearing-calendar"
import { formatDayMonthWords } from "@/lib/date-words"
import sitemap from "../../../sitemap"
import type { CalendarCopy, CalendarLocale } from "./copy"
import { COPY_DE } from "./copy-de"
import { COPY_EN } from "./copy-en"
import { COPY_FR } from "./copy-fr"
import {
  answerSentences,
  calendarCopy,
  calendarJsonLd,
  calendarMetadata,
  dayWords,
  joinList,
  jsonLdScript,
  stampOffset,
  timeWords,
} from "./page-data"

const LOCALES: CalendarLocale[] = ["en", "fr", "de"]
const RAW: Record<CalendarLocale, CalendarCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE }
const FRONTEND = process.cwd()
const file = calendarFile("2027")!

const url = (locale: CalendarLocale) => `https://ibanforge.com${locale === "en" ? "" : `/${locale}`}/clearing-calendar/2027`

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

const source = (rel: string) => readFileSync(resolve(FRONTEND, rel), "utf8")

describe("the answer comes first, rendered on the server", () => {
  const page = source("app/[locale]/clearing-calendar/[year]/page.tsx").replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")

  it("page.tsx renders the answer before the first <h2", () => {
    const answer = page.indexOf("answerSentences(file, locale)")
    expect(answer).toBeGreaterThan(page.indexOf("<h1"))
    expect(page.indexOf("<h2")).toBeGreaterThan(answer)
  })

  it("is not a client component", () => {
    expect(page).not.toContain('"use client"')
    expect(page).not.toMatch(/\buseEffect\b|\buseState\b/)
  })

  it("only the listed years exist", () => {
    expect(page).toContain("export const dynamicParams = false")
  })
})

describe("the answer, filled from the data file", () => {
  it("in English, word for word", () => {
    expect(answerSentences(file, "en").map((s) => s.text)).toEqual([
      "SIC, the Swiss franc system of SIX Interbank Clearing, has no clearing day on 5 weekdays in 2027: Friday 1 January, Friday 26 March, Monday 29 March, Thursday 6 May and Monday 17 May.",
      "euroSIC, its system for euro, has no clearing day on 3 weekdays: Friday 1 January, Friday 26 March and Monday 29 March.",
      "T2, which settles large-value payments in euro, is closed on 3 weekdays: Friday 1 January, Friday 26 March and Monday 29 March.",
    ])
  })

  it("in German, the days separated by semicolons since each carries a comma", () => {
    const [sic] = answerSentences(file, "de")
    expect(sic.text).toContain("Freitag, 1. Januar; Freitag, 26. März; Montag, 29. März; Donnerstag, 6. Mai und Montag, 17. Mai.")
  })

  it.each(LOCALES)("%s: no placeholder is left", (locale) => {
    for (const { text } of answerSentences(file, locale)) expect(text).not.toMatch(/\{\w+\}/)
  })

  it("days in words", () => {
    expect(dayWords("2027-01-01", "en")).toBe("Friday 1 January")
    expect(dayWords("2027-01-01", "fr")).toBe("vendredi 1er janvier")
    expect(dayWords("2027-01-01", "de")).toBe("Freitag, 1. Januar")
    expect(joinList(["a", "b", "c"], COPY_FR)).toBe("a, b et c")
    expect(joinList(["a"], COPY_EN)).toBe("a")
    expect(stampOffset("2026-11-18T19:05:25.893+01:00")).toBe("+01:00")
    expect(timeWords("19:05", "fr")).toBe("19 h 05")
    expect(timeWords("19:05", "de")).toBe("19:05")
  })
})

describe("the words", () => {
  it("the three languages have the same shape", () => {
    expect(shape(COPY_FR)).toEqual(shape(COPY_EN))
    expect(shape(COPY_DE)).toEqual(shape(COPY_EN))
  })

  it.each(LOCALES)("%s: no long dash, no superlative, and no closed day typed by hand", (locale) => {
    const text = strings(RAW[locale]).join("\n")
    expect(text).not.toContain("—")
    expect(text).not.toMatch(/\b(only|best|first|seul|meilleur|einzig|beste)\b/i)
    for (const system of systemsOf(file)) {
      for (const day of file.closed_weekdays[system] ?? []) {
        // The TARGET rule names 1 January and the end of euroSIC names 31 December: those are rules, not this year's list.
        if (day.endsWith("-01-01")) continue
        expect(text).not.toContain(formatDayMonthWords(day, locale))
      }
    }
  })

  it.each(LOCALES)("%s: one sentence per system, and a name for each holiday", (locale) => {
    const copy = calendarCopy(locale)
    for (const system of systemsOf(file)) {
      expect(copy.hero.answer[system]).toContain("{count}")
      expect(copy.hero.answer[system]).toContain("{days}")
    }
    expect(Object.keys(copy.holidays)).toHaveLength(12)
  })

  it.each(LOCALES)("%s: the cited articles of the directive and the end of euroSIC", (locale) => {
    const copy = RAW[locale]
    expect(copy.transfer.psd2).toContain("2015/2366")
    expect(copy.transfer.psd2).toMatch(/4\(37\)|4 Nummer 37|4, point 37/)
    expect(copy.transfer.psd2).toMatch(/78\(1\)|78 Absatz 1|78, paragraphe 1/)
    expect(copy.cards.eurosicEnd).toMatch(/31 December 2027|31\. Dezember 2027|31 décembre 2027/)
    expect(copy.sources.sixChanges).toContain("ISO 20022")
  })
})

describe("metadata, sitemap, structured data, links", () => {
  it.each(LOCALES)("%s: title and description at the right length, canonical and hreflang", (locale) => {
    const meta = calendarMetadata(locale, "2027")
    const title = String(meta.title)
    expect(title).toContain("2027")
    expect(title).toMatch(/TARGET/)
    expect(title).toMatch(/SIC/)
    expect(title).not.toContain("IBANforge")
    expect(title.length).toBeLessThanOrEqual(62)
    const description = String(meta.description)
    expect(description.length).toBeGreaterThan(80)
    expect(description.length).toBeLessThanOrEqual(170)
    expect(meta.alternates?.canonical).toBe(url(locale))
    expect(meta.alternates?.languages).toEqual({ en: url("en"), fr: url("fr"), de: url("de"), "x-default": url("en") })
  })

  it("is in the sitemap in the three languages", () => {
    const urls = sitemap().map((entry) => entry.url)
    for (const locale of LOCALES) expect(urls).toContain(url(locale))
  })

  it.each(LOCALES)("%s: a web page with its breadcrumb and its sources", (locale) => {
    const script = jsonLdScript(calendarJsonLd(locale, file))
    expect(script).not.toContain("<")
    const graph = JSON.parse(script)["@graph"] as Array<Record<string, unknown>>
    expect(graph.map((n) => n["@type"])).toEqual(["WebPage", "BreadcrumbList"])
    expect(graph[0].inLanguage).toBe(locale)
    expect(graph[0].citation).toContain(file.sources.six.file)
  })

  it("the footer and the Swiss IID index link to the page", () => {
    expect(source("components/site-footer.tsx")).toContain("clearingCalendarPath(LATEST_CLEARING_CALENDAR_YEAR)")
    expect(source("app/[locale]/iid/page.tsx")).toContain("clearingCalendarPath(LATEST_CLEARING_CALENDAR_YEAR)")
  })
})
