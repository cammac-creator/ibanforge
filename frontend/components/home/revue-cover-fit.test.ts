import { describe, expect, it } from "vitest"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import de from "@/messages/de.json"
import { routing } from "@/i18n/routing"
import { COVER_LINES } from "./revue-cover-fit"

const messages = { en, fr, de } as const

/*
 * The widths of the title lines are measured once, in the font, and written
 * down with the text they were measured on (revue-cover-fit.ts). A title
 * rewritten in the messages, or lines retyped in the table without a new
 * measure, would keep the old widths and overflow, or leave a gap, in its
 * column: these tests turn red first.
 */
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
    expect(
      measured,
      "the lines changed since their widths were measured: run frontend/scripts/measure-cover-fit.mjs and paste its output",
    ).toBe(lines.join("|"))
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
