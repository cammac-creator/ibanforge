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

const WEEKDAYS: Record<WordsLocale, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
};

/** The name of the day of the week of `2027-03-26`: `Friday`, `vendredi`, `Freitag`. Computed in UTC. */
export function weekdayWords(isoDay: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!m) return '';
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return WEEKDAYS[wordsLocale(locale)][weekday];
}

/** `2027-03-26` without its year: `26 March`, `26 mars`, `26. März`; « 1er mai » in French. */
export function formatDayMonthWords(isoDay: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
  if (!m) return isoDay;
  const month = MONTHS[wordsLocale(locale)][Number(m[2]) - 1];
  if (!month) return isoDay;
  const day = Number(m[3]);
  if (locale === 'de') return `${day}. ${month}`;
  if (locale === 'fr' && day === 1) return `1er ${month}`;
  return `${day} ${month}`;
}

/** The name of a month (1 to 12): `March`, `mars`, `März`. */
export function monthWords(month: number, locale: string): string {
  return MONTHS[wordsLocale(locale)][month - 1] ?? '';
}

/** `2026-09` (a register edition) as `September 2026` or `septembre 2026`. */
export function formatMonthWords(isoMonth: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoMonth);
  if (!m) return isoMonth;
  const month = MONTHS[wordsLocale(locale)][Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : isoMonth;
}
