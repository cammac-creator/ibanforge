/**
 * Seed the Austrian and Belgian bank-code registers.
 *
 * Both are published by the authority that allocates the codes, which is what
 * lets an absence mean "held by nobody" rather than "absent from our map". The
 * same claim CH, LI, DE and FI already carry.
 *
 *   npx tsx scripts/seed-national.ts          # both
 *   npx tsx scripts/seed-national.ts AT       # one
 *
 * AUSTRIA — Oesterreichische Nationalbank, SEPA-Zahlungsverkehrs-Verzeichnis.
 * Republished DAILY, which is finer than the Bundesbank's monthly cycle. The
 * file is Latin-1 and semicolon-separated: decoding it as UTF-8 mangles every
 * umlaut in a bank name, the same trap the German seeder documents.
 *
 * BELGIUM — Banque nationale de Belgique, Secrétariat du Protocole. The file
 * publishes ALL 1000 three-digit slots and writes 'VRIJ' (Dutch for vacant) in
 * the BIC column for the ~210 it has not allocated. Those rows are dropped, not
 * stored: keeping them would turn an explicit "nobody holds this code" into a
 * bank named VRIJ, the exact inversion of what the register says.
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.BIC_DB_PATH ?? resolve(__dirname, '../data/bic.sqlite');

const SOURCES = {
  AT: 'https://www.oenb.at/docroot/downloads_observ/sepa-zv-vz_gesamt.csv',
  BE: 'https://www.nbb.be/doc/be/be/protocol/full_list_current.xlsx',
} as const;

/**
 * Refuse to replace a good table with a short one.
 *
 * Measured 29/07/2026: 869 Austrian codes, 790 allocated Belgian ones. A
 * truncated download, an upstream incident or a format change our parser
 * mangled would come back well under these. Abort BEFORE touching the table and
 * let the existing data stand.
 */
const MIN_EXPECTED: Record<string, number> = { AT: 700, BE: 650 };

/** Both servers redirect or refuse without a browser User-Agent. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

interface Entry {
  code: string;
  name: string;
  bic: string | null;
  /** Street with house number, as the OeNB publishes it; null where absent. */
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
}

function pad(code: string, width: number): string | null {
  const d = code.trim();
  if (!/^\d+$/.test(d) || d.length > width) return null;
  return d.padStart(width, '0');
}

/** A BIC column may carry an 11-character BIC; we store the 8-character stem. */
function bic8(raw: string): string | null {
  const b = (raw ?? '').replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}/.test(b) ? b.slice(0, 8) : null;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function parseAustria(): Promise<Entry[]> {
  const buf = await fetchBytes(SOURCES.AT);
  // Latin-1, not UTF-8. Decoding wrong turns "Raiffeisenbank Wörgl" into noise.
  const text = new TextDecoder('latin1').decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());

  // The file opens with a disclaimer of unknown length; find the header row
  // rather than skipping a fixed number of lines.
  const headerIdx = lines.findIndex((l) => l.startsWith('Kennzeichen;'));
  if (headerIdx < 0) throw new Error('AT: header row not found, format changed');
  const header = lines[headerIdx].split(';');
  const iCode = header.indexOf('Bankleitzahl');
  const iName = header.indexOf('Bankenname');
  const iBic = header.findIndex((h) => /SWIF/i.test(h));
  // The head-office address, published street-and-house-number in one field.
  // indexOf finds the FIRST 'PLZ'/'Ort', which is the seat — the second pair
  // belongs to 'Postadresse', a separate mailing address that is often a PO
  // box and must not be served as where the institution is.
  const iStreet = header.indexOf('Straße');
  const iPlz = header.indexOf('PLZ');
  const iOrt = header.indexOf('Ort');
  const iLei = header.indexOf('LEI');
  if (iCode < 0 || iName < 0) throw new Error('AT: expected columns missing');

  const opt = (f: string[], i: number): string | null => {
    if (i < 0) return null;
    const v = (f[i] ?? '').trim();
    return v || null;
  };

  const seen = new Map<string, Entry>();
  for (const line of lines.slice(headerIdx + 1)) {
    const f = line.split(';');
    const code = pad(f[iCode] ?? '', 5);
    if (!code || seen.has(code)) continue;
    const name = (f[iName] ?? '').trim();
    if (!name) continue;
    seen.set(code, {
      code,
      name,
      bic: iBic >= 0 ? bic8(f[iBic] ?? '') : null,
      street: opt(f, iStreet),
      post_code: opt(f, iPlz),
      town: opt(f, iOrt),
      lei: opt(f, iLei),
    });
  }
  return [...seen.values()];
}

