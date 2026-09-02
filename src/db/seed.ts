import Database from 'better-sqlite3';
import { readFileSync, createWriteStream, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createUnzip } from 'node:zlib';
import { execSync } from 'node:child_process';
import { getCountryName } from '../lib/countries.js';
import {
  extractGleifAddress,
  addressMatchesBic,
  type GleifEntityAddresses,
} from '../lib/gleif-address.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? resolve(__dirname, '../../data/bic.sqlite');
const SCHEMA_PATH = resolve(__dirname, 'schema.sql');
const TMP_DIR = '/tmp/biclookup-seed';
const GLEIF_API = process.env.GLEIF_API_BASE ?? 'https://api.gleif.org/api/v1';

mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

// Step 1: Download BIC-LEI mapping from GLEIF
async function downloadBicLeiMapping(): Promise<string> {
  const csvGlob = resolve(TMP_DIR, 'lei-bic-*.csv');

  // Check if already downloaded
  try {
    const existing = execSync(`ls ${TMP_DIR}/lei-bic-*.csv 2>/dev/null`).toString().trim();
    if (existing) {
      console.log('Using cached BIC-LEI mapping:', existing);
      return existing;
    }
  } catch {
    /* not found */
  }

  console.log('Downloading BIC-LEI mapping from GLEIF...');
  const metaRes = await fetch('https://mapping.gleif.org/api/v2/bic-lei/latest');
  const meta = (await metaRes.json()) as { data: { attributes: { downloadLink: string } } };
  const downloadUrl = meta.data.attributes.downloadLink;

  const zipPath = resolve(TMP_DIR, 'lei-bic.zip');
  const res = await fetch(downloadUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

  const fileStream = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(res.body as any), fileStream);

  // Unzip
  execSync(`cd ${TMP_DIR} && unzip -o lei-bic.zip`);
  const csvFile = execSync(`ls ${TMP_DIR}/lei-bic-*.csv`).toString().trim();
  console.log('Downloaded:', csvFile);
  return csvFile;
}

// Step 2: Parse CSV and load BIC-LEI pairs
function parseBicLeiCsv(csvPath: string): Map<string, string> {
  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').slice(1); // skip header
  const map = new Map<string, string>();

  for (const line of lines) {
    const [lei, bic] = line.trim().split(',');
    if (lei && bic && bic.length >= 8) {
      map.set(bic, lei);
    }
  }

  console.log(`Parsed ${map.size} BIC-LEI mappings`);
  return map;
}

// Step 3: Fetch entity details from GLEIF API in batches
interface EntityInfo {
  lei: string;
  name: string;
  country: string;
  countryName: string | null;
  city: string | null;
  street: string | null;
  postCode: string | null;
  region: string | null;
  addressEn: string | null;
  addressLang: string | null;
  asOf: string | null;
}

async function fetchEntities(leis: string[]): Promise<Map<string, EntityInfo>> {
  const map = new Map<string, EntityInfo>();
  const batchSize = 50; // GLEIF allows filtering by multiple LEIs

  for (let i = 0; i < leis.length; i += batchSize) {
    const batch = leis.slice(i, i + batchSize);
    const filter = batch.join(',');

    try {
      const res = await fetch(
        `${GLEIF_API}/lei-records?filter[lei]=${encodeURIComponent(filter)}&page[size]=${batchSize}`,
        { headers: { Accept: 'application/vnd.api+json' } },
      );

      if (!res.ok) {
        console.warn(`GLEIF batch ${i}-${i + batchSize} failed: ${res.status}`);
        continue;
      }

      const json = (await res.json()) as {
        data: Array<{
          attributes: {
            lei: string;
            entity: {
              legalName: { name: string };
              legalAddress: { country: string; city?: string };
            } & GleifEntityAddresses;
            registration?: { lastUpdateDate?: string };
          };
        }>;
      };

      for (const record of json.data) {
        const a = record.attributes;
        const addr = extractGleifAddress(a.entity);
        map.set(a.lei, {
          lei: a.lei,
          name: a.entity.legalName.name,
          country: a.entity.legalAddress.country,
          countryName: getCountryName(a.entity.legalAddress.country),
          city: a.entity.legalAddress.city ?? null,
          street: addr?.street ?? null,
          postCode: addr?.post_code ?? null,
          region: addr?.region ?? null,
          addressEn: addr?.romanized ?? null,
          addressLang: addr?.language ?? null,
          asOf: a.registration?.lastUpdateDate ? a.registration.lastUpdateDate.slice(0, 10) : null,
        });
      }
    } catch (err) {
      console.warn(`GLEIF batch error at ${i}:`, err);
    }

    // Rate limit
    if (i + batchSize < leis.length) {
      await new Promise((r) => setTimeout(r, 300));
    }

    if ((i / batchSize) % 20 === 0) {
      console.log(`  Fetched entity details: ${map.size}/${leis.length}`);
    }
  }

  return map;
}

