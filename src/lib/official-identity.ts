import { getBicDB } from './db.js';

/**
 * Official identity — the name, LEI and registered address a central bank
 * publishes for the institution behind a code we resolved.
 *
 * Two publishers feed this, both republishing daily:
 *
 *   - **European Central Bank**, list of monetary financial institutions
 *     (table `ecb_mfi`). Reached by LEI on a BIC lookup, and by the French
 *     five-digit bank code on an IBAN.
 *   - **Banco de España**, list of Spanish MFIs (table `bde_mfi`). Reached by
 *     the four-digit Spanish bank code, which that list publishes bare in its
 *     SUPERVISORY CODE column.
 *
 * ## The provenance contract — this is what the licence buys
 *
 * Both publishers permit reuse on the same two conditions, and the second one
 * is unusual. The ECB:
 *
 *   "Where the information is incorporated in documents that are sold
 *    (regardless of the medium), the natural or legal person publishing the
 *    information must inform buyers, both before they pay any subscription or
 *    fee and EACH TIME THEY ACCESS the information taken from this website,
 *    that the information may be obtained free of charge through this website."
 *
 * The Banco de España's legal notice imposes the same duty in the same words
 * for information "incorporated into documents or other media that are to be
 * sold or transferred for consideration", and adds that any reproduction "shall
 * be carried out faithfully, without any manipulation or alteration of the
 * content, and the Banco de España shall always be cited as the source."
 *
 * This API is sold. "Each time they access" therefore means every block on
 * every call — not a credit line on a documentation page a caller may never
 * read. So `source`, `free_of_charge` and `as_of` are non-optional fields of
 * the served object, and `officialIdentity()` is the only constructor: nothing
 * else in the codebase may assemble this shape. A test serialises every block
 * this module can produce and fails if the free-of-charge notice, the source or
 * the date is missing.
 *
 * ## Never authoritative
 *
 * `authoritative` is typed `false`, a literal, so `authoritative: true` is a
 * compile error rather than a review comment. Both publishers RELAY: the ECB
 * assembles what national central banks report, and neither of them allocates
 * bank codes — that stays with the national authorities. The Banco de España
 * goes further and disclaims liability "for any loss or damage resulting from
 * decisions taken on the basis of the information published on this site".
 *
 * Consequently this block is **informational and additive**. It never touches
 * `valid`, and it never touches `bank_code_check` — not its `status`, not its
 * `authoritative`, not its `register`. An institution absent from a list
 * produces no block at all, never a negative one: same discipline as
 * `pra_authorisation` and `iban_issuer: 'not_listed'`, where silence is not a
 * denial.
 *
 * Seeded by scripts/seed-ecb-mfi.ts.
 */

/** How the row was reached. Served, because the two joins are not equally strong. */
export type OfficialIdentityMatch = 'lei' | 'national_code';

export interface OfficialIdentity {
  /** The institution's name as the publisher writes it. */
  name: string;
  /** Null where the publisher lists none — 643 ECB rows and 74 Spanish ones do not. */
  lei: string | null;
  /** One-line registered address, composed at seed time. Null when the publisher gives none. */
  address: string | null;
  /** The publisher's own classification, e.g. 'Credit Institution'. */
  category: string;
  matched_by: OfficialIdentityMatch;
  /** Who published it. Required by both licences; never empty. */
  source: string;
  /**
   * The notice both licences demand on EVERY access to information that is
   * sold. A sentence rather than a parenthetical in `source`, because a caller
   * parsing `source` as a label would drop a parenthetical and keep the name.
   */
  free_of_charge: string;
  /**
   * The citation formula the Banco de España requires, reproduced verbatim.
   * Present on Spanish blocks only — the ECB asks to be cited as the source and
   * `source` does that.
   */
  attribution?: string;
  /**
   * Date of the list this row came from, 'YYYY-MM-DD'. Read from the stored
   * rows, never from a clock: an identity dated today from a file published
   * last week is a false statement about the register.
   */
  as_of: string;
  /**
   * Always false, and typed as the literal so it cannot become true. Both
   * publishers relay; neither allocates. See the file note.
   */
  authoritative: false;
}

const ECB_SOURCE =
  'European Central Bank, list of monetary financial institutions (free at ecb.europa.eu)';
const ECB_FREE =
  'This information may be obtained free of charge from the ECB website at ecb.europa.eu.';

const BDE_SOURCE = 'Banco de España, list of MFIs';
const BDE_FREE =
  'This information may be obtained free of charge from the Banco de España website at www.bde.es.';
