import { getBicDB } from './db.js';

/**
 * National bank-code registers that share one shape: an authority allocates a
 * fixed-width numeric code to an institution and publishes the whole allocation.
 *
 * Austria (Oesterreichische Nationalbank, SEPA-Zahlungsverkehrs-Verzeichnis,
 * republished daily), Belgium (Banque nationale de Belgique, Secrétariat du
 * Protocole, the body that allocates the codes), Slovakia (Národná banka
 * Slovenska, the prevodník of identification codes for the domestic payment
 * system) and Czechia (Česká národní banka, the Číselník kódů platebního styku)
 * all fit. None carries the retirement/successor pair the Bundesbank publishes,
 * so none needs the extra columns de-blz.ts has; one table serves all four
 * rather than four near-identical modules.
 *
 * As with CH, LI, DE and BG, being here is a claim that an absence means the
 * code is allocated to nobody. Seeded by scripts/seed-national.ts.
 *
 * Sauf pour les registres que EXHAUSTIVE ci-dessous dit partiels : Saint-Marin
 * et, depuis le 25/09/2026, l'Italie (scripts/seed-national-it.ts), dont une
 * absence ne dit rien. La table est partagée, la force de l'affirmation non.
 */
export interface NationalCodeEntry {
  code: string;
  name: string;
  bic: string | null;
  /**
   * One line, house number included (OeNB publishes it that way); null for BE,
   * SK and CZ. Pour l'Italie, le siège légal en Italie que publie la Banca
   * d'Italia (pour une banque étrangère, sa succursale italienne).
   */
  street: string | null;
  post_code: string | null;
  town: string | null;
  /**
   * LEI where the register publishes one (OeNB, 99% filled; la Banca d'Italia
   * pour la plupart de ses codes en vigueur); null for BE, SK and CZ.
   */
  lei: string | null;
  /**
   * The credit the register's own terms require, as the seeder read it.
   *
   * Null for AT and BE — neither publisher asks for one, and neither states an
   * edition of its own to name. Slovakia and Czechia fill it because their
   * central banks' terms make citing the source a condition of reuse, so it
   * travels with the row rather than being written beside it at each surface.
   * The Czech one opens on the exact words those terms ask for, "Zdroj: ČNB".
   */
  source: string | null;
  /**
   * Effective date the REGISTER states, 'YYYY-MM-DD'. Null for AT and BE, whose
   * answers are dated by the reference set's refresh month instead.
   */
  as_of: string | null;
}

/** Width of the bank code as an IBAN of that country carries it. */
const CODE_WIDTH: Record<string, number> = { AT: 5, BE: 3, SK: 4, CZ: 4, SM: 5, IT: 5 };

/**
 * 🚨 Which of these registers EXHAUST their country's bank-code space.
 *
 * This table is the difference between "no institution holds this code" and "we
 * have not seen this code", and it is the whole reason San Marino may live in
 * the same table as the other four without inheriting their authority.
 *
 * AT, BE, SK and CZ are published by the authority that ALLOCATES the codes and
 * cover the space: an absence there is the allocation authority's own verdict.
 *
 * Czechia is the one where the law says so in as many words. Vyhláška č.
 * 169/2011 Sb., § 4 c), makes IBAN positions 5 to 8 the "kód platebního styku"
 * of its § 6, and § 6 (2) has the ČNB publish the codes it has allocated in the
 * číselník this table loads. Its content is providers, not banks: building
 * societies, credit unions and non-bank payment institutions hold codes too,
 * which is what an allocation looks like and a list of banks does not.
 *
 * SM is not. The BCSM page is titled "operating banks" and lists banks; it
 * never claims to publish the ABI allocation, San Marino also licenses payment
 * and e-money institutions that are not banks (one holds a San Marino BIC and
 * settles through EBA STEP2), and the ISO 13616 registry's own San Marino
 * example IBAN carries an ABI absent from the page. So a hit names the holder
 * and a MISS means nothing.
 *
 * IT non plus (25/09/2026). Les registres de la Banca d'Italia listent les
 * banques, les établissements de paiement et de monnaie électronique qu'elle
 * inscrit, pas l'attribution de l'espace ABI : Poste Italiane (07601), la Banca
 * d'Italia elle-même (01000) et les succursales d'établissements de paiement
 * européens (Qonto, 36092) émettent de vrais IBAN italiens hors de ces
 * registres. Un code trouvé nomme son titulaire, un code absent ne dit rien. Ce
 * qu'ils disent EN PLUS, un code radié avec sa date et son successeur légal, vit
 * dans RETIRED_TABLE ci-dessous et ne devient jamais un refus non plus.
 *
 * enrich.ts reads this rather than hardcoding a country list, and the only
 * place a non-exhaustive register may lead is `verified` — never
 * `not_in_register`, never `not_allocated`.
 */
