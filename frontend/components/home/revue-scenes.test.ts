import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { RevueEssai } from "./revue-essai"
import { essaiCopy } from "./revue-essai-model"
import { RevueVoies, type VoiesCopy } from "./revue-voies"
import { ApiText, BebasFigure, KeepHyphenated, splitFrom, splitMention, splitNumbered } from "./revue-parts"
import { COUNTER_FIT } from "./revue-cover-fit"

const messages = { en, fr, de } as const
type Locale = keyof typeof messages

/*
 * What chapters 03 and 04 show before any script runs: the frame a phone with
 * reduced motion keeps, the one a crawler reads, the one the motion starts
 * from. Each must be complete on its own; the motion only moves it.
 */

function voiesCopy(locale: Locale): VoiesCopy {
  const home = messages[locale].home
  const names = home.lens.gallery.items.map((item) => splitNumbered(item.eyebrow))
  const link = (label: string, href: string, evt: string) => ({ label, href, evt })
  return {
    group: home.lens.gallery.eyebrow,
    ways: [
      { ...names[0], audience: home.audiences.devTitle, text: home.audiences.devText, link: link(home.audiences.devLink, "/docs", "cta:docs") },
      { ...names[1], audience: home.audiences.financeTitle, text: home.audiences.financeText, link: link(home.audiences.financeLink, "/audit", "cta:audit") },
      { ...names[2], audience: home.audiences.agentsTitle, text: home.audiences.agentsText, link: link(home.audiences.agentsLink, "/agents", "cta:agents") },
    ],
    verdictOk: home.demo.verdictOk,
    frames: { api: "API", apiTag: home.audiences.devTitle, sheet: home.ways.sheet, sheetTag: "Google Sheets", agent: home.ways.agent, agentTag: "MCP" },
    sheetNote: home.integrations.items.sheets,
    mcpNote: home.integrations.items.mcp,
    formula: "=IBAN_CHECK(A2)",
    unit: home.ways.unit,
    flagged: home.ways.flagged,
    figure: home.ways.figure,
    caption: home.ways.caption,
    reasons: [home.demo.notAllocated.replace("{code}", "12345678"), home.demo.checksum],
    counter: { total: COUNTER_FIT.value, sep: COUNTER_FIT[locale].sep, em: COUNTER_FIT[locale].em },
    bankEm: 6.9,
  }
}

// The visible text, markup removed. Only ordinary spaces collapse: the no-break
// spaces of the messages stay as they are.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/[ \t\n\r]+/g, " ")

describe("chapter 04, one scene and three switches", () => {
  it.each(["en", "fr", "de"] as const)("rests on the file, complete, before any script (%s)", (locale) => {
    const html = renderToStaticMarkup(createElement(RevueVoies, { copy: voiesCopy(locale) }))
    const home = messages[locale].home
    // The still frame is the file, and its switch is the current one.
    expect(html).toContain('data-voie="1"')
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="true"[^>]*>.*?rv-voie__nom">[^<]+<\/span>/)
    expect(text(html)).toContain(home.ways.flagged)
    expect(text(html)).toContain("DE89 3704 0044 0532 0130 01")
    expect(text(html)).toContain(home.demo.checksum)
    expect(text(html)).toContain("12345678")
    expect(text(html)).toContain(home.ways.caption)
    // The rolling layer is empty: the engine alone writes in it.
    expect(html).toContain('<span class="rv-f__roule" aria-hidden="true"></span>')
    // The three ways, their audiences, their doors.
    for (const way of home.lens.gallery.items) expect(text(html)).toContain(splitNumbered(way.eyebrow).name)
    for (const evt of ["cta:docs", "cta:audit", "cta:agents"]) expect(html).toContain(`data-evt="${evt}"`)
    // The same answer in the tools scene, waiting behind the file.
    expect(html).toContain("Commerzbank.")
    expect(html).toContain("npx -y")
  })

  it("writes the counter the way each language groups thousands", () => {
    const fixed = (locale: Locale) =>
      /<span class="rv-f__fixe">(.*?)<\/span><span class="rv-f__roule"/.exec(
        renderToStaticMarkup(createElement(RevueVoies, { copy: voiesCopy(locale) })),
      )?.[1]
    expect(fixed("en")).toBe("5,000")
    expect(fixed("fr")).toBe('5<span class="rv-fine"></span>000')
    expect(fixed("de")).toBe('5<span class="rv-fine"></span>000')
  })

  it("keeps the audit prices out of the finance text: the price table has them", () => {
    for (const locale of ["en", "fr", "de"] as const) {
      expect(messages[locale].home.audiences.financeText).not.toMatch(/149|349/)
    }
  })
})

