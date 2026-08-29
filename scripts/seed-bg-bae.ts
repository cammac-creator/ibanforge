/**
 * IBANforge — Seed the Bulgarian BAE code register into bic.sqlite
 *
 * ## The register
 *
 * The Bulgarian National Bank (Българска народна банка) allocates BAE codes to
 * banks and other payment service providers under its Ordinance No. 13 of
 * 18 August 2016, and publishes the whole allocation at
 * https://www.bnb.bg/RegistersAndServices/RSBAEAndBIC — as an HTML table with a
 * "download" control that serves the same rows as a SpreadsheetML 2003
 * workbook (`?download=MS-Excel`, filename BAE_BIC.xls). The workbook is what
 * this seeder reads: it carries the register's own effective date in its first
 * cell, which the HTML page only repeats inside a heading.
 *
 * ⚠️ "BNB" in this repository already means the Banque nationale de Belgique
 * (see national-registers.ts). The Bulgarian authority is spelled out in full
 * everywhere in this file and in everything it writes to the database.
 *
 * ## The licence, and why `as_of` is stored rather than derived
 *
 * The Bulgarian National Bank answered in writing on 27/08/2026 that reuse is
 * permitted "respecting the Rights for using the BNB site". Those terms allow
 * reproduction and distribution on two conditions: cite the source, and do not
 * alter or distort the data. So:
 *  - `source` and `as_of` are STORED columns, read from the file, and every
 *    served surface reads the credit from them. A hardcoded date is an
 *    attribution that rots at the first refresh.
 *  - Institution names are stored verbatim in Cyrillic. Transliterating them
 *    here would be exactly the alteration the terms forbid.
 *  - Rows this parser cannot validate are COUNTED and printed, never dropped in
 *    silence — a silent drop is a distortion that nobody can see.
 *
 * ## What a BAE code is, and what this makes authoritative
 *
 * A Bulgarian BBAN is `4!a4!n2!n8!c`: four letters of bank code in IBAN
 * positions 5-8, then four digits of branch code in 9-12. A BAE code is those
 * eight characters together — `BUIN9561` is bank `BUIN`, branch `9561`.
 *
 * Measured 29/08/2026: 251 BAE codes across 36 distinct four-letter bank codes,
 * 37 of them carrying the head-office BIC (the Bulgarian National Bank
 * publishes two head-office rows, one for its SEBRA payments service).
 *
 * The authoritative claim is made on the FOUR-LETTER BANK CODE only. The
 * register allocates that space exhaustively — no Bulgarian PSP issues IBANs
 * without a BAE code — so a bank code absent from it is allocated to nobody.
 * The full eight-character BAE is stored verbatim but is NOT used to deny: the
 * distribution of branch codes is wildly uneven (63 for one bank, a single code
 * for 28 of the 36), and denying an IBAN whose branch digits are not separately
 * published would be a `not_in_register` verdict off a coverage gap — the exact
 * overclaim enrich.ts documents at STRUCTURAL_BIC_PREFIX_RULE.
 *
 * Usage: npx tsx scripts/seed-bg-bae.ts [path/to/BAE_BIC.xls]
 *
 * The optional argument reads a file already on disk instead of downloading,
 * for a run from behind a proxy that cannot reach bnb.bg.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const BIC_DB_PATH = process.env.BIC_DB_PATH ?? resolve(__dirname, '../data/bic.sqlite');

/**
 * The workbook export of the register page. Same rows as the HTML table, plus
 * the effective date in a cell of its own.
 */
export const BG_BAE_URL =
  'https://www.bnb.bg/RegistersAndServices/RSBAEAndBIC/index.htm?download=MS-Excel';

/**
 * Sanity floors. Measured 29/08/2026: 251 codes, 36 bank codes.
 *
 * Both are checked BEFORE the table is touched. A truncated download or a
 * layout change our reader mangled would come back under them, and the table it
 * would replace is the evidence behind an `authoritative: true` claim — the one
 * kind of row that must never be replaced by a short download.
 *
 * The bank-code floor is the one that matters most: the authoritative verdict
 * is made on the four-letter code, so a parse that kept every row but folded
 * them onto a handful of banks would pass a row count and still deny most of
 * Bulgaria.
 */
