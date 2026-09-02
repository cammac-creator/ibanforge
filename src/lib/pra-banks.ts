import { getBicDB } from './db.js';

/**
 * Bank of England — "List of PRA-regulated Banks", the monthly CSV of firms the
 * Prudential Regulation Authority authorises to accept deposits.
 *
 * ## The licence, and why `list_month` is not decoration
 *
 * The Bank of England granted written permission on 25/08/2026 to use the list
 * as a reference source in this API, on one condition: attribution to the Bank
 * of England **together with the month of the list**. Every surface that serves
 * this data carries `source` and `list_month`, and both are read from the
 * database rather than written by hand — a hardcoded month is a licence
 * condition that rots on the next refresh.
 *
 * ## Joined on LEI, never on names
 *
 * The list publishes Firm Name / FRN / LEI. Matching a firm name against a BIC
 * directory's `institution` string is the kind of fuzzy join that hands
 * "Alpha Bank Example Plc" the authorisation of "Alpha Bank Example (Europe)
 * SA". The LEI is an exact global identifier; a miss is a miss.
 *
 * ## Why a country scope on top of the LEI
 *
 * The branch section heads its third column **"Head Office LEI"** — the LEI of
 * the entity abroad, which GLEIF maps to every BIC that entity owns anywhere in
 * the world. A bare LEI join therefore answers "PRA authorised" for the Dutch
 * BIC of a Dutch bank, on the strength of that bank's London branch. That is a
 * false compliance positive served on a paid call.
 *
 * The list authorises deposit-taking **in the UK**. So the claim is only made
 * when the BIC being described is itself in the jurisdiction the authorisation
 * concerns — GB, plus GI for the Gibraltar section, whose firms are authorised
 * to serve the UK from Gibraltar.
 *
 * ## No negative branch, ever
 *
 * The file's own preamble says it "does not supersede the Financial Services
 * Register which should be referred to as the most accurate and up to date
 * source of information", and it covers one permission only — deposit-taking.
 * A firm absent from it may be an investment firm, an e-money institution or a
 * credit union. So an absence produces **no block at all**, never
 * `authorised: false`. Same discipline as `iban_issuer: 'not_listed'` in
 * enrich.ts and `COMPOSITE_REGISTER`: silence is not a denial.
 *
 * Seeded by scripts/seed-pra-banks.ts.
 */
export type PraSection =
  | 'uk_incorporated'
  | 'non_uk_branch'
  | 'gibraltar_branch'
  | 'eea_sro_branch';

/**
 * Whose LEI the list published for this firm. `head_office_lei` is the branch
 * section's own column heading, and it is served so a consumer can see that the
 * identifier is shared with the parent abroad rather than specific to the UK
 * branch.
 */
export type PraLeiBasis = 'lei' | 'head_office_lei';

export interface PraAuthorisation {
  /** Always true. There is no negative form of this block — see the file note. */
  authorised: true;
  firm_name: string;
  frn: string;
  section: PraSection;
  basis: PraLeiBasis;
  /** The attribution the permission requires, verbatim. */
  source: 'Bank of England, List of Banks';
  /** Month of the list this row came from, e.g. '2026-08'. The other half of the attribution. */
  list_month: string;
}

/**
 * Which BIC countries each section's authorisation actually speaks about.
 *
 * `uk_incorporated` is restricted to GB on purpose too: a UK bank's foreign
 * branch BIC carries the same LEI, and "authorised to accept deposits" beside a
 * Frankfurt BIC would be read as a statement about Germany.
 */
const SECTION_SCOPE: Record<PraSection, readonly string[]> = {
  uk_incorporated: ['GB'],
  non_uk_branch: ['GB'],
  gibraltar_branch: ['GB', 'GI'],
  eea_sro_branch: ['GB'],
};

/** Prefer the firm's own LEI row over a head-office one when both exist. */
const SECTION_RANK: Record<PraSection, number> = {
  uk_incorporated: 0,
  gibraltar_branch: 1,
  eea_sro_branch: 2,
  non_uk_branch: 3,
};

interface PraRow {
  firm_name: string;
  frn: string;
  section: string;
  lei_basis: string;
  list_month: string;
}

let byLeiStmt: import('better-sqlite3').Statement | null = null;
let tableChecked = false;
let tablePresent = false;

