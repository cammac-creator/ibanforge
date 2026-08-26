/**
 * IBANforge — Seed the EBA register of payment and electronic money
 * institutions (the PSD2 "golden copy") into bic.sqlite.
 *
 * ## The licence
 *
 * "Reproduction of all EBA material on this site is authorised, provided the
 * source is acknowledged" (https://www.eba.europa.eu/legal-notice). Attribution
 * is the condition, so `source` and `as_of` are stored columns served on every
 * surface — never literals written by hand, which rot at the next refresh.
 *
 * ## Integrity: the one register in this codebase that can be proven
 *
 * The EBA publishes a manifest carrying the SHA-256 of the day's ZIP, and ships
 * a second SHA-256 *inside* the ZIP for the JSON it contains. Both are checked
 * here. No other source we mirror offers this, and a register whose integrity
 * can be proven but is not checked is worse than one that cannot: it invites
 * the belief that it was.
 *
 * A mismatch leaves `psd_entities` untouched and exits 0 — same doctrine as
 * seed-pra-banks.ts. A truncated download must never replace good rows.
 *
 * ## Why the file is streamed
 *
 * The ZIP is ~20 MB and inflates to ~217 MB of pretty-printed JSON holding
 * 329,122 entities. `JSON.parse` on that allocates well over a gigabyte in a
 * CI runner for a table we reduce to a few thousand rows. The scanner below
 * walks the inflate stream and emits one entity object at a time.
 *
 * Usage: npx tsx scripts/seed-eba-psd.ts
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const BIC_DB_PATH = resolve(__dirname, '../data/bic.sqlite');

const MANIFEST_URL = 'https://euclid.eba.europa.eu/register/api/filemetadata';
const DOWNLOAD_BASE = 'https://euclid.eba.europa.eu/register/downloads/PSDMD/';

/**
 * Sanity floor over the entity types we keep. The live register carries about
 * 4,400 of them across 30 competent authorities. Far under that is a truncated
 * download or a nomenclature change our reducer silently dropped — abort
 * *before* touching the database, exactly as the PRA and SIX seeders do.
 */
const MIN_EXPECTED_ROWS = 3000;

// ---------------------------------------------------------------------------
// Nomenclature
// ---------------------------------------------------------------------------

/**
 * The register's own entity types, mapped to stable keys we serve.
 *
 * Only these five carry a national reference code AND describe an entity that
 * can itself hold an account-issuing authorisation, so only these are stored:
 *
 * - `PSD_AG` (322,467 rows, 98% of the file) are *agents* acting for a
 *   principal. An agent is not an issuer, and keeping them would grow the
 *   tracked database by two orders of magnitude for nothing.
 * - `PSD_BR` are branches passporting in from another country. Measured on the
 *   2026-08-25 copy: **0 of 244** carry `ENT_NAT_REF_COD` at all, so they could
 *   never join to a bank code even in principle.
 * - `PSD_EXC` are entities *excluded* from PSD2 scope (Art. 3 exclusions) and
 *   `PSD_ENL` are bodies entitled under national law (credit unions and the
 *   like). Neither is an authorisation, and serving either beside the word
 *   "registered" would misread the register's own meaning.
 */
export const PSD_ENTITY_TYPES = {
  PSD_PI: 'payment_institution',
  PSD_EMI: 'emi',
  PSD_AISP: 'aisp',
  PSD_EEMI: 'exempted_emi',
  PSD_EPI: 'exempted_payment_institution',
} as const;

export type PsdEntityType = (typeof PSD_ENTITY_TYPES)[keyof typeof PSD_ENTITY_TYPES];

export interface PsdEntity {
  entity_type: PsdEntityType;
  country: string;
  national_reference_code: string;
  name: string;
  address: string | null;
  town: string | null;
  post_code: string | null;
  competent_authority: string;
}

/** Every type the file carries, kept for the census the report needs. */
export type PsdCensus = Record<string, number>;

