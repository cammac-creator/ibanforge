/**
 * IBANforge — Seed the official identity lists into bic.sqlite
 *
 * Two publishers, one job: put an institution's OFFICIAL name, LEI and
 * registered address behind a code we already resolve, and carry the provenance
 * that makes serving it lawful.
 *
 *   1. European Central Bank — daily list of monetary financial institutions
 *      (table `ecb_mfi`).
 *   2. Banco de España — list of Spanish MFIs (table `bde_mfi`), whose
 *      SUPERVISORY CODE column publishes the 4-digit Spanish bank code bare.
 *
 * ## The licence, and why `list_date` is a stored column
 *
 * Both publishers attach the same two conditions to reuse, in almost the same
 * words. The ECB:
 *
 *   "When such information is distributed or reproduced, it must appear
 *    accurately and the ECB must be cited as the source."
 *   "Where the information is incorporated in documents that are sold
 *    (regardless of the medium), the natural or legal person publishing the
 *    information must inform buyers, both before they pay any subscription or
 *    fee and EACH TIME THEY ACCESS the information taken from this website,
 *    that the information may be obtained free of charge through this website."
 *
 * The Banco de España's legal notice says the same thing about information
 * "incorporated into documents or other media that are to be sold or
 * transferred for consideration". This API is sold. So the free-of-charge
 * mention is not a courtesy line on a docs page: it travels inside every served
 * block, on every call, for BOTH sources. That is enforced in
 * src/lib/official-identity.ts and locked by a test.
 *
 * `list_date` is stored rather than derived because a dated claim about which
 * institution holds a bank code is the only kind worth making — and because
 * nothing here may fall back to the wall clock. A row dated today from a file
 * published last Friday is a false statement about the register, and it is the
 * one failure of this ingestion that cannot be walked back. Same doctrine as
 * `list_month` in scripts/seed-pra-banks.ts.
 *
 * Usage: npx tsx scripts/seed-ecb-mfi.ts
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const BIC_DB_PATH = resolve(__dirname, '../data/bic.sqlite');

/**
 * Sanity floors. Below these the download is truncated or the layout moved, and
 * the table we would replace is the evidence behind a licensed claim. Abort
 * BEFORE touching the database and let the existing rows stand — the rule
 * seed-bc-nummer.ts and seed-pra-banks.ts already follow.
 */
const MIN_ECB_ROWS = 3000;
const MIN_BDE_ROWS = 150;

// ---------------------------------------------------------------------------
// Source 1 — European Central Bank, daily MFI list
// ---------------------------------------------------------------------------

/**
 * The ECB republishes the whole list every BUSINESS day under a date-stamped
 * name. There is no "latest" alias, so the date is part of the URL.
 */
function ecbUrl(d: Date): string {
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return (
    'https://www.ecb.europa.eu/stats/money/mfi/general/html/dla/mfi_MID/' + `mfi_csv_${yy}${mm}${dd}.csv`
  );
}

/**
 * The 14 columns of the daily file, in publication order.
 *
 * Pinned as a constant and compared against the real header on every run. A
 * silent column insertion upstream would otherwise shift ADDRESS into POSTAL
 * and hand every institution its neighbour's street — the kind of corruption
 * that parses perfectly and reads plausibly.
 */
export const ECB_MFI_COLUMNS = [
  'RIAD_CODE',
  'LEI',
  'COUNTRY_OF_REGISTRATION',
  'NAME',
  'BOX',
  'ADDRESS',
  'POSTAL',
  'CITY',
  'CATEGORY',
  'HEAD_COUNTRY_OF_REGISTRATION',
  'HEAD_NAME',
  'HEAD_RIAD_CODE',
  'HEAD_LEI',
  'REPORT',
] as const;

export interface EcbMfiRow {
  riad_code: string;
  country: string;
  name: string;
  lei: string | null;
  address: string | null;
  category: string;
  /**
   * The national bank code, and ONLY where the publisher's identifier actually
   * is one. See nationalBankCode() — this is null for every country but France.
   */
  national_bank_code: string | null;
}

/**
 * Decode the daily file.
 *
 * The ECB ships it as UTF-16 little-endian with a BOM and CRLF line endings —
 * not UTF-8, whatever the `.csv` extension suggests. Read as UTF-8 it comes
 * back as NUL-separated mojibake that still splits into fields, so the failure
 * is silent rather than loud. `utf-16le` plus an explicit BOM strip is the
 * whole fix, and it is exercised by a fixture built with
 * `Buffer.from(text, 'utf16le')` so an upstream re-encoding fails a test
 * instead of a customer.
 */
