/**
 * Seed the Austrian, Belgian and Slovak bank-code registers.
 *
 * All three are published by the authority that allocates the codes, which is
 * what lets an absence mean "held by nobody" rather than "absent from our map".
 * The same claim CH, LI, DE and FI already carry.
 *
 *   npx tsx scripts/seed-national.ts          # all
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
 *
 * SLOVAKIA — Národná banka Slovenska, "Directory of identification codes for
 * the domestic payment system in the Slovak Republic" (the prevodník). Read the
 * PAGE, not a file: see the three notes below.
 *
 * ## Why Slovakia starts from an HTML page
 *
 * The download links are per-document UUIDs that change with every version
 * (`https://nbs.sk/dokument/<uuid>/stiahnut/?force=true`), so there is no
 * durable file URL to hardcode. The page publishes the same directory twice,
 * as a PDF and as a CSV, distinguished only by the "(CSV)" suffix on the anchor
 * text — which is therefore the handle this seeder holds it by.
 *
 * 🚨 The historical direct link
 * `https://www.nbs.sk/_img/documents/_platobnesystemy/eurosips/prevodnik_ik_tps_sr.csv`
 * still answers HTTP 200 and is the obvious thing to reach for. Do not: measured
 * 06/09/2026 it serves a STALE edition — the old Slovak header, 42 rows, three
 * banks that have left the register (5200, 8050, 8170) and none of the three
 * that joined it (2250, 3030, 6363). A dead file that answers 200 is worse than
 * one that 404s, because nothing in the pipeline notices.
 *
 * ## Why the CSV must be decoded as windows-1250
 *
 * The server sends `Content-Type: text/csv;charset=UTF-8` and that header is
 * FALSE (measured 06/09/2026: the file does not decode as UTF-8 at all — byte
 * 0x9a, `š` in windows-1250, is not a valid UTF-8 lead). Trusting the header
 * turns "Všeobecná úverová banka" into noise, and latin1 — the encoding the
 * Austrian file above needs — is just as wrong here: it renders `š` as a
 * control character. Slovak needs the Central European page.
 *
 * ## The licence, and why `source` and `as_of` are stored
 *
 * The NBS site terms (https://nbs.sk/disclaimer-sk/, "Podmienky používania",
 * read 06/09/2026) allow storing, reproducing and reusing published information
 * without prior consent on two conditions: the NBS must be named as the source,
 * and the electronic file must not be altered in content or otherwise. So the
 * credit is DATA, written into `national_bank_codes.source` / `.as_of` from the
 * page itself and read back by every surface — the discipline seed-bg-bae.ts
 * adopted for the Bulgarian terms and pra-banks.ts for the Bank of England's
 * list month. A credit written by hand beside a value read from the database is
 * how the two drift apart, and here the drift would breach a licence condition.
 * Institution names are stored verbatim (edge whitespace only), which is why no
 * transliteration or tidying happens anywhere in the Slovak path.
 *
 * A letter of 26/08/2026 to info@nbs.sk asked whether extracting fields from
 * the file counts as altering it; unanswered as of 06/09/2026. The Czech
 * National Bank, whose terms carry a near-identical clause, answered on
 * 27/08/2026 that it does not ("you do not alter the information", the
 * department's own view). If the NBS answers otherwise, this register comes
 * back out.
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.BIC_DB_PATH ?? resolve(__dirname, '../data/bic.sqlite');

const SOURCES = {
  AT: 'https://www.oenb.at/docroot/downloads_observ/sepa-zv-vz_gesamt.csv',
  BE: 'https://www.nbb.be/doc/be/be/protocol/full_list_current.xlsx',
  // The PAGE, not a file — the CSV behind it carries a per-version UUID.
  SK: 'https://nbs.sk/en/payments/general-information/directories-and-registers/directory-identification-codes-domestic-payment-system-in-sr/',
} as const;

/**
 * Refuse to replace a good table with a short one.
 *
 * Measured 29/07/2026: 869 Austrian codes, 790 allocated Belgian ones.
 * Measured 06/09/2026: 38 Slovak ones — the whole Slovak payment system fits in
 * two screens, so its floor is set well under the count rather than just under
 * it, or an ordinary month in which four providers merge would fail the build.
 * A truncated download, an upstream incident or a format change our parser
 * mangled would come back well under these. Abort BEFORE touching the table and
 * let the existing data stand.
 */
