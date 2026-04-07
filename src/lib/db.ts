import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetStatements } from './bic-lookup.js';
import { resetStatsStatements } from './stats.js';

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
}
