/**
 * Write `frontend/data/clearing-calendar/{year}.json`, the data of the site's
 * page `/clearing-calendar/{year}`, from the Clearing Day Calendar of SIX
 * Interbank Clearing and the TARGET rule of the ECB (see clearing-calendar.ts).
 *
 *   npm run pages:export-calendar -- 2027
 *
 * SIX regenerates its file every working day at about 16:30 CET and only lists
 * forthcoming days: run it before 1 January of the year, or it refuses. The
 * JSON is committed so that the site's build needs nothing but the repository.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClearingCalendar, SIX_CALENDAR_CSV_URL } from './clearing-calendar.js';

const year = Number(process.argv[2]);
if (!Number.isInteger(year)) {
  console.error('Usage: npm run pages:export-calendar -- <year>');
  process.exit(1);
}

const response = await fetch(SIX_CALENDAR_CSV_URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`SIX calendar: HTTP ${response.status}`);
const text = await response.text();
const file = buildClearingCalendar(text, year, new Date().toISOString());

const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  `../frontend/data/clearing-calendar/${year}.json`,
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(file, null, 2) + '\n');

console.log(`${out}`);
console.log(`SIX file created at ${file.sources.six.file_created_at}`);
for (const [system, days] of Object.entries(file.closed_weekdays)) {
  console.log(`${system}: ${days.length} weekday(s) closed: ${days.join(', ')}`);
}
