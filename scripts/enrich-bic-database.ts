/**
 * BIC database enrichment script.
 * Merges additional BIC sources into bic.sqlite (GLEIF remains authoritative).
 *
 * Sources:
 * 1. PeterNotenboom/SwiftCodes (112K BICs, MIT, GitHub)
 * 2. Deutsche Bundesbank BLZ file (BLZ→BIC mapping, quarterly)
 * 3. SIX Group Bank Master (Swiss BC→BIC, daily)
 *
 * Run with: npm run bic:enrich
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, existsSync, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { execSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import { getCountryName } from '../src/lib/countries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
const BIC_DB_PATH = resolve(DATA_DIR, 'bic.sqlite');
const TMP_DIR = resolve(__dirname, '../.tmp-bic-enrich');

/**
 * SIX BankMaster TOWN values occasionally carry a company-form prefix
 * (e.g. "BV Amsterdam") or a trailing state+ZIP ("New York, NY 1006-3053").
 * Strip those conservatively without touching legitimate city names.
 */
function cleanSixCity(city: string): string {
  return city
    .replace(/^(BV|PP|NV)\s+/i, '')
    .replace(/,?\s+[A-Z]{2}\s+[\d-]+$/, '')
    .trim();
}

// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`  Downloading ${url}...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!res.body) throw new Error(`No body for ${url}`);
  const fileStream = createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), fileStream);
}

function parseCsvLine(line: string, sep = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Source 1: PeterNotenboom/SwiftCodes (112K BICs, MIT)
// ---------------------------------------------------------------------------

async function importSwiftCodes(db: Database.Database): Promise<number> {
  console.log('\n[1/3] Importing PeterNotenboom/SwiftCodes...');

  const repoDir = resolve(TMP_DIR, 'SwiftCodes');
  if (!existsSync(repoDir)) {
    console.log('  Cloning repository...');
    execSync(`git clone --depth 1 https://github.com/PeterNotenboom/SwiftCodes.git ${repoDir}`, { stdio: 'pipe' });
  }

  const countriesDir = resolve(repoDir, 'AllCountries');
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(countriesDir).filter(f => f.endsWith('.json')).sort();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, branch_info, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'swiftcodes')
  `);

  let count = 0;
  const batch: Array<[string, string, string, string, string, string, string, string | null]> = [];

  for (const file of files) {
    const raw = await readFile(resolve(countriesDir, file), 'utf-8');
    const data = JSON.parse(raw);
    const cc = data.country_code ?? file.replace('.json', '');
    const countryName = data.country ?? '';

    for (const entry of data.list ?? []) {
      const sc = entry.swift_code ?? '';
      if (sc.length < 8) continue;

      const bic8 = sc.slice(0, 8);
      const bic11 = sc.length === 11 ? sc : sc + 'XXX';
      const branchCode = bic11.slice(8);
      const institution = entry.bank ?? '';
      const city = entry.city ?? '';
      const branchInfo = entry.branch ?? null;

      batch.push([bic8, bic11, institution, cc, countryName, city, branchCode, branchInfo]);
      count++;
    }
  }

  // Insert in one transaction
  const insertBatch = db.transaction((rows: typeof batch) => {
    for (const row of rows) insert.run(...row);
  });
  insertBatch(batch);

  console.log(`  SwiftCodes: ${count} entries processed, ${files.length} countries`);
  return count;
}

// ---------------------------------------------------------------------------
// Source 2: Deutsche Bundesbank BLZ (quarterly)
// ---------------------------------------------------------------------------

async function importBundesbank(db: Database.Database): Promise<number> {
  console.log('\n[2/3] Importing Deutsche Bundesbank BLZ...');

  const csvPath = resolve(TMP_DIR, 'bundesbank_blz.csv');
  try {
    await downloadFile(
      'https://www.bundesbank.de/resource/blob/926192/d4d7565b2a5c1ad4045c0cf8e3ce1a4e/mL/blz-aktuell-csv-data.csv',
      csvPath,
    );
  } catch {
    console.warn('  WARNING: Bundesbank download failed, trying alternative URL...');
    await downloadFile(
      'https://www.bundesbank.de/resource/blob/602632/8e0da085f3d1bc8adbc7a1f6c0284e1f/mL/blz-aktuell-csv-data.csv',
      csvPath,
    );
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, source)
    VALUES (?, ?, ?, 'DE', 'Germany', ?, ?, 'bundesbank')
  `);

  let count = 0;
  let headerParsed = false;
  let bicIdx = -1, nameIdx = -1, cityIdx = -1;

  const rl = createInterface({ input: createReadStream(csvPath, { encoding: 'latin1' }), crlfDelay: Infinity });

  const rows: Array<[string, string, string, string, string]> = [];

  for await (const line of rl) {
    const cols = parseCsvLine(line, ';');
    if (!headerParsed) {
      bicIdx = cols.findIndex(c => c.toUpperCase().includes('BIC'));
      nameIdx = cols.findIndex(c => c.toUpperCase().includes('BEZEICHNUNG'));
      cityIdx = cols.findIndex(c => c.toUpperCase().includes('ORT'));
      headerParsed = true;
      continue;
    }

    const bic = cols[bicIdx]?.trim();
    if (!bic || bic.length < 8) continue;

    const bic8 = bic.slice(0, 8);
    const bic11 = bic.length === 11 ? bic : bic + 'XXX';
    const name = cols[nameIdx]?.trim() ?? '';
    const city = cols[cityIdx]?.trim() ?? '';
    const branchCode = bic11.slice(8);

    rows.push([bic8, bic11, name, city, branchCode]);
    count++;
  }

  const insertBatch = db.transaction((r: typeof rows) => {
    for (const row of r) insert.run(...row);
  });
  insertBatch(rows);

  console.log(`  Bundesbank: ${count} entries processed`);
  return count;
}