/** The formula the Banco de España's terms require, word for word. */
const BDE_ATTRIBUTION =
  'Own elaboration based on data from the Banco de España website (www.bde.es)';

interface EcbRow {
  name: string;
  lei: string | null;
  address: string | null;
  category: string;
  list_date: string;
}

interface BdeRow {
  name: string;
  lei: string | null;
  address: string | null;
  category: string;
  list_date: string;
}

/** The single constructor. See the provenance contract in the file note. */
function ecbIdentity(row: EcbRow, matched_by: OfficialIdentityMatch): OfficialIdentity {
  return {
    name: row.name,
    lei: row.lei,
    address: row.address,
    category: row.category,
    matched_by,
    source: ECB_SOURCE,
    free_of_charge: ECB_FREE,
    as_of: row.list_date,
    authoritative: false,
  };
}

function bdeIdentity(row: BdeRow): OfficialIdentity {
  return {
    name: row.name,
    lei: row.lei,
    address: row.address,
    category: row.category,
    matched_by: 'national_code',
    source: BDE_SOURCE,
    free_of_charge: BDE_FREE,
    attribution: BDE_ATTRIBUTION,
    as_of: row.list_date,
    authoritative: false,
  };
}

let ecbByLeiStmt: import('better-sqlite3').Statement | null = null;
let ecbByNationalStmt: import('better-sqlite3').Statement | null = null;
let bdeByCodeStmt: import('better-sqlite3').Statement | null = null;
let checked = false;
let ecbPresent = false;
let bdePresent = false;

/**
 * Same lifecycle discipline as resetPraBanksStatements(), and wired into
 * closeAll() the same way: a statement prepared on a closed connection throws
 * forever after, and the table-presence memo describes the same database so it
 * has to reset with it.
 */
export function resetOfficialIdentityStatements(): void {
  ecbByLeiStmt = null;
  ecbByNationalStmt = null;
  bdeByCodeStmt = null;
  checked = false;
  ecbPresent = false;
  bdePresent = false;
}

/**
 * A database built before this seeder ran has neither table. Answering "nothing
 * known" is the safe failure — no block, which is exactly what an unmatched
 * code already produces. Must never throw: self-description surfaces read the
 * counts on every cold start.
 */
function ready(): { ecb: boolean; bde: boolean } {
  if (!checked) {
    checked = true;
    try {
      const rows = getBicDB()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ecb_mfi','bde_mfi')",
        )
        .all() as Array<{ name: string }>;
      const names = new Set(rows.map((r) => r.name));
      ecbPresent = names.has('ecb_mfi');
      bdePresent = names.has('bde_mfi');
    } catch {
      ecbPresent = false;
      bdePresent = false;
    }
  }
  return { ecb: ecbPresent, bde: bdePresent };
}

/**
 * Institutions currently loaded from the ECB list. Self-description only, never
 * a lookup path — the role getChClearingCount() and getPraBanksCount() play.
 * Served surfaces call this instead of carrying a literal: the list is
 * republished every business day.
 */
export function getEcbMfiCount(): number {
  if (!ready().ecb) return 0;
  try {
    return (getBicDB().prepare('SELECT COUNT(*) AS cnt FROM ecb_mfi').get() as { cnt: number }).cnt;
  } catch {
    return 0;
  }
}

/** Institutions currently loaded from the Banco de España list. Self-description only. */
export function getBdeMfiCount(): number {
  if (!ready().bde) return 0;
  try {
    return (getBicDB().prepare('SELECT COUNT(*) AS cnt FROM bde_mfi').get() as { cnt: number }).cnt;
  } catch {
    return 0;
  }
}

/** Date of the loaded ECB list, 'YYYY-MM-DD'. Null when nothing is loaded. */
export function getEcbListDate(): string | null {
  if (!ready().ecb) return null;
  try {
    const row = getBicDB().prepare('SELECT MAX(list_date) AS d FROM ecb_mfi').get() as
      | { d: string | null }
      | undefined;
    return row?.d ?? null;
  } catch {
    return null;
  }
}

/** Date of the loaded Banco de España list, 'YYYY-MM-DD'. Null when nothing is loaded. */
export function getBdeListDate(): string | null {
  if (!ready().bde) return null;
  try {
    const row = getBicDB().prepare('SELECT MAX(list_date) AS d FROM bde_mfi').get() as
      | { d: string | null }
      | undefined;
    return row?.d ?? null;
  } catch {
    return null;
  }
}

