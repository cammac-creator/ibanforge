/*
 * The home title, one line per row of the cover (the magazine layout chosen by
 * Claude-Alain on 28/09/2026). Each line fills its column exactly and the title
 * grows down to its last words: the font size of a line is the width of its
 * column divided by `em`, the width of that line set in Bebas Neue at 1em.
 *
 * The widths are measured in the browser, in the font the site serves, by
 * frontend/scripts/measure-cover-fit.mjs. They are numbers rather than a script
 * that measures on load: the title is the first thing painted, and a size that
 * changes once JavaScript runs would move the whole first screen.
 *
 * `measured` is the text those widths were measured on, written by the script
 * with them. revue-cover-fit.test.ts holds the lines to hero.titleLead and
 * hero.titleAccent of each language, and to `measured`: a title changed in the
 * messages, or lines retyped in this table without running the script again,
 * fails there before anyone sees a line overflow its column.
 */
export const COVER_LINES = {
  en: {
    lines: ["Check the bank", "behind an IBAN", "before you pay"],
    em: [5.0761, 4.7841, 4.875],
    measured: "Check the bank|behind an IBAN|before you pay",
  },
  fr: {
    lines: ["Vérifiez la banque", "derrière un IBAN", "avant de payer"],
    em: [6.0691, 5.4691, 4.8741],
    measured: "Vérifiez la banque|derrière un IBAN|avant de payer",
  },
  de: {
    lines: ["Prüfen Sie die Bank", "hinter einer IBAN,", "bevor Sie zahlen"],
    em: [6.3391, 5.8491, 5.5141],
    measured: "Prüfen Sie die Bank|hinter einer IBAN,|bevor Sie zahlen",
  },
} as const satisfies Record<string, { lines: readonly string[]; em: readonly number[]; measured: string }>

export type CoverLocale = keyof typeof COVER_LINES

export function coverLines(locale: string): { text: string; em: number }[] {
  const entry = COVER_LINES[(locale in COVER_LINES ? locale : "en") as CoverLocale]
  return entry.lines.map((text, i) => ({ text, em: entry.em[i] }))
}
