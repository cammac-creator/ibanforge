import { getBicDB } from './db.js';
import type Database from 'better-sqlite3';

export interface BICRow {
  bic8: string;
  bic11: string;
  institution: string | null;
  country_code: string;
  country_name: string | null;
  city: string | null;
  branch_code: string | null;
  branch_info: string | null;
  lei: string | null;
  lei_status: string | null;
  is_test_bic: number;
  source: string;
}

let stmtByBic11: Database.Statement | null = null;
let stmtByBic8: Database.Statement | null = null;

export function lookupByBic11(bic11: string): BICRow | null {
  if (!stmtByBic11) {
    stmtByBic11 = getBicDB().prepare('SELECT * FROM bic_entries WHERE bic11 = ? LIMIT 1');
  }
  return (stmtByBic11.get(bic11) as BICRow) ?? null;
}

export function lookupByBic8(bic8: string): BICRow[] {
  if (!stmtByBic8) {
    stmtByBic8 = getBicDB().prepare('SELECT * FROM bic_entries WHERE bic8 = ?');
  }
  return stmtByBic8.all(bic8) as BICRow[];
}

export function lookup(bic: string): BICRow | null {
  if (bic.length === 11) {
    return lookupByBic11(bic);
  }
  if (bic.length === 8) {
    // Try XXX branch first (head office), then any match
    const hq = lookupByBic11(bic + 'XXX');
    if (hq) return hq;
    const rows = lookupByBic8(bic);
    return rows[0] ?? null;
  }
  return null;
}

export function getEntryCount(): number {
  return (getBicDB().prepare('SELECT COUNT(*) as cnt FROM bic_entries').get() as { cnt: number }).cnt;
}

/**
 * Look up a BIC by country code and BBAN bank code.
 * Heuristic: searches for BIC entries matching the country where the BIC8
 * institution code starts with the bank code (many countries use this mapping).
 * Returns a simplified object suitable for IBAN validation enrichment, or null.
 */
export function lookupByCountryBank(
  countryCode: string,
  bankCode: string,
): { code: string; bank_name: string | null; city: string | null } | null {
  const db = getBicDB();
  const row = db
    .prepare(
      'SELECT bic8, institution, city FROM bic_entries WHERE country_code = ? AND bic8 LIKE ? LIMIT 1',
    )
    .get(countryCode, bankCode + '%') as
    | { bic8: string; institution: string | null; city: string | null }
    | undefined;

  if (!row) return null;
  return { code: row.bic8, bank_name: row.institution, city: row.city };
}

/**
 * Reset cached prepared statements (call when closing DB)
 */
export function resetStatements(): void {
  stmtByBic11 = null;
  stmtByBic8 = null;
}