// ---------------------------------------------------------------------------
// Source 3: SIX Group Bank Master (Switzerland, daily)
// ---------------------------------------------------------------------------

async function importSixBankMaster(db: Database.Database): Promise<number> {
  console.log('\n[3/3] Importing SIX Group Bank Master...');

  const csvPath = resolve(TMP_DIR, 'six_bankmaster.csv');
  await downloadFile('https://api.six-group.com/api/epcd/bankmaster/v3/bankmaster_V3.csv', csvPath);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'six_group')
  `);

  let count = 0;
  let headerParsed = false;
  let bicIdx = -1, nameIdx = -1, cityIdx = -1;

  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

  const rows: Array<[string, string, string, string, string, string, string]> = [];

  for await (const line of rl) {
    const cols = parseCsvLine(line, ';');
    if (!headerParsed) {
      bicIdx = cols.findIndex(c => c.toUpperCase().includes('BIC'));
      nameIdx = cols.findIndex(c => c.toUpperCase().includes('NAME'));
      cityIdx = cols.findIndex(c => c.toUpperCase().includes('TOWN'));
      headerParsed = true;
      continue;
    }

    const bic = cols[bicIdx]?.trim();
    if (!bic || bic.length < 8) continue;

    const bic8 = bic.slice(0, 8);
    const bic11 = bic.length === 11 ? bic : bic + 'XXX';
    const name = cols[nameIdx]?.trim() ?? '';
    const city = cleanSixCity(cols[cityIdx]?.trim() ?? '');
    const branchCode = bic11.slice(8);

    // Country from the BIC itself (positions 5-6), not hardcoded CH: the SIX
    // BankMaster includes foreign euroSIC participants (ING/NL, Starling/GB,
    // all Liechtenstein banks, SECB/DE...) whose BIC country code is not CH.
    const countryCode = bic8.slice(4, 6).toUpperCase();
    const countryName = getCountryName(countryCode) ?? countryCode;

    rows.push([bic8, bic11, name, countryCode, countryName, city, branchCode]);
    count++;
  }

  const insertBatch = db.transaction((r: typeof rows) => {
    for (const row of r) insert.run(...row);
  });
  insertBatch(rows);

  console.log(`  SIX Group: ${count} entries processed`);
  return count;
}

// ---------------------------------------------------------------------------
// Source 4: OeNB Austria (daily)
// ---------------------------------------------------------------------------

async function importOeNB(db: Database.Database): Promise<number> {
  console.log('\n[4/5] Importing OeNB Austria...');

  const csvPath = resolve(TMP_DIR, 'oenb.csv');
  await downloadFile('https://www.oenb.at/docroot/downloads_observ/sepa-zv-vz_gesamt.csv', csvPath);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, source)
    VALUES (?, ?, ?, 'AT', 'Austria', ?, ?, 'oenb')
  `);

  const raw = await readFile(csvPath, 'latin1');
  const lines = raw.split('\n');
  let headerParsed = false;
  let bicIdx = -1, nameIdx = -1, cityIdx = -1;
  const rows: Array<[string, string, string, string, string]> = [];

  for (const line of lines) {
    const cols = parseCsvLine(line, ';');
    if (!headerParsed) {
      if (cols.some(c => c.toUpperCase().includes('SWIFT'))) {
        bicIdx = cols.findIndex(c => c.toUpperCase().includes('SWIFT'));
        nameIdx = cols.findIndex(c => c.toUpperCase().includes('BANKENNAME') || c.toUpperCase().includes('NAME'));
        cityIdx = cols.findIndex(c => c.toUpperCase() === 'ORT');
        headerParsed = true;
      }
      continue;
    }

    const bic = cols[bicIdx]?.trim();
    if (!bic || bic.length < 8) continue;

    const bic8 = bic.slice(0, 8);
    const bic11 = bic.length === 11 ? bic : bic + 'XXX';
    const name = cols[nameIdx]?.trim() ?? '';
    const city = cols[cityIdx]?.trim() ?? '';

    rows.push([bic8, bic11, name, city, bic11.slice(8)]);
  }

  const insertBatch = db.transaction((r: typeof rows) => {
    for (const row of r) insert.run(...row);
  });
  insertBatch(rows);

  console.log(`  OeNB Austria: ${rows.length} entries processed`);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Source 5: NBP Poland (EWIB)
