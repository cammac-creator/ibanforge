import type { CalendarSystem, HolidayKey } from '@/lib/clearing-calendar';

/**
 * The words of the page `/clearing-calendar/{year}`, one file per language
 * beside the route, as for `iban-api-deutschland`. The days of the year are not
 * typed here: they come from the data file (lib/clearing-calendar.ts) and fill
 * the placeholders in braces in `page-data.ts` or `page.tsx`. The only dates
 * written out are rules the sources state: the TARGET closing days, the end of
 * euroSIC, the arrival of T2.
 */

export type CalendarLocale = 'en' | 'fr' | 'de';

export interface CalendarCopy {
  meta: { title: string; description: string; ogLocale: string };
  breadcrumbHome: string;
  hero: {
    eyebrow: string;
    h1: string;
    /** One sentence per system, before the first <h2>: `{count}` weekdays, `{days}` listed. */
    answer: Record<CalendarSystem, string>;
    weekends: string;
    meaning: string;
    fileLine: string;
  };
  /** The short name of each system, as the table and the legend print it. */
  systems: Record<CalendarSystem, string>;
  differ: {
    heading: string;
    intro: string;
    /** `{day}`, `{holiday}`, `{closed}` and `{open}`: lists of system names. */
    item: string;
  };
  glance: {
    heading: string;
    intro: string;
    /** Monday first. */
    weekdays: string[];
    legend: { all: string; partial: string; weekend: string; weekendHoliday: string; open: string };
  };
  dates: {
    heading: string;
    intro: string;
    colDay: string;
    closed: string;
    open: string;
    weekendLine: string;
  };
  holidays: Record<HolidayKey, string>;
  cards: {
    heading: string;
    about: Record<CalendarSystem, string>;
    closedCount: string;
    service: string;
    rule: string;
    eurosicEnd: string;
  };
  transfer: {
    heading: string;
    t2: string;
    psd2: string;
    cutOff: string;
  };
  sources: {
    heading: string;
    sixFile: string;
    specification: string;
    sixSchedule: string;
    sixChanges: string;
    sixPage: string;
    eurosicPage: string;
    ecbRule: string;
    ecbHolidays: string;
    psd2: string;
    readOn: string;
  };
  next: { heading: string; iid: string; country: string; tools: string };
  /** The word that joins the last two items of a list. */
  and: string;
  /** What separates the other items: a comma, or a semicolon where a day already carries one (German). */
  listSeparator: string;
}