const EXHAUSTIVE: Record<string, boolean> = {
  AT: true,
  BE: true,
  SK: true,
  CZ: true,
  SM: false,
  IT: false,
};

/**
 * Does an absence in this country's register mean the code is unallocated?
 *
 * False for a country we hold no register for AND for one whose register does
 * not cover its code space — the caller cannot tell those apart from here, and
 * must not need to: both mean "do not turn a miss into a denial".
 */
export function nationalRegisterIsExhaustive(cc: string): boolean {
  return EXHAUSTIVE[cc] === true;
}

/**
 * Bring a published code to the width the IBAN uses.
 *
 * The OeNB writes the central bank as '100' while an Austrian IBAN carries
 * '00100'; the NBS writes Slovakia's largest bank as '200' while a Slovak IBAN
 * carries '0200'. Comparing the two unpadded answers "not allocated" for a real
 * bank, which is the same defect that made four Swiss codes stale in July.
 */
export function normaliseCode(cc: string, raw: string): string | null {
  const width = CODE_WIDTH[cc];
  if (!width) return null;
  const digits = (raw ?? '').trim();
  if (!/^\d+$/.test(digits) || digits.length > width) return null;
  return digits.padStart(width, '0');
}

/** The table holding each country's edition in force. */
const CURRENT_TABLE = 'national_bank_codes';

/**
 * 🚨 The table an edition waits in between its publication and its effective
 * date.
 *
 * The ČNB publishes each číselník "v dostatečném předstihu před jeho
 * platností", well ahead of the day it takes effect (its rules, art. III.3):
 * edition 254, in force from 1 September 2026, was on its server from
 * 24 August. A register that answers `not_allocated` with `authoritative: true`
 * cannot switch editions on the day it happens to READ the file. Switched early,
 * it refuses a code still valid until the end of the month (8190, removed by
 * 254); switched late, by the monthly refresh after the date, it refuses a code
 * the ČNB has just created — and editions do not all start on the 1st (251 took
 * effect on 16 March 2026, 245 on 9 April 2025), while the refresh runs on the
 * 1st.
 *
 * So the seeder writes an announced edition HERE, beside the one in force, and
 * the choice between the two is made at REQUEST time, on the date where the
 * register is published (activeTable below). Never two editions in the current
 * table: its key is (country, code), and nationalRegisterEdition() would credit
 * whichever edition carries the newest date, in force or not.
 */
export const PENDING_TABLE = 'national_bank_codes_pending';

/**
 * 🚨 Les codes qu'un registre NON EXHAUSTIF déclare radiés, avec la date et le
 * successeur légal qu'il publie. L'Italie seule aujourd'hui (Banca d'Italia,
 * scripts/seed-national-it.ts).
 *
 * Une table à part, et non une colonne de `national_bank_codes` : les colonnes de
 * celle-ci sont fixées par la surcouche privée (src/lib/restricted-family.ts), et
 * surtout un code radié n'est PAS attribué aujourd'hui. Le ranger dans la table
 * des codes en vigueur le ferait lire par lookupNationalCode comme un code
 * vivant.
 *
 * Colonnes : `code` (à la largeur de l'IBAN), `name` (le DERNIER titulaire, tel
 * que le registre l'écrivait), `retired_on` (dernier jour où le registre porte ce
 * code pour lui, 'AAAA-MM-JJ'), `successor_code` et `successor_name` (le
 * successeur LÉGAL en vigueur aujourd'hui, suivi par fusions et incorporations ;
 * null quand il n'y en a pas), `source` et `as_of` (le crédit et l'édition, comme
 * dans `national_bank_codes`).
 *
 * Un code réattribué ne s'y trouve jamais : un code qui a un titulaire en vigueur
 * est dans `national_bank_codes`, quoi que dise son passé.
 */