// ---------------------------------------------------------------------------

async function importNBP(db: Database.Database): Promise<number> {
  console.log('\n[5/5] Importing NBP Poland (EWIB)...');

  const txtPath = resolve(TMP_DIR, 'nbp_ewib.txt');
  await downloadFile('https://ewib.nbp.pl/faces/PlainDok?dokNazwa=plewibnra.txt', txtPath);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, source)
    VALUES (?, ?, ?, 'PL', 'Poland', ?, ?, 'nbp')
  `);

  const raw = await readFile(txtPath, 'latin1');
  const lines = raw.split('\n');
  const rows: Array<[string, string, string, string, string]> = [];

  for (const line of lines) {
    // Tab-separated, BIC is around column 20-21
    const cols = line.split('\t');
    if (cols.length < 21) continue;

    // Find BIC-like values in columns 20-21 (0-indexed: 19-20)
    for (const idx of [19, 20]) {
      const bic = cols[idx]?.trim();
      if (!bic || bic.length < 8 || !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}/.test(bic)) continue;

      const bic8 = bic.slice(0, 8);
      const bic11 = bic.length === 11 ? bic : bic + 'XXX';
      const name = cols[1]?.trim() ?? '';
      const city = cols[7]?.trim() ?? '';

      rows.push([bic8, bic11, name, city, bic11.slice(8)]);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = rows.filter(r => {
    if (seen.has(r[1])) return false;
    seen.add(r[1]);
    return true;
  });

  const insertBatch = db.transaction((r: typeof deduped) => {
    for (const row of r) insert.run(...row);
  });
  insertBatch(deduped);

  console.log(`  NBP Poland: ${deduped.length} entries processed`);
  return deduped.length;
}

// ---------------------------------------------------------------------------
// Source 6: EBA Clearing STEP2 SCT (SEPA Reachable PSPs, monthly)
// Official directory of all PSPs reachable via STEP2 SCT — covers entire
// SEPA zone (32+ countries). Used to give France (and other SEPA markets)
// an authoritative source beyond the SwiftCodes aggregate.
// ---------------------------------------------------------------------------

async function importEbaStep2(db: Database.Database): Promise<number> {
  console.log('\n[6/6] Importing EBA Step2 SCT (official SEPA PSPs)...');

  const xlsxPath = resolve(TMP_DIR, 'eba_step2_sct.xlsx');

  // EBA publishes the file on the 5th of each month with filename `YYYYMM05-...xlsx`,
  // but uploads it into the WordPress folder of the *previous* month
  // (e.g., the file dated 2026-05-05 lives at /2026/04/...). We try both
  // conventions just in case EBA's upload policy changes.
  const now = new Date();
  const candidates: string[] = [];
  for (let i = 0; i < 12; i++) {
    const fileDate = new Date(now.getFullYear(), now.getMonth() - i, 5);
    const fileYY = fileDate.getFullYear();
    const fileMM = String(fileDate.getMonth() + 1).padStart(2, '0');
    const filename = `${fileYY}${fileMM}05-SCT-Reachable-PSP-List_CUG.xlsx`;

    // Pattern 1: previous month's folder (current EBA convention)
    const folder = new Date(fileYY, fileDate.getMonth() - 1, 5);
    const folderYY = folder.getFullYear();
    const folderMM = String(folder.getMonth() + 1).padStart(2, '0');
    candidates.push(`https://www.ebaclearing.eu/wp-content/uploads/${folderYY}/${folderMM}/${filename}`);

    // Pattern 2: same-month folder (fallback)
    candidates.push(`https://www.ebaclearing.eu/wp-content/uploads/${fileYY}/${fileMM}/${filename}`);
  }

  let downloadedFrom = '';
  for (const url of candidates) {
    try {
      await downloadFile(url, xlsxPath);
      downloadedFrom = url;
      break;
    } catch {
      /* try next month */
    }
  }
  if (!downloadedFrom) {
    throw new Error(`EBA Step2 download failed (tried ${candidates.length} candidate URLs)`);
  }
  console.log(`  Source: ${downloadedFrom}`);

  const buffer = await readFile(xlsxPath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'eba_step2')
  `);

  const valid: Array<[string, string, string, string, string, string, string]> = [];
  const bicRegex = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const bic = String(row[0] ?? '').trim().toUpperCase();
    const name = String(row[2] ?? '').trim();
    if (!bic || bic.length < 8 || !bicRegex.test(bic)) continue;

    const bic8 = bic.slice(0, 8);
    const bic11 = bic.length === 11 ? bic : bic + 'XXX';
    const cc = bic.slice(4, 6); // ISO country code embedded in BIC
    const branchCode = bic11.slice(8);

    valid.push([bic8, bic11, name, cc, '', '', branchCode]);
  }

  const insertBatch = db.transaction((r: typeof valid) => {
    for (const row of r) insert.run(...row);
  });
  insertBatch(valid);

  console.log(`  EBA Step2 SCT: ${valid.length} entries processed`);
  return valid.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== IBANforge BIC Database Enrichment ===');
  console.log(`Database: ${BIC_DB_PATH}\n`);

  // Ensure source column exists
  const db = new Database(BIC_DB_PATH);
  const cols = (db.prepare("PRAGMA table_info(bic_entries)").all() as Array<{ name: string }>).map(r => r.name);
  if (!cols.includes('source')) {
    console.log('Adding source column to bic_entries...');
    db.exec("ALTER TABLE bic_entries ADD COLUMN source TEXT DEFAULT 'gleif'");
  }

  // Setup temp dir
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  // Count before
  const beforeCount = (db.prepare('SELECT COUNT(*) as n FROM bic_entries').get() as { n: number }).n;
  const beforeBic8 = (db.prepare('SELECT COUNT(DISTINCT bic8) as n FROM bic_entries').get() as { n: number }).n;
  console.log(`Before: ${beforeCount} entries, ${beforeBic8} unique BIC8`);

  // Import sources
  await importSwiftCodes(db);
  await importBundesbank(db);
  await importSixBankMaster(db);
  try { await importOeNB(db); } catch (err) { console.warn(`  WARNING: OeNB import failed: ${(err as Error).message}`); }
  try { await importNBP(db); } catch (err) { console.warn(`  WARNING: NBP import failed: ${(err as Error).message}`); }
  try { await importEbaStep2(db); } catch (err) { console.warn(`  WARNING: EBA Step2 import failed: ${(err as Error).message}`); }

  // Count after
  const afterCount = (db.prepare('SELECT COUNT(*) as n FROM bic_entries').get() as { n: number }).n;
  const afterBic8 = (db.prepare('SELECT COUNT(DISTINCT bic8) as n FROM bic_entries').get() as { n: number }).n;

  // Source breakdown
  const sources = db.prepare('SELECT source, COUNT(*) as n FROM bic_entries GROUP BY source ORDER BY n DESC').all() as Array<{ source: string; n: number }>;

  console.log('\n========== BIC Database Summary ==========');
  console.log(`Before: ${beforeCount} entries, ${beforeBic8} BIC8`);
  console.log(`After:  ${afterCount} entries, ${afterBic8} BIC8`);
  console.log(`Added:  ${afterCount - beforeCount} new entries`);
  console.log('\nBy source:');
  for (const s of sources) console.log(`  ${(s.source ?? 'unknown').padEnd(15)} ${s.n.toLocaleString()} entries`);
  console.log('==========================================\n');

  db.close();

  // Cleanup
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal:', err);
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
