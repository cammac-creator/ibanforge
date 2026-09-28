/*
 * The lines of the home that fill their column exactly, measured once in the
 * browser (the magazine layout chosen by Claude-Alain on 28/09/2026, tightened
 * into « la revue resserrée » the same day).
 *
 * The widths are measured in the font the site serves, by
 * frontend/scripts/measure-cover-fit.mjs, which prints each entry whole. They
 * are numbers rather than a script that measures on load: a size that changes
 * once JavaScript runs would move the page under the reader.
 *
 * Every entry keeps `measured`, the text its widths were measured on, written
 * by the script. revue-cover-fit.test.ts holds the lines to the messages of
 * each language and to `measured`: a text changed in the messages, or lines
 * retyped here without running the script again, fails there before anyone
 * sees a line overflow its column. This file imports nothing, so the script can
 * read it as it is.
 */

/*
 * The cover title, one line per row. Each line fills its column and the title
 * grows down to its last words: the font size of a line is the width of its
 * column divided by `em`, the width of that line set in Bebas Neue at 1em.
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

/*
 * The title of the ending (home.cta.title), in Bebas Neue: three lines on a
 * phone (`narrow`), two from 760 px (`wide`). One size per layout: the widest
 * line fills the column, the others follow at the same size. `em` holds the
 * width of that widest line at 1em. `measured` is "narrow lines/wide lines".
 */
export const FIN_LINES = {
  en: {
    narrow: ["Check your", "first IBAN", "in two minutes"],
    wide: ["Check your first", "IBAN in two minutes"],
    em: { narrow: 4.9241, wide: 6.5081 },
    measured: "Check your|first IBAN|in two minutes/Check your first|IBAN in two minutes",
  },
  fr: {
    narrow: ["Vérifiez votre", "premier IBAN", "en deux minutes"],
    wide: ["Vérifiez votre premier", "IBAN en deux minutes"],
    em: { narrow: 5.3461, wide: 7.477 },
    measured: "Vérifiez votre|premier IBAN|en deux minutes/Vérifiez votre premier|IBAN en deux minutes",
  },
  de: {
    narrow: ["Prüfen Sie Ihre", "erste IBAN", "in zwei Minuten"],
    wide: ["Prüfen Sie Ihre erste", "IBAN in zwei Minuten"],
    em: { narrow: 5.1261, wide: 6.975 },
    measured: "Prüfen Sie Ihre|erste IBAN|in zwei Minuten/Prüfen Sie Ihre erste|IBAN in zwei Minuten",
  },
} as const satisfies Record<
  CoverLocale,
  { narrow: readonly string[]; wide: readonly string[]; em: { narrow: number; wide: number }; measured: string }
>

export function finLines(locale: string) {
  return FIN_LINES[(locale in FIN_LINES ? locale : "en") as CoverLocale]
}

/*
 * The counter of the file in chapter 04: the row ceiling of the smaller file
 * audit (lib/audit-tiers.ts), in Bebas Neue with tabular figures. French and
 * German group the thousands with a thin space, which Bebas does not draw: a
 * fixed spacer of 0.08em stands for it (`sep: "fine"`); English writes a comma.
 * `measured` is the figure as it was measured.
 */
export const COUNTER_FIT = {
  value: 5000,
  en: { sep: ",", em: 1.7881, measured: "5,000" },
  fr: { sep: "fine", em: 1.68, measured: "5\u00a0000" },
  de: { sep: "fine", em: 1.68, measured: "5\u00a0000" },
} as const satisfies { value: number } & Record<CoverLocale, { sep: "," | "fine"; em: number; measured: string }>

export function counterFit(locale: string) {
  return COUNTER_FIT[(locale in FIN_LINES ? locale : "en") as CoverLocale]
}

/*
 * The bank of the tools scene in chapter 04, the same in every language:
 * « Commerzbank. » in Inter 600 at -0.04em, the width of the film's bank shot.
 */
export const BANK_FIT = { text: "Commerzbank.", em: 6.9286, measured: "Commerzbank." } as const