export function decodeEcbCsv(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-16le').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Normalise a published LEI, or answer null.
 *
 * 643 of the 5,374 rows in the file measured on 2026-08-25 carry no LEI at all
 * — mostly money market funds. A row without one still belongs in the table; it
 * simply never joins on the LEI path. Anything that is not exactly 20
 * alphanumerics is stored as null rather than guessed at, exactly as
 * seed-pra-banks.ts does.
 */
export function normaliseLei(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().replace(/^'/, '').toUpperCase();
  return /^[A-Z0-9]{20}$/.test(value) ? value : null;
}

/**
 * Compose the one-line registered address the API serves.
 *
 * Four columns, any of which may be blank. Joined in postal order and dropped
 * entirely when nothing survives — an address of ", ," is worse than no address
 * field, because it looks like data.
 */
export function composeAddress(parts: {
  box?: string;
  street?: string;
  postal?: string;
  city?: string;
}): string | null {
  const line1 = [parts.street?.trim(), parts.box?.trim()].filter(Boolean).join(', ');
  const line2 = [parts.postal?.trim(), parts.city?.trim()].filter(Boolean).join(' ');
  const composed = [line1, line2].filter(Boolean).join(', ').trim();
  return composed === '' ? null : composed;
}

/**
 * Is this publisher's RIAD code the country's national bank code?
 *
 * **For France, and only for France.** A French RIAD code is `FR` followed by
 * the five-digit *code banque* that opens the BBAN: `FR30004` is BNP Paribas,
 * whose IBANs carry bank code 30004. Verified against the live file on
 * 2026-08-25 for BNP Paribas, Société Générale, Crédit Lyonnais and La Banque
 * Postale.
 *
 * Everywhere else the RIAD code is a registry serial with no payment meaning,
 * and the shape does not tell them apart: measured on the same file, 1,240
 * German rows and 569 Polish rows have the identical `XX` + 5 digits shape, and
 * `DE07802` is Wüstenrot Bausparkasse — whose Bankleitzahl is 60430000, not
 * 07802. So the gate is the COUNTRY plus the shape, never the shape alone.
 * Serving a German registry serial as a French bank code would put one
 * institution's name behind another's IBAN, on a paid call.
 *
 * Portugal has a widely repeated mapping heuristic that the ECB does not
 * document. Undocumented is exactly what this function refuses to encode.
 */
export function nationalBankCode(country: string, riadCode: string): string | null {
  if (country !== 'FR') return null;
  const m = /^FR(\d{5})$/.exec(riadCode.trim());
  return m ? m[1] : null;
}

export interface EcbParse {
  rows: EcbMfiRow[];
}

/**
 * Read the daily file. Tab-separated, not comma-separated, and with no quoting
 * at all — institution names carry commas ("Caixa Rural Vinarós, S. Coop. de
 * Credit. V.") and survive precisely because the delimiter is a tab.
 *
 * Throws on anything it cannot account for; the caller turns a throw into "keep
 * the table we already have", never into a partial ingestion.
 */
export function parseEcbMfi(text: string): EcbParse {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('Empty ECB MFI file');

  const header = lines[0].split('\t').map((h) => h.trim());
  if (header.length !== ECB_MFI_COLUMNS.length || header.some((h, i) => h !== ECB_MFI_COLUMNS[i])) {
    throw new Error(
      `ECB MFI columns moved. Expected [${ECB_MFI_COLUMNS.join(', ')}], got [${header.join(', ')}]`,
    );
  }

  const rows: EcbMfiRow[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    if (f.length !== ECB_MFI_COLUMNS.length) {
      throw new Error(`ECB MFI row has ${f.length} fields, expected ${ECB_MFI_COLUMNS.length}: "${line}"`);
    }
    const riad = f[0].trim();
    const country = f[2].trim();
    const name = f[3].trim();
    if (riad === '' || name === '') {
      throw new Error(`ECB MFI row missing RIAD code or name: "${line}"`);
    }
    rows.push({
      riad_code: riad,
      // Two rows carry the literal 'E$' here (the ECB itself and the EIB): the
      // euro area as a whole, not an ISO country. Stored as published and never
      // fed to anything that expects ISO 3166 — hence no CHECK constraint on
      // this column, and no country-scoped path that could ever reach it.
      country,
      name,
      lei: normaliseLei(f[1]),
      address: composeAddress({ box: f[4], street: f[5], postal: f[6], city: f[7] }),
      category: f[8].trim(),
      national_bank_code: nationalBankCode(country, riad),
    });
  }
  return { rows };
}

interface EcbDownload {
  text: string;
  url: string;
  /** 'YYYY-MM-DD', from the file name that actually answered 200. */
  list_date: string;
}

/**
 * Walk back from today until a published file answers.
 *
 * The list appears on business days only, and the current day's file is not
 * there until the ECB publishes it. So on a Monday morning the two most recent
 * candidates are the weekend and today, and all three miss — which is the
 * normal state of the world, not an incident. Four days back clears any
 * weekend plus a public holiday on either side.
 *
 * `response.ok` is the gate, never the byte count: a missing file answers 404
 * with ~97 KB of HTML error page, which every length-based check reads as a
 * successful download.
 */
async function downloadEcb(now = new Date()): Promise<EcbDownload> {
  const attempts: string[] = [];
  for (let back = 0; back <= 4; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    const url = ecbUrl(d);
    console.log(`[ecb-mfi] trying ${url}`);
    let response: Response;
    try {
      response = await fetch(url, { redirect: 'follow' });
    } catch (err) {
      attempts.push(`${url} → ${(err as Error).message}`);
      continue;
    }
    if (!response.ok) {
      attempts.push(`${url} → HTTP ${response.status}`);
      continue;
    }
    const text = decodeEcbCsv(new Uint8Array(await response.arrayBuffer()));
    const list_date = d.toISOString().slice(0, 10);
    console.log(`[ecb-mfi] downloaded ${text.length} chars, list date ${list_date}`);
    return { text, url, list_date };
  }
  // No clock fallback. A list we could not download is not a list dated today.
  throw new Error(`No published ECB MFI list found. Tried:\n  ${attempts.join('\n  ')}`);
}

// ---------------------------------------------------------------------------
// Source 2 — Banco de España, list of Spanish MFIs
// ---------------------------------------------------------------------------

const BDE_URL =
  'https://www.bde.es/webbe/en/estadisticas/otras-clasificaciones/clasificacion-entidades/' +
  'listas-instituciones-financieras/listas-instituciones-financieras-monetarias-pais/lista-mfi-es.csv';

/** The 8 columns the BdE publishes, in order. Same rationale as ECB_MFI_COLUMNS. */
export const BDE_MFI_COLUMNS = [
  'EUROPEAN CODE',
  'LEI',
  'NAME',
  'CATEGORY',
  'ADDRESS',
  'REPORT',
  'HEAD OF BRANCH',
  'SUPERVISORY CODE',
] as const;

export interface BdeMfiRow {
  /** The 4-digit Spanish bank code, published bare in SUPERVISORY CODE. */
  code: string;
  name: string;
  lei: string | null;
  address: string | null;
  category: string;
}

/**
 * Split a comma-separated document into records, honouring quoted fields.
 *
 * Unlike the ECB's tab file this one is genuinely comma-delimited AND full of
 * commas inside fields — every name ("A&G BANCO, S.A.") and every address
 * ("Paseo de la Castellana, 92, 28046, Madrid"). A naive split(',') shreds all
 * 242 rows. Records rather than lines, so an embedded newline cannot shift
 * every row after it.
 */
export function parseCsvRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Read the Spanish list.
 *
 * Every field arrives padded with hundreds of trailing spaces — the export is a
 * fixed-width dump wearing a CSV extension, and `"0241"` reaches us as `"0241"`
 * followed by ~900 blanks. Trimming is not cosmetic here: an untrimmed code
 * joins nothing, forever, and silently.
 *
 * Only rows whose SUPERVISORY CODE is exactly four digits are kept as bank
 * codes. Four rows on the 2026-08-25 file publish codes like `FI2680` — money
 * market funds, whose identifier is not a bank code and must never be offered
 * as the holder of an IBAN's first four digits.
 */
export function parseBdeMfi(text: string): BdeMfiRow[] {
  const records = parseCsvRecords(text).filter((r) => r.some((f) => f.trim() !== ''));
  if (records.length === 0) throw new Error('Empty Banco de España MFI file');

  const header = records[0].map((h) => h.trim());
  if (header.length !== BDE_MFI_COLUMNS.length || header.some((h, i) => h !== BDE_MFI_COLUMNS[i])) {
    throw new Error(
      `Banco de España MFI columns moved. Expected [${BDE_MFI_COLUMNS.join(', ')}], got [${header.join(', ')}]`,
    );
  }

  const rows: BdeMfiRow[] = [];
  for (const rec of records.slice(1)) {
    if (rec.length !== BDE_MFI_COLUMNS.length) {
      throw new Error(
        `Banco de España row has ${rec.length} fields, expected ${BDE_MFI_COLUMNS.length}: "${rec.join(' | ')}"`,
      );
    }
    const code = rec[7].trim();
    if (!/^\d{4}$/.test(code)) continue;
    const name = rec[2].trim();
    if (name === '') throw new Error(`Banco de España row ${code} has no name`);
    const address = rec[4].trim();
    rows.push({
      code,
      name,
      lei: normaliseLei(rec[1]),
      address: address === '' ? null : address,
      category: rec[3].trim(),
    });
  }
  return rows;
}

interface BdeDownload {
  text: string;
  url: string;
  /** 'YYYY-MM-DD', from the server's Last-Modified header. */
  list_date: string;
}

/**
 * Download the Spanish list.
 *
 * The file carries no date, inside it or in its name — the URL is stable and
 * the content is replaced in place. `Last-Modified` is therefore the only date
 * the publisher gives us, and it is the publisher's own, not our clock. When
 * the header is absent we skip the ingestion entirely rather than date the rows
 * from `new Date()`: an attribution carrying a date the publisher never stated
 * is precisely what the licence's "faithfully, without any manipulation" clause
 * forbids.
 *
 * bde.es serves a redirect chain and 403s some clients; a browser User-Agent
 * clears it, as verified on 2026-08-26.
 */
async function downloadBde(): Promise<BdeDownload> {
  console.log(`[bde-mfi] trying ${BDE_URL}`);
  const response = await fetch(BDE_URL, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`${BDE_URL} → HTTP ${response.status}`);

  const lastModified = response.headers.get('last-modified');
  if (!lastModified) {
    throw new Error('Banco de España served no Last-Modified header, so the list has no publisher date');
  }
  const stamp = new Date(lastModified);
  if (Number.isNaN(stamp.getTime())) {
    throw new Error(`Banco de España Last-Modified is unparseable: "${lastModified}"`);
  }
  const list_date = stamp.toISOString().slice(0, 10);
  const text = await response.text();
  console.log(`[bde-mfi] downloaded ${text.length} chars, list date ${list_date} (Last-Modified)`);
  return { text, url: BDE_URL, list_date };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function createEcbMfiTable(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ecb_mfi (
      riad_code          TEXT PRIMARY KEY,
      country            TEXT NOT NULL,
      name               TEXT NOT NULL,
      lei                TEXT,
      address            TEXT,
      category           TEXT NOT NULL,
      national_bank_code TEXT,
      list_date          TEXT NOT NULL,
      source             TEXT NOT NULL DEFAULT 'European Central Bank',
      updated_at         TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_ecb_mfi_lei ON ecb_mfi(lei)');
  // The national-code path always queries country AND code together (see
  // nationalBankCode): a composite index is what that lookup actually reads.
  db.exec('CREATE INDEX IF NOT EXISTS idx_ecb_mfi_national ON ecb_mfi(country, national_bank_code)');
}

export function createBdeMfiTable(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bde_mfi (
      code       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      lei        TEXT,
      address    TEXT,
      category   TEXT NOT NULL,
      list_date  TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'Banco de España',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_bde_mfi_lei ON bde_mfi(lei)');
}

/** Ingest the ECB list, or leave `ecb_mfi` exactly as it was. */
async function seedEcb(db: import('better-sqlite3').Database): Promise<void> {
  let downloaded: EcbDownload;
  try {
    downloaded = await downloadEcb();
  } catch (err) {
    console.error(`[ecb-mfi] download failed: ${(err as Error).message}`);
    console.log('[ecb-mfi] ecb_mfi left untouched. Exiting 0 so the build is not broken.');
    return;
  }

  let parsed: EcbParse;
  try {
    parsed = parseEcbMfi(downloaded.text);
  } catch (err) {
    console.error(`[ecb-mfi] parse failed on ${downloaded.url}: ${(err as Error).message}`);
    console.log('[ecb-mfi] ecb_mfi left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  if (parsed.rows.length < MIN_ECB_ROWS) {
    console.error(
      `[ecb-mfi] sanity floor: parsed ${parsed.rows.length} institutions but expected at least ${MIN_ECB_ROWS}.`,
    );
    console.log('[ecb-mfi] ecb_mfi left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  db.exec('DROP TABLE IF EXISTS ecb_mfi');
  createEcbMfiTable(db);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO ecb_mfi
      (riad_code, country, name, lei, address, category, national_bank_code, list_date, source)
    VALUES (@riad_code, @country, @name, @lei, @address, @category, @national_bank_code, @list_date,
            'European Central Bank')
  `);
  db.transaction((rows: EcbMfiRow[]) => {
    for (const r of rows) insert.run({ ...r, list_date: downloaded.list_date });
  })(parsed.rows);

  const fr = (
    db.prepare("SELECT COUNT(*) c FROM ecb_mfi WHERE national_bank_code IS NOT NULL").get() as { c: number }
  ).c;
  const withLei = (db.prepare('SELECT COUNT(*) c FROM ecb_mfi WHERE lei IS NOT NULL').get() as { c: number }).c;
  const joined = (
    db.prepare('SELECT COUNT(DISTINCT m.riad_code) c FROM ecb_mfi m JOIN bic_entries b ON b.lei = m.lei').get() as {
      c: number;
    }
  ).c;

  console.log('\n--- ECB MFI seed results ---');
  console.log(`Source URL:            ${downloaded.url}`);
  console.log(`List date:             ${downloaded.list_date} (from the published file name)`);
  console.log(`Institutions:          ${parsed.rows.length}`);
  console.log(`With a usable LEI:     ${withLei}`);
  console.log(`Joining a BIC row:     ${joined}`);
  console.log(`FR national bank code: ${fr}`);
}

/** Ingest the Spanish list, or leave `bde_mfi` exactly as it was. */
async function seedBde(db: import('better-sqlite3').Database): Promise<void> {
  let downloaded: BdeDownload;
  try {
    downloaded = await downloadBde();
  } catch (err) {
    console.error(`[bde-mfi] download failed: ${(err as Error).message}`);
    console.log('[bde-mfi] bde_mfi left untouched. Exiting 0 so the build is not broken.');
    return;
  }

  let rows: BdeMfiRow[];
  try {
    rows = parseBdeMfi(downloaded.text);
  } catch (err) {
    console.error(`[bde-mfi] parse failed on ${downloaded.url}: ${(err as Error).message}`);
    console.log('[bde-mfi] bde_mfi left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  if (rows.length < MIN_BDE_ROWS) {
    console.error(`[bde-mfi] sanity floor: parsed ${rows.length} institutions but expected at least ${MIN_BDE_ROWS}.`);
    console.log('[bde-mfi] bde_mfi left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  db.exec('DROP TABLE IF EXISTS bde_mfi');
  createBdeMfiTable(db);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO bde_mfi (code, name, lei, address, category, list_date, source)
    VALUES (@code, @name, @lei, @address, @category, @list_date, 'Banco de España')
  `);
  db.transaction((all: BdeMfiRow[]) => {
    for (const r of all) insert.run({ ...r, list_date: downloaded.list_date });
  })(rows);

  const withLei = (db.prepare('SELECT COUNT(*) c FROM bde_mfi WHERE lei IS NOT NULL').get() as { c: number }).c;

  console.log('\n--- Banco de España MFI seed results ---');
  console.log(`Source URL:        ${downloaded.url}`);
  console.log(`List date:         ${downloaded.list_date} (from the Last-Modified header)`);
  console.log(`Institutions:      ${rows.length}`);
  console.log(`With a usable LEI: ${withLei}`);
  console.log(
    '\nAttribution required by the licence: ' +
      '"Own elaboration based on data from the Banco de España website (www.bde.es)", ' +
      'plus the notice that the data is available free of charge from that website.',
  );
}

async function main(): Promise<void> {
  const db = new Database(BIC_DB_PATH);
  db.pragma('journal_mode = WAL');
  try {
    // Sequential on purpose: two publishers, two independent verdicts, and a
    // failure on one must not take the other's table down with it.
    await seedEcb(db);
    await seedBde(db);
  } finally {
    db.close();
  }
  console.log('\nDone! ecb_mfi and bde_mfi seeded in data/bic.sqlite');
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[ecb-mfi] seed failed:', err);
    process.exitCode = 1;
  });
}
