import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetStatements } from './bic-lookup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// BIC database (read-only) — contains bic_entries table
// ---------------------------------------------------------------------------

const BIC_DB_PATH = process.env.BIC_DB_PATH ?? resolve(__dirname, '../../data/bic.sqlite');

let bicDB: Database.Database | null = null;

export function getBicDB(): Database.Database {
  if (!bicDB) {
    bicDB = new Database(BIC_DB_PATH, { readonly: true });
  }
  return bicDB;
}

// ---------------------------------------------------------------------------
// Stats database (read-write) — operations log + daily aggregates
// ---------------------------------------------------------------------------

const STATS_DB_PATH = process.env.STATS_DB_PATH ?? resolve(__dirname, '../../data/stats.sqlite');

let statsDB: Database.Database | null = null;

export function getStatsDB(): Database.Database {
  if (!statsDB) {
    statsDB = new Database(STATS_DB_PATH);
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL,
        country_code TEXT,
        success INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        revenue_usdc REAL DEFAULT 0,
        PRIMARY KEY (date, operation_type)
      );
    `);
  }
  return statsDB;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function closeAll(): void {
  if (bicDB) {
    bicDB.close();
    bicDB = null;
    resetStatements();
  }
  if (statsDB) {
    statsDB.close();
    statsDB = null;
  }
}
