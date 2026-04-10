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
  }
}
