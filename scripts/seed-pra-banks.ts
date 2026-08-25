/**
 * IBANforge — Seed the Bank of England "List of PRA-regulated Banks" into bic.sqlite
 *
 * The Bank of England granted written permission (25/08/2026) to reuse the
 * monthly list as a reference source inside this API, on ONE condition:
 * attribution to the Bank of England **together with the month of the list**.
 * That is why `list_month` is a stored column and not a derived guess — the
 * month is part of the licence, not decoration. Nothing in this script may
 * fall back to the wall clock for it: an attribution carrying the wrong month
 * is the one failure of this ingestion that cannot be walked back.
 *
 * Usage: npx tsx scripts/seed-pra-banks.ts
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const BIC_DB_PATH = resolve(__dirname, '../data/bic.sqlite');

/**
 * The list is published as `banks-list-YYMM.csv` under the year folder, early
 * in the month it covers. Asking for the current month on the 1st therefore
 * 404s perfectly normally, which is why the caller walks backwards instead of
 * treating the first miss as an incident.
 */
function listUrl(year: number, month: number): string {
  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return (
    'https://www.bankofengland.co.uk/-/media/boe/files/prudential-regulation/authorisations/' +
    `which-firms-does-the-pra-regulate/${year}/banks-list-${yy}${mm}.csv`
  );
}

/**
 * Sanity floor. The live list carries a few hundred firms across its sections.
 * A parse that comes back far under that is a truncated download or a layout
 * change our reader silently mangled — and the table it would replace is the
 * evidence behind a permission-bearing claim. Abort *before* touching the
 * database and let the existing rows stand, exactly as seed-bc-nummer.ts does.
 */
const MIN_EXPECTED_ROWS = 200;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Stable keys for the four blocks the BoE publishes. The labels are the file's
 * own wording; an unrecognised one is a hard failure rather than a skip,
 * because a section quietly dropped is a bank quietly reported as unknown.
 */
export const PRA_SECTIONS = {
  'Banks incorporated in the UK authorised to accept deposits': 'uk_incorporated',
  'Banks incorporated outside the UK authorised to accept deposits through a branch in the UK': 'non_uk_branch',
  'Banks incorporated in Gibraltar authorised to accept deposits through a branch or service in the UK':
    'gibraltar_branch',
  'Banks incorporated in the EEA authorised to accept deposits through a branch in the UK while in Supervised Run Off (SRO)':
    'eea_sro_branch',
} as const;

export type PraSection = (typeof PRA_SECTIONS)[keyof typeof PRA_SECTIONS];

/**
 * Whose LEI the third column holds.
 *
 * The UK-incorporated block heads it "LEI" — the firm's own. The branch block
 * heads it "Head Office LEI", which is the LEI of the entity abroad, shared
 * with every BIC that entity owns anywhere. Read from the header row rather
 * than inferred from the section, so a BoE relabelling is picked up instead of
 * being overridden by our assumption.
 */
export type LeiBasis = 'lei' | 'head_office_lei';

export interface PraBankRow {
  firm_name: string;
  frn: string;
  lei: string | null;
  section: PraSection;
  lei_basis: LeiBasis;
}

