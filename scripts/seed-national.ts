/**
 * Seed the Austrian, Belgian, Slovak, San Marino and Czech bank-code registers.
 *
 * 🔒 DEPUIS LE 25/09/2026 (étape du retrait) : AT, BE et SM appartiennent à la
 * famille sous conditions (src/lib/restricted-family.ts). Sans variable, ce
 * script ne lit que les registres publics (SK, CZ, et IT quand on le nomme) ;
 * `SEED_FAMILY=restricted`, posée par la chaîne privée (`npm run overlay:seed`),
 * lit AT, BE et SM seuls. Nommer un pays hors de son mode est refusé.
 *
 * ⚠️ FOUR of these five are exhaustive; San Marino is NOT. AT, BE, SK and CZ are
 * published by the authority that allocates the codes, which is what lets an
 * absence mean "held by nobody" rather than "absent from our map" — the claim
 * CH, LI, DE and FI already carry. The BCSM page is a list of *operating banks*,
 * not an allocation of the ABI space, so a San Marino miss stays exactly what it
 * is today: absent from our reference data, nothing more. The table is shared;
 * the strength of the claim is not, and it is decided in enrich.ts, which never
 * puts SM in NATIONAL_REGISTERS. Do not "tidy" that by adding it.
 *
 *   npx tsx scripts/seed-national.ts          # every public register (SK, CZ)
 *   npx tsx scripts/seed-national.ts CZ       # one
 *   npx tsx scripts/seed-national.ts IT       # Italy, only ever on its own
 *   SEED_FAMILY=restricted npx tsx scripts/seed-national.ts   # AT, BE, SM (private chain)
 *
 * ITALIE — Banca d'Italia, registres des banques, des établissements de paiement
 * et de monnaie électronique (open data CC BY 4.0). NON exhaustif, comme
 * Saint-Marin, avec en plus les codes radiés et leur successeur légal : tout est
 * dans scripts/seed-national-it.ts, qui l'explique.
 *
 * CZECHIA — Česká národní banka, Číselník kódů platebního styku v České
 * republice. The one register here whose EDITIONS are published before they
 * take effect: read the notes on parseCzechEditions and planCzechEditions, and
 * on PENDING_TABLE in src/lib/national-registers.ts, before touching it.
 *
 * AUSTRIA — Oesterreichische Nationalbank, SEPA-Zahlungsverkehrs-Verzeichnis.
 * Republished DAILY, which is finer than the Bundesbank's monthly cycle. The
 * file is Latin-1 and semicolon-separated: decoding it as UTF-8 mangles every
 * umlaut in a bank name, the same trap the German seeder documents. Its
 * `SWIFT-Code` column is 11 characters on EVERY row, and on most of them the
 * branch code is not XXX — see bicAsPublished below for why that is data and
 * not noise to be trimmed.
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
 *
 * SAN MARINO — Banca Centrale della Repubblica di San Marino, "Operating Banks".
 * Four banks, each an HTML paragraph carrying a name, a registered office, a
 * phone/fax line, an "ABI Code" and a "SWIFT BIC". Read the notes on
 * parseSanMarino for the two traps in that markup.
 *
 * ## Why this one is not authoritative
 *
 * The page lists the banks; it does not publish the allocation of the ABI code
 * space, and nothing on bcsm.sm says it exhausts it. San Marino also licenses
 * payment and e-money institutions that are not banks — one of them holds a San
 * Marino BIC and settles through EBA STEP2 — and the ISO 13616 registry's own
 * San Marino example carries an ABI absent from this page. So a hit here names
 * the holder and a MISS means nothing at all, which is why San Marino stays out
 * of NATIONAL_REGISTERS in enrich.ts and out of pruneStaleNationalCodes in
 * bic-lookup.ts. Adding it to either would turn four rows of good data into a
 * denial engine for a country whose code space we have never seen.
 *
 * ## The licence, and why `as_of` is the day we read the page
 *
 * bcsm.sm publishes NO terms of use (checked 06/09/2026: a privacy policy and a
 * "© Central Bank of the Republic of San Marino" footer, nothing else). The
 * position, written up in docs/data-sources.md, is that four lines of routing
 * data published by the supervisor to be used are served one per request with
 * the source credited; the licence is recorded as UNKNOWN rather than guessed,
 * and a letter to the BCSM is queued. Nothing here invents a clause.
 *
 * The page states no edition and no revision date, so `as_of` is the DAY THIS
 * SEEDER READ IT — the only date we can honestly stand behind — and the stored
 * `source` says so in words. Consequence, stated here rather than discovered
 * later: every run rewrites all four rows with a new date, so data/bic.sqlite
 * and sm-bank.json churn on each refresh even when the page has not changed.
 * That is the price of a source that publishes no date; refresh-diff sees 4 -> 4
 * and does not flag it.
 */