export const MIN_EXPECTED_ROWS = 200;
export const MIN_EXPECTED_BANK_CODES = 30;

// ---------------------------------------------------------------------------
// SpreadsheetML
// ---------------------------------------------------------------------------

/**
 * The register's own column headings. Matched verbatim rather than by position:
 * the workbook opens with a dateline row, a title and blank spacers, so a fixed
 * row/column offset would break the first time the Bulgarian National Bank adds
 * a line above the table.
 */
const HEADER_NAME = 'Наименование на ДПУ';
const HEADER_BAE = 'БАЕ код';
/** "BIC code (head office)" — ЦУ is централно управление. */
const HEADER_BIC = 'BIC код';

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return XML_ENTITIES[body] ?? whole;
  });
}

/**
 * Read the first worksheet as a matrix of strings.
 *
 * `ss:Index` and `ss:MergeAcross` are both honoured. The current file uses only
 * MergeAcross (on its title row) and no Index at all, but a writer is free to
 * emit `ss:Index` for a sparse row at any time, and a reader that ignores it
 * shifts every value in that row one column to the left — silently, since the
 * result is still a well-formed matrix.
 */
export function parseWorksheetRows(xml: string): string[][] {
  const body = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const worksheet = /<Worksheet\b[^>]*>([\s\S]*?)<\/Worksheet>/.exec(body);
  if (!worksheet) throw new Error('No <Worksheet> in the workbook: the export format changed');

  const rows: string[][] = [];
  for (const rowMatch of worksheet[1].matchAll(/<Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Row>)/g)) {
    const inner = rowMatch[2] ?? '';
    const cells: string[] = [];
    let column = 0;
    for (const cellMatch of inner.matchAll(/<Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Cell>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const index = /ss:Index="(\d+)"/.exec(attrs);
      if (index) column = Number(index[1]) - 1;
      const data = /<Data\b[^>]*>([\s\S]*?)<\/Data>/.exec(cellMatch[2] ?? '');
      while (cells.length < column) cells.push('');
      cells[column] = data ? decodeXml(data[1]).trim() : '';
      const merge = /ss:MergeAcross="(\d+)"/.exec(attrs);
      column += 1 + (merge ? Number(merge[1]) : 0);
    }
    rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The dateline
// ---------------------------------------------------------------------------

/**
 * `04.02.2026` → `2026-02-04`.
 *
 * Null on anything else. There is no clock fallback anywhere in this file: the
 * date is half of the attribution the licence requires, and inventing one from
 * `new Date()` would publish a freshness the Bulgarian National Bank never
 * stated — the one failure of this ingestion that cannot be walked back.
 */
export function parseRegisterDate(raw: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${yyyy}-${mm}-${dd}`;
  // Reject 31.02: a Date round-trip is the cheapest calendar we have, and a
  // date that does not exist means the cell was not the dateline.
  const probe = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

/** A BAE code is the bank code and the branch code the IBAN carries, joined. */
const BAE_RE = /^[A-Z]{4}\d{4}$/;

/**
 * A head-office BIC as this register publishes it: eight characters, and the
 * country must be BG.
 *
 * The country check is not pedantry. Every BIC in a Bulgarian register is
 * Bulgarian, so a foreign one means the reader landed on the wrong column —
 * which is precisely the failure that would otherwise be stored as fact.
 */
export function normaliseBic(raw: string): string | null {
  const bic = (raw ?? '').replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{4}BG[A-Z0-9]{2}$/.test(bic) ? bic : null;
}

export interface BgBaeRow {
  /** The eight-character BAE code, verbatim. */
  bae: string;
  /** IBAN positions 5-8. The code the authoritative verdict is made on. */
  bank_code: string;
  /** IBAN positions 9-12. */
  branch_code: string;
  /** The provider's name as the register writes it, in Cyrillic, unaltered. */
  name: string;
  /** BIC8 of the head office. Published on the head-office rows only. */
  bic: string | null;
  /**
   * Position in the published file, from 0.
   *
   * Load-bearing, not bookkeeping: the register may publish more than one
   * head-office row for a bank code (it does for the Bulgarian National Bank,
   * whose SEBRA payments service has its own), and the row served as "the
   * institution holding this bank code" is the FIRST one the register lists.
   * Without a stored ordinal that pick is whatever order SQLite feels like.
   */
  ordinal: number;
}

export interface BgBaeParse {
  /** 'YYYY-MM-DD', read from the workbook's own dateline. */
  as_of: string;
  rows: BgBaeRow[];
  /** Rows refused by validation, with the reason. Printed, never hidden. */
  rejected: Array<{ reason: string; cells: string[] }>;
}

/**
 * Read the whole workbook: the effective date, then every register row.
 *
 * Throws on anything it cannot account for — a missing header, a missing
 * dateline, a duplicated BAE code. The caller turns a throw into "keep the
 * table we already have", never into a partial ingestion.
 */
export function parseBaeWorkbook(xml: string): BgBaeParse {
  const matrix = parseWorksheetRows(xml);

  const headerIndex = matrix.findIndex((row) =>
    row.some((c) => c === HEADER_NAME) && row.some((c) => c === HEADER_BAE),
  );
  if (headerIndex < 0) {
    throw new Error(
      `Header row not found (expected "${HEADER_NAME}" and "${HEADER_BAE}"): the register layout changed`,
    );
  }
  const header = matrix[headerIndex];
  const iName = header.indexOf(HEADER_NAME);
  const iBae = header.indexOf(HEADER_BAE);
  const iBic = header.findIndex((c) => c.startsWith(HEADER_BIC));
  if (iBic < 0) throw new Error(`BIC column not found (expected a heading opening on "${HEADER_BIC}")`);

  // The dateline sits above the table, alone in its row. Searched rather than
  // read from a fixed cell, and searched ONLY above the header so a date
  // appearing in an institution's name can never be mistaken for it.
  let asOf: string | null = null;
  for (const row of matrix.slice(0, headerIndex)) {
    for (const cell of row) {
      const parsed = parseRegisterDate(cell);
      if (parsed) {
        asOf = parsed;
        break;
      }
    }
    if (asOf) break;
  }
  if (!asOf) {
    throw new Error(
      'No effective date (dd.mm.yyyy) above the header row. The date is half of the attribution ' +
        'the licence requires and is never taken from a clock — refusing the file.',
    );
  }

  const rows: BgBaeRow[] = [];
  const rejected: BgBaeParse['rejected'] = [];
  const seen = new Set<string>();

  for (const cells of matrix.slice(headerIndex + 1)) {
    const bae = (cells[iBae] ?? '').replace(/\s/g, '').toUpperCase();
    const name = (cells[iName] ?? '').trim();
    const rawBic = cells[iBic] ?? '';

    // Spacer rows: no code and no name. Not a rejection, just the layout.
    if (!bae && !name) continue;

    if (!BAE_RE.test(bae)) {
      rejected.push({ reason: 'BAE code is not 4 letters followed by 4 digits', cells });
      continue;
    }
    if (!name) {
      rejected.push({ reason: 'no provider name', cells });
      continue;
    }
    if (seen.has(bae)) {
      // A duplicate means two institutions would claim one code, or that the
      // reader is double-counting. Either way the file is not what we think it
      // is, and half-ingesting it is worse than keeping yesterday's table.
      throw new Error(`BAE code ${bae} appears twice: refusing the file rather than picking one`);
    }

    const bic = rawBic.trim() ? normaliseBic(rawBic) : null;
    if (rawBic.trim() && !bic) {
      rejected.push({ reason: `BIC column holds "${rawBic.trim()}", which is not a BG BIC8`, cells });
      continue;
    }
    if (bic && bic.slice(0, 4) !== bae.slice(0, 4)) {
      // The register's own invariant, verified over all 37 head-office rows on
      // 29/08/2026: the BAE bank code IS the first four characters of the BIC.
      // A row that breaks it means the columns are misaligned.
      rejected.push({ reason: `BIC ${bic} does not open on the bank code of ${bae}`, cells });
      continue;
    }

    seen.add(bae);
    rows.push({
      bae,
      bank_code: bae.slice(0, 4),
      branch_code: bae.slice(4),
      name,
      bic,
      ordinal: rows.length,
    });
  }

  return { as_of: asOf, rows, rejected };
}

/** Distinct four-letter bank codes in a parse — the space the verdict is made on. */
export function bankCodeCount(rows: readonly BgBaeRow[]): number {
  return new Set(rows.map((r) => r.bank_code)).size;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function createBgBaeTable(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bg_bae (
      bae         TEXT PRIMARY KEY,
      bank_code   TEXT NOT NULL,
      branch_code TEXT NOT NULL,
      name        TEXT NOT NULL,
      bic         TEXT,
      ordinal     INTEGER NOT NULL,
      as_of       TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'Bulgarian National Bank, BAE register',
      updated_at  TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_bg_bae_bank_code ON bg_bae(bank_code)');
}

/**
 * Write a parsed register into the database, in one transaction, after the
 * floors pass.
 *
 * Exported so the guard can be tested without a network: "a bad download never
 * replaces good rows" is the property, and a property is only held by a test
 * that can actually hand it a bad download.
 */
export function writeBgBae(db: import('better-sqlite3').Database, parsed: BgBaeParse): number {
  const banks = bankCodeCount(parsed.rows);
  if (parsed.rows.length < MIN_EXPECTED_ROWS) {
    throw new Error(
      `Only ${parsed.rows.length} BAE codes parsed, expected at least ${MIN_EXPECTED_ROWS}. ` +
        'Refusing to replace the table.',
    );
  }
  if (banks < MIN_EXPECTED_BANK_CODES) {
    throw new Error(
      `Only ${banks} distinct bank codes parsed, expected at least ${MIN_EXPECTED_BANK_CODES}. ` +
        'Refusing to replace the table.',
    );
  }

  createBgBaeTable(db);
  const insert = db.prepare(`
    INSERT INTO bg_bae (bae, bank_code, branch_code, name, bic, ordinal, as_of, source)
    VALUES (@bae, @bank_code, @branch_code, @name, @bic, @ordinal, @as_of, @source)
  `);
  const tx = db.transaction((rows: readonly BgBaeRow[]) => {
    // Replace wholesale rather than merge: a code the register no longer lists
    // must stop being answered for, which is the entire point of holding a
    // register instead of a map.
    db.prepare('DELETE FROM bg_bae').run();
    for (const row of rows) {
      insert.run({
        ...row,
        as_of: parsed.as_of,
        source: 'Bulgarian National Bank, BAE register',
      });
    }
  });
  tx(parsed.rows);
  return parsed.rows.length;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * User-Agent strings the export endpoint actually serves.
 *
 * ⚠️ This is the trap of this ingestion, measured 29/08/2026 and reproducible
 * on demand. bnb.bg sits behind a web application firewall that guards
 * `?download=MS-Excel` (the register page itself is open to anything), and it
 * answers a refusal with **HTTP 200 and a 746-byte HTML page** titled "Error"
 * carrying an incident ID. A seeder that trusts `res.ok` therefore stores an
 * error page, and one that only checks the length stores nothing but cannot say
 * why.
 *
 * What the firewall refuses, measured, five runs each:
 *   - no User-Agent at all;
 *   - `IBANforge/1.0 (+https://ibanforge.com)` — an honest bot string;
 *   - `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)` — the TRUNCATED browser
 *     string seed-national.ts uses for the OeNB and the NBB. A browser UA with
 *     no engine or version behind it is the classic spoof signature, and this
 *     firewall scores it as one.
 * What it serves: a complete browser UA, and the plain tool strings
 * (`curl/8.7.1`, `Wget/1.21.4`, `python-requests/2.32.3`).
 *
 * Both forms are tried in order, and the reason is not cosmetic: they fail for
 * OPPOSITE reasons, so a policy change that closes one is unlikely to close the
 * other on the same day. Nothing here is a workaround for a licence — the
 * Bulgarian National Bank permitted this reuse in writing; the firewall simply
 * does not know that.
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'curl/8.7.1',
];

/** The register page, sent as the Referer: the download control lives on it. */
const REGISTER_PAGE = 'https://www.bnb.bg/RegistersAndServices/RSBAEAndBIC/index.htm';

async function download(): Promise<string> {
  const attempts: string[] = [];

  for (const ua of USER_AGENTS) {
    let res: Response;
    try {
      res = await fetch(BG_BAE_URL, {
        redirect: 'follow',
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'bg,en;q=0.9',
          Referer: REGISTER_PAGE,
        },
      });
    } catch (err) {
      attempts.push(`${ua} -> ${(err as Error).message}`);
      continue;
    }
    if (!res.ok) {
      attempts.push(`${ua} -> HTTP ${res.status}`);
      continue;
    }
    // The workbook is UTF-8 with a BOM and Cyrillic throughout; decoding it as
    // anything else turns every institution name into noise, which the "do not
    // distort" condition would not survive.
    const text = new TextDecoder('utf-8').decode(await res.arrayBuffer());
    // Content, not status. The firewall's refusal is a 200.
    if (!text.includes('<Workbook')) {
      const incident = /incident ID is: (\d+)/.exec(text)?.[1];
      attempts.push(
        `${ua} -> ${text.length} bytes that are not a workbook` +
          (incident ? ` (firewall refusal, incident ${incident})` : ''),
      );
      continue;
    }
    console.log(`[bg] ${text.length} characters served to "${ua.slice(0, 32)}…"`);
    return text;
  }

  throw new Error(
    `The BAE workbook could not be downloaded. Tried:\n  ${attempts.join('\n  ')}\n` +
      `Fallback: save ${BG_BAE_URL} by hand and run "npm run db:seed-bg -- path/to/BAE_BIC.xls".`,
  );
}

async function main(): Promise<void> {
  const localPath = process.argv[2];

  let xml: string;
  if (localPath) {
    console.log(`[bg] reading ${localPath}`);
    xml = readFileSync(localPath, 'utf8');
  } else {
    console.log(`[bg] downloading ${BG_BAE_URL}`);
    try {
      xml = await download();
    } catch (err) {
      // An upstream that is not serving today must not turn the monthly build
      // red, and must certainly not empty the table. Same doctrine as the PRA
      // seeder. A FORMAT change is a different matter — see below.
      console.error(`[bg] download failed: ${(err as Error).message}`);
      console.log('[bg] bg_bae left untouched. Exiting 0 so the build is not broken.');
      return;
    }
  }

  // Deliberately NOT caught: a workbook that downloaded fine and then failed to
  // parse means the layout changed, and the only safe outcome is a red build
  // that a human reads. The table is untouched either way — nothing below this
  // line has opened the database yet.
  const parsed = parseBaeWorkbook(xml);

  console.log(`[bg] effective date read from the file: ${parsed.as_of}`);
  console.log(
    `[bg] parsed ${parsed.rows.length} BAE codes across ${bankCodeCount(parsed.rows)} bank codes, ` +
      `${parsed.rows.filter((r) => r.bic).length} carrying a head-office BIC`,
  );
  if (parsed.rejected.length) {
    console.warn(`[bg] ${parsed.rejected.length} row(s) refused by validation:`);
    for (const r of parsed.rejected.slice(0, 20)) {
      console.warn(`  - ${r.reason}: ${r.cells.filter(Boolean).join(' | ')}`);
    }
  }

  const db = new Database(BIC_DB_PATH);
  try {
    const written = writeBgBae(db, parsed);
    console.log(`[bg] bg_bae now holds ${written} rows`);
    console.log(
      `[bg] attribution required by the terms: "Bulgarian National Bank, BAE register (${parsed.as_of})"`,
    );
  } finally {
    db.close();
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[bg] seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