describe("chapter 03, a real check", () => {
  it.each(["en", "fr", "de"] as const)("waits, the German bank in the field, nothing called (%s)", (locale) => {
    const lens = messages[locale].home.lens.hero
    const copy = essaiCopy(lens, messages[locale].home.demo, messages[locale].playground.verdict)
    const html = renderToStaticMarkup(createElement(RevueEssai, { copy, playgroundHref: "/playground" }))
    expect(html).toContain('value="DE89 3704 0044 0532 0130 00"')
    for (const word of [lens.waitFormat, lens.waitBank, lens.waitBic, lens.submit, lens.inputNote]) {
      expect(text(html)).toContain(word)
    }
    // Only « Germany » is pressed, and no verdict is claimed before an answer.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).not.toContain("rv-essai__verdict")
    expect(html).toContain('data-evt="cta:journey-api"')
  })

  it.each(["en", "fr", "de"] as const)("says why its buttons wait when JavaScript is off (%s)", (locale) => {
    const lens = messages[locale].home.lens.hero
    const copy = essaiCopy(lens, messages[locale].home.demo, messages[locale].playground.verdict)
    const html = renderToStaticMarkup(createElement(RevueEssai, { copy, playgroundHref: "/playground" }))
    // Disabled until the script answers them: without JavaScript they never
    // would, so the page says so and points at an answer any browser can read.
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? ""
    expect(text(noscript)).toContain(lens.noJs)
    expect(noscript).toContain('href="https://api.ibanforge.com/v1/demo"')
    expect(lens.noJs).not.toMatch(/3D|lens|lentille|Linse/i)
  })
})

describe("the small pieces of the home", () => {
  it("sets API paths as code, word for word", () => {
    const html = renderToStaticMarkup(createElement(ApiText, { text: "Oui. Sans aucune clé, POST /v1/iban/validate répond." }))
    expect(html).toBe("Oui. Sans aucune clé, <code>POST /v1/iban/validate</code> répond.")
  })

  it("draws the no-break spaces of a Bebas figure as spacers", () => {
    expect(renderToStaticMarkup(createElement(BebasFigure, { text: "29\u00a0$" }))).toBe(
      '29<span class="rv-fine rv-fine--devise"></span>$',
    )
  })

  it("never parts a hyphenated word", () => {
    expect(renderToStaticMarkup(createElement(KeepHyphenated, { text: "Pourquoi le mod-97 ne suffit pas" }))).toBe(
      'Pourquoi le <span class="rv-nw">mod-97</span> ne suffit pas',
    )
  })

  it("splits prices, integrations and ways where the messages write them", () => {
    expect(splitFrom("dès 4\u00a0$")).toEqual({ from: "dès", amount: "4\u00a0$" })
    expect(splitFrom("from $4")).toEqual({ from: "from", amount: "$4" })
    expect(splitFrom("29\u00a0$")).toEqual({ from: null, amount: "29\u00a0$" })
    expect(splitMention("SDK Java 17+ · Maven Central")).toEqual({ name: "SDK Java 17+", mention: "Maven Central" })
    expect(splitMention("Collection Postman")).toEqual({ name: "Collection Postman", mention: null })
    for (const locale of ["en", "fr", "de"] as const) {
      const ways = messages[locale].home.lens.gallery.items.map((item) => splitNumbered(item.eyebrow))
      expect(ways.map((way) => way.num)).toEqual(["01", "02", "03"])
      expect(ways.every((way) => way.name.length > 3)).toBe(true)
    }
  })
})

describe("the client components of the home", () => {
  // Rule 8 of AGENTS.md: WebKit formats differently from Node, and a hydration
  // mismatch wipes the class on <html>. Figures reach the client formatted.
  it("never format with Intl in the browser", () => {
    const dir = resolve(__dirname)
    const clients = readdirSync(dir)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => ({ name, source: readFileSync(resolve(dir, name), "utf8") }))
      .filter(({ source }) => /^["']use client["']/m.test(source) || /from "gsap"/.test(source))
    expect(clients.length).toBeGreaterThan(3)
    for (const { name, source } of clients) {
      expect(source, name).not.toMatch(/\bIntl\.|toLocale(String|DateString|TimeString)\(/)
    }
  })
})