const MIN_EXPECTED: Record<string, number> = { AT: 700, BE: 650, SK: 25 };

/**
 * The OeNB and NBB both redirect or refuse without a browser User-Agent.
 * nbs.sk serves either way (measured 06/09/2026, page and CSV both 200 with no
 * UA at all); it is sent there for consistency, not out of necessity.
 */
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
  /**
   * The credit the register's own terms require, and the date it is about.
   *
   * Null for AT and BE, whose publishers ask for none and who state no edition
   * date of their own — those two are dated by the reference set's refresh
   * month, which is the honest answer for a file re-read on our cycle. Slovakia
   * fills both: its terms make the citation a condition, and its page states an
   * effective date that our refresh month would misreport.
   */
  source?: string | null;
  as_of?: string | null;
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
    seen.set(code, {
      code,
      name,
      bic: bic8(rawBic),
      street: null,
      post_code: null,
      town: null,
      lei: null,
    });
  }
  console.log(`  BE: ${vacant} slots marked VRIJ or unavailable, dropped on purpose`);
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Slovakia
// ---------------------------------------------------------------------------

/**
 * The edition of the prevodník a run actually read, taken from the page.
 *
 * Nothing here is derived from a clock or a file name. The version and the
 * effective date are the dated half of the attribution the NBS terms require,
 * and the CSV link is a per-version UUID with no stable form to guess.
 */
export interface SlovakEdition {
  /** The register's own version number, as the page prints it: '225'. */
  version: string;
  /** Effective date, ISO. The page writes it 'D. M. YYYY'. */
  as_of: string;
  /** Absolute URL of the CSV, from the anchor whose text ends '(CSV)'. */
  csv_url: string;
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decode the entities before matching anything.
 *
 * The page writes the effective date `18.&nbsp;5.&nbsp;2026`. JavaScript's `\s`
 * does cover U+00A0, so a tolerant regex works — but only AFTER the entity is
 * decoded; against the raw markup it is matching the six literal characters
 * `&nbsp;` and fails. Both fixtures in the test carry the entity for exactly
 * this reason.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (/^#x/i.test(body)) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return HTML_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Markup to readable text: drop the tags, then decode what they were hiding. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '));
}

/**
 * Read the edition off the register page.
 *
 * The version and the date are label-and-value pairs split by markup
 * (`<p>Version: <strong>225</strong></p>`), so they are matched against the
 * stripped text rather than the source. Both labels appear exactly once on the
 * page (measured 06/09/2026).
 *
 * `pageUrl` is only used to resolve the anchor: the NBS emits absolute hrefs
 * today, and resolving means a switch to relative ones is a non-event rather
 * than a download of `/dokument/...` against nothing.
 */
export function parseSlovakiaPage(html: string, pageUrl: string): SlovakEdition {
  let csv_url = '';
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    // The label is what distinguishes the CSV from the PDF of the same
    // directory: the two hrefs are indistinguishable UUIDs.
    const label = textOf(m[2]).replace(/\s+/g, ' ').trim();
    if (/\(CSV\)$/i.test(label)) {
      csv_url = new URL(m[1], pageUrl).toString();
      break;
    }
  }
  if (!csv_url) {
    throw new Error(
      'SK: no anchor whose text ends in "(CSV)" on the register page, layout changed',
    );
  }

  const text = textOf(html);
  const version = /Version:\s*(\d+)/i.exec(text)?.[1];
  if (!version) throw new Error('SK: no "Version:" on the register page, layout changed');