async function parseBelgium(): Promise<Entry[]> {
  const buf = await fetchBytes(SOURCES.BE);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });

  const seen = new Map<string, Entry>();
  let vacant = 0;
  for (const r of rows) {
    const code = pad(String(r[0] ?? ''), 3);
    if (!code || seen.has(code)) continue;
    const rawBic = String(r[1] ?? '').replace(/\s/g, '');
    // The register's own word for an unallocated slot. Dropping it is what
    // makes a Belgian miss mean "allocated to nobody".
    if (/^VRIJ$/i.test(rawBic)) {
      vacant++;
      continue;
    }
    // Institution name: Dutch, then French, then English, whichever is filled.
    const name = [r[2], r[3], r[5], r[4]].map((v) => String(v ?? '').trim()).find(Boolean);
    if (!name) continue;
    // Beyond VRIJ, the register also writes 'Onbeschikbaar' / 'Indisponible'
    // (unavailable) for the handful of slots it reserves — code 539, the
    // web's favourite example IBAN, is one of them. Neither word names an
    // institution; storing it would serve a bank called "Onbeschikbaar",
    // the NL corporate-treasury defect in miniature. Two vacant slots also
    // carry 'N/A' in the BIC column and VRIJ as their *name*, so the BIC
    // filter above misses them — match the name too, whole-word only.
    if (/^(vrij|libre)$|^(onbeschikbaar|indisponible|unavailable|nicht verf)/i.test(name)) {
      vacant++;
      continue;
    }
    // The BNB file publishes six columns and no address at all (verified
    // 05/08/2026, every row) — Belgium is names-only, honestly.
    seen.set(code, { code, name, bic: bic8(rawBic), street: null, post_code: null, town: null, lei: null });
  }
  console.log(`  BE: ${vacant} slots marked VRIJ or unavailable, dropped on purpose`);
  return [...seen.values()];
}

function write(db: Database.Database, cc: string, entries: Entry[]): void {
  const floor = MIN_EXPECTED[cc];
  if (entries.length < floor) {
    throw new Error(
      `${cc}: only ${entries.length} codes parsed, expected at least ${floor}. Refusing to replace the table.`,
    );
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM national_bank_codes WHERE country = ?').run(cc);
    const ins = db.prepare(
      'INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of entries) ins.run(cc, e.code, e.name, e.bic, e.street, e.post_code, e.town, e.lei);
  });
  tx();
  console.log(`  ${cc}: ${entries.length} codes written`);
}

async function main(): Promise<void> {
  const only = process.argv[2]?.toUpperCase();
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS national_bank_codes (
      country   TEXT NOT NULL,
      code      TEXT NOT NULL,
      name      TEXT NOT NULL,
      bic       TEXT,
      street    TEXT,
      post_code TEXT,
      town      TEXT,
      lei       TEXT,
      PRIMARY KEY (country, code)
    );
  `);
  // CREATE TABLE IF NOT EXISTS does not migrate an existing table — a base
  // seeded before the address columns existed needs an explicit ALTER, or the
  // INSERT below fails on column count.
  const have = new Set(
    (db.prepare(`PRAGMA table_info(national_bank_codes)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const col of ['street', 'post_code', 'town', 'lei']) {
    if (!have.has(col)) db.exec(`ALTER TABLE national_bank_codes ADD COLUMN ${col} TEXT`);
  }

  const jobs: Array<[string, () => Promise<Entry[]>]> = [
    ['AT', parseAustria],
    ['BE', parseBelgium],
  ];
  for (const [cc, parse] of jobs) {
    if (only && only !== cc) continue;
    console.log(`${cc}: downloading ${SOURCES[cc as 'AT' | 'BE']}`);
    write(db, cc, await parse());
  }
  db.close();
  console.log('done');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
