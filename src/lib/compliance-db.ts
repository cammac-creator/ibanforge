import type DatabaseType from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const COMPLIANCE_DB_PATH = process.env.COMPLIANCE_DB_PATH ?? resolve(__dirname, '../../data/compliance.sqlite');

let complianceDB: DatabaseType.Database | null = null;

export function getComplianceDB(): DatabaseType.Database {
  if (!complianceDB) {
    const Database = require('better-sqlite3') as typeof DatabaseType;
    complianceDB = new Database(COMPLIANCE_DB_PATH, { readonly: true });
  }
  return complianceDB;
}

export function closeComplianceDB(): void {
  if (complianceDB) {
    complianceDB.close();
    complianceDB = null;
    _metaStmt = null;
  }
}

export interface ComplianceMeta {
  /** Scope of the sanctions screening — bank (BIC8) level only, never the beneficiary. */
  scope: 'bank_bic_only';
  /** Plain-language limitation, surfaced in every compliance response. */
  disclaimer: string;
  /** ISO timestamp of the last compliance-data refresh (null if unknown). */
  sanctions_as_of: string | null;
  /** Year-month (YYYY-MM) of the FATF plenary the lists reflect (null if unknown). */
  fatf_as_of: string | null;
  /** Comma-separated data sources (null if unknown). */
  sources: string | null;
}

const DISCLAIMER =
  'Informational triage only — NOT a regulated AML/CFT product. Sanctions screening ' +
  'is performed at the BANK (BIC8) level: it flags the holding institution, NOT the ' +
  'beneficiary / account-holder name. Most sanctions designations target persons and ' +
  'companies, which this does not screen. Use a regulated provider (Refinitiv, ' +
  'ComplyAdvantage, etc.) for name-level KYC/AML obligations.';

let _metaStmt: DatabaseType.Statement | null = null;

/**
 * Read the compliance dataset metadata (refresh date, FATF as-of, sources) and
 * pair it with the fixed scope + disclaimer. Returned on every compliance
 * response so an agent can see the freshness AND the limits of the signal.
 * Never throws: on any error it returns the static scope/disclaimer with null
 * freshness fields.
 */
export function getComplianceMeta(): ComplianceMeta {
  const base: ComplianceMeta = {
    scope: 'bank_bic_only',
    disclaimer: DISCLAIMER,
    sanctions_as_of: null,
    fatf_as_of: null,
    sources: null,
  };
  try {
    const db = getComplianceDB();
    if (!_metaStmt) _metaStmt = db.prepare('SELECT key, value FROM metadata');
    const rows = _metaStmt.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      ...base,
      sanctions_as_of: map.get('last_refresh') ?? null,
      fatf_as_of: map.get('fatf_as_of') ?? null,
      sources: map.get('sources') ?? null,
    };
  } catch {
    return base;
  }
}
