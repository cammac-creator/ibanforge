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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
const BIC_DB_PATH = resolve(DATA_DIR, 'bic.sqlite');
const TMP_DIR = resolve(__dirname, '../.tmp-bic-enrich');

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
    VALUES (?, ?, ?, 'CH', 'Switzerland', ?, ?, 'six_group')
  `);

  let count = 0;
  let headerParsed = false;
  let bicIdx = -1, nameIdx = -1, cityIdx = -1;

  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

  const rows: Array<[string, string, string, string, string]> = [];

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
    const city = cols[cityIdx]?.trim() ?? '';
    const branchCode = bic11.slice(8);

    rows.push([bic8, bic11, name, city, branchCode]);
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
