import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addDays,
  buildClearingCalendar,
  daysOfYear,
  easterSunday,
  nonClearingWeekdays,
  parseSixCalendar,
  SIX_CALENDAR_CSV_URL,
  SIX_SERVICES,
  targetClosingDays,
  weekdayOf,
  type ClearingCalendarFile,
} from './clearing-calendar.js';
import {
  MAX_CALENDAR_BYTES,
  calendarPath,
  exportClearingCalendar,
} from './export-clearing-calendar.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HEADER = [
  'Calendar day',
  'Day of week',
  'Service identification',
  'Service description',
  'Clearing day',
  'Start of scheduled Downtime 1',
  'End of scheduled Downtime 1',
  'Start of scheduled Downtime 2',
  'End of scheduled Downtime 2',
  'Start of scheduled Downtime 3',
  'End of scheduled Downtime 3',
  'Scheduled clearing day change',
  'Scheduled clearing stop 1',
  'Scheduled clearing stop 2',
  'Scheduled clearing stop 3',
  'Scheduled cut-off 1',
  'Scheduled cut-off 2',
  'Next clearing day',
  '2026-11-18T18:53:00.016+01:00',
].join(';');

const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * An invented file in the shape of the specification: every day from `from` to
 * `to`, for each service, with the days of `holidays[service]` and the weekends
 * left without a clearing day of their own.
 */
function fakeFile(from: string, to: string, holidays: Record<string, string[]>): string {
  const lines = [HEADER];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    for (const service of Object.keys(holidays)) {
      const closed = (d: string) => [0, 6].includes(weekdayOf(d)) || holidays[service].includes(d);
      let next = day;
      while (closed(next)) next = addDays(next, 1);
      const clearing = next === day;
      const cells = new Array(18).fill('');
      cells[0] = day;
      cells[1] = NAMES[weekdayOf(day)];
      cells[2] = service;
      cells[3] = 'invented service';
      cells[4] = next;
      cells[11] = clearing ? 'Y' : 'N';
      lines.push(cells.join(';'));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

const SIC_HOLIDAYS = ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-06', '2027-05-17'];
const EUROSIC_HOLIDAYS = ['2027-01-01', '2027-03-26', '2027-03-29'];
const WHOLE_YEAR = fakeFile('2026-12-30', '2028-01-04', {
  PCR_P: SIC_HOLIDAYS,
  PER_P: EUROSIC_HOLIDAYS,
});

describe('reading the SIX file', () => {
  it('takes the creation stamp from the last header cell', () => {
    expect(parseSixCalendar(WHOLE_YEAR).createdAt).toBe('2026-11-18T18:53:00.016+01:00');
  });

  it('refuses a header that is not the one of the specification', () => {
    const shifted = WHOLE_YEAR.replace('Clearing day;', 'Settlement day;');
    expect(() => parseSixCalendar(shifted)).toThrow(/column 5/);
  });

  it('refuses a header without a creation stamp', () => {
    const noStamp = WHOLE_YEAR.replace(';2026-11-18T18:53:00.016+01:00', '');
    expect(() => parseSixCalendar(noStamp)).toThrow(/creation stamp/);
  });

  it('keeps the weekdays that are not clearing days, per service', () => {
    const { rows } = parseSixCalendar(WHOLE_YEAR);
    expect(nonClearingWeekdays(rows, SIX_SERVICES.sic, 2027)).toEqual(SIC_HOLIDAYS);
    expect(nonClearingWeekdays(rows, SIX_SERVICES.eurosic, 2027)).toEqual(EUROSIC_HOLIDAYS);
  });

  it('refuses a year the file no longer holds whole (it lists forthcoming days only)', () => {
    const fromMarch = fakeFile('2027-03-01', '2028-01-04', { PCR_P: SIC_HOLIDAYS });
    const { rows } = parseSixCalendar(fromMarch);
    expect(() => nonClearingWeekdays(rows, 'PCR_P', 2027)).toThrow(/no row for 2027-01-01/);
  });

  it('refuses a file that ends before 31 December', () => {
    const short = fakeFile('2026-12-30', '2027-12-30', { PCR_P: SIC_HOLIDAYS });
    const { rows } = parseSixCalendar(short);
    expect(() => nonClearingWeekdays(rows, 'PCR_P', 2027)).toThrow(/no row for 2027-12-31/);
  });

  it('refuses a weekday name that disagrees with the date', () => {
    const wrong = WHOLE_YEAR.replace('2027-01-04;Monday', '2027-01-04;Tuesday');
    const { rows } = parseSixCalendar(wrong);
    expect(() => nonClearingWeekdays(rows, 'PCR_P', 2027)).toThrow(/2027-01-04 is a Monday/);
  });

  it('refuses a clearing day that field 12 contradicts', () => {
    const wrong = WHOLE_YEAR.replace(
      /^(2027-01-04;Monday;PCR_P;invented service;2027-01-04(;[^;\r\n]*){6};)Y/m,
      '$1N',
    );
    expect(wrong).not.toBe(WHOLE_YEAR);
    const { rows } = parseSixCalendar(wrong);
    expect(() => nonClearingWeekdays(rows, 'PCR_P', 2027)).toThrow(/disagree/);
  });

  it('refuses a weekend listed as a clearing day', () => {
    const wrong = WHOLE_YEAR.replace(
      /^2027-01-02;Saturday;PCR_P;invented service;2027-01-04((;[^;\r\n]*){6});N/m,
      '2027-01-02;Saturday;PCR_P;invented service;2027-01-02$1;Y',
    );
    expect(wrong).not.toBe(WHOLE_YEAR);
    const { rows } = parseSixCalendar(wrong);
    expect(() => nonClearingWeekdays(rows, 'PCR_P', 2027)).toThrow(/a weekend, as a clearing day/);
  });
});

describe('the TARGET rule', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2038, '2038-04-25'],
  ])('Easter %i is %s', (year, easter) => {
    expect(easterSunday(year)).toBe(easter);
    expect(weekdayOf(easter)).toBe(0);
  });

  it('gives the six closing days the ECB lists for 2026, 2027 and 2028', () => {
    // ECB, "ECB public holidays", days marked "TARGET closing day", read on 18 November 2026.
    expect(targetClosingDays(2026)).toEqual([
      '2026-01-01',
      '2026-04-03',
      '2026-04-06',
      '2026-05-01',
      '2026-12-25',
      '2026-12-26',
    ]);
    expect(targetClosingDays(2027)).toEqual([
      '2027-01-01',
      '2027-03-26',
      '2027-03-29',
      '2027-05-01',
      '2027-12-25',
      '2027-12-26',
    ]);
    expect(targetClosingDays(2028)).toEqual([
      '2028-01-01',
      '2028-04-14',
      '2028-04-17',
      '2028-05-01',
      '2028-12-25',
      '2028-12-26',
    ]);
  });

  it('counts 365 and 366 days', () => {
    expect(daysOfYear(2027)).toHaveLength(365);
    expect(daysOfYear(2028)).toHaveLength(366);
  });
});

