import { describe, expect, it } from 'vitest';
import {
  calendarFile,
  calendarYears,
  closedSystems,
  dateRows,
  dayKind,
  differingDays,
  LATEST_CLEARING_CALENDAR_YEAR,
  latestCalendarYear,
  monthGrids,
  NAMED_DAYS,
  stampParts,
  systemsOf,
  weekendNamedDays,
} from './clearing-calendar';
import { formatDayMonthWords, monthWords, weekdayWords } from './date-words';

/**
 * The second reading of every date the page publishes.
 *
 * The data file is read from the CSV of SIX and from the ECB's rule
 * (scripts/export-clearing-calendar.ts). These two lists are the published
 * tables, copied by hand on 18 November 2026, so that a wrong file, a wrong
 * rule or a change at the source fails here before it reaches the page:
 *
 *  - SIX Interbank Clearing, "Schedule of clearing days 2027" (PDF, English,
 *    created 28 September 2026):
 *    https://www.six-group.com/dam/download/banking-services/interbank-clearing/en/payment_services/sic/banking-holidays.pdf
 *    (the German address serves the same English file; the French one carries
 *    other years under a 2027 title and is not used);
 *  - ECB, "ECB public holidays", the days of 2027 marked "TARGET closing day":
 *    https://www.ecb.europa.eu/ecb/contacts/working-hours/html/index.en.html
 */

/** [day, SIC clearing day, euroSIC clearing day], the 2027 rows of the SIX table. */
const SIX_SCHEDULE_2027: [string, boolean, boolean][] = [
  ['2027-01-01', false, false],
  ['2027-01-02', false, false],
  ['2027-03-26', false, false],
  ['2027-03-29', false, false],
  ['2027-05-01', false, false],
  ['2027-05-06', false, true],
  ['2027-05-17', false, true],
  ['2027-08-01', false, false],
  ['2027-12-24', true, true],
  ['2027-12-25', false, false],
  ['2027-12-26', false, false],
  ['2027-12-31', true, true],
];

const ECB_TARGET_CLOSING_2027 = ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-12-25', '2027-12-26'];

const file = calendarFile('2027')!;
const weekend = (day: string) => ['Saturday', 'Sunday'].includes(weekdayWords(day, 'en'));

describe('2027: the data file against the published tables', () => {
  it('the file exists and covers the three systems', () => {
    expect(calendarYears()).toEqual(['2027']);
    expect(latestCalendarYear()).toBe('2027');
    // The footer links to the latest year without loading the data.
    expect(LATEST_CLEARING_CALENDAR_YEAR).toBe(latestCalendarYear());
    expect(file.year).toBe(2027);
    expect(systemsOf(file)).toEqual(['sic', 'eurosic', 'target']);
  });

  it.each(SIX_SCHEDULE_2027.filter(([day]) => !weekend(day)))(
    '%s: SIC clearing day %s, euroSIC clearing day %s, as in the SIX schedule',
    (day, sic, eurosic) => {
      expect(file.closed_weekdays.sic?.includes(day)).toBe(!sic);
      expect(file.closed_weekdays.eurosic?.includes(day)).toBe(!eurosic);
    },
  );

  it('every weekday the file closes in SIC or euroSIC is a "No" of the SIX schedule', () => {
    const no = (index: 1 | 2) => SIX_SCHEDULE_2027.filter((row) => !row[index]).map(([day]) => day);
    for (const day of file.closed_weekdays.sic ?? []) expect(no(1)).toContain(day);
    for (const day of file.closed_weekdays.eurosic ?? []) expect(no(2)).toContain(day);
  });

  it('the TARGET closing days are the ECB list, and the closed weekdays its weekdays', () => {
    expect(file.target_closing_days).toEqual(ECB_TARGET_CLOSING_2027);
    expect(file.closed_weekdays.target).toEqual(ECB_TARGET_CLOSING_2027.filter((day) => !weekend(day)));
  });

  it('the named days are the 2027 rows of the SIX schedule, and cover every TARGET closing day', () => {
    expect(Object.keys(NAMED_DAYS['2027']).sort()).toEqual(SIX_SCHEDULE_2027.map(([day]) => day));
    for (const day of ECB_TARGET_CLOSING_2027) expect(NAMED_DAYS['2027'][day]).toBeDefined();
  });

  it('every closed weekday has a name', () => {
    for (const system of systemsOf(file)) {
      for (const day of file.closed_weekdays[system] ?? []) expect(NAMED_DAYS['2027'][day]).toBeDefined();
    }
  });

  it('the creation stamp of the SIX file is dated and readable', () => {
    const { day, time } = stampParts(file.sources.six.file_created_at);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day < '2027-01-01').toBe(true);
    expect(time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('what the page derives', () => {
  it('Ascension and Whit Monday are the only days where the systems differ', () => {
    expect(differingDays(file)).toEqual(['2027-05-06', '2027-05-17']);
    expect(closedSystems(file, '2027-05-06')).toEqual(['sic']);
    expect(closedSystems(file, '2027-05-17')).toEqual(['sic']);
  });

  it('the table lists the closed weekdays and the two eves, in date order', () => {
    expect(dateRows(file).map((row) => [row.day, row.holiday, row.closed.join('+')])).toEqual([
      ['2027-01-01', 'newYear', 'sic+eurosic+target'],
      ['2027-03-26', 'goodFriday', 'sic+eurosic+target'],
      ['2027-03-29', 'easterMonday', 'sic+eurosic+target'],
      ['2027-05-06', 'ascension', 'sic'],
      ['2027-05-17', 'whitMonday', 'sic'],
      ['2027-12-24', 'christmasEve', ''],
      ['2027-12-31', 'newYearsEve', ''],
    ]);
  });

  it('five named days fall on a weekend', () => {
    expect(weekendNamedDays(file)).toEqual(['2027-01-02', '2027-05-01', '2027-08-01', '2027-12-25', '2027-12-26']);
  });

  it('the year view has 365 days, weeks from Monday, and the right kinds', () => {
    const grids = monthGrids(2027);
    expect(grids).toHaveLength(12);
    expect(grids.reduce((n, g) => n + g.days.length, 0)).toBe(365);
    // 1 January 2027 is a Friday: four empty cells before it.
    expect(grids[0].offset).toBe(4);
    // 1 February 2027 is a Monday.
    expect(grids[1].offset).toBe(0);
    expect(dayKind(file, '2027-01-01')).toBe('all');
    expect(dayKind(file, '2027-05-06')).toBe('partial');
    expect(dayKind(file, '2027-05-08')).toBe('weekend');
    expect(dayKind(file, '2027-05-07')).toBe('open');
  });
});

describe('dates in words', () => {
  it('names the day of the week in the three languages', () => {
    expect(weekdayWords('2027-03-26', 'en')).toBe('Friday');
    expect(weekdayWords('2027-03-26', 'fr')).toBe('vendredi');
    expect(weekdayWords('2027-03-26', 'de')).toBe('Freitag');
    expect(weekdayWords('2027-05-17', 'de')).toBe('Montag');
  });

  it('writes a day without its year', () => {
    expect(formatDayMonthWords('2027-05-06', 'en')).toBe('6 May');
    expect(formatDayMonthWords('2027-05-06', 'de')).toBe('6. Mai');
    expect(formatDayMonthWords('2027-05-01', 'fr')).toBe('1er mai');
    expect(monthWords(3, 'de')).toBe('März');
  });
});
