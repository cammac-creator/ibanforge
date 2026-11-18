/**
 * The clearing calendar behind the site's page `/clearing-calendar/{year}`.
 *
 * Two systems are read from the Clearing Day Calendar that SIX Interbank
 * Clearing publishes as a CSV file (specification "Clearing Day Calendar CSV
 * V 1.0", valid from 1 July 2024): SIC, the Swiss franc RTGS service (`PCR_P`),
 * and euroSIC, the euro RTGS service (`PER_P`). The file also lists the instant
 * payment service (`PCI_P`); the page does not show it, so it is not read.
 *
 * The specification defines the two fields used here:
 *  - `Clearing day` (field 5) is "the clearing day that is active on the start
 *    (00:00) of the related calendar day". A calendar day is therefore a
 *    clearing day of the service when that field names the day itself; on a
 *    weekend or a holiday it names the next clearing day.
 *  - `Scheduled clearing day change` (field 12) is "Y" when a clearing day
 *    change is scheduled for the calendar day. It must agree with the first
 *    reading, and the parser refuses a file where it does not.
 *
 * The file only lists forthcoming days ("its contents will diminish as the year
 * progresses"): read after 1 January of the year asked for, it no longer holds
 * the whole year, and the parser refuses rather than write a year with holes.
 *
 * TARGET (T2) is not in that file. Its closing days follow the rule the ECB
 * publishes on its T2 page: closed on Saturday and Sunday and, for euro
 * settlement, on 1 January, Good Friday, Easter Monday, 1 May, 25 and
 * 26 December. They are computed here from the date of Easter.
 *
 * No text of SIX is copied: the output holds dates only, with the addresses of
 * the sources and the creation stamp of the file read.
 */

export const SIX_CALENDAR_CSV_URL =
  'https://api.six-group.com/api/epcd/clearingday/v1/calendar.csv';
export const SIX_CALENDAR_PAGE_URL =
  'https://www.six-group.com/en/products-services/banking-services/interbank-clearing/online-services/clearing-day-calendar.html';
export const SIX_SPECIFICATION_URL =
  'https://www.six-group.com/dam/download/banking-services/interbank-clearing/clearing-day-calendar/specification-clearing-day-calendar-csv-v1.0.pdf';
export const ECB_T2_URL = 'https://www.ecb.europa.eu/paym/target/t2/html/index.en.html';

/** The services of the SIX file the page shows, by the key the page uses. */
export const SIX_SERVICES = { sic: 'PCR_P', eurosic: 'PER_P' } as const;
export type SixSystem = keyof typeof SIX_SERVICES;

/** The columns of the specification this script relies on, at their position. */
const EXPECTED_HEADER: Record<number, string> = {
  0: 'Calendar day',
  1: 'Day of week',
  2: 'Service identification',
  4: 'Clearing day',
  11: 'Scheduled clearing day change',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Field 4 of the file structure: "CET with UTC offset", e.g. 2024-12-22T16:32:05.19+01:00. */
const CREATION_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/;

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface SixRow {
  calendarDay: string;
  dayOfWeek: string;
  service: string;
  clearingDay: string;
  clearingDayChange: string;
}

export interface SixCalendar {
  /** The creation stamp the last column of the header carries. */
  createdAt: string;
  rows: SixRow[];
}

/** Read the CSV text of the SIX Clearing Day Calendar, refusing anything off specification. */
export function parseSixCalendar(text: string): SixCalendar {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length < 2) throw new Error('SIX calendar: the file holds no row');
  const header = lines[0].split(';').map((cell) => cell.trim());
  for (const [index, name] of Object.entries(EXPECTED_HEADER)) {
    if (header[Number(index)] !== name) {
      throw new Error(
        `SIX calendar: column ${Number(index) + 1} is "${header[Number(index)]}", expected "${name}"`,
      );
    }
  }
  const createdAt = header[header.length - 1];
  if (!CREATION_STAMP.test(createdAt)) {
    throw new Error(`SIX calendar: no creation stamp at the end of the header ("${createdAt}")`);
  }
  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split(';');
    const row: SixRow = {
      calendarDay: cells[0]?.trim() ?? '',
      dayOfWeek: cells[1]?.trim() ?? '',
      service: cells[2]?.trim() ?? '',
      clearingDay: cells[4]?.trim() ?? '',
      clearingDayChange: cells[11]?.trim() ?? '',
    };
    if (!ISO_DAY.test(row.calendarDay) || !ISO_DAY.test(row.clearingDay)) {
      throw new Error(`SIX calendar: line ${i + 2} has no valid calendar day or clearing day`);
    }
    if (row.clearingDayChange !== 'Y' && row.clearingDayChange !== 'N') {
      throw new Error(`SIX calendar: line ${i + 2} has "${row.clearingDayChange}" in field 12`);
    }
    return row;
  });
  return { createdAt, rows };
}