// Step 4: Build SQLite database
async function seed() {
  console.log('=== BICLookup Database Seed ===\n');

  // Download and parse BIC-LEI mapping
  const csvPath = await downloadBicLeiMapping();
  const bicLeiMap = parseBicLeiCsv(csvPath);

  // Get unique LEIs
  const uniqueLeis = [...new Set(bicLeiMap.values())];
  console.log(`\nFetching entity details for ${uniqueLeis.length} LEIs from GLEIF API...`);
  console.log('(This will take several minutes)\n');

  const entities = await fetchEntities(uniqueLeis);
  console.log(`\nGot details for ${entities.size} entities\n`);

  // Create database
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Drop and recreate
  db.exec('DROP TABLE IF EXISTS bic_entries');
  db.exec('DROP TABLE IF EXISTS api_stats');
  db.exec('DROP TABLE IF EXISTS daily_stats');

  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, branch_info, lei, lei_status, is_test_bic, street, post_code, region, address_en, address_source, address_lang, address_as_of, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gleif')
  `);

  const insertMany = db.transaction((rows: unknown[][]) => {
    for (const row of rows) {
      insert.run(...row);
    }
  });

  // Build rows
  const rows: unknown[][] = [];

  for (const [bic, lei] of bicLeiMap) {
    const cleaned = bic.replace(/\s/g, '').toUpperCase();
    if (cleaned.length < 8 || cleaned.length > 11) continue;

    const bic8 = cleaned.substring(0, 8);
    const bic11 = cleaned.length === 11 ? cleaned : cleaned + 'XXX';
    const branchCode = bic11.substring(8, 11);
    const countryCode = cleaned.substring(4, 6);
    const locationCode = cleaned.substring(6, 8);
    const isTestBic = locationCode[1] === '0' ? 1 : 0;

    const entity = entities.get(lei);
    // Same-country guard: a GLEIF entity address is head-office level. Only
    // attach city + address when the BIC's own country matches the entity's
    // registered country, otherwise this BIC is a foreign branch and would
    // inherit the wrong (parent HQ) location.
    const matches = entity ? addressMatchesBic(bic11, entity.country) : false;

    rows.push([
      bic8,
      bic11,
      entity?.name ?? null,
      countryCode,
      entity?.countryName ?? getCountryName(countryCode),
      matches ? (entity!.city ?? null) : null,
      branchCode,
      null, // branch_info
      lei,
      entity ? 'ACTIVE' : null,
      isTestBic,
      matches ? entity!.street : null,
      matches ? entity!.postCode : null,
      matches ? entity!.region : null,
      matches ? entity!.addressEn : null,
      matches && entity!.street ? 'GLEIF' : null,
      matches ? entity!.addressLang : null,
      matches ? entity!.asOf : null,
    ]);
  }

  // Insert in batches
  const BATCH = 5000;
  for (let i = 0; i < rows.length; i += BATCH) {
    insertMany(rows.slice(i, i + BATCH));
    console.log(`Inserted ${Math.min(i + BATCH, rows.length)}/${rows.length} BIC entries`);
  }

  // NOTE: do NOT create stats.sqlite here. It is created and migrated lazily by
  // getStatsDB() in src/lib/db.ts — the single source of truth for the stats
  // schema. Seeding a legacy `daily_stats` (without operation_type) here made the
  // CREATE TABLE IF NOT EXISTS in db.ts a no-op, so getStatsHistory crashed with
  // "no such column: operation_type" — which failed the cron's test step and
  // silently skipped the "Commit updated database" step (stale bic.sqlite).

  const count = (db.prepare('SELECT COUNT(*) as cnt FROM bic_entries').get() as { cnt: number })
    .cnt;
  console.log(`\n=== Done! ${count} BIC entries in database ===`);

  // Show sample
  const sample = db
    .prepare('SELECT bic11, institution, country_code, city, lei FROM bic_entries LIMIT 5')
    .all();
  console.log('\nSample entries:');
  console.table(sample);

  db.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
