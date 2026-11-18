/**
 * Write `frontend/data/clearing-calendar/{year}.json`, the data of the site's
 * page `/clearing-calendar/{year}`, from the Clearing Day Calendar of SIX
 * Interbank Clearing and the TARGET rule of the ECB (see clearing-calendar.ts).
 *
 *   npm run pages:export-calendar -- 2027
 *
 * SIX says its calendar is "updated daily at around 4:30 pm"; the file only lists
 * forthcoming days: run it before 1 January of the year, or it refuses. The
 * JSON is committed so that the site's build needs nothing but the repository.
 *
 * The download is capped while it is received (review of PR 639, 18/11/2026): a
 * check after `arrayBuffer()` kept an oversized file from being parsed, but bounded
 * neither the download nor the memory. Importing this module downloads nothing.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCappedBody } from './bounded-read.js';
import {
  buildClearingCalendar,
  SIX_CALENDAR_CSV_URL,
  type ClearingCalendarFile,
} from './clearing-calendar.js';

/** The real file weighs about 200 kB: anything far larger is refused while it arrives. */
export const MAX_CALENDAR_BYTES = 5_000_000;

/** Where the site reads the file of a year. */
export function calendarPath(year: number): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../frontend/data/clearing-calendar/${year}.json`,
  );
}

/**
 * Download the SIX file, build the year and write it (a neighbour, then a rename).
 * Throws, and writes nothing, on a year that is not one, an HTTP refusal, a file
 * over the cap or a file `buildClearingCalendar` refuses.
 */
export async function exportClearingCalendar(
  year: number,
  options: { fetchImpl?: typeof fetch; out?: string; now?: Date } = {},
): Promise<{ out: string; file: ClearingCalendarFile }> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new Error(`clearing calendar: "${year}" is not a year`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(SIX_CALENDAR_CSV_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`SIX calendar: HTTP ${response.status}`);
  const bytes = await readCappedBody(response, MAX_CALENDAR_BYTES, 'SIX calendar');
  const text = new TextDecoder('utf-8').decode(bytes);
  const file = buildClearingCalendar(text, year, (options.now ?? new Date()).toISOString());
  const out = options.out ?? calendarPath(year);
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n');
  renameSync(tmp, out);
  return { out, file };
}

async function main(): Promise<void> {
  const year = Number(process.argv[2]);
  if (!Number.isInteger(year)) {
    console.error('Usage: npm run pages:export-calendar -- <year>');
    process.exit(1);
  }
  const { out, file } = await exportClearingCalendar(year);
  console.log(`${out}`);
  console.log(`SIX file created at ${file.sources.six.file_created_at}`);
  for (const [system, days] of Object.entries(file.closed_weekdays)) {
    console.log(`${system}: ${days.length} weekday(s) closed: ${days.join(', ')}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
