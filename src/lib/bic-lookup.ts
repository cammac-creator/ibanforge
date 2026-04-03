import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBicDB } from './db.js';
import { LRUCache } from './cache.js';
import type Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// bic_data.json — static bank_code → BIC mapping (6907 entries, 40+ countries)
// Format: { "COUNTRY:bank_code": { bic, bank_name?, city? } }
// ---------------------------------------------------------------------------

interface BicDataEntry {
  bic: string;
  bank_name?: string;
  city?: string;
}

let bicDataCache: Record<string, BicDataEntry> | null = null;

function getBicData(): Record<string, BicDataEntry> {
  if (!bicDataCache) {
    const require = createRequire(import.meta.url);
    bicDataCache = require(resolve(__dirname, '../db/bic_data.json')) as Record<string, BicDataEntry>;
  }
  return bicDataCache;
}

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

const bicCache = new LRUCache<BICRow | null>(2000);

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
  const cached = bicCache.get(bic);
  if (cached !== undefined) return cached;

  let result: BICRow | null = null;
  if (bic.length === 11) {
    result = lookupByBic11(bic);
  } else if (bic.length === 8) {
    // Try XXX branch first (head office), then any match
    const hq = lookupByBic11(bic + 'XXX');
    if (hq) {
      result = hq;
    } else {
      const rows = lookupByBic8(bic);
      result = rows[0] ?? null;
    }
  }

  bicCache.set(bic, result);
  return result;
}

export function getEntryCount(): number {
  return (getBicDB().prepare('SELECT COUNT(*) as cnt FROM bic_entries').get() as { cnt: number }).cnt;
}

export function getLastUpdated(): string | null {
  const row = getBicDB().prepare('SELECT MAX(updated_at) as last_updated FROM bic_entries').get() as { last_updated: string | null };
  return row.last_updated;
}

/**
 * Look up a BIC by country code and BBAN bank code.
 *
 * Strategy:
 * 1. Direct key lookup in bic_data.json using "COUNTRY:bank_code" (O(1), most accurate)
 * 2. Fallback: SQLite query on bic_entries WHERE bic8 LIKE bank_code% (covers GLEIF-only entries)
 *
 * Returns a simplified object suitable for IBAN validation enrichment, or null.
 */
export function lookupByCountryBank(
  countryCode: string,
  bankCode: string,
): { code: string; bank_name: string | null; city: string | null } | null {
  // Strategy 1: exact key lookup in bic_data.json
  const data = getBicData();
  const key = `${countryCode}:${bankCode}`;
  const entry = data[key];

  if (entry) {
    // Normalize BIC to 8 chars (strip branch suffix if present)
    const bic8 = entry.bic.length > 8 ? entry.bic.substring(0, 8) : entry.bic;
    let bankName = entry.bank_name ?? null;
    let cityName = entry.city ?? null;

    // Enrich from SQLite if bic_data.json has incomplete details
    if (!bankName || !cityName) {
      const dbRow = lookup(bic8);
      if (dbRow) {
        bankName = bankName || dbRow.institution;
        cityName = cityName || dbRow.city;
      }
    }

    return {
      code: bic8,
      bank_name: bankName,
      city: cityName,
    };
  }

  // Strategy 2: SQLite fallback — bic8 starts with bank code (works for some countries)
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
 * Reset cached prepared statements and LRU cache (call when closing DB)
 */
export function resetStatements(): void {
  stmtByBic11 = null;
  stmtByBic8 = null;
  bicCache.clear();
}