export const RETIRED_TABLE = 'national_bank_codes_retired';

/**
 * La page d'où l'on télécharge les registres italiens, citée comme adresse du
 * jeu dans le crédit que la licence CC BY 4.0 demande (section 3(a)(1)(A)(v)).
 * Une seule écriture : le chargeur, /llms.txt et la documentation la lisent ici.
 */
export const IT_DATASET_PAGE =
  'https://infostat.bancaditalia.it/GIAVAInquiry-public/ng/#/area-download';

type EditionTable = typeof CURRENT_TABLE | typeof PENDING_TABLE;

/**
 * Where a register's effective dates are to be read. An edition "platný od
 * 1. 9. 2026" is in force from midnight in Prague, which is 22:00 UTC the day
 * before in summer; reading it in UTC would keep the old edition two hours too
 * long. Registers with no entry are read in UTC.
 */
const REGISTER_TIME_ZONE: Record<string, string> = { CZ: 'Europe/Prague' };

/**
 * Today's date, 'YYYY-MM-DD', where the register of `cc` is published.
 *
 * `now` is a parameter so the seeder can pin one date for a whole run and a
 * test can pin the day before and the day of an effective date. Built from the
 * parts rather than from a locale's format: which locale prints ISO order is a
 * property of the ICU data, not a promise.
 */