  const d = /Effective from:\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i.exec(text);
  if (!d) {
    throw new Error(
      'SK: no "Effective from: D. M. YYYY" on the register page. The date is half of the ' +
        'attribution the NBS terms require and is never taken from a clock — refusing the page.',
    );
  }
  const as_of = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  // Reject 31.02: a Date round-trip is the cheapest calendar we have, and a
  // date that does not exist means the match landed on something else.
  const probe = new Date(`${as_of}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== as_of) {
    throw new Error(`SK: "${d[1]}. ${d[2]}. ${d[3]}" is not a date, refusing the page`);
  }
  return { version, as_of, csv_url };
}

/** The credit the NBS terms require, built from the edition the run read. */
export function slovakSource(edition: SlovakEdition): string {
  return `Národná banka Slovenska, Directory of identification codes for the domestic payment system, version ${edition.version}`;
}

/**
 * Parse the prevodník CSV. Pure, so the traps below are held by a test rather
 * than by a download.
 *
 * ## Finding the header
 *
 * The current file opens straight on an English header
 * (`Payment system code SR;Payment service provider;SWIFT 8;Payment system SIPS`);
 * the edition still served by the dead direct link opens on a Slovak TITLE row
 * and puts the Slovak header (`Kód platobného styku;…;SWIFT kód 8;…`) second.
 * So the header is found by the one token both spellings share — SWIFT — and
 * never by position. That token also locates the BIC column.
 *
 * Code and name are columns 0 and 1, which both published layouts agree on.
 * Deriving them from the heading text instead would be guesswork in two
 * languages where "Kód" appears in the SWIFT heading too; a reordering would
 * fail the floor in write() rather than store nonsense, because every row is
 * validated (digits for the code, a non-empty name).
 *
 * ## The four columns
 *
 * - CODE. Published WITHOUT its leading zero (`200`, `900`, `600`) while a
 *   Slovak IBAN carries four digits in positions 5-8 (`SKkk bbbb pppppp
 *   cccccccccc`) — and while the register's OWN PDF and the HTML table on the
 *   same page both write `0200` and `0720`. The CSV is the odd one out, so
 *   padStart(4) restores what the register itself publishes everywhere else.
 *   Comparing unpadded would answer "not allocated" for the country's largest
 *   bank, the defect normaliseCode() in national-registers.ts exists to stop.
 * - NAME. Verbatim, edge whitespace only. Several rows carry a trailing space
 *   ('Air bank a.s. '), several a non-breaking space or a double space inside
 *   ('Slovenská záručná a<U+00A0>rozvojová banka', 'ING Bank N.V.,  pobočka…');
 *   the inner ones stay. Tidying them would be the alteration the terms forbid,
 *   and JS trim() removes U+00A0 at the edges, which is all we want removed.
 * - SWIFT 8. Empty on four rows (8191, 8400, 9950, 9956) — real entries that
 *   simply hold no BIC. 🚨 Unlike seed-bg-bae.ts, this parser must NOT check
 *   that the BIC's country is the register's own: eight Czech institutions hold
 *   a Slovak payment code and publish a CZ BIC (2010 Fio, 5800 J&T, 2070
 *   TRINITY, 6000 PPF, 0600 MONETA, 3030 Air bank, 2250 CREDITAS, 6363
 *   Partners). A country check would silently drop all eight.
 * - Payment system SIPS. An 'x' marks participation in SIPS, the domestic
 *   clearing system. Not stored: the table has no column for it, and the
 *   verdict is about who holds the code, not about how they clear.
 */
export function parseSlovakia(text: string, edition: SlovakEdition): Entry[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headerIdx = lines.findIndex((l) => /swift/i.test(l));
  if (headerIdx < 0) throw new Error('SK: no header row carrying "SWIFT", format changed');
  const iBic = lines[headerIdx].split(';').findIndex((h) => /swift/i.test(h));
  // Column 2 in both published layouts, and it must at least sit AFTER the code
  // and name columns this parser reads by position. `iBic < 2` means the row did
  // not split into fields at all — which is what a changed separator looks like:
  // one field containing the whole line, "SWIFT" inside it, index 0. Refusing
  // here turns that into a red build; without the guard the run parses to zero
  // rows and only the floor in write() notices, one layer too late to say why.
  if (iBic < 2) throw new Error('SK: the SWIFT column is not where a header row puts it');

  const source = slovakSource(edition);
  const seen = new Map<string, Entry>();
  for (const line of lines.slice(headerIdx + 1)) {
    const f = line.split(';');
    const code = pad(f[0] ?? '', 4);
    if (!code || seen.has(code)) continue;
    const name = (f[1] ?? '').trim();
    if (!name) continue;
    seen.set(code, {
      code,
      name,
      bic: bic8(f[iBic] ?? ''),
      // The prevodník publishes a name and a BIC, no address at all — the same
      // honest shape as Belgium. Nulls here are what the NBS publishes, not
      // data missing on our side, and inventing an address would be the
      // distortion its terms forbid.
      street: null,
      post_code: null,
      town: null,
      lei: null,
      source,
      as_of: edition.as_of,
    });
  }
  return [...seen.values()];
}

async function parseSlovakiaLive(): Promise<Entry[]> {
  // The page is UTF-8 (and says so truthfully); only the CSV lies about it.
  const page = new TextDecoder('utf-8').decode(await fetchBytes(SOURCES.SK));
  const edition = parseSlovakiaPage(page, SOURCES.SK);
  console.log(`  SK: version ${edition.version}, effective ${edition.as_of}`);
  console.log(`  SK: reading ${edition.csv_url}`);
  const csv = new TextDecoder('windows-1250').decode(await fetchBytes(edition.csv_url));
  return parseSlovakia(csv, edition);
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
      'INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei, source, as_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of entries)
      ins.run(
        cc,
        e.code,
        e.name,
        e.bic,
        e.street,
        e.post_code,
        e.town,
        e.lei,
        e.source ?? null,
        e.as_of ?? null,
      );
  });
  tx();
  console.log(`  ${cc}: ${entries.length} codes written`);
  // Print the credit the row carries, so a run that must satisfy a licence
  // shows what it wrote rather than leaving it to be looked up.
  const credit = entries[0]?.source;
  if (credit) console.log(`  ${cc}: attribution stored — "${credit} (${entries[0]?.as_of})"`);
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
      source    TEXT,
      as_of     TEXT,
      PRIMARY KEY (country, code)
    );
  `);
  // CREATE TABLE IF NOT EXISTS does not migrate an existing table — a base
  // seeded before the address columns existed needs an explicit ALTER, or the
  // INSERT below fails on column count. `source` and `as_of` joined the list
  // for Slovakia, whose licence makes the credit part of the data; AT and BE
  // leave both NULL and keep dating their answers by the reference set.
  const have = new Set(
    (db.prepare(`PRAGMA table_info(national_bank_codes)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  for (const col of ['street', 'post_code', 'town', 'lei', 'source', 'as_of']) {
    if (!have.has(col)) db.exec(`ALTER TABLE national_bank_codes ADD COLUMN ${col} TEXT`);
  }

  const jobs: Array<[keyof typeof SOURCES, () => Promise<Entry[]>]> = [
    ['AT', parseAustria],
    ['BE', parseBelgium],
    ['SK', parseSlovakiaLive],
  ];
  for (const [cc, parse] of jobs) {
    if (only && only !== cc) continue;
    console.log(`${cc}: downloading ${SOURCES[cc]}`);
    write(db, cc, await parse());
  }
  db.close();
  console.log('done');
}

// Guarded so the test can import the pure parsers without the script running.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
