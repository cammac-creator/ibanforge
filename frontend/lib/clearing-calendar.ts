/**
 * The data of the page `/clearing-calendar/{year}`: the weekdays on which SIC
 * (Swiss francs), euroSIC (euro) and TARGET's T2 (euro) are closed, and the
 * year view built from them.
 *
 * `data/clearing-calendar/{year}.json` is written by `npm run
 * pages:export-calendar -- {year}` at the root of the repository
 * (scripts/export-clearing-calendar.ts): SIC and euroSIC from the Clearing Day
 * Calendar file of SIX Interbank Clearing, T2 from the rule the ECB publishes.
 * A static import, so the site's image needs nothing outside `frontend/`.
 *
 * "Closed" on the page covers two terms of two operators: a weekday that SIX
 * does not list as a clearing day of SIC or euroSIC, and a TARGET closing day
 * of the ECB. Weekends are closed in all three (the export refuses a SIX file
 * that lists a weekend as a clearing day).
 */

import data2027 from '@/data/clearing-calendar/2027.json';

export type CalendarSystem = 'sic' | 'eurosic' | 'target';

/** The order the page shows the systems in: francs first, then the two euro systems. */
export const SYSTEM_ORDER: readonly CalendarSystem[] = ['sic', 'eurosic', 'target'];

export interface ClearingCalendarFile {
  year: number;
  closed_weekdays: Partial<Record<CalendarSystem, string[]>>;
  target_closing_days: string[];
  sources: {
    six: {
      publisher: string;
      title: string;
      file: string;
      page: string;
      specification: string;
      services: Record<string, string>;
      file_created_at: string;
      read_at: string;
    };
    target: { publisher: string; title: string; url: string };
  };
}

const FILES: Record<string, ClearingCalendarFile> = {
  '2027': data2027,
};

export { CLEARING_CALENDAR_BASE, clearingCalendarPath, LATEST_CLEARING_CALENDAR_YEAR } from './clearing-calendar-path';

/** The years with a data file, oldest first. */
export function calendarYears(): string[] {
  return Object.keys(FILES).sort();
}

export function latestCalendarYear(): string {
  const years = calendarYears();
  return years[years.length - 1];
}

export function calendarFile(year: string): ClearingCalendarFile | null {
  return FILES[year] ?? null;
}

/** The systems a year's file covers, in page order (euroSIC ends on 31 December 2027). */
export function systemsOf(file: ClearingCalendarFile): CalendarSystem[] {
  return SYSTEM_ORDER.filter((system) => Array.isArray(file.closed_weekdays[system]));
}

// ─── Days ─────────────────────────────────────────────────────────────────────

/** 0 for Monday to 6 for Sunday, in UTC. */
export function mondayIndex(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function isWeekend(isoDay: string): boolean {
  return mondayIndex(isoDay) >= 5;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The systems closed on a day: all of them on a weekend, else those whose file lists it. */
export function closedSystems(file: ClearingCalendarFile, isoDay: string): CalendarSystem[] {
  const systems = systemsOf(file);
  if (isWeekend(isoDay)) return systems;
  return systems.filter((system) => file.closed_weekdays[system]?.includes(isoDay));
}

export type DayKind = 'open' | 'weekend' | 'all' | 'partial';

export function dayKind(file: ClearingCalendarFile, isoDay: string): DayKind {
  if (isWeekend(isoDay)) return 'weekend';
  const closed = closedSystems(file, isoDay).length;
  if (closed === 0) return 'open';
  return closed === systemsOf(file).length ? 'all' : 'partial';
}

export interface MonthGrid {
  month: number;
  /** Empty cells before the 1st, weeks starting on Monday. */
  offset: number;
  days: string[];
}

export function monthGrids(year: number): MonthGrid[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const days = Array.from({ length: daysInMonth(year, month) }, (_, d) => iso(year, month, d + 1));
    return { month, offset: mondayIndex(days[0]), days };
  });
}

/** Weekdays closed in some systems and open in others: the days that matter most. */
export function differingDays(file: ClearingCalendarFile): string[] {
  const days = new Set(systemsOf(file).flatMap((system) => file.closed_weekdays[system] ?? []));
  return [...days].filter((day) => dayKind(file, day) === 'partial').sort();
}

// ─── Named days ───────────────────────────────────────────────────────────────

export type HolidayKey =
  | 'newYear'
  | 'berchtold'
  | 'goodFriday'
  | 'easterMonday'
  | 'labourDay'
  | 'ascension'
  | 'whitMonday'
  | 'nationalDay'
  | 'christmasEve'
  | 'christmas'
  | 'stStephen'
  | 'newYearsEve';

/**
 * The days of the year that SIX's "Schedule of clearing days 2027" names, its
 * two eves included (it lists them as clearing days), which also cover the six
 * TARGET closing days of the ECB. Names only: whether a system is closed comes
 * from the data file, and `clearing-calendar.test.ts` checks the two against
 * each other and against both published lists.
 */
export const NAMED_DAYS: Record<string, Record<string, HolidayKey>> = {
  '2027': {
    '2027-01-01': 'newYear',
    '2027-01-02': 'berchtold',
    '2027-03-26': 'goodFriday',
    '2027-03-29': 'easterMonday',
    '2027-05-01': 'labourDay',
    '2027-05-06': 'ascension',
    '2027-05-17': 'whitMonday',
    '2027-08-01': 'nationalDay',
    '2027-12-24': 'christmasEve',
    '2027-12-25': 'christmas',
    '2027-12-26': 'stStephen',
    '2027-12-31': 'newYearsEve',
  },
};

export function namedDay(year: string, isoDay: string): HolidayKey | null {
  return NAMED_DAYS[year]?.[isoDay] ?? null;
}

export interface DateRow {
  day: string;
  holiday: HolidayKey | null;
  closed: CalendarSystem[];
}

/**
 * The table of the page: every named weekday and every closed weekday, in date
 * order, with the systems closed on it. Open named days (the two eves) stay in:
 * they answer the question as much as a closed one.
 */
export function dateRows(file: ClearingCalendarFile): DateRow[] {
  const year = String(file.year);
  const days = new Set([
    ...Object.keys(NAMED_DAYS[year] ?? {}),
    ...systemsOf(file).flatMap((system) => file.closed_weekdays[system] ?? []),
  ]);
  return [...days]
    .filter((day) => !isWeekend(day))
    .sort()
    .map((day) => ({ day, holiday: namedDay(year, day), closed: closedSystems(file, day) }));
}

/** The named days that fall on a Saturday or a Sunday this year. */
export function weekendNamedDays(file: ClearingCalendarFile): string[] {
  return Object.keys(NAMED_DAYS[String(file.year)] ?? {})
    .filter(isWeekend)
    .sort();
}

/** `2026-11-18T19:05:25.893+01:00` as its day and its local time, `19:05`. */
export function stampParts(stamp: string): { day: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(stamp);
  return m ? { day: m[1], time: m[2] } : { day: stamp.slice(0, 10), time: '' };
}
