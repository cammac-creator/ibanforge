import type DatabaseType from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resetStatements } from './bic-lookup.js';
import { resetStatsStatements } from './stats.js';
import { closeComplianceDB } from './compliance-db.js';
import { resetChClearingStatements } from './ch-clearing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Lazy-load better-sqlite3 so the module can be imported even when the native
// addon is not compiled (e.g. during Glama MCP inspection).
// ---------------------------------------------------------------------------

type DatabaseConstructor = typeof DatabaseType;
let _Database: DatabaseConstructor | null = null;

function loadDatabaseSync(): DatabaseConstructor {
  if (!_Database) {
    _Database = require('better-sqlite3') as DatabaseConstructor;
  }
  return _Database;
}

// ---------------------------------------------------------------------------
// BIC database (read-only) — contains bic_entries table
// ---------------------------------------------------------------------------

const BIC_DB_PATH = process.env.BIC_DB_PATH ?? resolve(__dirname, '../../data/bic.sqlite');

let bicDB: DatabaseType.Database | null = null;

export function getBicDB(): DatabaseType.Database {
  if (!bicDB) {
    const Db = loadDatabaseSync();
    bicDB = new Db(BIC_DB_PATH, { readonly: true });
  }
  return bicDB;
}

// ---------------------------------------------------------------------------
// Stats database (read-write) — operations log + daily aggregates
// ---------------------------------------------------------------------------

const STATS_DB_PATH = process.env.STATS_DB_PATH ?? resolve(__dirname, '../../data/stats.sqlite');

let statsDB: DatabaseType.Database | null = null;

export function getStatsDB(): DatabaseType.Database {
  if (!statsDB) {
    const Db = loadDatabaseSync();
    statsDB = new Db(STATS_DB_PATH);
    // Concurrent reads + better write throughput. WAL is critical because
    // multiple request handlers write to stats.sqlite simultaneously
    // (recordOperation, recordRequest, increment quota).
    statsDB.pragma('journal_mode = WAL');
    statsDB.pragma('synchronous = NORMAL');
    statsDB.pragma('busy_timeout = 5000');
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
      CREATE INDEX IF NOT EXISTS idx_operations_type ON operations(operation_type);
      CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at);
      CREATE INDEX IF NOT EXISTS idx_operations_country ON operations(country_code);
      CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
      CREATE INDEX IF NOT EXISTS idx_hourly_stats_date ON hourly_stats(date);
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
      -- Hot path: most usage queries scope by month then look up by key_hash.
      -- The PRIMARY KEY (key_hash, month) already covers (key_hash, month) lookups.
      -- This index covers the "list keys used this month" admin query.
      CREATE INDEX IF NOT EXISTS idx_api_usage_month ON api_usage(month);
      -- Same idea for api_keys: protect the daily quota check that filters by
      -- created_at >= now-1day for rate-limiting key creation per email.
      CREATE INDEX IF NOT EXISTS idx_api_keys_email_created ON api_keys(email, created_at);
      CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
    `);
    // Migrate existing databases that may be missing the new columns
    const existingCols = (statsDB.prepare("PRAGMA table_info(operations)").all() as Array<{ name: string }>).map(r => r.name);
    if (!existingCols.includes('hour')) statsDB.exec('ALTER TABLE operations ADD COLUMN hour INTEGER');
    if (!existingCols.includes('day_of_week')) statsDB.exec('ALTER TABLE operations ADD COLUMN day_of_week INTEGER');
    if (!existingCols.includes('error_detail')) statsDB.exec('ALTER TABLE operations ADD COLUMN error_detail TEXT');
    const keyCols = (statsDB.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>).map(r => r.name);
    if (!keyCols.includes('monthly_limit')) statsDB.exec('ALTER TABLE api_keys ADD COLUMN monthly_limit INTEGER');
    // Track request provenance: distinguish MCP HTTP / MCP stdio / REST direct / bot / web
    const reqCols = (statsDB.prepare("PRAGMA table_info(request_log)").all() as Array<{ name: string }>).map(r => r.name);
    if (!reqCols.includes('client_kind')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN client_kind TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_request_log_client_kind ON request_log(client_kind)');
    }
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
    resetChClearingStatements();
  }
  if (statsDB) {
    statsDB.close();
    statsDB = null;
    resetStatsStatements();
  }
  closeComplianceDB();
}
