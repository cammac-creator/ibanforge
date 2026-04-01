/**
 * Enrichment script: fills country_name from country_code using ISO mapping.
 * Run with: npm run db:enrich  (or: npx tsx scripts/enrich-lei.ts)
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCountryName } from '../src/lib/countries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? resolve(__dirname, '../data/bic.sqlite');

console.log(`Opening database: ${DB_PATH}`);
const db = new Database(DB_PATH);

// Find rows that have a country_code but no country_name
const rows = db
  .prepare(
    `SELECT id, country_code FROM bic_entries
     WHERE country_name IS NULL AND country_code IS NOT NULL`
  )
  .all() as { id: number; country_code: string }[];

console.log(`Found ${rows.length} rows with missing country_name.`);

if (rows.length === 0) {
  console.log('Nothing to update.');
  db.close();
  process.exit(0);
}

const update = db.prepare(
  `UPDATE bic_entries SET country_name = ? WHERE id = ?`
);

let updated = 0;
let unmapped = 0;
const unmappedCodes = new Set<string>();

const runTransaction = db.transaction(() => {
  for (const row of rows) {
    const name = getCountryName(row.country_code);
    if (name) {
      const result = update.run(name, row.id);
      updated += result.changes;
    } else {
      unmapped++;
      unmappedCodes.add(row.country_code);
    }
  }
});

runTransaction();

console.log(`\n--- Results ---`);
console.log(`Updated:  ${updated}`);
console.log(`Unmapped: ${unmapped}`);
if (unmappedCodes.size > 0) {
  console.log(`Unmapped codes: ${[...unmappedCodes].sort().join(', ')}`);
}

db.close();
console.log('Done.');
