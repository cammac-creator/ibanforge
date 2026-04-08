import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetStatements } from './bic-lookup.js';
import { resetStatsStatements } from './stats.js';
import { closeComplianceDB } from './compliance-db.js';

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
        created_at TEXT DEFAULT (datetime('now')),
        hour INTEGER,
        day_of_week INTEGER,
        error_detail TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        revenue_usdc REAL DEFAULT 0,
        PRIMARY KEY (date, operation_type)
      );
      CREATE TABLE IF NOT EXISTS hourly_stats (
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        operation_type TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        PRIMARY KEY (date, hour, operation_type)
      );
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        response_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        hour INTEGER,
        day_of_week INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_request_log_date ON request_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_request_log_path ON request_log(path);
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);
      CREATE TABLE IF NOT EXISTS api_usage (
        key_hash TEXT NOT NULL,
        month TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (key_hash, month)
      );
    `);
    // Migrate existing databases that may be missing the new columns
    const existingCols = (statsDB.prepare("PRAGMA table_info(operations)").all() as Array<{ name: string }>).map(r => r.name);
    if (!existingCols.includes('hour')) statsDB.exec('ALTER TABLE operations ADD COLUMN hour INTEGER');
    if (!existingCols.includes('day_of_week')) statsDB.exec('ALTER TABLE operations ADD COLUMN day_of_week INTEGER');
    if (!existingCols.includes('error_detail')) statsDB.exec('ALTER TABLE operations ADD COLUMN error_detail TEXT');
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
    resetStatsStatements();
  }
  closeComplianceDB();
}
