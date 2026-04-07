import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPLIANCE_DB_PATH = process.env.COMPLIANCE_DB_PATH ?? resolve(__dirname, '../../data/compliance.sqlite');

let complianceDB: Database.Database | null = null;

export function getComplianceDB(): Database.Database {
  if (!complianceDB) {
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
