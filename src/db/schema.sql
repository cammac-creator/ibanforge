-- IBANforge database schema (REFERENCE ONLY)
--
-- This file is NOT executed at runtime.
-- The actual schema is auto-created in src/lib/db.ts.
-- This file exists for documentation purposes.
--
-- BIC database (bic.sqlite — read-only at runtime):

CREATE TABLE IF NOT EXISTS bic_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bic8         TEXT NOT NULL,
  bic11        TEXT NOT NULL UNIQUE,
  institution  TEXT,
  country_code TEXT NOT NULL,
  country_name TEXT,
  city         TEXT,
  branch_code  TEXT,
  branch_info  TEXT,
  lei          TEXT,
  lei_status   TEXT,
  is_test_bic  INTEGER DEFAULT 0,
  source       TEXT DEFAULT 'gleif',
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bic8    ON bic_entries(bic8);
CREATE INDEX IF NOT EXISTS idx_bic11   ON bic_entries(bic11);
CREATE INDEX IF NOT EXISTS idx_lei     ON bic_entries(lei);
CREATE INDEX IF NOT EXISTS idx_country ON bic_entries(country_code);

-- Stats database (stats.sqlite — read-write):

CREATE TABLE IF NOT EXISTS operations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_type TEXT NOT NULL,
  country_code   TEXT,
  success        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date           TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  total          INTEGER DEFAULT 0,
  success_count  INTEGER DEFAULT 0,
  revenue_usdc   REAL DEFAULT 0,
  PRIMARY KEY (date, operation_type)
);
