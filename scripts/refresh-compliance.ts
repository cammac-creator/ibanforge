/**
 * Compliance data refresh script.
 * Downloads OpenSanctions bulk data + EPC SEPA registers and builds compliance.sqlite.
 *
 * Run with: npm run compliance:refresh  (or: npx tsx scripts/refresh-compliance.ts)
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, renameSync, existsSync, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  FATF_AS_OF,
  FATF_BLACK_LIST,
  FATF_GREY_LIST,
  FATF_MEMBERS,
  SANCTIONED_COUNTRIES_COMPREHENSIVE,
  SANCTIONED_COUNTRIES_SECTORAL,
} from '../src/lib/compliance-static.js';
import { validateBIC } from '../src/lib/bic-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
const TMP_DIR = resolve(__dirname, '../.tmp-compliance');
const TMP_DB_PATH = resolve(TMP_DIR, 'compliance.sqlite');
const FINAL_DB_PATH = resolve(DATA_DIR, 'compliance.sqlite');

// ---------------------------------------------------------------------------
// Static compliance data — FATF lists & sanctioned countries are maintained
// and dated in src/lib/compliance-static.ts (imported above). See FATF_AS_OF.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EPC SEPA register URLs
// ---------------------------------------------------------------------------

const EPC_REGISTERS: { scheme: string; url: string }[] = [
  {
    scheme: 'SCT',
    url: 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/sct/sct.csv',
  },
  {
    scheme: 'SDD',
    url: 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/sdd_core/sdd_core.csv',
  },
  {
    scheme: 'SCT_INST',
    url: 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/sct_inst/sct_inst.csv',
  },
];

// BIC regex for extracting BICs from text
const BIC_REGEX = /\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g;
const BIC_XML_REGEX = /<BIC>([A-Z0-9]{8,11})<\/BIC>/g;

// ---------------------------------------------------------------------------
// Helper: fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Helper: download file to disk
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  if (!response.body) {
    throw new Error(`No response body for ${url}`);
  }
  const fileStream = createWriteStream(dest);
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fileStream);
}

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sanctioned_entities (
      bic8        TEXT NOT NULL,
      entity_name TEXT,
      source_list TEXT NOT NULL,
      country_code TEXT,
      UNIQUE(bic8, source_list)
    );

    CREATE TABLE IF NOT EXISTS sanctioned_countries (
      country_code TEXT PRIMARY KEY,
      sanction_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fatf_countries (
      country_code TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sepa_participants (
      bic8   TEXT NOT NULL,
      scheme TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (bic8, scheme)
    );

    CREATE TABLE IF NOT EXISTS vop_participants (
      bic8   TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// Static data insertion
// ---------------------------------------------------------------------------

function insertStaticData(db: Database.Database): void {
  console.log('\n[1/5] Inserting static sanctions & FATF data...');

  const insertSanctionedCountry = db.prepare(
    `INSERT OR REPLACE INTO sanctioned_countries (country_code, sanction_type) VALUES (?, ?)`
  );
  const insertFatf = db.prepare(
    `INSERT OR REPLACE INTO fatf_countries (country_code, status) VALUES (?, ?)`
  );

  const runStatic = db.transaction(() => {
    for (const cc of SANCTIONED_COUNTRIES_COMPREHENSIVE) {
      insertSanctionedCountry.run(cc, 'comprehensive');
    }
    for (const cc of SANCTIONED_COUNTRIES_SECTORAL) {
      insertSanctionedCountry.run(cc, 'sectoral');
    }
    for (const cc of FATF_BLACK_LIST) {
      insertFatf.run(cc, 'black_list');
    }
    for (const cc of FATF_GREY_LIST) {
      insertFatf.run(cc, 'grey_list');
    }
    for (const cc of FATF_MEMBERS) {
      insertFatf.run(cc, 'member');
    }
  });

  runStatic();

  const sanctionedCount = (db.prepare(`SELECT COUNT(*) as n FROM sanctioned_countries`).get() as { n: number }).n;
  const fatfCount = (db.prepare(`SELECT COUNT(*) as n FROM fatf_countries`).get() as { n: number }).n;
  console.log(`  sanctioned_countries: ${sanctionedCount} rows`);
  console.log(`  fatf_countries:       ${fatfCount} rows`);
}

// ---------------------------------------------------------------------------
// OpenSanctions download & parse
// ---------------------------------------------------------------------------

async function fetchOpenSanctions(db: Database.Database): Promise<void> {
  console.log('\n[2/5] Downloading OpenSanctions data (4 sources)...');

  // Download each sanctions source separately for better source_list classification
  const SANCTIONS_SOURCES = [
    { name: 'OFAC', url: 'https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv' },
    { name: 'EU', url: 'https://data.opensanctions.org/datasets/latest/eu_fsf/targets.simple.csv' },
    { name: 'UN', url: 'https://data.opensanctions.org/datasets/latest/un_sc_sanctions/targets.simple.csv' },
    { name: 'SECO', url: 'https://data.opensanctions.org/datasets/latest/ch_seco_sanctions/targets.simple.csv' },
  ];

  // Cross-check candidate BICs against the real BIC base (read-only): a regex
  // match on free-text identifiers is only kept if it is an actual bank BIC.
  const bicDB = new Database(resolve(DATA_DIR, 'bic.sqlite'), { readonly: true });
  const bicLookup = bicDB.prepare('SELECT 1 FROM bic_entries WHERE bic8 = ? LIMIT 1');

  try {
    for (const source of SANCTIONS_SOURCES) {
      const csvPath = resolve(TMP_DIR, `opensanctions_${source.name}.csv`);
      try {
        await importSanctionsCSV(db, source.url, source.name, csvPath, bicLookup);
      } catch (err) {
        console.warn(`  WARNING: ${source.name} download failed: ${(err as Error).message}`);
      }
    }
  } finally {
    bicDB.close();
  }

  const entityCount = (db.prepare(`SELECT COUNT(*) as n FROM sanctioned_entities`).get() as { n: number }).n;
  console.log(`  sanctioned_entities total: ${entityCount} rows (after dedup across all sources)`);
}

async function importSanctionsCSV(
  db: Database.Database,
  url: string,
  sourceLabel: string,
  csvPath: string,
  bicLookup: Database.Statement,
): Promise<void> {
  console.log(`  Fetching ${sourceLabel}: ${url}`);
  await downloadFile(url, csvPath);
  console.log(`  Parsing ${sourceLabel} BICs...`);

  const insertEntity = db.prepare(
    `INSERT OR IGNORE INTO sanctioned_entities (bic8, entity_name, source_list, country_code)
     VALUES (?, ?, ?, ?)`
  );

  let lineCount = 0;
  let bicCount = 0;
  let rejectedCount = 0;
  let headerParsed = false;
  let colIdentifiers = -1;
  let colName = -1;
  let colCountries = -1;

  const { createReadStream } = await import('node:fs');
  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

  const insertBatch = db.transaction((rows: Array<[string, string, string, string]>) => {
    for (const row of rows) insertEntity.run(...row);
  });

  const batch: Array<[string, string, string, string]> = [];

  for await (const line of rl) {
    lineCount++;
    if (!headerParsed) {
      const cols = parseCsvLine(line);
      colIdentifiers = cols.indexOf('identifiers');
      colName = cols.indexOf('caption');
      if (colName === -1) colName = cols.indexOf('name');
      colCountries = cols.indexOf('countries');
      headerParsed = true;
      continue;
    }

    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;

    const identifiers = colIdentifiers >= 0 ? (cols[colIdentifiers] ?? '') : '';
    const entityName = colName >= 0 ? (cols[colName] ?? '') : '';
    const countries = colCountries >= 0 ? (cols[colCountries] ?? '') : '';

    if (!identifiers) continue;

    const bics = new Set<string>();
    let match: RegExpExecArray | null;
    BIC_REGEX.lastIndex = 0;
    while ((match = BIC_REGEX.exec(identifiers)) !== null) {
      bics.add(match[1].substring(0, 8));
    }
    if (bics.size === 0) continue;

    const countryCode = countries.split(/[,;|\s]+/)[0]?.trim().toUpperCase() ?? '';
    for (const bic8 of bics) {
      // Reject regex matches that are not real bank identifiers: the candidate
      // must pass ISO 9362 format validation AND exist in the BIC base.
      if (!validateBIC(bic8).valid || !bicLookup.get(bic8)) {
        rejectedCount++;
        continue;
      }
      batch.push([bic8, entityName.substring(0, 200), sourceLabel, countryCode]);
      bicCount++;
    }
    if (batch.length >= 500) insertBatch(batch.splice(0, batch.length));
  }
  if (batch.length > 0) insertBatch(batch.splice(0, batch.length));

  console.log(`  ${sourceLabel}: ${lineCount} lines, ${bicCount} BICs kept, ${rejectedCount} rejected (invalid format or unknown BIC)`);
}

// ---------------------------------------------------------------------------
// Minimal CSV line parser (handles quoted fields)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
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
// EPC SEPA register download & parse
// ---------------------------------------------------------------------------

async function fetchSepaRegisters(db: Database.Database): Promise<void> {
  console.log('\n[3/5] Downloading EPC SEPA registers (CSV)...');

  const insertSepa = db.prepare(
    `INSERT OR IGNORE INTO sepa_participants (bic8, scheme, status) VALUES (?, ?, 'active')`
  );

  for (const register of EPC_REGISTERS) {
    try {
      const csvPath = resolve(TMP_DIR, `sepa_${register.scheme}.csv`);
      console.log(`  Fetching ${register.scheme}: ${register.url}`);
      await downloadFile(register.url, csvPath);

      const { createReadStream } = await import('node:fs');
      const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

      const bics = new Set<string>();
      let headerParsed = false;
      let bicIdx = -1;

      for await (const line of rl) {
        const cols = parseCsvLine(line);
        if (!headerParsed) {
          bicIdx = cols.findIndex(c => c.toUpperCase() === 'BIC');
          headerParsed = true;
          continue;
        }
        const bic = cols[bicIdx]?.trim();
        if (bic && bic.length >= 8) {
          bics.add(bic.substring(0, 8));
        }
      }

      const insertBatch = db.transaction((bicsArr: string[]) => {
        for (const bic8 of bicsArr) insertSepa.run(bic8, register.scheme);
      });
      insertBatch([...bics]);
      console.log(`  ${register.scheme}: ${bics.size} BICs inserted`);
    } catch (err) {
      console.warn(`  WARNING: ${register.scheme} register download failed: ${(err as Error).message}`);
      console.warn(`  Skipping ${register.scheme} — continuing.`);
    }
  }

  const sepaCount = (db.prepare(`SELECT COUNT(*) as n FROM sepa_participants`).get() as { n: number }).n;
  console.log(`  sepa_participants total: ${sepaCount} rows`);
}

// ---------------------------------------------------------------------------
// VoP participants (derived from SCT)
// ---------------------------------------------------------------------------

async function fetchVopRegister(db: Database.Database): Promise<void> {
  console.log('\n[4/5] Downloading EPC VoP register (CSV)...');

  const vopUrl = 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/vop/vop.csv';
  const insertVop = db.prepare(
    `INSERT OR IGNORE INTO vop_participants (bic8, status) VALUES (?, ?)`
  );

  try {
    const csvPath = resolve(TMP_DIR, 'vop.csv');
    console.log(`  Fetching: ${vopUrl}`);
    await downloadFile(vopUrl, csvPath);

    const { createReadStream } = await import('node:fs');
    const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

    const bics = new Set<string>();
    let headerParsed = false;
    let bicIdx = -1;
    let statusIdx = -1;

    for await (const line of rl) {
      const cols = parseCsvLine(line);
      if (!headerParsed) {
        bicIdx = cols.findIndex(c => c.toUpperCase() === 'BIC');
        statusIdx = cols.findIndex(c => c.toUpperCase() === 'STATUS');
        headerParsed = true;
        continue;
      }
      const bic = cols[bicIdx]?.trim();
      const status = cols[statusIdx]?.trim().toLowerCase() ?? '';
      if (bic && bic.length >= 8 && status.includes('ready')) {
        bics.add(bic.substring(0, 8));
      }
    }

    const insertBatch = db.transaction((bicsArr: string[]) => {
      for (const bic8 of bicsArr) insertVop.run(bic8, 'active');
    });
    insertBatch([...bics]);
    console.log(`  VoP: ${bics.size} active participants`);
  } catch (err) {
    console.warn(`  WARNING: VoP register download failed: ${(err as Error).message}`);
    console.warn('  Falling back to SCT participants as VoP baseline...');
    db.exec(`
      INSERT OR IGNORE INTO vop_participants (bic8, status)
      SELECT bic8, 'active' FROM sepa_participants WHERE scheme = 'SCT'
    `);
  }

  const vopCount = (db.prepare(`SELECT COUNT(*) as n FROM vop_participants`).get() as { n: number }).n;
  console.log(`  vop_participants: ${vopCount} rows`);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function insertMetadata(db: Database.Database): void {
  console.log('\n[5/5] Writing metadata...');

  const insertMeta = db.prepare(
    `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`
  );

  const runMeta = db.transaction(() => {
    insertMeta.run('last_refresh', new Date().toISOString());
    insertMeta.run('version', '1.0.0');
    insertMeta.run('sources', 'OpenSanctions,SECO,FATF,EPC-SCT,EPC-SDD,EPC-SCT_INST');
    insertMeta.run('fatf_as_of', FATF_AS_OF);
  });

  runMeta();
  console.log('  Metadata written.');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(db: Database.Database): void {
  console.log('\n========== compliance.sqlite summary ==========');
  const tables = [
    'sanctioned_entities',
    'sanctioned_countries',
    'fatf_countries',
    'sepa_participants',
    'vop_participants',
    'metadata',
  ];
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number };
    console.log(`  ${table.padEnd(25)} ${row.n} rows`);
  }
  const lastRefresh = (
    db.prepare(`SELECT value FROM metadata WHERE key = 'last_refresh'`).get() as { value: string } | undefined
  )?.value;
  console.log(`  last_refresh:             ${lastRefresh ?? 'N/A'}`);
  console.log('===============================================\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== IBANforge compliance:refresh ===');
  console.log(`Output: ${FINAL_DB_PATH}`);

  // Staleness guard — FATF lists are hand-maintained (src/lib/compliance-static.ts).
  const fatfAgeMonths =
    (Date.now() - new Date(`${FATF_AS_OF}-01T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24 * 30.4);
  if (fatfAgeMonths > 5) {
    console.warn(
      `[compliance] WARNING: FATF lists are stale (as of ${FATF_AS_OF}, ~${Math.round(fatfAgeMonths)} months old) — recalibrate src/lib/compliance-static.ts after the latest FATF plenary.`,
    );
  }

  // 1. Prepare temp directory
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
  mkdirSync(TMP_DIR, { recursive: true });

  // 2. Create DB and schema
  const db = new Database(TMP_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  createSchema(db);

  // 3. Insert static data
  insertStaticData(db);

  // 4. OpenSanctions (BIC-level)
  await fetchOpenSanctions(db);

  // 5. EPC SEPA registers
  await fetchSepaRegisters(db);

  // 6. VoP register (real data)
  await fetchVopRegister(db);

  // 7. Metadata
  insertMetadata(db);

  // 8. Summary
  printSummary(db);

  // 9. Close DB and atomically replace final file
  db.close();

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  renameSync(TMP_DB_PATH, FINAL_DB_PATH);
  console.log(`compliance.sqlite written to: ${FINAL_DB_PATH}`);

  // 10. Clean up temp dir
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('Temp directory cleaned up.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  // Attempt cleanup
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(1);
});
