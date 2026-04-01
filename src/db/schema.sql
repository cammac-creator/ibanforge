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

CREATE TABLE IF NOT EXISTS api_stats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT,
  found        INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date         TEXT PRIMARY KEY,
  total        INTEGER DEFAULT 0,
  found_count  INTEGER DEFAULT 0,
  revenue_usdc REAL DEFAULT 0
);