describe('the file the site reads', () => {
  it('is built from the two sources, with the stamp of the file read', () => {
    const file = buildClearingCalendar(WHOLE_YEAR, 2027, '2026-11-18T17:53:10.000Z');
    expect(file.closed_weekdays).toEqual({
      sic: SIC_HOLIDAYS,
      eurosic: EUROSIC_HOLIDAYS,
      target: ['2027-01-01', '2027-03-26', '2027-03-29'],
    });
    expect(file.target_closing_days).toEqual(targetClosingDays(2027));
    expect(file.sources.six.file_created_at).toBe('2026-11-18T18:53:00.016+01:00');
    expect(file.sources.six.read_at).toBe('2026-11-18T17:53:10.000Z');
  });

  it('frontend/data/clearing-calendar/2027.json agrees with the TARGET rule and holds dates only', () => {
    const committed = JSON.parse(
      readFileSync(resolve(ROOT, 'frontend/data/clearing-calendar/2027.json'), 'utf8'),
    ) as ClearingCalendarFile;
    expect(committed.year).toBe(2027);
    expect(committed.target_closing_days).toEqual(targetClosingDays(2027));
    expect(committed.closed_weekdays.target).toEqual(
      targetClosingDays(2027).filter((day) => ![0, 6].includes(weekdayOf(day))),
    );
    for (const days of Object.values(committed.closed_weekdays)) {
      for (const day of days) {
        expect(day).toMatch(/^2027-\d{2}-\d{2}$/);
        expect([0, 6]).not.toContain(weekdayOf(day));
      }
    }
    expect(committed.sources.six.services).toEqual(SIX_SERVICES);
  });
});

/**
 * The download and the write (review of PR 639, 18/11/2026): until then only the
 * builder was tested. Network simulated, file in a temporary folder, never
 * frontend/data/.
 */
describe('the export: download, cap and write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibf-calendrier-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const NOW = new Date('2026-11-18T17:53:10.000Z');

  function server(answer: () => Response) {
    const asked: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      asked.push(String(input));
      return answer();
    }) as typeof fetch;
    return { fetchImpl, asked };
  }

  it('writes the year it built, whole, at the path given, and nothing beside it', async () => {
    const out = join(dir, 'ecrit', '2027.json');
    const { fetchImpl, asked } = server(() => new Response(WHOLE_YEAR, { status: 200 }));
    const result = await exportClearingCalendar(2027, { fetchImpl, out, now: NOW });
    expect(asked).toEqual([SIX_CALENDAR_CSV_URL]);
    expect(result.out).toBe(out);
    expect(readFileSync(out, 'utf8')).toBe(
      JSON.stringify(buildClearingCalendar(WHOLE_YEAR, 2027, NOW.toISOString()), null, 2) + '\n',
    );
    expect(readdirSync(dirname(out))).toEqual(['2027.json']);
    expect(calendarPath(2027)).toBe(resolve(ROOT, 'frontend/data/clearing-calendar/2027.json'));
  });

  it('refuses a year that is not one, before any download', async () => {
    for (const year of [Number.NaN, 1999, 2101, 2027.5]) {
      const { fetchImpl, asked } = server(() => new Response(WHOLE_YEAR, { status: 200 }));
      await expect(
        exportClearingCalendar(year, { fetchImpl, out: join(dir, 'x.json') }),
      ).rejects.toThrow(/is not a year/);
      expect(asked).toEqual([]);
    }
    expect(existsSync(join(dir, 'x.json'))).toBe(false);
  });

  it.each([
    ['an HTTP refusal', () => new Response('unavailable', { status: 503 }), /HTTP 503/],
    [
      'a file announced over the cap',
      () =>
        new Response('x', {
          status: 200,
          headers: { 'content-length': String(MAX_CALENDAR_BYTES + 1) },
        }),
      /larger than/,
    ],
    [
      'a file streamed over the cap',
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < 6; i++) controller.enqueue(new Uint8Array(1_000_000));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      /larger than/,
    ],
    ['a file the builder refuses', () => new Response('not;a;calendar', { status: 200 }), /./],
  ])('%s: throws and writes nothing', async (_label, answer, why) => {
    const out = join(dir, 'refus', '2027.json');
    const { fetchImpl } = server(answer);
    await expect(exportClearingCalendar(2027, { fetchImpl, out, now: NOW })).rejects.toThrow(why);
    expect(existsSync(dirname(out)) ? readdirSync(dirname(out)) : []).toEqual([]);
  });
});