export function registerToday(cc: string, now: Date = new Date()): string {
  const timeZone = REGISTER_TIME_ZONE[cc] ?? 'UTC';
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  const parts = format.formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Building a formatter costs more than formatting: one per time zone, for the process. */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The instant every register read of the current answer is decided at.
 *
 * One answer reads the register several times — availability, the edition and
 * its credit, the code itself, the composite map's guard — and each read asks
 * which edition is in force. Read against a live clock, an answer computed
 * across midnight in Prague could take its verdict from one edition and its
 * credit or its BIC from the next. Pinning one instant for the whole answer
 * (and, through the EnrichCache, for a whole batch) makes that impossible.
 *
 * Safe as module state because every reader here is synchronous: nothing can
 * interleave between the pin and its release. A nested pin keeps the outer one.
 */
let pinnedNow: Date | null = null;

export function withRegisterClock<T>(fn: () => T, now: Date = new Date()): T {
  if (pinnedNow) return fn();
  pinnedNow = now;
  try {
    return fn();
  } finally {
    pinnedNow = null;
  }
}

const stmts = new Map<EditionTable, import('better-sqlite3').Statement>();
let tableChecked = false;
let tablePresent = false;
let pendingChecked = false;
let pendingPresent = false;
/** La table des codes radiés (RETIRED_TABLE), sa présence et sa requête, pour le processus. */
let retiredChecked = false;
let retiredPresent = false;
let retiredStmt: import('better-sqlite3').Statement | null = null;
/**
 * Per country, the effective date of the announced edition and of the one in
 * force, read once per process: the database is read-only at run time and is
 * only ever replaced by a deploy, which starts a new process.
 */
const editionDates = new Map<string, { pending: string | null; current: string | null }>();

/**
 * Same lifecycle discipline as resetStatements() in bic-lookup.ts, and wired
 * into closeAll() the same way. Without it, a statement prepared on a closed
 * connection kept throwing, the catch lookupNationalCode carried at the time
 * ate the throw and answered null — which enrich turned into `not_in_register` with
 * `authoritative: true`: real AT/BE banks denied with full confidence, from a
 * plumbing failure. The table-presence memos reset with it, and so does the
 * choice of edition: all three describe the same database.
 */
export function resetNationalRegisterStatements(): void {
  stmts.clear();
  tableChecked = false;
  tablePresent = false;
  pendingChecked = false;
  pendingPresent = false;
  editionDates.clear();
  retiredChecked = false;
  retiredPresent = false;
  retiredStmt = null;
}

function tableExists(name: string): boolean {
  try {
    return !!getBicDB()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(name);
  } catch {
    return false;
  }
}

/**
 * A database built before this seeder ran has no table. Answering "no register"
 * is the safe failure: the country degrades to the composite map it used
 * before, rather than every lookup throwing or, worse, every code reading as
 * unallocated.
 */
function ready(): boolean {
  if (!tableChecked) {
    tableChecked = true;
    tablePresent = tableExists(CURRENT_TABLE);
  }
  return tablePresent;
}

/** A database seeded before announced editions were kept has no pending table: nothing waits. */
function pendingReady(): boolean {
  if (!pendingChecked) {
    pendingChecked = true;
    pendingPresent = tableExists(PENDING_TABLE);
  }
  return pendingPresent;
}

/**
 * The table holding the edition IN FORCE today for this country.
 *
 * The pending edition takes over on its effective date, and only if it is newer
 * than the one it replaces: the seeder clears the pending rows whenever it
 * writes a newer edition in force, so the second condition is a belt to those
 * braces rather than something a sound database needs.
 *
 * Every reader of the register goes through here — the lookup, the edition and
 * its credit, the allocated set — so a version can never be printed beside a
 * date, or a verdict beside a credit, from another edition.
 *
 * It sits on the hot path of every register country, so the common case costs
 * a map read: nothing announced — every country, nearly every day — returns
 * the current table without computing a date. Today's date is only computed
 * for a country with an edition waiting, which is Czechia during the week or
 * two the ČNB publishes ahead.
 *
 * Unguarded when the query itself fails, like lookupNationalCode: a database
 * that cannot say which edition is in force cannot answer for either.
 */
function activeTable(cc: string): EditionTable {
  if (!pendingReady()) return CURRENT_TABLE;
  let dates = editionDates.get(cc);
  if (!dates) {
    const db = getBicDB();
    const pending = db
      .prepare(`SELECT MIN(as_of) AS as_of FROM ${PENDING_TABLE} WHERE country = ?`)
      .get(cc) as { as_of: string | null } | undefined;
    const current = db
      .prepare(`SELECT MAX(as_of) AS as_of FROM ${CURRENT_TABLE} WHERE country = ?`)
      .get(cc) as { as_of: string | null } | undefined;
    dates = { pending: pending?.as_of ?? null, current: current?.as_of ?? null };
    editionDates.set(cc, dates);
  }
  if (!dates.pending) return CURRENT_TABLE;
  if (dates.current && dates.current >= dates.pending) return CURRENT_TABLE;
  return dates.pending <= registerToday(cc, pinnedNow ?? new Date())
    ? PENDING_TABLE
    : CURRENT_TABLE;
}

export function nationalRegisterAvailable(cc: string): boolean {
  if (!CODE_WIDTH[cc] || !ready()) return false;
  try {
    const row = getBicDB()
      .prepare(`SELECT 1 AS ok FROM ${activeTable(cc)} WHERE country = ? LIMIT 1`)
      .get(cc) as { ok: number } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Look up an allocated code in the edition in force. Returns null when the
 * register does not carry it, which for AT, BE, SK and CZ means no institution
 * holds it.
 *
 * Belgium publishes all 1000 three-digit slots and writes 'VRIJ' in the BIC
 * column for the 210 it has not allocated. Those are dropped at seed time
 * rather than stored, so an explicit "nobody holds this" stays a miss here
 * instead of resolving to a bank named VRIJ.
 */
export function lookupNationalCode(cc: string, bankCode: string): NationalCodeEntry | null {
  if (!ready()) return null;
  const code = normaliseCode(cc, bankCode);
  if (!code) return null;
  // No catch around the query, and that is the point: these four countries are
  // authoritative, so a null out of here becomes not_in_register with reason
  // not_allocated — "do not send". A catch { return null } made a corrupt page
  // or a schema drift produce that sentence about real AT/BE/SK banks with full
  // confidence (the resetNationalRegisterStatements() docstring above records
  // the first bite; the 29/08/2026 adversarial review reproduced the class on
  // Bulgaria). A query failure now escapes, like lookupBlz: every caller sits
  // under a guard that converts it into status unavailable / reason
  // lookup_failed, authority dropped. Schema drift stays harmless a different
  // way — SELECT * with defensive mapping degrades missing columns to nulls
  // instead of raising.
  const table = activeTable(cc);
  let stmt = stmts.get(table);
  if (!stmt) {
    stmt = getBicDB().prepare(`SELECT * FROM ${table} WHERE country = ? AND code = ?`);
    stmts.set(table, stmt);
  }
  const row = stmt.get(cc, code) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    code: String(row.code),
    name: String(row.name),
    bic: (row.bic as string | null | undefined) ?? null,
    street: (row.street as string | null | undefined) ?? null,
    post_code: (row.post_code as string | null | undefined) ?? null,
    town: (row.town as string | null | undefined) ?? null,
    lei: (row.lei as string | null | undefined) ?? null,
    // Defensive, like every field above: a database seeded before these two
    // columns existed has no `source` and no `as_of`, and `?? null` degrades
    // that to "no credit stated" instead of raising. The credit is a licence
    // condition, so the surfaces are built to omit it rather than to print a
    // half of it — see nationalRegisterCredit() below.
    source: (row.source as string | null | undefined) ?? null,
    as_of: (row.as_of as string | null | undefined) ?? null,
  };
}

/**
 * What the loaded register says about itself: the credit it requires and the
 * date that credit is about.
 *
 * Read from the rows, never from a clock or a constant. Slovakia is the country
 * this exists for — the NBS terms make citing the source a condition of reuse,
 * and its page states an effective date that our monthly refresh month would
 * misreport. Czechia is the same case, on the ČNB's terms. Austria and Belgium
 * store neither and get `null` for both, which is what keeps their answers on
 * `getReferenceAsOf()` with no special case.
 *
 * Both fields are read in ONE query, from the edition in force (activeTable), so
 * a caller can never print a version from one edition beside a date from
 * another — nor credit an edition announced but not yet in force.
 */
export function nationalRegisterEdition(cc: string): {
  source: string | null;
  as_of: string | null;
} {
  if (!CODE_WIDTH[cc] || !ready()) return { source: null, as_of: null };
  try {
    const row = getBicDB()
      .prepare(
        // MAX(as_of) and the source that goes with it. The seeder writes one
        // edition per country and per table in a single transaction, so every
        // row agrees; ordering makes that explicit rather than assumed.
        `SELECT source, as_of FROM ${activeTable(cc)}
          WHERE country = ? AND as_of IS NOT NULL
          ORDER BY as_of DESC LIMIT 1`,
      )
      .get(cc) as { source: string | null; as_of: string | null } | undefined;
    return { source: row?.source ?? null, as_of: row?.as_of ?? null };
  } catch {
    // A credit that cannot be read is omitted, never guessed: printing the
    // authority's name beside a date we do not hold is the one failure the
    // licence discipline exists to prevent.
    return { source: null, as_of: null };
  }
}

/**
 * How each register's credit is worded, and — the part that matters — WHOSE
 * date it is.
 *
 * Slovakia's is the register's own effective date, so it reads as a plain
 * parenthesis, in the publisher's own word for "source" (`Zdroj`), which is
 * what its terms ask to be named.
 *
 * Czechia's stored source already OPENS on the words the ČNB terms prescribe —
 * "ČNB musí být vždy uvedena jako zdroj informací (Zdroj: ČNB)" — because that
 * string also travels, unformatted, as `bic.source` on every answer. So the
 * format only adds the effective date, in the register's own words, and never
 * a second "Zdroj:".
 *
 * San Marino's is the day WE read the page: the BCSM publishes no edition and
 * no revision date. "read on" is not decoration — a bare `(2026-09-06)` there
 * would read as the source's date and quietly overstate it, which is the exact
 * failure getBgAsOf() was written to avoid one register over.
 */
const CREDIT_FORMAT: Record<string, (source: string, asOf: string) => string> = {
  SK: (source, asOf) => `Zdroj: ${source} (${asOf})`,
  CZ: (source, asOf) => `${source} (platný od ${asOf})`,
  SM: (source, asOf) => `Source: ${source} (read on ${asOf})`,
  // L'Italie : CC BY 4.0 demande l'auteur, la licence, et d'« indiquer les
  // modifications apportées ». La ligne stockée porte l'auteur, le jeu et la
  // licence ; la date est celle de l'édition (le nom du fichier de la Banca
  // d'Italia), et la modification est dite ici, une fois pour toutes les surfaces.
  IT: (source, asOf) => `Source: ${source}, edition ${asOf}; normalised and joined by IBANforge`,
};

/**
 * The one-line credit every surface must carry, built from the loaded data.
 *
 * Null when the register states no edition (AT, BE) or when nothing is loaded —
 * better no credit line than one naming a date we do not hold. Same shape and
 * same reasoning as bgAttribution() in bg-bae.ts.
 */
export function nationalRegisterCredit(cc: string): string | null {
  const { source, as_of } = nationalRegisterEdition(cc);
  const format = CREDIT_FORMAT[cc];
  if (!source || !as_of || !format) return null;
  return format(source, as_of);
}

/**
 * Every code allocated in the edition in force, for pruning curated keys that
 * contradict it.
 */
export function allocatedCodes(cc: string): ReadonlySet<string> {
  if (!ready()) return new Set();
  try {
    const rows = getBicDB()
      .prepare(`SELECT code FROM ${activeTable(cc)} WHERE country = ?`)
      .all(cc) as Array<{ code: string }>;
    return new Set(rows.map((r) => r.code));
  } catch {
    return new Set();
  }
}

/** Ce qu'un registre non exhaustif publie d'un code qu'il a radié. Voir RETIRED_TABLE. */
export interface RetiredNationalCode {
  code: string;
  /** Le dernier titulaire, tel que le registre l'écrivait. */
  name: string;
  /** 'AAAA-MM-JJ' : dernier jour où le registre porte ce code pour ce titulaire. */
  retired_on: string;
  /** Le successeur légal en vigueur, à la largeur de l'IBAN ; null quand il n'y en a pas. */
  successor_code: string | null;
  successor_name: string | null;
  source: string | null;
  as_of: string | null;
}

/** Une base construite avant le registre italien n'a pas la table : aucun code radié connu. */
function retiredReady(): boolean {
  if (!retiredChecked) {
    retiredChecked = true;
    retiredPresent = tableExists(RETIRED_TABLE);
  }
  return retiredPresent;
}

/**
 * Le code, s'il est radié d'après le registre de ce pays ; null sinon.
 *
 * Réservé aux registres NON exhaustifs : c'est un fait positif du registre (il a
 * connu ce code et l'a radié), jamais un refus, et enrich.ts ne le lit que dans
 * sa branche non exhaustive, APRÈS une absence dans la table des codes en
 * vigueur. Sans garde autour de la requête, comme lookupNationalCode : une base
 * illisible remonte à checkBankCode, qui répond `unavailable` / `lookup_failed`.
 */
export function lookupRetiredNationalCode(
  cc: string,
  bankCode: string,
): RetiredNationalCode | null {
  if (!retiredReady()) return null;
  const code = normaliseCode(cc, bankCode);
  if (!code) return null;
  if (!retiredStmt) {
    retiredStmt = getBicDB().prepare(
      `SELECT * FROM ${RETIRED_TABLE} WHERE country = ? AND code = ?`,
    );
  }
  const row = retiredStmt.get(cc, code) as Record<string, unknown> | undefined;
  if (!row) return null;
  const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    code: String(row.code),
    name: String(row.name),
    retired_on: String(row.retired_on),
    successor_code: text(row.successor_code),
    successor_name: text(row.successor_name),
    source: text(row.source),
    as_of: text(row.as_of),
  };
}

/**
 * Tous les codes que le registre de ce pays déclare radiés, pour élaguer les clés
 * de la carte curée qu'il contredit (bic-lookup.ts). Vide quand la table manque
 * ou ne se lit pas : sans vérité à opposer, la carte reste telle quelle.
 */
export function retiredNationalCodes(cc: string): ReadonlySet<string> {
  if (!retiredReady()) return new Set();
  try {
    const rows = getBicDB()
      .prepare(`SELECT code FROM ${RETIRED_TABLE} WHERE country = ?`)
      .all(cc) as Array<{ code: string }>;
    return new Set(rows.map((r) => r.code));
  } catch {
    return new Set();
  }
}
