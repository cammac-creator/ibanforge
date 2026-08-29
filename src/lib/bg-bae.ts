import { getBicDB } from './db.js';

/**
 * The Bulgarian BAE code register, as published by the Bulgarian National Bank.
 *
 * ⚠️ Spell the authority out. "BNB" already means the Banque nationale de
 * Belgique in this codebase (national-registers.ts, and the `institution` note
 * in types.ts), and two central banks behind one abbreviation is how a Belgian
 * answer ends up wearing a Bulgarian credit.
 *
 * ## What the register allocates
 *
 * A Bulgarian BBAN is `4!a4!n2!n8!c`: four letters of bank code in IBAN
 * positions 5-8, four digits of branch code in 9-12. A BAE code is those eight
 * characters together, and the Bulgarian National Bank allocates them to banks
 * and other payment service providers under its Ordinance No. 13 of
 * 18 August 2016. Measured 29/08/2026: 251 codes over 36 bank codes.
 *
 * ## Why the authoritative claim stops at the four-letter bank code
 *
 * The bank-code space is allocated exhaustively — no Bulgarian PSP issues IBANs
 * without a BAE code — so a four-letter code absent from the register is held by
 * nobody, and `not_in_register` for it is a fact.
 *
 * The eight-character BAE is a different matter. 28 of the 36 banks publish a
 * single code while one publishes 63, so the branch digits are plainly not
 * enumerated to the same standard everywhere. Denying an IBAN because its
 * branch digits are not separately listed would be a denial off a coverage gap
 * — the overclaim enrich.ts documents at STRUCTURAL_BIC_PREFIX_RULE. The full
 * codes are stored verbatim (the licence forbids altering the data) and are
 * simply not used to deny.
 *
 * ## Attribution travels with the data
 *
 * The Bulgarian National Bank permitted reuse in writing on 27/08/2026 subject
 * to its site terms: cite the source, do not distort. `source` and `as_of` are
 * therefore stored columns read back from the rows, never literals — the same
 * discipline pra-banks.ts applies to the Bank of England's list month.
 *
 * Seeded by scripts/seed-bg-bae.ts.
 */
export interface BgBankCode {
  /** IBAN positions 5-8. The code the verdict is about. */
  bank_code: string;
  /**
   * The institution the register lists first for this bank code, verbatim and
   * in Cyrillic. "First" is the register's own publication order: the Bulgarian
   * National Bank publishes two head-office rows for BNBG (the second is its
   * SEBRA payments service), and `ordinal` is what makes the pick deterministic
   * instead of leaving it to SQLite.
   */
  name: string;
  /** The BAE code of that row — the bank code plus the head office's branch digits. */
  bae: string;
  /** BIC8 of the head office, where the register publishes one. */
  bic: string | null;
  /** Effective date of the loaded register, 'YYYY-MM-DD', read from its own file. */
  as_of: string;
}

interface BgRow {
  bank_code: string;
  name: string;
  bae: string;
  bic: string | null;
  as_of: string;
}

let headStmt: import('better-sqlite3').Statement | null = null;
let tableChecked = false;
let tablePresent = false;

/**
 * Same lifecycle discipline as resetStatements() in bic-lookup.ts and
 * resetNationalRegisterStatements() in national-registers.ts, and wired into
 * closeAll() the same way. A statement prepared on a closed connection throws
 * forever after; the catch below would turn that into "no register", which for
 * an authoritative country means real bank codes denied with full confidence
 * from a plumbing fault. The table-presence memo resets with it because it
 * describes the same database.
 */
export function resetBgBaeStatements(): void {
  headStmt = null;
  tableChecked = false;
  tablePresent = false;
}

/**
 * A database built before this seeder ran has no table. Answering "no register"
 * is the safe failure: Bulgaria degrades to the composite map it used before,
 * rather than every Bulgarian code reading as unallocated.
 */
function ready(): boolean {
  if (!tableChecked) {
    tableChecked = true;
    try {
      const row = getBicDB()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bg_bae'")
        .get();
      tablePresent = !!row;
    } catch {
      tablePresent = false;
    }
  }
  return tablePresent;
}

/** Whether the register is loaded at all, so callers can decline to claim authority. */
export function bgBaeRegisterAvailable(): boolean {
  if (!ready()) return false;
  try {
    const row = getBicDB().prepare('SELECT 1 AS ok FROM bg_bae LIMIT 1').get() as
      | { ok: number }
      | undefined;
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Who does the register say holds this four-letter bank code?
 *
 * Null means no institution does — the register allocates the space, so this is
 * a finding and not a coverage gap. The branch digits of the IBAN are
 * deliberately not consulted; see the file note.
 */
export function lookupBgBankCode(bankCode: string): BgBankCode | null {
  if (!ready()) return null;
  const code = (bankCode ?? '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) return null;
  try {
    if (!headStmt) {
      headStmt = getBicDB().prepare(
        // Head-office rows first (they are the ones carrying a BIC), then the
        // register's own order. Both keys matter: without the BIC key a branch
        // row published before the head office would name a branch as the
        // holder of the bank code, and without `ordinal` the tie between two
        // head-office rows is undefined.
        `SELECT bank_code, name, bae, bic, as_of FROM bg_bae
          WHERE bank_code = ?
          ORDER BY (bic IS NULL), ordinal
          LIMIT 1`,
      );
    }
    const row = headStmt.get(code) as BgRow | undefined;
    if (!row) return null;
    return {
      bank_code: row.bank_code,
      name: row.name,
      bae: row.bae,
      bic: row.bic ?? null,
      as_of: row.as_of,
    };
  } catch {
    return null;
  }
}

/** Number of BAE codes held, for truthful self-description surfaces. */
export function getBgBaeCount(): number {
  if (!ready()) return 0;
  try {
    return (getBicDB().prepare('SELECT COUNT(*) AS c FROM bg_bae').get() as { c: number }).c;
  } catch {
    return 0;
  }
}

/** Number of distinct bank codes held — the space the verdict is made on. */
export function getBgBankCodeCount(): number {
  if (!ready()) return 0;
  try {
    return (
      getBicDB().prepare('SELECT COUNT(DISTINCT bank_code) AS c FROM bg_bae').get() as { c: number }
    ).c;
  } catch {
    return 0;
  }
}

/**
 * Effective date of the loaded register, 'YYYY-MM-DD'. Null when nothing is
 * loaded.
 *
 * Read from the rows, never from a clock or a file name: it is the dated half
 * of the attribution the Bulgarian National Bank's terms require, and the
 * register is republished on request rather than on a calendar, so a date
 * guessed from the refresh run would overstate its freshness every time.
 */
export function getBgAsOf(): string | null {
  if (!ready()) return null;
  try {
    const row = getBicDB().prepare('SELECT MAX(as_of) AS d FROM bg_bae').get() as
      | { d: string | null }
      | undefined;
    return row?.d ?? null;
  } catch {
    return null;
  }
}

/**
 * The credit every surface must carry, built from the loaded data. Null when no
 * register is loaded — better no credit line than one naming a date we do not
 * hold.
 */
export function bgAttribution(): string | null {
  const asOf = getBgAsOf();
  return asOf ? `Bulgarian National Bank, BAE register (${asOf})` : null;
}