export interface PraListParse {
  /** 'YYYY-MM', read from the preamble. The attribution month. */
  list_month: string;
  rows: PraBankRow[];
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * "List of PRA-regulated Banks as at  01 August 2026" — note the DOUBLE space
 * after "at" in the published file. `\s+` rather than a literal space is the
 * whole point of this regex, and removing it silently un-dates the attribution.
 */
const AS_AT_RE = /List of PRA-regulated Banks as at\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i;

/**
 * Split a CSV document into records, honouring quoted fields.
 *
 * A naive `split(',')` is not enough here: the second preamble line contains a
 * comma inside its quoted prose, and firm names do too
 * ("ARBUTHNOT LATHAM & CO., LIMITED"). Records rather than lines, so a field
 * carrying a newline cannot shift every row after it.
 */
export function parseCsvRecords(text: string): string[][] {
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first field
  // and no comparison against it ever matches.
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

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

/**
 * Normalise the published LEI, or answer null.
 *
 * One row in the August 2026 file reads `'95980020140005844330`: a leading
 * apostrophe, Excel's "treat this as text" escape, not part of the identifier.
 * Joined as-is it matches no LEI in GLEIF and the firm silently loses its
 * authorisation. Anything that is not 20 alphanumerics after that is stored as
 * null rather than guessed at — a row with no usable LEI still belongs in the
 * table, it simply never joins.
 */
export function normaliseLei(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().replace(/^'/, '').toUpperCase();
  return /^[A-Z0-9]{20}$/.test(value) ? value : null;
}

/**
 * Read the whole document: attribution month first, then the sections.
 *
 * Throws on anything it cannot account for. The caller turns a throw into "keep
 * the table we already have" — never into a partial ingestion.
 */
export function parsePraList(text: string): PraListParse {
  const records = parseCsvRecords(text);

  let listMonth: string | null = null;
  let section: PraSection | null = null;
  let leiBasis: LeiBasis | null = null;
  const rows: PraBankRow[] = [];

  for (const raw of records) {
    const fields = raw.map((f) => f.trim());
    if (fields.every((f) => f === '')) continue;

    const first = fields[0];
    const isProse = fields.slice(1).every((f) => f === '');

    if (isProse) {
      const asAt = AS_AT_RE.exec(first);
      if (asAt) {
        const monthIndex = MONTH_NAMES.indexOf(asAt[2].toLowerCase());
        if (monthIndex === -1) {
          throw new Error(`Unrecognised month name in the preamble: "${asAt[2]}" (line: ${first})`);
        }
        listMonth = `${asAt[3]}-${String(monthIndex + 1).padStart(2, '0')}`;
        continue;
      }

      const known = (PRA_SECTIONS as Record<string, PraSection>)[first];
      if (known) {
        section = known;
        leiBasis = null;
        continue;
      }

      // Before the first section this is the preamble prose the BoE ships with
      // every issue. After it, it is a heading we do not know — and swallowing
      // it would drop every firm underneath it without a sound.
      if (section === null) continue;
      throw new Error(`Unknown section heading after "${section}": "${first}"`);
    }

    if (first === 'Firm Name') {
      if (section === null) throw new Error('Column header found before any section heading');
      const leiHeader = (fields[2] ?? '').toLowerCase();
      if (leiHeader === 'lei') leiBasis = 'lei';
      else if (leiHeader === 'head office lei') leiBasis = 'head_office_lei';
      else throw new Error(`Unknown LEI column header in section "${section}": "${fields[2]}"`);
      continue;
    }

    if (section === null || leiBasis === null) {
      throw new Error(`Data row outside any section/header: "${fields.join(' | ')}"`);
    }

    const frn = (fields[1] ?? '').trim();
    if (first === '' || frn === '') {
      throw new Error(`Data row missing firm name or FRN: "${fields.join(' | ')}"`);
    }

    rows.push({
      firm_name: first,
      frn,
      lei: normaliseLei(fields[2]),
      section,
      lei_basis: leiBasis,
    });
  }

  if (!listMonth) {
    // No clock fallback. The month is the condition of the permission; guessing
    // it would publish an attribution we were not given.
    throw new Error('Could not read "List of PRA-regulated Banks as at <date>" from the preamble');
  }

  return { list_month: listMonth, rows };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

interface Downloaded {
  text: string;
  url: string;
  /** 'YYYY-MM' implied by the file name we actually got. */
  url_month: string;
}

/**
 * Walk back from the current month. The BoE publishes the list a few days into
 * the month it covers, so a miss on the newest candidate is the normal state of
 * the first week, not an incident.
 *
 * The HTML landing page needs a browser User-Agent (403 otherwise); the CSV
 * itself does not, verified 25/08/2026 with curl's default UA.
 */
async function downloadList(now = new Date()): Promise<Downloaded> {
  const attempts: string[] = [];

  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const url = listUrl(year, month);
    console.log(`[pra] trying ${url}`);
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
    const text = await response.text();
    console.log(`[pra] downloaded ${text.length} bytes from ${url}`);
    return { text, url, url_month: `${year}-${String(month).padStart(2, '0')}` };
  }

  throw new Error(`No published list found. Tried:\n  ${attempts.join('\n  ')}`);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function createPraBanksTable(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pra_banks (
      frn        TEXT NOT NULL,
      firm_name  TEXT NOT NULL,
      lei        TEXT,
      section    TEXT NOT NULL,
      lei_basis  TEXT NOT NULL,
      list_month TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'Bank of England',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (frn, section)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pra_banks_lei ON pra_banks(lei)');
}

async function main(): Promise<void> {
  let downloaded: Downloaded;
  try {
    downloaded = await downloadList();
  } catch (err) {
    // Same doctrine as the Vocalink seeder documented in docs/data-sources.md:
    // an upstream that is not serving today must not turn a build red. The
    // table already in the database stays, attribution and all.
    console.error(`[pra] download failed: ${(err as Error).message}`);
    console.log('[pra] pra_banks left untouched. Exiting 0 so the build is not broken.');
    return;
  }

  let parsed: PraListParse;
  try {
    parsed = parsePraList(downloaded.text);
  } catch (err) {
    console.error(`[pra] parse failed on ${downloaded.url}: ${(err as Error).message}`);
    console.log('[pra] pra_banks left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  if (parsed.rows.length < MIN_EXPECTED_ROWS) {
    console.error(
      `[pra] sanity floor: parsed ${parsed.rows.length} firms but expected at least ${MIN_EXPECTED_ROWS}.`,
    );
    console.log('[pra] pra_banks left untouched (nothing was dropped). Exiting 0.');
    return;
  }

  if (parsed.list_month !== downloaded.url_month) {
    // Not fatal — the file name is a convenience, the preamble is the source of
    // truth — but a divergence means one of the two is not what we think it is,
    // and the month is the licensed part of the attribution.
    console.warn(
      `[pra] WARNING: file name implies ${downloaded.url_month} but the preamble says ${parsed.list_month}. ` +
        'Using the preamble.',
    );
  }

  const db = new Database(BIC_DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec('DROP TABLE IF EXISTS pra_banks');
  createPraBanksTable(db);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO pra_banks (frn, firm_name, lei, section, lei_basis, list_month, source)
    VALUES (@frn, @firm_name, @lei, @section, @lei_basis, @list_month, 'Bank of England')
  `);

  const insertAll = db.transaction((rows: PraBankRow[]) => {
    for (const row of rows) insert.run({ ...row, list_month: parsed.list_month });
  });
  insertAll(parsed.rows);

  const perSection = db
    .prepare('SELECT section, COUNT(*) AS cnt FROM pra_banks GROUP BY section ORDER BY section')
    .all() as Array<{ section: string; cnt: number }>;
  const withLei = (
    db.prepare("SELECT COUNT(*) AS cnt FROM pra_banks WHERE lei IS NOT NULL AND lei != ''").get() as {
      cnt: number;
    }
  ).cnt;
  const joined = (
    db
      .prepare(
        'SELECT COUNT(DISTINCT p.frn) AS cnt FROM pra_banks p JOIN bic_entries b ON b.lei = p.lei',
      )
      .get() as { cnt: number }
  ).cnt;

  db.close();

  console.log('\n--- PRA List of Banks seed results ---');
  console.log(`Source URL:        ${downloaded.url}`);
  console.log(`List month:        ${parsed.list_month} (read from the preamble)`);
  console.log(`Firms inserted:    ${parsed.rows.length}`);
  for (const s of perSection) console.log(`  ${s.section.padEnd(18)} ${s.cnt}`);
  console.log(`With a usable LEI: ${withLei}`);
  console.log(`Joining a BIC row: ${joined}`);
  console.log('\nDone! pra_banks seeded in data/bic.sqlite');
  console.log('Attribution required by the permission: "Bank of England (List of Banks, ' + parsed.list_month + ')"');
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[pra] seed failed:', err);
    process.exitCode = 1;
  });
}
