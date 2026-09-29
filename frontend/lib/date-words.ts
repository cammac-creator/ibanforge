/**
 * Dates written out in words, the same string on every runtime.
 *
 * Hand-rolled rather than `Intl` or `toLocaleDateString` (rule 8 of AGENTS.md:
 * WebKit formats differently from Node, and a hydration mismatch wipes the
 * class on <html>). Safe in a client component.
 */

export type WordsLocale = 'en' | 'fr' | 'de';

const MONTHS: Record<WordsLocale, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
};

function wordsLocale(locale: string): WordsLocale {
  return locale === 'fr' || locale === 'de' ? locale : 'en';
}

/** `2026-09-24` as `24 September 2026`, `24 septembre 2026`, `24. September 2026`. */
export function formatDayWords(isoDay: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!m) return isoDay;
  const [, y, mo, d] = m;
  const month = MONTHS[wordsLocale(locale)][Number(mo) - 1];
  if (!month) return isoDay;
  const day = Number(d);
  if (locale === 'de') return `${day}. ${month} ${y}`;
  // French writes the first of the month as an ordinal: « 1er septembre ».
  if (locale === 'fr' && day === 1) return `1er ${month} ${y}`;
  return `${day} ${month} ${y}`;
}

/** `2026-09` (a register edition) as `September 2026` or `septembre 2026`. */
export function formatMonthWords(isoMonth: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoMonth);
  if (!m) return isoMonth;
  const month = MONTHS[wordsLocale(locale)][Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : isoMonth;
}
