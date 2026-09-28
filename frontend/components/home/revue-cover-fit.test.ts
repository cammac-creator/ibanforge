import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { routing } from "@/i18n/routing"
import { formatGrouped } from "@/lib/format-grouped"
import { AUDIT_TIERS } from "@/lib/audit-tiers"
import { BANK_FIT, COUNTER_FIT, COVER_LINES, FIN_LINES } from "./revue-cover-fit"

const messages = { en, fr, de } as const

/*
 * The widths of the fitted lines are measured once, in the font, and written
 * down with the text they were measured on (revue-cover-fit.ts). A text
 * rewritten in the messages, or lines retyped in the table without a new
 * measure, would keep the old widths and overflow, or leave a gap, in its
 * column: these tests turn red first.
 */
const RUN = "run frontend/scripts/measure-cover-fit.mjs and paste its output"

describe("the lines of the home title", () => {
  it("cover every language of the site", () => {
    expect(Object.keys(COVER_LINES).sort()).toEqual([...routing.locales].sort())
  })

  it.each(routing.locales)("say the title of the messages, word for word (%s)", (locale) => {
    const hero = messages[locale].home.hero
    expect(COVER_LINES[locale].lines.join(" ")).toBe(`${hero.titleLead} ${hero.titleAccent}`)
  })

  it.each(routing.locales)("were measured on the text they show (%s)", (locale) => {
    const { lines, measured } = COVER_LINES[locale]
    expect(measured, `the lines changed since their widths were measured: ${RUN}`).toBe(lines.join("|"))
  })

  it.each(routing.locales)("each carry a measured width (%s)", (locale) => {
    const { lines, em } = COVER_LINES[locale]
    expect(em).toHaveLength(lines.length)
    for (const width of em) {
      // A line of the title is a few words of capitals: between two and eight
      // em wide in Bebas Neue. Zero means "not measured yet".
      expect(width).toBeGreaterThan(2)
      expect(width).toBeLessThan(8)
    }
  })
})

describe("the lines of the ending's title", () => {
  it("cover every language of the site", () => {
    expect(Object.keys(FIN_LINES).sort()).toEqual([...routing.locales].sort())
  })

  it.each(routing.locales)("say home.cta.title word for word, on a phone and on a computer (%s)", (locale) => {
    const { narrow, wide } = FIN_LINES[locale]
    const title = messages[locale].home.cta.title
    expect(narrow.join(" ")).toBe(title)
    expect(wide.join(" ")).toBe(title)
    // Three lines on a phone, two from 760 px: the layout of the mockup.
    expect(narrow).toHaveLength(3)
    expect(wide).toHaveLength(2)
  })

  it.each(routing.locales)("were measured on the text they show (%s)", (locale) => {
    const { narrow, wide, measured } = FIN_LINES[locale]
    expect(measured, `the lines changed since their widths were measured: ${RUN}`).toBe(
      `${narrow.join("|")}/${wide.join("|")}`,
    )
  })

  it.each(routing.locales)("carry the width of their widest line (%s)", (locale) => {
    const { em } = FIN_LINES[locale]
    expect(em.narrow).toBeGreaterThan(3)
    expect(em.wide).toBeGreaterThan(em.narrow)
    expect(em.wide).toBeLessThan(10)
  })
})

describe("the counter of the file (chapter 04)", () => {
  it("rolls to the row ceiling of the smaller audit", () => {
    expect(COUNTER_FIT.value).toBe(AUDIT_TIERS[0].rows)
  })

  it.each(routing.locales)("was measured on the figure the site writes (%s)", (locale) => {
    const entry = COUNTER_FIT[locale]
    const written = formatGrouped(COUNTER_FIT.value, locale)
    expect(entry.measured, `the figure changed since it was measured: ${RUN}`).toBe(written)
    // A comma is drawn as it is; a no-break space becomes the fixed spacer.
    expect(entry.sep).toBe(written.includes(",") ? "," : "fine")
    expect(entry.em).toBeGreaterThan(1)
    expect(entry.em).toBeLessThan(3)
  })
})

describe("the bank of the tools scene (chapter 04)", () => {
  it("was measured on its word", () => {
    expect(BANK_FIT.measured, RUN).toBe(BANK_FIT.text)
    expect(BANK_FIT.em).toBeGreaterThan(5)
    expect(BANK_FIT.em).toBeLessThan(9)
  })
})
