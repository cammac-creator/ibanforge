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
  -- Registered/head-office address (GLEIF, CC0). Only populated when the BIC's
  -- own country matches the entity's registered country (no foreign-branch HQ).
  street         TEXT,
  post_code      TEXT,
  region         TEXT,
  address_en     TEXT,   -- Latin/romanized street line for non-Latin entities
  address_source TEXT,   -- e.g. 'GLEIF'
  address_lang   TEXT,   -- language of `street`
  address_as_of  TEXT,   -- GLEIF registration lastUpdateDate (YYYY-MM-DD)
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bic8    ON bic_entries(bic8);
CREATE INDEX IF NOT EXISTS idx_bic11   ON bic_entries(bic11);
CREATE INDEX IF NOT EXISTS idx_lei     ON bic_entries(lei);
CREATE INDEX IF NOT EXISTS idx_country ON bic_entries(country_code);

-- Swiss clearing database (ch_clearing table in bic.sqlite — read-only at runtime):

CREATE TABLE IF NOT EXISTS ch_clearing (
  iid              TEXT PRIMARY KEY,    -- 5-digit zero-padded (e.g. '00230', '30000', '81998')
  valid_on         TEXT,                -- YYYY-MM-DD
  concatenation    INTEGER DEFAULT 0,   -- 1 if merged into another IID
  redirect_iid     TEXT,                -- target IID when concatenation=1
  sic_iid          TEXT,                -- 6-digit SIC identifier
  headquarters_iid TEXT,                -- IID of the headquarters
  iid_type         INTEGER,            -- 1=HQ, 2=branch, 4=other
  qr_iid           TEXT,                -- QR-IID allocation (for QR-bill)
  name             TEXT NOT NULL,       -- Bank/institution name
  street           TEXT,
  building_number  TEXT,
  post_code        TEXT,
  town             TEXT,
  country          TEXT DEFAULT 'CH',   -- ISO alpha-2
  bic              TEXT,                -- BIC/SWIFT (11 chars)
  sic_participation       INTEGER DEFAULT 0,
  rtgs_chf               INTEGER DEFAULT 0,
  ip_chf                 INTEGER DEFAULT 0,  -- Instant Payments CHF
  eurosic_participation  INTEGER DEFAULT 0,
  lsv_bdd_chf           INTEGER DEFAULT 0,
  lsv_bdd_eur           INTEGER DEFAULT 0,
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ch_clearing_bic ON ch_clearing(bic);
CREATE INDEX IF NOT EXISTS idx_ch_clearing_hq ON ch_clearing(headquarters_iid);
CREATE INDEX IF NOT EXISTS idx_ch_clearing_name ON ch_clearing(name);

-- Bank of England "List of PRA-regulated Banks" (pra_banks table in bic.sqlite
-- — read-only at runtime). Seeded by scripts/seed-pra-banks.ts.
--
-- Used under written permission from the Bank of England (25/08/2026), whose
-- one condition is attribution to the Bank of England TOGETHER WITH the month
-- of the list. `list_month` is therefore a stored column, not a derived value:
-- every served surface reads the month from here.

CREATE TABLE IF NOT EXISTS pra_banks (
  frn        TEXT NOT NULL,       -- Firm Reference Number
  firm_name  TEXT NOT NULL,
  lei        TEXT,                -- NULL when the list publishes none, or an unusable one
  section    TEXT NOT NULL,       -- uk_incorporated | non_uk_branch | gibraltar_branch | eea_sro_branch
  -- 'lei' or 'head_office_lei' — the branch section publishes the PARENT's LEI,
  -- which GLEIF shares with every BIC that parent owns worldwide. Carried so a
  -- consumer can see how far the identifier reaches.
  lei_basis  TEXT NOT NULL,
  list_month TEXT NOT NULL,       -- 'YYYY-MM', read from the file's own preamble
  source     TEXT NOT NULL DEFAULT 'Bank of England',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (frn, section)
);

CREATE INDEX IF NOT EXISTS idx_pra_banks_lei ON pra_banks(lei);

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

CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash      TEXT UNIQUE NOT NULL,
  key_prefix    TEXT NOT NULL,
  email         TEXT NOT NULL,
  monthly_limit INTEGER,              -- NULL = default (200), custom value for paid clients
  created_at    TEXT DEFAULT (datetime('now')),
  active        INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);

CREATE TABLE IF NOT EXISTS api_usage (
  key_hash TEXT NOT NULL,
  month    TEXT NOT NULL,
  count    INTEGER DEFAULT 0,
  PRIMARY KEY (key_hash, month)
);
