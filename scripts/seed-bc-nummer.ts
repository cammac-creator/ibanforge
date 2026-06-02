/**
 * IBANforge — Seed Swiss BC-Nummer (SIX BankMaster) into bic.sqlite
 *
 * Downloads the SIX BankMaster CSV V3, parses it, and inserts into the
 * ch_clearing table in data/bic.sqlite.
 *
 * Usage: npx tsx scripts/seed-bc-nummer.ts
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const BIC_DB_PATH = resolve(__dirname, '../data/bic.sqlite');
const CSV_URL = 'https://api.six-group.com/api/epcd/bankmaster/v3/bankmaster_V3.csv';

// Sanity floor: the live SIX BankMaster has ~1190 institutions. If a fetch
// returns far fewer (truncated download, upstream incident, format change that
// our parser silently mangles), we MUST NOT drop the good table and replace it
// with garbage — especially under the unattended monthly cron. Abort loudly
// *before* touching the DB and let the existing data stand.
const MIN_EXPECTED_ROWS = 800;

function zeroPad(value: string | number, length = 5): string {
  return String(value).padStart(length, '0');
}

function yesNo(value: string): number {
  return value?.trim().toUpperCase() === 'Y' ? 1 : 0;
}

async function downloadCSV(): Promise<string> {
  console.log(`Downloading BankMaster CSV from ${CSV_URL}...`);

  let response = await fetch(CSV_URL, { redirect: 'follow' });

  // Follow one concatenation redirect if needed
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      console.log(`Following redirect to ${location}...`);
      response = await fetch(location, { redirect: 'follow' });
    }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  console.log(`Downloaded ${text.length} bytes`);
  return text;
}

function parseCSV(csvText: string): Array<Record<string, string>> {
  const lines = csvText.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV has fewer than 2 lines');
  }

  // Parse header — the last column contains a timestamp in braces, ignore it
  const rawHeaders = lines[0].split(';');
  const headers = rawHeaders
    .map((h) => h.trim())
    .filter((h) => !h.startsWith('{') && h.length > 0);

  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cols[j] ?? '').trim();
    }
    rows.push(row);
  }

  return rows;
}

interface ClearingRow {
  iid: string;
  valid_on: string | null;
  concatenation: number;
  redirect_iid: string | null;
  sic_iid: string | null;
  headquarters_iid: string | null;
  iid_type: number | null;
  qr_iid: string | null;
  name: string;
  street: string | null;
  building_number: string | null;
  post_code: string | null;
  town: string | null;
  country: string | null;
  bic: string | null;
  sic_participation: number;
  rtgs_chf: number;
  ip_chf: number;
  eurosic_participation: number;
  lsv_bdd_chf: number;
  lsv_bdd_eur: number;
}

function transformRow(row: Record<string, string>): ClearingRow | null {
  const rawIid = row['IID/QR-IID'];
  if (!rawIid || rawIid.trim() === '') return null;

  const iid = zeroPad(rawIid);
  const concatenation = yesNo(row['Concatenation']);
  const name = row['Name of bank/institution'] ?? '';

  // For concatenated entries with no name, still store the redirect
  if (concatenation === 1 && name === '') {
    const redirectIid = row['New IID/QR-IID'] ? zeroPad(row['New IID/QR-IID']) : null;
    return {
      iid,
      valid_on: row['Valid on'] || null,
      concatenation: 1,
      redirect_iid: redirectIid,
      sic_iid: null,
      headquarters_iid: null,
      iid_type: null,
      qr_iid: null,
      name: '',
      street: null,
      building_number: null,
      post_code: null,
      town: null,
      country: null,
      bic: null,
      sic_participation: 0,
      rtgs_chf: 0,
      ip_chf: 0,
      eurosic_participation: 0,
      lsv_bdd_chf: 0,
      lsv_bdd_eur: 0,
    };
  }

  // Skip rows with no name and no redirect (empty rows)
  if (name === '') return null;

  const redirectIid = concatenation === 1 && row['New IID/QR-IID']
    ? zeroPad(row['New IID/QR-IID'])
    : null;

  const headquartersRaw = row['Headquarters'];
  const headquarters_iid = headquartersRaw ? zeroPad(headquartersRaw) : null;

  const iidTypeRaw = parseInt(row['IID type'] ?? '', 10);
  const iid_type = [1, 2, 4].includes(iidTypeRaw) ? iidTypeRaw : null;

  // QR-IID is its OWN allocation column, distinct from the clearing IID. They
  // coincide for only a handful of institutions (e.g. UBS) and differ for most
  // (e.g. PostFinance iid=30000 → qr_iid=09000). An audit flagged "qr_iid looks
  // wrong" — verified false positive: the column mapping is correct, the values
  // are genuinely independent. Do NOT "fix" this by sourcing it from iid.
  const qrIidRaw = row['QR-IID allocation'];
  const qr_iid = qrIidRaw && qrIidRaw.trim() !== '' ? zeroPad(qrIidRaw) : null;

  return {
    iid,
    valid_on: row['Valid on'] || null,
    concatenation,
    redirect_iid: redirectIid,
    sic_iid: row['SIC IID'] || null,
    headquarters_iid,
    iid_type,
    qr_iid,
    name,
    street: row['Street Name'] || null,
    building_number: row['Building Number'] || null,
    post_code: row['Post Code'] || null,
    town: row['Town Name'] || null,
    country: row['Country'] || null,
    bic: row['BIC'] || null,
    sic_participation: yesNo(row['SIC participation']),
    rtgs_chf: yesNo(row['RTGS customer payments, CHF']),
    ip_chf: yesNo(row['IP customer payments, CHF']),
    eurosic_participation: yesNo(row['euroSIC participation']),
    lsv_bdd_chf: yesNo(row['LSV+/BDD, CHF']),
    lsv_bdd_eur: yesNo(row['LSV+/BDD, EUR']),
  };
}

async function main() {
  const csvText = await downloadCSV();
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} CSV rows`);

  if (rows.length < MIN_EXPECTED_ROWS) {
    throw new Error(
      `Sanity floor: parsed ${rows.length} rows but expected at least ${MIN_EXPECTED_ROWS}. ` +
        `Refusing to drop ch_clearing — keeping the existing table intact. ` +
        `Check the SIX BankMaster feed (${CSV_URL}).`,
    );
  }

  // Open database in read-write mode (NOT via getBicDB which is readonly)
  const db = new Database(BIC_DB_PATH);
  db.pragma('journal_mode = WAL');

  // Drop and recreate table
  db.exec('DROP TABLE IF EXISTS ch_clearing');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ch_clearing (
      iid              TEXT PRIMARY KEY,
      valid_on         TEXT,
      concatenation    INTEGER DEFAULT 0,
      redirect_iid     TEXT,
      sic_iid          TEXT,
      headquarters_iid TEXT,
      iid_type         INTEGER,
      qr_iid           TEXT,
      name             TEXT NOT NULL,
      street           TEXT,
      building_number  TEXT,
      post_code        TEXT,
      town             TEXT,
      country          TEXT DEFAULT 'CH',
      bic              TEXT,
      sic_participation       INTEGER DEFAULT 0,
      rtgs_chf               INTEGER DEFAULT 0,
      ip_chf                 INTEGER DEFAULT 0,
      eurosic_participation  INTEGER DEFAULT 0,
      lsv_bdd_chf           INTEGER DEFAULT 0,
      lsv_bdd_eur           INTEGER DEFAULT 0,
      updated_at       TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_ch_clearing_bic ON ch_clearing(bic)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ch_clearing_hq ON ch_clearing(headquarters_iid)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ch_clearing_name ON ch_clearing(name)');

  const insert = db.prepare(`
    INSERT OR REPLACE INTO ch_clearing (
      iid, valid_on, concatenation, redirect_iid, sic_iid,
      headquarters_iid, iid_type, qr_iid, name, street,
      building_number, post_code, town, country, bic,
      sic_participation, rtgs_chf, ip_chf, eurosic_participation,
      lsv_bdd_chf, lsv_bdd_eur
    ) VALUES (
      @iid, @valid_on, @concatenation, @redirect_iid, @sic_iid,
      @headquarters_iid, @iid_type, @qr_iid, @name, @street,
      @building_number, @post_code, @town, @country, @bic,
      @sic_participation, @rtgs_chf, @ip_chf, @eurosic_participation,
      @lsv_bdd_chf, @lsv_bdd_eur
    )
  `);

  let inserted = 0;
  let skipped = 0;
  let concatenated = 0;
  let hqCount = 0;
  let branchCount = 0;
  let otherCount = 0;
  const countries = new Set<string>();

  const insertAll = db.transaction(() => {
    for (const row of rows) {
      const transformed = transformRow(row);
      if (!transformed) {
        skipped++;
        continue;
      }

      insert.run(transformed);
      inserted++;

      if (transformed.concatenation === 1) concatenated++;
      if (transformed.iid_type === 1) hqCount++;
      else if (transformed.iid_type === 2) branchCount++;
      else if (transformed.iid_type === 4) otherCount++;
      if (transformed.country) countries.add(transformed.country);
    }
  });

  insertAll();

  // Count cantonal banks
  const cantonalCount = (
    db.prepare(
      "SELECT COUNT(*) as cnt FROM ch_clearing WHERE name LIKE '%Kantonalbank%' OR name LIKE '%Banque Cantonale%' OR name LIKE '%Banca dello Stato%' OR name LIKE '%Banca cantonale%'"
    ).get() as { cnt: number }
  ).cnt;

  // Count PostFinance entries
  const postfinanceCount = (
    db.prepare(
      "SELECT COUNT(*) as cnt FROM ch_clearing WHERE name LIKE '%PostFinance%'"
    ).get() as { cnt: number }
  ).cnt;

  // Count Raiffeisen entries
  const raiffeisenCount = (
    db.prepare(
      "SELECT COUNT(*) as cnt FROM ch_clearing WHERE name LIKE 'Raiffeisen%'"
    ).get() as { cnt: number }
  ).cnt;

  db.close();

  console.log('\n--- Swiss BC-Nummer Seed Results ---');
  console.log(`Total CSV rows:    ${rows.length}`);
  console.log(`Inserted:          ${inserted}`);
  console.log(`Skipped:           ${skipped}`);
  console.log(`Concatenated:      ${concatenated}`);
  console.log(`Headquarters:      ${hqCount}`);
  console.log(`Branches:          ${branchCount}`);
  console.log(`Other:             ${otherCount}`);
  console.log(`Countries:         ${[...countries].sort().join(', ')}`);
  console.log(`Cantonal banks:    ${cantonalCount}`);
  console.log(`PostFinance:       ${postfinanceCount}`);
  console.log(`Raiffeisen:        ${raiffeisenCount}`);
  console.log('\nDone! ch_clearing table seeded in data/bic.sqlite');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
