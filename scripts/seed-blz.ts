/**
 * Seed the German Bankleitzahlen register from the Bundesbank.
 *
 * ## Why this table exists
 *
 * `bank_code_check.authoritative` is a claim that an absence proves the code is
 * not allocated, and it may only be made where we hold the national register
 * itself. Until now that was Switzerland alone, via SIX BankMaster. Germany was
 * checked against a composite map assembled from BIC directories, so a German
 * miss meant "absent from our data" and nothing more. That is the gap AsterPay
 * named as the one that mattered, and Germany is their largest settlement
 * corridor.
 *
 * The Bundesbank publishes the whole register as a CSV. Measured 29/07/2026:
 * 13,807 rows, 3,506 distinct BLZ carrying a Merkmal=1 record. That is the
 * register; the Merkmal=2 rows are additional records for institutions that do
 * not themselves take part in payment transactions, and every distinct BLZ has
 * a Merkmal=1 row, so filtering on it loses nothing and keeps the meaning exact.
 *
 * ## Deleted codes and successors
 *
 * 75 BLZ carry a deletion mark and 34 of those name a successor. A merged or
 * renamed bank is precisely the failure mode AsterPay put on their own edge-case
 * list and the one case I had no verifiable example for. Those rows are kept,
 * not dropped: a retired BLZ was really allocated, and answering
 * `not_in_register` for it would be a worse lie than answering `verified`
 * without qualification. The retirement and the successor travel with the
 * answer instead, so a caller can re-paper the beneficiary rather than guess.
 *
 * Same shape as seed-bc-nummer.ts, including the sanity floor: an unattended
 * monthly cron must never replace a good table with a truncated download.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const BIC_DB_PATH = resolve(__dirname, '../data/bic.sqlite');

/**
 * The Bundesbank serves the file from a blob path that carries a content hash,
 * so the URL changes when the file does. Both known paths are tried in order;
 * enrich-bic-database.ts already carries the same pair for the same reason.
 */
const CSV_URLS = [
  'https://www.bundesbank.de/resource/blob/926192/d4d7565b2a5c1ad4045c0cf8e3ce1a4e/mL/blz-aktuell-csv-data.csv',
  'https://www.bundesbank.de/resource/blob/602632/8e0da085f3d1bc8adbc7a1f6c0284e1f/mL/blz-aktuell-csv-data.csv',
];

/**
 * The live register holds ~3,500 payment-participating BLZ. Far fewer means a
 * truncated download, an upstream incident, or a format change our parser
 * silently mangled. Abort BEFORE touching the table and let the good data stand.
 */
const MIN_EXPECTED_ROWS = 2800;

interface BlzRow {
  blz: string;
  name: string;
  short_name: string | null;
  bic: string | null;
  post_code: string | null;
  town: string | null;
  retired: number;
  successor_blz: string | null;
}

async function download(): Promise<string> {
  for (const url of CSV_URLS) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      // The file is Latin-1, not UTF-8: read bytes and decode explicitly, or
      // every umlaut in a bank name arrives mangled.
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('latin1').decode(buf);
      if (text.length > 100_000) {
        console.log(`Downloaded ${text.length} chars from ${url}`);
        return text;
      }
    } catch (err) {
      console.warn(`  fetch failed for ${url}: ${String(err).slice(0, 120)}`);
    }
  }
  throw new Error('Bundesbank BLZ file could not be downloaded from any known URL');
}

/** Split one CSV line on ';' honouring the quoting the Bundesbank actually uses. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseBlzCsv(text: string): BlzRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: BlzRow[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const f = splitLine(line);
    const blz = f[0];
    if (!/^\d{8}$/.test(blz)) continue;
    // Merkmal 1 is the institution that takes part in payment transactions;
    // 2 is an additional record for the same BLZ.
    if (f[1] !== '1') continue;
    if (seen.has(blz)) continue;
    seen.add(blz);
    const successor = (f[12] ?? '').trim();
    rows.push({
      blz,
      name: f[2] ?? '',
      short_name: f[5] || null,
      bic: (f[7] || '').trim() || null,
      post_code: f[3] || null,
      town: f[4] || null,
      retired: f[11] === '1' ? 1 : 0,
      successor_blz: successor && successor !== '00000000' ? successor : null,
    });
  }
  return rows;
}

async function main(): Promise<void> {
  const text = await download();
  const rows = parseBlzCsv(text);
  console.log(`Parsed ${rows.length} payment-participating BLZ`);
  console.log(`  retired: ${rows.filter((r) => r.retired).length}, with a successor: ${rows.filter((r) => r.successor_blz).length}`);

  if (rows.length < MIN_EXPECTED_ROWS) {
    throw new Error(`Only ${rows.length} BLZ parsed, expected at least ${MIN_EXPECTED_ROWS}. Refusing to replace the table.`);
  }

  const db = new Database(BIC_DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS de_blz (
      blz           TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      short_name    TEXT,
      bic           TEXT,
      post_code     TEXT,
      town          TEXT,
      retired       INTEGER NOT NULL DEFAULT 0,
      successor_blz TEXT,
      updated_at    TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO de_blz (blz, name, short_name, bic, post_code, town, retired, successor_blz, updated_at)
     VALUES (@blz, @name, @short_name, @bic, @post_code, @town, @retired, @successor_blz, @updated_at)
     ON CONFLICT(blz) DO UPDATE SET
       name = excluded.name, short_name = excluded.short_name, bic = excluded.bic,
       post_code = excluded.post_code, town = excluded.town, retired = excluded.retired,
       successor_blz = excluded.successor_blz, updated_at = excluded.updated_at`,
  );
  const tx = db.transaction((list: BlzRow[]) => {
    // Replace wholesale rather than merge: a BLZ the register no longer lists
    // must stop being answered for, which is the entire point of holding the
    // register instead of a map.
    db.prepare('DELETE FROM de_blz').run();
    for (const r of list) insert.run({ ...r, updated_at: now });
  });
  tx(rows);

  const count = (db.prepare('SELECT COUNT(*) c FROM de_blz').get() as { c: number }).c;
  console.log(`de_blz now holds ${count} rows`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
