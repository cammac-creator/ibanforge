/**
 * One-time corrective migration for the SIX BankMaster import bug.
 *
 * scripts/enrich-bic-database.ts previously hardcoded country_code='CH' for ALL
 * SIX BankMaster rows. But that file lists foreign euroSIC participants
 * (ING/NL, Starling/GB, all Liechtenstein banks, SECB/DE...). Their primary BIC
 * therefore resolved to the wrong country — e.g. a BIC lookup of INGBNL2AXXX
 * returned country=CH, city="BV Amsterdam" instead of NL / Amsterdam.
 *
 * This script fixes the already-built data/bic.sqlite. The seeder itself is now
 * fixed (country derived from BIC positions 5-6), so a future `npm run
 * bic:enrich` will not reintroduce the bug.
 *
 * Idempotent: once the data is correct, re-running it is a no-op.
 *
 * Run with: npx tsx scripts/fix-six-group-country.ts
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCountryName } from '../src/lib/countries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? resolve(__dirname, '../data/bic.sqlite');

// Same conservative city cleanup as the seeder (cleanSixCity).
function cleanSixCity(city: string): string {
  return city
    .replace(/^(BV|PP|NV)\s+/i, '')
    .replace(/,?\s+[A-Z]{2}\s+[\d-]+$/, '')
    .trim();
}

console.log(`Opening ${DB_PATH}`);
const db = new Database(DB_PATH);

const rows = db
  .prepare(
    `SELECT id, bic8, country_code, city FROM bic_entries WHERE source = 'six_group'`,
  )
  .all() as { id: number; bic8: string; country_code: string; city: string | null }[];

const update = db.prepare(
  `UPDATE bic_entries SET country_code = ?, country_name = ?, city = ? WHERE id = ?`,
);

let countryFixed = 0;
let cityCleaned = 0;

const run = db.transaction(() => {
  for (const row of rows) {
    const correctCC = row.bic8.slice(4, 6).toUpperCase();
    const cleanedCity = cleanSixCity(row.city ?? '');
    const ccChanged = row.country_code !== correctCC;
    const cityChanged = (row.city ?? '') !== cleanedCity;
    if (!ccChanged && !cityChanged) continue;
    const correctName = getCountryName(correctCC) ?? correctCC;
    update.run(correctCC, correctName, cleanedCity, row.id);
    if (ccChanged) countryFixed++;
    if (cityChanged) cityCleaned++;
  }
});
run();

console.log(`\n--- Results ---`);
console.log(`six_group rows scanned: ${rows.length}`);
console.log(`country_code fixed:     ${countryFixed}`);
console.log(`city cleaned:           ${cityCleaned}`);

const ing = db
  .prepare(
    `SELECT bic11, institution, country_code, country_name, city FROM bic_entries WHERE bic11 = 'INGBNL2AXXX'`,
  )
  .get();
console.log(`\nINGBNL2AXXX now:`, ing);

const remaining = db
  .prepare(
    `SELECT COUNT(*) n FROM bic_entries WHERE source='six_group' AND country_code <> upper(substr(bic8,5,2))`,
  )
  .get() as { n: number };
console.log(`Remaining country mismatches: ${remaining.n}`);

db.close();
console.log('Done.');