// ---------------------------------------------------------------------------
// Streaming JSON scan
// ---------------------------------------------------------------------------

/**
 * Emit every object nested exactly two levels deep in the document.
 *
 * The golden copy is `[ [ {disclaimer} ], [ {entity}, {entity}, ... ] ]`, so the
 * entities sit at depth 2. The scanner counts brackets and braces rather than
 * reading indentation: the EBA pretty-prints today, and a reformat upstream
 * would silently empty a line-based reader without failing anything.
 *
 * The disclaimer object sits at depth 2 too. It is not special-cased — the
 * reducer drops anything without an `EntityType`, which also means a third
 * top-level section added by the EBA cannot break this.
 */
export class DepthTwoScanner {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private capturing = false;
  private buf = '';

  constructor(private readonly onObject: (text: string) => void) {}

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (this.capturing) this.buf += ch;

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === '\\') this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }

      if (ch === '"') {
        this.inString = true;
        continue;
      }

      if (ch === '[' || ch === '{') {
        if (ch === '{' && this.depth === 2 && !this.capturing) {
          this.capturing = true;
          this.buf = '{';
        }
        this.depth++;
      } else if (ch === ']' || ch === '}') {
        this.depth--;
        if (this.capturing && this.depth === 2) {
          this.capturing = false;
          this.onObject(this.buf);
          this.buf = '';
        }
      }
    }
  }

  /** Nothing may be left half-captured; a truncated stream must be loud. */
  finish(): void {
    if (this.capturing || this.inString || this.depth !== 0) {
      throw new Error(
        `Truncated JSON: depth ${this.depth}, ${this.capturing ? 'mid-object' : 'complete objects'}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Reduction
// ---------------------------------------------------------------------------

interface RawEntity {
  CA_OwnerID?: string;
  EntityCode?: string;
  EntityType?: string;
  Properties?: Array<Record<string, unknown>>;
}

/**
 * `Properties` is an array of single-key objects rather than one object, so it
 * is flattened before anything is read out of it.
 */
export function flattenProperties(props: Array<Record<string, unknown>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of props ?? []) {
    for (const [k, v] of Object.entries(entry)) {
      if (typeof v === 'string') out[k] = v;
      else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
    }
  }
  return out;
}

/**
 * Reduce one raw entity, or answer null when it is not one we keep.
 *
 * Codes are trimmed: the Lithuanian rows publish `'LB000417 '` with a trailing
 * space, and an untrimmed key never matches anything for the rest of its life.
 */
export function reduceEntity(raw: RawEntity): PsdEntity | null {
  const type = raw.EntityType ? (PSD_ENTITY_TYPES as Record<string, PsdEntityType>)[raw.EntityType] : undefined;
  if (!type) return null;

  const p = flattenProperties(raw.Properties);
  const country = (p.ENT_COU_RES ?? '').trim().toUpperCase();
  const code = (p.ENT_NAT_REF_COD ?? '').trim();
  const name = (p.ENT_NAM ?? '').trim();
  const ca = (raw.CA_OwnerID ?? '').trim();

  // No country, no code or no name means nothing can be said about the entity,
  // and a row that cannot be joined or displayed is not worth storing.
  if (country.length !== 2 || !code || !name || !ca) return null;

  return {
    entity_type: type,
    country,
    national_reference_code: code,
    name,
    address: (p.ENT_ADD ?? '').trim() || null,
    town: (p.ENT_TOW_CIT_RES ?? '').trim() || null,
    post_code: (p.ENT_POS_COD ?? '').trim() || null,
    competent_authority: ca,
  };
}

export interface PsdParse {
  entities: PsdEntity[];
  /** Count per raw EntityType across the WHOLE file, kept for the report. */
  census: PsdCensus;
}

/** Scan a whole document already in memory. Used by the tests and the fixture. */
export function parsePsdDocument(text: string): PsdParse {
  const entities: PsdEntity[] = [];
  const census: PsdCensus = {};
  const scanner = new DepthTwoScanner((objText) => {
    const raw = JSON.parse(objText) as RawEntity;
    if (!raw.EntityType) return;
    census[raw.EntityType] = (census[raw.EntityType] ?? 0) + 1;
    const reduced = reduceEntity(raw);
    if (reduced) entities.push(reduced);
  });
  scanner.push(text);
  scanner.finish();
  return { entities, census };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface PsdManifest {
  zip_url: string;
  sha256: string;
  /** 'YYYY-MM-DD' — the date of the golden copy, read from the manifest. */
  as_of: string;
  /** The date implied by the download path, for cross-checking. */
  path_as_of: string | null;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * "Tue Aug 25 16:00:19 UTC 2026" → "2026-08-25".
 *
 * Parsed by hand rather than through `new Date()`: that constructor is
 * locale-and-runtime-dependent for this shape, and the date is the attribution.
 * Returns null instead of guessing — no clock fallback, ever. A copy dated by
 * the wall clock claims a freshness the EBA never published.
 */
export function parseManifestTimestamp(ts: string): string | null {
  const m = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+[\d:]+\s+\w+\s+(\d{4})$/.exec((ts ?? '').trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2].padStart(2, '0')}`;
}

/** "20260825/download-PSDMD-202608251600.zip" → "2026-08-25". */
export function parsePathDate(relPath: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})\//.exec(relPath ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function readManifest(json: Record<string, unknown>): PsdManifest {
  const rel = String(json.latest_version_relative_zip_path ?? '');
  const sha = String(json.sha256_hash ?? '').toLowerCase();
  const asOf = parseManifestTimestamp(String(json.timestamp ?? ''));

  if (!rel) throw new Error('Manifest carries no latest_version_relative_zip_path');
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`Manifest sha256_hash is not a SHA-256: "${sha}"`);
  if (!asOf) throw new Error(`Could not read a date from manifest timestamp "${String(json.timestamp)}"`);

  return { zip_url: DOWNLOAD_BASE + rel, sha256: sha, as_of: asOf, path_as_of: parsePathDate(rel) };
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compressed: Buffer;
}