/**
 * Same lifecycle discipline as resetStatements() in bic-lookup.ts and
 * resetNationalRegisterStatements() in national-registers.ts, and wired into
 * closeAll() the same way. A statement prepared on a closed connection throws
 * forever after; here that would only drop the block, but the table-presence
 * memo must reset with it because it describes the same database.
 */
export function resetPraBanksStatements(): void {
  byLeiStmt = null;
  tableChecked = false;
  tablePresent = false;
}

/**
 * A database built before this seeder ran has no table. Answering "nothing
 * known" is the safe failure: no block is served, which is exactly what an
 * unmatched LEI already produces. It must never throw — /llms.txt reads the
 * count on every cold start.
 */
function ready(): boolean {
  if (!tableChecked) {
    tableChecked = true;
    try {
      const row = getBicDB()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pra_banks'")
        .get();
      tablePresent = !!row;
    } catch {
      tablePresent = false;
    }
  }
  return tablePresent;
}

/**
 * Number of firms currently loaded from the PRA list.
 *
 * Self-description only, never a lookup path — the same role getChClearingCount()
 * plays for SIX. Served surfaces call this instead of carrying a literal: the
 * list changes every month, and a number written by hand is wrong by the second
 * refresh at the latest.
 */
export function getPraBanksCount(): number {
  if (!ready()) return 0;
  try {
    return (getBicDB().prepare('SELECT COUNT(*) AS cnt FROM pra_banks').get() as { cnt: number })
      .cnt;
  } catch {
    return 0;
  }
}

/**
 * Month of the loaded list, 'YYYY-MM'. Null when nothing is loaded.
 *
 * This is the licensed half of the attribution, so it is read from the rows
 * themselves and never derived from a clock or a file name.
 */
export function getPraListMonth(): string | null {
  if (!ready()) return null;
  try {
    const row = getBicDB().prepare('SELECT MAX(list_month) AS m FROM pra_banks').get() as
      | { m: string | null }
      | undefined;
    return row?.m ?? null;
  } catch {
    return null;
  }
}

/**
 * The attribution string every surface must carry, built from the loaded data.
 * Null when no list is loaded — better no credit line than one naming a month
 * we do not hold.
 */
export function praAttribution(): string | null {
  const month = getPraListMonth();
  return month ? `Bank of England (List of Banks, ${month})` : null;
}

function isSection(value: string): value is PraSection {
  return value in SECTION_SCOPE;
}

/**
 * Does the PRA list name the holder of this LEI, for a BIC in the jurisdiction
 * the authorisation covers?
 *
 * @param lei         LEI carried by the resolved BIC row (GLEIF).
 * @param bicCountry  ISO country of that BIC. Required: without it there is no
 *                    jurisdiction to check the claim against, so the answer is
 *                    null rather than an unscoped assertion.
 */
export function praAuthorisationByLei(
  lei: string | null | undefined,
  bicCountry: string | null | undefined,
): PraAuthorisation | null {
  if (!lei || !bicCountry || !ready()) return null;
  const code = lei.trim().toUpperCase();
  const cc = bicCountry.trim().toUpperCase();
  if (code.length !== 20 || cc.length !== 2) return null;

  let rows: PraRow[];
  try {
    if (!byLeiStmt) {
      byLeiStmt = getBicDB().prepare(
        'SELECT firm_name, frn, section, lei_basis, list_month FROM pra_banks WHERE lei = ?',
      );
    }
    rows = byLeiStmt.all(code) as PraRow[];
  } catch {
    // Same safe failure as the national registers: a plumbing fault must not be
    // reported as a fact about a bank.
    return null;
  }
  if (rows.length === 0) return null;

  const eligible = rows
    .filter((r): r is PraRow & { section: PraSection } => isSection(r.section))
    .filter((r) => SECTION_SCOPE[r.section].includes(cc))
    .sort((a, b) => SECTION_RANK[a.section] - SECTION_RANK[b.section]);

  const hit = eligible[0];
  if (!hit) return null;

  return {
    authorised: true,
    firm_name: hit.firm_name,
    frn: hit.frn,
    section: hit.section,
    basis: hit.lei_basis === 'head_office_lei' ? 'head_office_lei' : 'lei',
    source: 'Bank of England, List of Banks',
    list_month: hit.list_month,
  };
}