import Database from 'better-sqlite3';
import { appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import { PENDING_TABLE, registerToday } from '../src/lib/national-registers.js';
import {
  RESTRICTED_FAMILY,
  RESTRICTED_FLOORS,
  restrictedRegisterCountries,
  seedFamilyFromEnv,
} from '../src/lib/restricted-family.js';
import { failureCause, reportSeedMember, seedReportActive } from './seed-report.js';
import {
  IT_DATASET_PAGE,
  ItalianSourceNotLoaded,
  reportItalianStatus,
  seedItalianLive,
} from './seed-national-it.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.BIC_DB_PATH ?? resolve(__dirname, '../data/bic.sqlite');

const SOURCES = {
  AT: 'https://www.oenb.at/docroot/downloads_observ/sepa-zv-vz_gesamt.csv',
  BE: 'https://www.nbb.be/doc/be/be/protocol/full_list_current.xlsx',
  // The PAGE, not a file — the CSV behind it carries a per-version UUID.
  SK: 'https://nbs.sk/en/payments/general-information/directories-and-registers/directory-identification-codes-domestic-payment-system-in-sr/',
  // An HTML page and nothing else: the BCSM publishes no file of any kind.
  SM: 'https://www.bcsm.sm/en/functions/statutory-functions/payment-system/operating-banks',
  // The PAGE again: the CSV carries neither its edition nor its effective date.
  CZ: 'https://www.cnb.cz/cs/platebni-styk/ucty-kody-bank/',
} as const;

/**
 * Refuse to replace a good table with a short one.
 *
 * Measured 29/07/2026: 869 Austrian codes, 790 allocated Belgian ones.
 * Measured 06/09/2026: 38 Slovak ones — the whole Slovak payment system fits in
 * two screens, so its floor is set well under the count rather than just under
 * it, or an ordinary month in which four providers merge would fail the build.
 * Measured 25/09/2026: 46 Czech codes in edition 254. Same reasoning as the
 * Slovak floor, same family of register.
 * Measured 06/09/2026: 4 San Marino banks. A floor of 3 is not much of a guard
 * at that size, and it is not pretending to be one: the real protection there is
 * the per-field validation in parseSanMarino (five digits of ABI, a BIC of 8 or
 * 11 characters), because a page that changed shape yields zero blocks rather
 * than three bad ones.
 * A truncated download, an upstream incident or a format change our parser
 * mangled would come back well under these. Abort BEFORE touching the table and
 * let the existing data stand.
 */
const MIN_EXPECTED: Record<string, number> = {
  // Les trois registres de la famille « sous conditions » partagent leur plancher
  // avec le chargeur de la surcouche privée : une seule valeur par registre.
  AT: RESTRICTED_FLOORS.register_at,
  BE: RESTRICTED_FLOORS.register_be,
  SK: 25,
  SM: RESTRICTED_FLOORS.register_sm,
  CZ: 35,
};

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

/**
 * A register's BIC column, stored exactly as that register publishes it — 11
 * characters where it publishes 11, 8 where it publishes 8.
 *
 * 🚨 This used to cut every value to the 8-character stem, and in a cooperative
 * network that is not a normalisation, it is a change of subject. The OeNB file
 * publishes all of its BIC at 11 characters and most of them carry a branch code
 * other than XXX; in the Austrian Raiffeisen network those last three characters
 * name the LOCAL bank — a separate legal entity with its own LEI — while the
 * first eight name the Raiffeisenlandesbank it clears through. Truncating served
 * the Landesbank's BIC beside the local bank's name, with basis
 * `national_register` and `authoritative: true`, which is the strongest claim
 * this API makes. It is the same defect the German block in enrich.ts documents
 * for Sparkassen (a German integrator dropped the API over it), and the same
 * answer: the register publishes a pairing, so we serve that pairing whole.
 *
 * The form check is anchored now, so a 9, 10 or 12-character value is REFUSED
 * rather than salvaged. Truncation is what made salvaging look harmless: without
 * it, a half-read field would be stored and served as a BIC.
 */
function bicAsPublished(raw: string): string | null {
  const b = (raw ?? '').replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b) ? b : null;
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
      bic: iBic >= 0 ? bicAsPublished(f[iBic] ?? '') : null,
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
      bic: bicAsPublished(rawBic),
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
      bic: bicAsPublished(f[iBic] ?? ''),
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

// ---------------------------------------------------------------------------
// San Marino
// ---------------------------------------------------------------------------

/**
 * The register's name, and only its name.
 *
 * The DATE is not in here, though the first draft put it in and the seeder log
 * immediately printed "(read on 2026-09-06) (2026-09-06)". `source` is the
 * string a served `bic.source` shows, `as_of` is the date beside it, and the
 * one place they are joined is nationalRegisterCredit() — which words San
 * Marino's as "read on" precisely because that date is ours and not the BCSM's.
 */
export function sanMarinoSource(): string {
  return 'Central Bank of the Republic of San Marino, operating banks';
}

/**
 * Read the four operating banks out of the BCSM page.
 *
 * `readOn` is an ISO date supplied by the caller rather than taken from a clock
 * in here, so the test can pin it and so one run stamps one date on every row.
 *
 * ## Anchors: the two labels, and nothing else
 *
 * A block is found by carrying BOTH `ABI Code:` and `SWIFT BIC:`. Every other
 * label on that page varies and must not be matched on (all measured
 * 06/09/2026): two blocks open `Corporate name:` and two `Company name:`, and
 * the fourth writes `Telephone/Fax:` where the others write `Phone/Fax:`. A
 * parser anchored on any of those reads three banks and calls it four.
 *
 * ## 🚨 The name is split across two elements with no space between them
 *
 * The first bank is marked up `<strong>Banca</strong><strong>Agricola
 * Commerciale …</strong>` — no whitespace at the boundary. Strip the tags
 * naively and you get "BancaAgricola Commerciale …", which is also what a
 * browser renders, so the page itself displays the typo. That is not the
 * institution's name: our own GLEIF-sourced directory row for BASMSMSM reads
 * "BANCA AGRICOLA COMMERCIALE ISTITUTO BANCARIO SAMMARINESE" (checked
 * 06/09/2026). So tags are replaced by a SPACE and runs of whitespace collapsed
 * — reading text across an element boundary, not editing the data.
 */
export function parseSanMarino(html: string, readOn: string): Entry[] {
  const source = sanMarinoSource();
  const entries: Entry[] = [];
  const seen = new Set<string>();

  for (const block of html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? []) {
    if (!/ABI\s*Code\s*:/i.test(block) || !/SWIFT\s*BIC\s*:/i.test(block)) continue;
    // <br> becomes a newline so the labelled lines stay apart; every other tag
    // becomes a space, which is what un-joins the two <strong> of the name.
    const text = decodeEntities(block.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
    const line = (re: RegExp): string | null => {
      const m = re.exec(text);
      return m ? m[1].replace(/\s+/g, ' ').trim() || null : null;
    };

    const code = line(/ABI\s*Code\s*:\s*([^\n]*)/i);
    const bic = line(/SWIFT\s*BIC\s*:\s*([^\n]*)/i);
    // Five digits, as IBAN positions 6-10 carry it, and 8 or 11 characters of
    // BIC. A block that fails either is DROPPED and counted, never stored: a
    // page whose shape moved would otherwise write a phone number into the code
    // column, and four rows is too few for anyone to notice by eye.
    if (!code || !/^\d{5}$/.test(code)) continue;
    if (!bic || !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic.toUpperCase())) continue;
    if (seen.has(code)) continue;

    // The name is the first non-empty line after the "…name:" label, which is
    // the only thing the two label spellings are used for — matched loosely so a
    // third wording costs nothing.
    const name = line(/name\s*:\s*\n\s*([^\n]+)/i);
    if (!name) continue;

    // "Registered office: Via dell'Esempio, 101 - 47891 Contrada" (adresse
    // inventée de la fixture de test, 25/09/2026) — street, then a
    // dash, then five digits of CAP and the town. Split on the postcode rather
    // than on the dash: street names on this page contain commas and numbers,
    // and one of them (like "P.tta dell'Esempio, 2" in the fixture) would lose its house number to a
    // greedy comma split.
    const office = line(/Registered\s*office\s*:\s*([^\n]*)/i);
    const addr = office ? /^(.*?)\s*-\s*(\d{5})\s+(.+)$/.exec(office) : null;

    seen.add(code);
    entries.push({
      code,
      name,
      bic: bicAsPublished(bic),
      street: addr ? addr[1].trim() : null,
      post_code: addr ? addr[2] : null,
      town: addr ? addr[3].trim() : null,
      // The page publishes no LEI. Ours could be joined from GLEIF, but that
      // would be our enrichment wearing the register's credit.
      lei: null,
      source,
      as_of: readOn,
    });
  }
  return entries;
}

async function parseSanMarinoLive(): Promise<Entry[]> {
  const html = new TextDecoder('utf-8').decode(await fetchBytes(SOURCES.SM));
  // The date the page was READ. The BCSM states no edition and no revision
  // date, so this is the only date we can stand behind — never a clock reading
  // dressed up as the source's own, which is what getBgAsOf exists to avoid.
  const readOn = new Date().toISOString().slice(0, 10);
  const entries = parseSanMarino(html, readOn);
  console.log(`  SM: read on ${readOn}, ${entries.length} operating banks parsed`);
  return entries;
}

// ---------------------------------------------------------------------------
// Czechia
// ---------------------------------------------------------------------------

/**
 * Every edition with its effective date, PDF links only. Read when the current
 * page does not settle which edition is in force today — see seedCzechLive.
 */
const CZ_HISTORY_URL = 'https://www.cnb.cz/cs/platebni-styk/ucty-kody-bank/historicke-ciselniky/';

/**
 * The numbered CSV of an edition. Served for the current edition and past ones
 * (measured 25/09/2026: 253 and 254 answer 200, 255 answers 404, and the
 * `/export/sites/cnb/…` spelling of the same path answers 404 for all three).
 * The page links it for an ANNOUNCED edition — an archived copy of 28/08/2026
 * lists 253 with the unnumbered file and 254 with `kody_bank_CR_254.csv` — and
 * once an edition is in force it links the unnumbered file instead. Reading the
 * numbered file is what lets the edition in force be read while the unnumbered
 * one may already carry the next.
 */
export function czechNumberedCsvUrl(version: string): string {
  return `https://www.cnb.cz/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR_${version}.csv`;
}

export interface CzechEdition {
  /** The číselník's own number, as the page prints it: '254'. */
  version: string;
  /** Effective date, ISO. The page writes it 'platný od D. M. YYYY'. */
  as_of: string;
  /** The CSV linked beside it, when the page links one (the history page does not). */
  csv_url: string | null;
}

/**
 * The ČNB's pages or files are in a state this run will not load: unreachable,
 * contradictory, or older than what is stored. Both Czech tables are left
 * exactly as they were and the monthly refresh goes on for every other source
 * (see main). Everything else — a page or a file whose SHAPE changed — throws a
 * plain Error and fails the run, because that is the failure a human has to
 * read. Same rule as the Bulgarian step of the workflow.
 */
export class CzechSourceNotLoaded extends Error {}

/** 'D', 'M', 'YYYY' to ISO, or null for a day the calendar does not have. */
function isoDate(day: string, month: string, year: string): string | null {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const probe = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/**
 * Every "Číselník N platný od D. M. YYYY" a ČNB page states.
 *
 * ## 🚨 The HTML comments go first
 *
 * The current page carries a commented-out copy of its own list item, pointing
 * at `admin-cnb.cz.net`, the ČNB's administration server (measured 25/09/2026).
 * It reads "Číselník 254 platný od 1. 9. 2026" today, and nothing says it will
 * follow the next edition: matched, it could date the register with an edition
 * the public page does not state, and its links lead to a server the public
 * cannot reach.
 *
 * ## One list item at a time
 *
 * The number, the date and the CSV link are related only by sitting in the same
 * `<li>`, and on the current page that item is nested inside another whose text
 * also says "Číselník" (without a number). So the markup is cut at each `</li>`
 * and only what follows the last `<li` opening before it is read. `<link>` in
 * the page head also begins with those three letters; the opening is matched
 * with the character that must follow it.
 *
 * The phrase is matched on the TEXT, tags stripped and entities decoded: on the
 * current page the date sits inside the PDF anchor ("Číselník 254 <a>platný od
 * 1. 9. 2026 (pdf…)</a>"), on the history page the whole phrase does.
 *
 * An item whose date the calendar does not have is SKIPPED, with a warning:
 * one typo among the 129 items of the history page must not stop a run, and
 * on the current page a skipped item leaves no edition at all, which the
 * caller refuses as a changed layout.
 */
export function parseCzechEditions(html: string, pageUrl: string): CzechEdition[] {
  const visible = html.replace(/<!--[\s\S]*?-->/g, '');
  const editions: CzechEdition[] = [];
  for (const chunk of visible.split(/<\/li\s*>/i)) {
    let start = -1;
    for (const m of chunk.matchAll(/<li[\s>]/gi)) start = m.index ?? start;
    if (start < 0) continue;
    const item = chunk.slice(start);
    const text = textOf(item).replace(/\s+/g, ' ');
    const m = /[Čč]íselník\s+(\d+)\s+platn[ýáé]\s+od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(
      text,
    );
    if (!m) continue;
    let csv_url: string | null = null;
    for (const a of item.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
      const href = decodeEntities(a[1]);
      if (/\.csv(?:[?#]|$)/i.test(href)) {
        csv_url = new URL(href, pageUrl).toString();
        break;
      }
    }
    const as_of = isoDate(m[2], m[3], m[4]);
    if (!as_of) {
      console.warn(`  CZ: "${m[0]}" states no real date; that item is skipped`);
      continue;
    }
    editions.push({ version: m[1], as_of, csv_url });
  }
  return editions;
}

/**
 * Which edition is in force on `today`, and which one is announced.
 *
 * In force: the HIGHEST number whose date has come. Never "the number before
 * the announced one": editions 247 and 248 both took effect on 1 October 2025,
 * so numbers are the ČNB's order and dates only its calendar. Announced: the
 * NEXT edition to take effect — the earliest date still to come, the highest
 * number on that date — when it is newer than the one in force. Only one waits
 * in the pending table; should the ČNB ever announce two ahead, the second is
 * read by the refresh after the first takes effect.
 *
 * The same edition met on both pages must carry the same date there; if it does
 * not, nothing here can tell which page is right, so nothing is loaded.
 */
export function planCzechEditions(
  editions: readonly CzechEdition[],
  today: string,
): { current: CzechEdition; pending: CzechEdition | null } {
  const byVersion = new Map<number, CzechEdition>();
  for (const e of editions) {
    const n = Number(e.version);
    const seen = byVersion.get(n);
    if (seen && seen.as_of !== e.as_of) {
      throw new CzechSourceNotLoaded(
        `CZ: edition ${e.version} is dated ${seen.as_of} on one ČNB page and ${e.as_of} on another, refusing to pick one`,
      );
    }
    // The current page links a CSV, the history page does not: keep the link.
    if (!seen || (!seen.csv_url && e.csv_url)) byVersion.set(n, e);
  }
  const newestFirst = [...byVersion.entries()].sort((a, b) => b[0] - a[0]).map(([, e]) => e);
  const current = newestFirst.find((e) => e.as_of <= today);
  if (!current) {
    throw new CzechSourceNotLoaded(
      `CZ: none of the editions the ČNB states (${newestFirst.map((e) => `${e.version} from ${e.as_of}`).join(', ') || 'none'}) is in force on ${today}`,
    );
  }
  const announced = newestFirst.filter(
    (e) => e.as_of > today && Number(e.version) > Number(current.version),
  );
  // newestFirst is sorted by number, so the first edition on the earliest date
  // is the highest number on that date.
  const nextDate = announced.reduce<string | null>(
    (min, e) => (min === null || e.as_of < min ? e.as_of : min),
    null,
  );
  const pending = announced.find((e) => e.as_of === nextDate) ?? null;
  return { current, pending };
}

/**
 * The credit the ČNB terms require, built from the edition the run read.
 *
 * It OPENS on "Zdroj: ČNB" — the terms' own words, "ČNB musí být vždy uvedena
 * jako zdroj informací (Zdroj: ČNB)" — because this string is served as it is,
 * as `bic.source`, on every answer whose BIC comes from the register.
 */
export function czechSource(edition: Pick<CzechEdition, 'version'>): string {
  return `Zdroj: ČNB, Číselník kódů platebního styku v ČR, verze ${edition.version}`;
}

/**
 * Parse one číselník CSV. Pure, so its traps are held by a test.
 *
 * - UTF-8, as the page says ("utf-8, csv"). The server sends it with
 *   `Content-Type: text/html;charset=UTF-8` (measured 25/09/2026), so nothing
 *   here or in the download looks at the type: what proves the file is its
 *   header row. An error page served with 200 has none and is refused.
 * - A byte-order mark on some editions (253 has one, 254 does not). Removed
 *   before the header search, which would otherwise read "\uFEFFKód…".
 * - The code is written with its leading zeros (`0100`), unlike the Slovak
 *   file. Padded anyway, so a change there cannot turn a real bank into
 *   `not_allocated`.
 * - Names verbatim, edges trimmed: the terms forbid changing the facts, and the
 *   diacritics are part of the name ("Komerční banka, a.s.").
 * - `BIC kód (SWIFT)` is empty on eleven rows of edition 254 (building
 *   societies, a credit union, Banking Circle, Multitude Bank…). Those are real
 *   allocations holding no BIC: stored with a null BIC, never dropped, or an
 *   allocated code would read as allocated to nobody.
 * - `Systém CERTIS` (A: direct participant in the Czech clearing, "-": not,
 *   with a trailing space on some rows) is not stored: the verdict is about who
 *   holds the code, not about how they clear.
 * - The last line carries no line ending.
 */
export function parseCzech(text: string, edition: CzechEdition): Entry[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const headerIdx = lines.findIndex((l) => /kód platebního styku/i.test(l));
  if (headerIdx < 0) {
    throw new Error(
      'CZ: no header row carrying "Kód platebního styku": the format changed, or the server answered a page instead of the file',
    );
  }
  const iBic = lines[headerIdx].split(';').findIndex((h) => /BIC|SWIFT/i.test(h));
  // Same guard as Slovakia: a separator change leaves one field per line, the
  // header search still succeeds, and the BIC column lands on index 0.
  if (iBic < 2) throw new Error('CZ: the BIC column is not where a header row puts it');

  const source = czechSource(edition);
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
      bic: bicAsPublished(f[iBic] ?? ''),
      // The číselník publishes a name and a BIC, no address and no LEI. Nulls
      // are what the ČNB publishes, not data missing on our side.
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

/** Same allocation, same names, same BICs — the order of the rows aside. */
function sameAllocation(a: readonly Entry[], b: readonly Entry[]): boolean {
  const key = (rows: readonly Entry[]) =>
    rows
      .map((e) => `${e.code};${e.name};${e.bic ?? ''}`)
      .sort()
      .join('\n');
  return key(a) === key(b);
}

/** The columns every edition table carries, for the current and the announced one alike. */
const NATIONAL_COLUMNS = `
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
      PRIMARY KEY (country, code)`;

/**
 * The two tables, created where missing. The announced one is created on every
 * run, so a reader of the database never has to wonder whether its absence
 * means "nothing announced" or "seeded before announcements were kept".
 */
export function ensureNationalTables(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS national_bank_codes (${NATIONAL_COLUMNS});`);
  db.exec(`CREATE TABLE IF NOT EXISTS ${PENDING_TABLE} (${NATIONAL_COLUMNS});`);
}

function insertRows(db: Database.Database, table: string, cc: string, entries: Entry[]): void {
  const ins = db.prepare(
    `INSERT INTO ${table} (country, code, name, bic, street, post_code, town, lei, source, as_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of entries) {
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
  }
}

/**
 * Write the edition in force and the announced one, in ONE transaction.
 *
 * The announced table is emptied for Czechia on every run, whatever it held: a
 * newer edition in force supersedes the announcement, and an announcement the
 * ČNB withdrew must not take effect on its old date.
 *
 * Refused, with the tables untouched: an edition under the floor (a plain
 * Error: a truncated file or a changed format, for a human to read), and an
 * edition in force OLDER than the one the API already serves
 * (CzechSourceNotLoaded: a stale copy of the page served by a cache would look
 * like that, and going back an edition would re-allocate codes the ČNB has
 * removed). "Already serves" includes an announced edition whose date has come
 * by `today`: activeTable() answers from it from that date, even though it
 * still sits in the pending table. An announcement not yet in force stays free
 * to be replaced or withdrawn.
 *
 * `today` is the run's date in Prague, fixed once by the caller, so the plan
 * and this check can never disagree about which edition is in force.
 */
export function writeCzech(
  db: Database.Database,
  current: CzechEditionRows,
  pending: CzechEditionRows | null,
  today: string,
): void {
  for (const part of pending ? [current, pending] : [current]) {
    if (part.entries.length < MIN_EXPECTED.CZ) {
      throw new Error(
        `CZ: only ${part.entries.length} codes parsed in edition ${part.edition.version}, expected at least ${MIN_EXPECTED.CZ}. Refusing to replace the tables.`,
      );
    }
  }
  const versionOf = (source: string | null | undefined): number =>
    Number(/verze (\d+)/.exec(source ?? '')?.[1] ?? 0);
  const stored = db
    .prepare(`SELECT source FROM national_bank_codes WHERE country = 'CZ' LIMIT 1`)
    .get() as { source: string | null } | undefined;
  const announced = db
    .prepare(
      `SELECT source, MIN(as_of) AS as_of FROM ${PENDING_TABLE} WHERE country = 'CZ' GROUP BY source`,
    )
    .all() as Array<{ source: string | null; as_of: string | null }>;
  const served = Math.max(
    versionOf(stored?.source),
    ...announced.filter((a) => a.as_of && a.as_of <= today).map((a) => versionOf(a.source)),
  );
  if (served > Number(current.edition.version)) {
    throw new CzechSourceNotLoaded(
      `CZ: the API already serves edition ${served} while the ČNB pages put ${current.edition.version} in force. Refusing to go back an edition.`,
    );
  }
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM national_bank_codes WHERE country = 'CZ'`).run();
    insertRows(db, 'national_bank_codes', 'CZ', current.entries);
    db.prepare(`DELETE FROM ${PENDING_TABLE} WHERE country = 'CZ'`).run();
    if (pending) insertRows(db, PENDING_TABLE, 'CZ', pending.entries);
  });
  tx();
  console.log(
    `  CZ: edition ${current.edition.version} in force from ${current.edition.as_of}, ${current.entries.length} codes written`,
  );
  console.log(`  CZ: attribution stored — "${current.entries[0]?.source}"`);
  if (pending) {
    console.log(
      `  CZ: edition ${pending.edition.version} announced from ${pending.edition.as_of}, ${pending.entries.length} codes waiting in ${PENDING_TABLE}`,
    );
  }
}

/** The network, injectable so the whole loading path can be tested without it. */
export type CzechFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A server that sends headers and then stalls must not hold the monthly runner. */
const CZ_FETCH_TIMEOUT_MS = 60_000;

/**
 * Download one ČNB address. Every failure of the NETWORK — no answer, an HTTP
 * error, a timeout, a connection cut while the body arrives — becomes
 * CzechSourceNotLoaded, including the body read: undici resolves fetch() on
 * the headers and rejects arrayBuffer() later with a TypeError ("terminated"),
 * which would otherwise fail the month. A 404 is null where the caller says the
 * file may not exist (a numbered CSV not published yet).
 */
async function czechFetch(
  fetchImpl: CzechFetch,
  url: string,
  optional = false,
): Promise<Buffer | null> {
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(CZ_FETCH_TIMEOUT_MS),
    });
    if (optional && res.status === 404) return null;
    if (!res.ok) throw new CzechSourceNotLoaded(`${url} -> HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof CzechSourceNotLoaded) throw e;
    throw new CzechSourceNotLoaded(`${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const utf8 = (buf: Buffer): string => new TextDecoder('utf-8').decode(buf);

/**
 * A page where a file was expected. The server labels even the real CSV
 * text/html, so the type proves nothing; the first character does. A refusal
 * page (cnb.cz sets the cookie of an application firewall that answers its
 * blocks with HTTP 200) is not a changed format: it is the ČNB not serving us
 * today, and it must not cost the month. A file that is not HTML and has no
 * header row we know is still a changed format, and still throws.
 */
function isHtml(body: string): boolean {
  return body
    .replace(/^\uFEFF/, '')
    .trimStart()
    .startsWith('<');
}

/** A short handle on a page, for a log line: its title, or its first words. */
function pageHint(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return (title ?? textOf(html)).replace(/\s+/g, ' ').trim().slice(0, 120);
}

export interface CzechEditionRows {
  edition: CzechEdition;
  entries: Entry[];
  /**
   * True when the rows come from the NUMBERED file of the edition, which is
   * that edition by construction. False when they come from the unnumbered
   * file, which states no number and may still carry the previous edition.
   */
  fromNumbered?: boolean;
}

/**
 * One edition's rows, from its numbered CSV when the ČNB serves it and from the
 * file the page links otherwise.
 *
 * `crossCheck`: when the page states NO announced edition, its linked file
 * should be the edition in force, and both files are read and compared. If
 * they differ, or the linked one cannot be read, the numbered file is still the
 * edition its number says, so it is the one loaded; the difference is reported
 * and nothing is announced. That is what the ČNB depositing the next file
 * before updating its page would look like, and refusing both would only cost
 * the month's refresh.
 */
async function readCzechEdition(
  fetchImpl: CzechFetch,
  edition: CzechEdition,
  crossCheck: boolean,
): Promise<CzechEditionRows> {
  const numberedUrl = czechNumberedCsvUrl(edition.version);
  const numberedBody = await czechFetch(fetchImpl, numberedUrl, true);
  const numbered = numberedBody ? utf8(numberedBody) : null;
  if (numbered !== null && isHtml(numbered)) {
    throw new CzechSourceNotLoaded(
      `${numberedUrl} answered a page, not the file ("${pageHint(numbered)}")`,
    );
  }
  const linkedUrl = edition.csv_url && edition.csv_url !== numberedUrl ? edition.csv_url : null;
  let linked: string | null = null;
  if (linkedUrl && (crossCheck || numbered === null)) {
    try {
      const body = utf8((await czechFetch(fetchImpl, linkedUrl)) as Buffer);
      if (isHtml(body)) {
        throw new CzechSourceNotLoaded(
          `${linkedUrl} answered a page, not the file ("${pageHint(body)}")`,
        );
      }
      linked = body;
    } catch (e) {
      // Without a numbered file there is nothing else to load: the month's
      // Czech tables stay as they are. With one, a linked file that cannot be
      // read only costs the comparison.
      if (!(e instanceof CzechSourceNotLoaded) || numbered === null) throw e;
      console.warn(`  CZ: ${e.message}; the numbered file is loaded without the comparison`);
    }
  }
  const primary = numbered ?? linked;
  if (primary === null) {
    throw new CzechSourceNotLoaded(
      `no CSV for edition ${edition.version} (numbered file 404, none linked from the page)`,
    );
  }
  const entries = parseCzech(primary, edition);
  if (
    crossCheck &&
    numbered !== null &&
    linked !== null &&
    !sameAllocation(entries, parseCzech(linked, edition))
  ) {
    console.warn(
      `  CZ: the page puts edition ${edition.version} in force, but the CSV it links differs from kody_bank_CR_${edition.version}.csv; the numbered file is loaded, nothing is announced, and the next refresh will read the page again`,
    );
  }
  console.log(
    `  CZ: edition ${edition.version} read from ${numbered !== null ? numberedUrl : linkedUrl}`,
  );
  return { edition, entries, fromNumbered: numbered !== null };
}

/**
 * A ČNB page, or the reason it is not one. A page that does not even carry the
 * bank's name is not the ČNB's layout having changed; it is a refusal or an
 * error page served with 200 (see isHtml), so the month's Czech tables stay
 * and the refresh goes on. The name is the anchor rather than a heading: a
 * redesign that renamed a heading would otherwise pass as "unreachable", in
 * silence, month after month.
 */
async function czechPage(fetchImpl: CzechFetch, url: string): Promise<string> {
  const html = utf8((await czechFetch(fetchImpl, url)) as Buffer);
  if (!html.includes('Česká národní banka')) {
    throw new CzechSourceNotLoaded(`${url} is not a ČNB page ("${pageHint(html)}")`);
  }
  return html;
}

export interface CzechSeedOptions {
  /** The network; `fetch` in production, a stub in the tests. */
  fetchImpl?: CzechFetch;
  /** The run's date in Prague, 'YYYY-MM-DD'; today in production. */
  today?: string;
}

/**
 * Read the ČNB pages, decide which edition is in force today (in Prague) and
 * which one is announced, and write both.
 *
 * The history page is read only when the current page does not settle the
 * edition in force on its own: when it states an edition not yet in force.
 * That is the window the ČNB publishes ahead in, and the edition still in force
 * then appears on the history page only.
 *
 * An announced edition read from the UNNUMBERED file cannot be told apart from
 * the edition in force by its content alone — that file states no number. If
 * the two are identical, the unnumbered file has not moved yet, and the
 * announcement is NOT written: the next refresh will read it. Writing it would
 * label edition N's rows as N+1 and let them take effect as such. An
 * announcement read from its NUMBERED file is that edition by construction and
 * is written even when its codes, names and BICs equal the edition in force:
 * editions that change only a column we do not store (CERTIS participation)
 * exist (235→236, 248→249, 250→251), and skipping them would keep crediting
 * the previous edition and its date for a whole month.
 */
export async function seedCzechLive(
  db: Database.Database,
  options: CzechSeedOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const today = options.today ?? registerToday('CZ');
  const page = await czechPage(fetchImpl, SOURCES.CZ);
  const listed = parseCzechEditions(page, SOURCES.CZ);
  if (listed.length === 0) {
    throw new Error(
      'CZ: no "Číselník N platný od D. M. YYYY" on the register page, layout changed. The date is half of the attribution the ČNB terms require and is never taken from a clock.',
    );
  }
  let editions = listed;
  if (listed.some((e) => e.as_of > today) || !listed.some((e) => e.as_of <= today)) {
    const history = await czechPage(fetchImpl, CZ_HISTORY_URL);
    editions = [...listed, ...parseCzechEditions(history, CZ_HISTORY_URL)];
  }
  const plan = planCzechEditions(editions, today);
  console.log(
    `  CZ: today ${today} in Prague; in force: ${plan.current.version} from ${plan.current.as_of}` +
      (plan.pending
        ? `; announced: ${plan.pending.version} from ${plan.pending.as_of}`
        : '; nothing announced'),
  );
  const current = await readCzechEdition(fetchImpl, plan.current, plan.pending === null);
  let pending = plan.pending ? await readCzechEdition(fetchImpl, plan.pending, false) : null;
  if (pending && !pending.fromNumbered && sameAllocation(pending.entries, current.entries)) {
    console.warn(
      `  CZ: the unnumbered file read for announced edition ${pending.edition.version} is identical to edition ${current.edition.version}; announcement not written, the next refresh will read it`,
    );
    pending = null;
  }
  writeCzech(db, current, pending, today);
}

/** A GitHub workflow command carries its message on one line: %, CR and LF are escaped. */
function workflowData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Tell the workflow what became of the Czech register.
 *
 * `not_loaded` prints a `::warning::` annotation, which GitHub shows on the run
 * page, and — when the step runs under Actions — writes `cz_register=not_loaded`
 * to $GITHUB_OUTPUT, which is what the workflows read to raise the alarm. The
 * exit code stays 0 on purpose: the monthly refresh runs this seeder before
 * committing every other source of the month, and the alarm must not cost
 * them (see the "Czech register not loaded" step of refresh-bic.yml).
 */
export function reportCzechStatus(
  status: 'loaded' | 'not_loaded',
  message = '',
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = console.log,
): void {
  if (status === 'not_loaded') {
    log(
      `::warning title=Czech register not loaded::${workflowData(`${message}; the Czech tables stay as they were`)}`,
    );
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `cz_register=${status}\n`);
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
  ensureNationalTables(db);
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
    ['SM', parseSanMarinoLive],
  ];
  // Deux modes, jamais les deux à la fois (seedFamilyFromEnv) :
  // - sans SEED_FAMILY (robots publics, copie d'un contributeur) : les registres
  //   publics seuls, la Slovaquie et la Tchéquie (l'Italie sur demande). Depuis
  //   l'étape du retrait (25/09/2026), AT, BE et SM ne sont plus téléchargés ici :
  //   la base de ce dépôt ne les porte plus ;
  // - SEED_FAMILY=restricted (chaîne privée de la surcouche) : AT, BE et SM seuls.
  // Un pays nommé hors de son mode est refusé plutôt que sauté en silence : une
  // commande `seed-national.ts AT` lancée sans la variable écrirait la famille
  // dans data/, d'où elle serait commitée.
  const restrictedOnly = seedFamilyFromEnv() === 'restricted';
  const restricted = restrictedRegisterCountries();
  if (only && restricted.has(only) !== restrictedOnly) {
    throw new Error(
      restrictedOnly
        ? `${only} est public : la chaîne privée (SEED_FAMILY=restricted) ne lit que ${[...restricted].join(', ')}.`
        : `${only} appartient à la famille sous conditions (src/lib/restricted-family.ts) : il n'est ` +
            'reconstruit que par la chaîne privée (SEED_FAMILY=restricted, npm run overlay:seed), ' +
            'jamais dans la base de ce dépôt.',
    );
  }
  for (const [cc, parse] of jobs) {
    if (only && only !== cc) continue;
    if (restricted.has(cc) !== restrictedOnly) continue;
    console.log(`${cc}: downloading ${SOURCES[cc]}`);
    // Chaîne privée de la surcouche (SEED_REPORT_PATH) : un registre de la
    // famille en panne est noté, les autres continuent, et `overlay seed` le
    // reprend de la surcouche précédente (scripts/restricted-carry-over.ts).
    // Partout ailleurs, et pour la Slovaquie toujours, une panne arrête le
    // seeder comme avant.
    const member = seedReportActive()
      ? RESTRICTED_FAMILY.find((m) => m.table === 'national_bank_codes' && m.where?.value === cc)
      : undefined;
    if (!member) {
      write(db, cc, await parse());
      continue;
    }
    try {
      const entries = await parse();
      write(db, cc, entries);
      reportSeedMember({ member: member.id, state: 'loaded', processed: entries.length });
    } catch (e) {
      console.warn(`  ${cc}: NOT loaded (${e instanceof Error ? e.message : String(e)})`);
      reportSeedMember({ member: member.id, state: 'failed', cause: failureCause(e) });
    }
  }
  // Czechia last, and on its own path: it writes two tables, and it is the one
  // register here whose failure to LOAD must not fail the monthly refresh.
  // Whether cnb.cz answers GitHub's runners has not been verified; a refusal
  // there would otherwise block every other source of the month from being
  // committed. So an unreachable, contradictory or stale ČNB
  // (CzechSourceNotLoaded) leaves both Czech tables exactly as they were and
  // says so; a page or a file that changed shape still throws, because that is
  // the failure a human has to read. The Bulgarian step of the same workflow
  // follows the same rule. An announced edition already stored keeps taking
  // effect on its date through a failed month.
  //
  // Not silent, though: reportCzechStatus() writes a workflow annotation and
  // the step output `cz_register`, and a later step of each workflow turns
  // `not_loaded` into a red step and the Telegram alert, AFTER the other
  // sources have been committed.
  //
  // Jamais en mode famille (SEED_FAMILY=restricted) : la Tchéquie est publique
  // et hors de la famille, la chaîne privée de la surcouche n'a pas à la lire.
  // Le robot public, lui, la lit comme avant.
  if (!restrictedOnly && (!only || only === 'CZ')) {
    console.log(`CZ: reading ${SOURCES.CZ}`);
    try {
      await seedCzechLive(db);
      reportCzechStatus('loaded');
    } catch (e) {
      if (!(e instanceof CzechSourceNotLoaded)) throw e;
      reportCzechStatus('not_loaded', e.message);
    }
  }
  // L'Italie, seulement quand on la NOMME (`seed-national.ts IT`), jamais dans
  // la passe de tous les registres : son propre workflow hebdomadaire
  // (refresh-it-register.yml) la relit, et le rafraîchissement mensuel ne doit
  // pas dépendre de bancaditalia.it. Même discipline que la Tchéquie : une
  // Banca d'Italia injoignable, qui répond une page ou une édition plus ancienne
  // (ItalianSourceNotLoaded) laisse les tables italiennes telles quelles et le
  // dit au workflow ; un fichier dont la forme a changé lève, pour un humain.
  // Voir scripts/seed-national-it.ts.
  if (only === 'IT') {
    console.log(`IT: reading the Banca d'Italia registers (${IT_DATASET_PAGE})`);
    try {
      await seedItalianLive(db);
      reportItalianStatus('loaded');
    } catch (e) {
      if (!(e instanceof ItalianSourceNotLoaded)) throw e;
      reportItalianStatus('not_loaded', e.message);
    }
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
