/**
 * The address of the clearing calendar page, without its data: the footer is a
 * client component and links here on every page, so it must not pull the data
 * files into the browser. `clearing-calendar.test.ts` keeps the latest year
 * equal to the newest data file.
 */

export const CLEARING_CALENDAR_BASE = '/clearing-calendar';

/** The newest year with a data file in `data/clearing-calendar/`. */
export const LATEST_CLEARING_CALENDAR_YEAR = '2027';

export function clearingCalendarPath(year: string | number): string {
  return `${CLEARING_CALENDAR_BASE}/${year}`;
}