/**
 * Read a ZIP central directory and return its entries.
 *
 * Hand-rolled because the project has no archive dependency and this needs
 * exactly one feature: locate a member and hand back its raw deflate stream so
 * it can be inflated *incrementally*. Every convenience library here would
 * either add a dependency or materialise the whole 217 MB member first.
 */
export function readZipEntries(zip: Buffer): ZipEntry[] {
  // The End Of Central Directory record is at the tail, after a comment of
  // unknown length, so it is searched backwards from the end.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 22 - 65536; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file: no end-of-central-directory record');

  const count = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(ptr) !== 0x02014b50) throw new Error(`Bad central directory header at ${ptr}`);
    const method = zip.readUInt16LE(ptr + 10);
    const compressedSize = zip.readUInt32LE(ptr + 20);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const localOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    // The local header repeats the name and carries its OWN extra-field length,
    // which routinely differs from the central one. Reading the data offset
    // from the central record instead is the classic way to land mid-stream.
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Bad local file header for "${name}"`);
    }
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;

    entries.push({ name, method, compressed: zip.subarray(dataStart, dataStart + compressedSize) });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Inflate a member, hashing and scanning it as it goes.
 *
 * Nothing larger than a chunk is ever held: the 217 MB member is consumed in
 * pieces, its SHA-256 accumulated, and each complete entity handed to `onObject`
 * and dropped.
 */
async function streamMember(
  entry: ZipEntry,
  onObject: (text: string) => void,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  const scanner = new DepthTwoScanner(onObject);
  let bytes = 0;
  // A UTF-8 multi-byte character can straddle a chunk boundary; a plain
  // toString() per chunk would corrupt exactly the accented Greek, Czech and
  // Romanian names this register is full of.
  const decoder = new TextDecoder('utf-8');

  const source = Readable.from([entry.compressed]);
  const stream = entry.method === 0 ? source : source.pipe(createInflateRaw());

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
    scanner.push(decoder.decode(chunk, { stream: true }));
  }
  scanner.push(decoder.decode());
  scanner.finish();

  return { sha256: hash.digest('hex'), bytes };
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/**
 * No primary key on (country, code, type).
 *
 * Measured on the 2026-08-25 copy: 64 (country, code) pairs and 5
 * (country, code, type) triples repeat. Most are one institution holding both a
 * payment and an e-money authorisation — Mollie and Yoursafe each appear as
 * `PSD_PI` and `PSD_EMI` under one Dutch code — which the register is right to
 * publish twice. Collapsing them with `INSERT OR REPLACE` would silently pick
 * whichever row happened to come last. The lookup layer ranks instead.
 */
export function createPsdEntitiesTable(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS psd_entities (
      country                 TEXT NOT NULL,
      national_reference_code TEXT NOT NULL,
      entity_type             TEXT NOT NULL,
      name                    TEXT NOT NULL,
      address                 TEXT,
      town                    TEXT,
      post_code               TEXT,
      competent_authority     TEXT NOT NULL,
      as_of                   TEXT NOT NULL,
      source                  TEXT NOT NULL DEFAULT 'European Banking Authority, payment institutions register',
      updated_at              TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_psd_entities_lookup ON psd_entities(country, national_reference_code)');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let manifest: PsdManifest;
  try {
    const res = await fetch(MANIFEST_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = readManifest((await res.json()) as Record<string, unknown>);
  } catch (err) {
    // An upstream that is not serving today must not turn a build red. The
    // table already in the database stays, attribution and all.
    console.error(`[psd] manifest unavailable: ${(err as Error).message}`);
    console.log('[psd] psd_entities left untouched. Exiting 0 so the build is not broken.');
    return;
  }

  if (manifest.path_as_of && manifest.path_as_of !== manifest.as_of) {
    console.warn(
      `[psd] WARNING: download path implies ${manifest.path_as_of} but the manifest timestamp says ` +
        `${manifest.as_of}. Using the manifest timestamp — it is the field the EBA dates the copy with.`,
    );
  }

  let zip: Buffer;
  try {
    console.log(`[psd] downloading ${manifest.zip_url}`);
    const res = await fetch(manifest.zip_url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    zip = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(`[psd] download failed: ${(err as Error).message}`);
    console.log('[psd] psd_entities left untouched. Exiting 0.');
    return;
  }

  // Gate 1: the ZIP against the manifest.
  const zipSha = createHash('sha256').update(zip).digest('hex');
  console.log(`[psd] downloaded ${zip.length} bytes, sha256 ${zipSha}`);
  if (zipSha !== manifest.sha256) {
    console.error(`[psd] SHA-256 MISMATCH. manifest=${manifest.sha256} downloaded=${zipSha}`);
    console.log('[psd] psd_entities left untouched (nothing was dropped). Exiting 0.');
    return;
  }
  console.log('[psd] zip sha256 matches the manifest');

  let entities: PsdEntity[];
  let census: PsdCensus;
  try {
    const members = readZipEntries(zip);
    const jsonEntry = members.find((e) => e.name.endsWith('.json'));
    const shaEntry = members.find((e) => e.name.endsWith('.json.sha256'));
    if (!jsonEntry) throw new Error(`No .json member in the archive (${members.map((m) => m.name).join(', ')})`);

    // Gate 2: the inflated JSON against the checksum the EBA ships inside the
    // archive. It covers a different failure from gate 1 — a ZIP that is intact
    // but whose member was built from a bad export.
    let expectedInner: string | null = null;
    if (shaEntry) {
      const chunks: Buffer[] = [];
      const src = Readable.from([shaEntry.compressed]);
      const st = shaEntry.method === 0 ? src : src.pipe(createInflateRaw());
      for await (const c of st as AsyncIterable<Buffer>) chunks.push(c);
      expectedInner = Buffer.concat(chunks).toString('utf8').trim().split(/\s+/)[0].toLowerCase();
    }

    const collected: PsdEntity[] = [];
    const cen: PsdCensus = {};
    const result = await streamMember(jsonEntry, (objText) => {
      const raw = JSON.parse(objText) as RawEntity;
      if (!raw.EntityType) return;
      cen[raw.EntityType] = (cen[raw.EntityType] ?? 0) + 1;
      const reduced = reduceEntity(raw);
      if (reduced) collected.push(reduced);
    });

    console.log(`[psd] inflated ${result.bytes} bytes, sha256 ${result.sha256}`);
    if (expectedInner) {
      if (result.sha256 !== expectedInner) {
        throw new Error(`inner JSON SHA-256 mismatch: archive=${expectedInner} computed=${result.sha256}`);
      }
      console.log('[psd] inner json sha256 matches the checksum shipped in the archive');
    } else {
      console.warn('[psd] WARNING: no .json.sha256 member in the archive; inner integrity not verified');
    }

    entities = collected;
    census = cen;
  } catch (err) {
    console.error(`[psd] parse failed: ${(err as Error).message}`);
    console.log('[psd] psd_entities left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  if (entities.length < MIN_EXPECTED_ROWS) {
    console.error(
      `[psd] sanity floor: reduced ${entities.length} entities but expected at least ${MIN_EXPECTED_ROWS}.`,
    );
    console.log('[psd] psd_entities left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  const db = new Database(BIC_DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec('DROP TABLE IF EXISTS psd_entities');
  createPsdEntitiesTable(db);

  const insert = db.prepare(`
    INSERT INTO psd_entities
      (country, national_reference_code, entity_type, name, address, town, post_code, competent_authority, as_of)
    VALUES
      (@country, @national_reference_code, @entity_type, @name, @address, @town, @post_code, @competent_authority, @as_of)
  `);
  const insertAll = db.transaction((rows: PsdEntity[]) => {
    for (const row of rows) insert.run({ ...row, as_of: manifest.as_of });
  });
  insertAll(entities);

  const perType = db
    .prepare('SELECT entity_type, COUNT(*) AS cnt FROM psd_entities GROUP BY entity_type ORDER BY cnt DESC')
    .all() as Array<{ entity_type: string; cnt: number }>;
  const perCountry = db
    .prepare('SELECT country, COUNT(*) AS cnt FROM psd_entities GROUP BY country ORDER BY cnt DESC')
    .all() as Array<{ country: string; cnt: number }>;

  db.close();

  const totalInFile = Object.values(census).reduce((a, b) => a + b, 0);
  console.log('\n--- EBA PSD register seed results ---');
  console.log(`Golden copy:   ${manifest.zip_url}`);
  console.log(`As of:         ${manifest.as_of} (from the manifest timestamp)`);
  console.log(`Entities in the file: ${totalInFile}`);
  for (const [t, n] of Object.entries(census).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(10)} ${String(n).padStart(7)}${(PSD_ENTITY_TYPES as Record<string, string>)[t] ? '  (kept)' : ''}`);
  }
  console.log(`Rows stored:   ${entities.length}`);
  for (const t of perType) console.log(`  ${t.entity_type.padEnd(30)} ${t.cnt}`);
  console.log(`Countries:     ${perCountry.length}`);
  console.log('  ' + perCountry.map((c) => `${c.country}=${c.cnt}`).join(' '));
  console.log('\nDone! psd_entities seeded in data/bic.sqlite');
  console.log('Attribution required by the licence: "European Banking Authority, payment institutions register"');
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[psd] seed failed:', err);
    process.exitCode = 1;
  });
}