/**
 * The official identity of the holder of this LEI, if the ECB lists it.
 *
 * ## Why there is no country scope here, unlike pra-banks.ts
 *
 * `praAuthorisationByLei` scopes to the BIC's own country, because it makes a
 * JURISDICTIONAL claim — "authorised to accept deposits in the UK" — and the
 * branch section publishes the head office's LEI, so an unscoped join would
 * announce a UK authorisation beside a Frankfurt BIC.
 *
 * This block makes no such claim. It says who the holder of the LEI IS: legal
 * name, registered address, the publisher's category. That is a fact about the
 * legal entity, and it does not change with which of its BICs was asked about.
 * Scoping it by country would suppress the identity of every foreign BIC of a
 * listed institution for no gain in truthfulness.
 *
 * ## The fan-out is real, and it runs the other way
 *
 * One LEI carries many BICs: measured 2026-08-26 against the live directory,
 * 232 of the LEIs on the ECB list map to more than one BIC8 — BNP Paribas's
 * single LEI covers 42 of them across as many countries. So one `ecb_mfi` row
 * legitimately answers many different BIC lookups. There is no ambiguity in the
 * other direction: the file carries zero duplicate LEIs (5,374 rows, verified
 * on the 2026-08-25 list), so a LEI never selects between two identities and
 * this is not the row-order coin flip that `sharedBic8Stats` exists to refuse.
 */
export function officialIdentityByLei(lei: string | null | undefined): OfficialIdentity | null {
  if (!lei || !ready().ecb) return null;
  const code = lei.trim().toUpperCase();
  if (code.length !== 20) return null;
  try {
    if (!ecbByLeiStmt) {
      ecbByLeiStmt = getBicDB().prepare(
        'SELECT name, lei, address, category, list_date FROM ecb_mfi WHERE lei = ? LIMIT 1',
      );
    }
    const row = ecbByLeiStmt.get(code) as EcbRow | undefined;
    return row ? ecbIdentity(row, 'lei') : null;
  } catch {
    // Same safe failure as the national registers: a plumbing fault must not be
    // reported as a fact about a bank.
    return null;
  }
}

/**
 * The official identity behind a national bank code.
 *
 * Two countries, two publishers, and both gates are the COUNTRY plus the shape
 * — never the shape alone.
 *
 * **FR** reads `ecb_mfi.national_bank_code`, a column populated at seed time
 * only for French rows, where the ECB's RIAD code is `FR` + the five-digit code
 * banque that opens the BBAN (`FR30004` is BNP Paribas). The same `XX` + five
 * digits shape appears on 1,240 German and 569 Polish rows where it is a
 * registry serial with no payment meaning, which is why the shape is not the
 * gate; see nationalBankCode() in the seeder.
 *
 * **ES** reads `bde_mfi`, whose SUPERVISORY CODE column publishes the four-digit
 * Spanish bank code bare (0182 is BBVA). Spanish rows also exist in the ECB
 * file with matching RIAD codes — 227 of them agree — but the Banco de España
 * is the authority that publishes the code space, and it is the licence whose
 * attribution formula we are able to reproduce.
 *
 * Any other country returns null. There is no fallback, and in particular no
 * Portuguese mapping: the PT heuristic in circulation is undocumented, and an
 * undocumented rule is exactly what must not be encoded behind a paid answer.
 */
export function officialIdentityByNationalCode(
  country: string | null | undefined,
  bankCode: string | null | undefined,
): OfficialIdentity | null {
  if (!country || !bankCode) return null;
  const cc = country.trim().toUpperCase();
  const code = bankCode.trim();
  const state = ready();

  if (cc === 'FR') {
    if (!state.ecb || !/^\d{5}$/.test(code)) return null;
    try {
      if (!ecbByNationalStmt) {
        ecbByNationalStmt = getBicDB().prepare(
          'SELECT name, lei, address, category, list_date FROM ecb_mfi ' +
            "WHERE country = 'FR' AND national_bank_code = ? LIMIT 1",
        );
      }
      const row = ecbByNationalStmt.get(code) as EcbRow | undefined;
      return row ? ecbIdentity(row, 'national_code') : null;
    } catch {
      return null;
    }
  }

  if (cc === 'ES') {
    if (!state.bde || !/^\d{4}$/.test(code)) return null;
    try {
      if (!bdeByCodeStmt) {
        bdeByCodeStmt = getBicDB().prepare(
          'SELECT name, lei, address, category, list_date FROM bde_mfi WHERE code = ? LIMIT 1',
        );
      }
      const row = bdeByCodeStmt.get(code) as BdeRow | undefined;
      return row ? bdeIdentity(row) : null;
    } catch {
      return null;
    }
  }

  return null;
}