/** 0 for Sunday to 6 for Saturday, computed in UTC so that no time zone moves a day. */
export function weekdayOf(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Every day of `year`, in order. */
export function daysOfYear(year: number): string[] {
  const days: string[] = [];
  for (let day = `${year}-01-01`; day.startsWith(String(year)); day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

const isWeekend = (isoDay: string) => {
  const weekday = weekdayOf(isoDay);
  return weekday === 0 || weekday === 6;
};

/**
 * The weekdays of `year` that are not a clearing day of `service`. Refuses a
 * file that does not cover the whole year, a weekday name that disagrees with
 * the date, the two readings of a clearing day disagreeing, and a weekend day
 * listed as a clearing day (the page shows every weekend as closed).
 */
export function nonClearingWeekdays(rows: SixRow[], service: string, year: number): string[] {
  const byDay = new Map<string, SixRow>();
  for (const row of rows) {
    if (row.service !== service || !row.calendarDay.startsWith(`${year}-`)) continue;
    if (byDay.has(row.calendarDay)) {
      throw new Error(`SIX calendar: ${service} lists ${row.calendarDay} twice`);
    }
    byDay.set(row.calendarDay, row);
  }
  const closed: string[] = [];
  for (const day of daysOfYear(year)) {
    const row = byDay.get(day);
    if (!row) {
      throw new Error(
        `SIX calendar: ${service} has no row for ${day}; the file lists forthcoming days only, ` +
          `so ${year} can no longer be read whole from it`,
      );
    }
    if (row.dayOfWeek !== WEEKDAYS_EN[weekdayOf(day)]) {
      throw new Error(
        `SIX calendar: ${day} is a ${WEEKDAYS_EN[weekdayOf(day)]}, the file says ${row.dayOfWeek}`,
      );
    }
    const clearing = row.clearingDay === day;
    if (clearing !== (row.clearingDayChange === 'Y')) {
      throw new Error(`SIX calendar: ${service} ${day}, clearing day and field 12 disagree`);
    }
    if (isWeekend(day)) {
      if (clearing)
        throw new Error(`SIX calendar: ${service} lists ${day}, a weekend, as a clearing day`);
      continue;
    }
    if (!clearing) closed.push(day);
  }
  return closed;
}

/** Easter Sunday in the Gregorian calendar (the anonymous algorithm, Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The six TARGET closing days of `year`, by the ECB's rule, in date order. */
export function targetClosingDays(year: number): string[] {
  const easter = easterSunday(year);
  return [
    `${year}-01-01`,
    addDays(easter, -2),
    addDays(easter, 1),
    `${year}-05-01`,
    `${year}-12-25`,
    `${year}-12-26`,
  ];
}

export interface ClearingCalendarFile {
  year: number;
  /** Weekdays without settlement, per system; weekends are closed in all three. */
  closed_weekdays: { sic: string[]; eurosic: string[]; target: string[] };
  /** The six TARGET closing days of the rule, weekends included. */
  target_closing_days: string[];
  sources: {
    six: {
      publisher: string;
      title: string;
      file: string;
      page: string;
      specification: string;
      services: typeof SIX_SERVICES;
      file_created_at: string;
      read_at: string;
    };
    target: { publisher: string; title: string; url: string };
  };
}

/** The file the site reads, from the CSV text of SIX and the TARGET rule. */
export function buildClearingCalendar(
  csvText: string,
  year: number,
  readAt: string,
): ClearingCalendarFile {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`clearing calendar: "${year}" is not a year`);
  }
  const six = parseSixCalendar(csvText);
  const target = targetClosingDays(year);
  return {
    year,
    closed_weekdays: {
      sic: nonClearingWeekdays(six.rows, SIX_SERVICES.sic, year),
      eurosic: nonClearingWeekdays(six.rows, SIX_SERVICES.eurosic, year),
      target: target.filter((day) => !isWeekend(day)),
    },
    target_closing_days: target,
    sources: {
      six: {
        publisher: 'SIX Interbank Clearing Ltd',
        title: 'Clearing Day Calendar (CSV V 1.0)',
        file: SIX_CALENDAR_CSV_URL,
        page: SIX_CALENDAR_PAGE_URL,
        specification: SIX_SPECIFICATION_URL,
        services: SIX_SERVICES,
        file_created_at: six.createdAt,
        read_at: readAt,
      },
      target: { publisher: 'European Central Bank', title: 'What is T2?', url: ECB_T2_URL },
    },
  };
}
