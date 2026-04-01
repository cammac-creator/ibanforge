import { getStatsDB } from './db.js';
import type { OperationType, StatsOverview } from '../types.js';

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

const insertOp = () => getStatsDB().prepare(
  'INSERT INTO operations (operation_type, country_code, success) VALUES (?, ?, ?)'
);

const upsertDaily = () => getStatsDB().prepare(`
  INSERT INTO daily_stats (date, operation_type, total, success_count, revenue_usdc)
  VALUES (date('now'), ?, 1, ?, ?)
  ON CONFLICT(date, operation_type) DO UPDATE SET
    total = total + 1,
    success_count = success_count + excluded.success_count,
    revenue_usdc = revenue_usdc + excluded.revenue_usdc
`);

/**
 * Record a single operation (IBAN validation, BIC lookup, etc.)
 */
export function recordOperation(
  type: OperationType,
  countryCode: string | null,
  success: boolean,
  costUsdc: number,
) {
  try {
    insertOp().run(type, countryCode, success ? 1 : 0);
    upsertDaily().run(type, success ? 1 : 0, costUsdc);
  } catch {
    // Stats are non-critical — never crash the API
  }
}

/**
 * Record a batch of IBAN validations in one call
 */
export function recordBatch(count: number, validCount: number, costUsdc: number) {
  try {
    upsertDaily().run('iban_batch', validCount, costUsdc);
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function typeStats(type: OperationType): { total: number; success_count: number } {
  const row = getStatsDB().prepare(
    'SELECT COUNT(*) as total, COALESCE(SUM(success), 0) as success_count FROM operations WHERE operation_type = ?'
  ).get(type) as { total: number; success_count: number };
  return row;
}

function rate(total: number, success: number): number {
  return total > 0 ? Math.round((success / total) * 10000) / 100 : 0;
}

/**
 * Full stats overview across all operation types
 */
export function getStats(): StatsOverview {
  const db = getStatsDB();

  const ibanVal = typeStats('iban_validate');
  const ibanBatch = typeStats('iban_batch');
  const bicLookup = typeStats('bic_lookup');

  const totalOps = ibanVal.total + ibanBatch.total + bicLookup.total;

  const revenue = db.prepare(
    'SELECT COALESCE(SUM(revenue_usdc), 0) as total FROM daily_stats'
  ).get() as { total: number };

  const topCountries = db.prepare(
    'SELECT country_code as country, COUNT(*) as count FROM operations WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count DESC LIMIT 10'
  ).all() as Array<{ country: string; count: number }>;

  const last7 = db.prepare(
    "SELECT date, SUM(total) as total, SUM(revenue_usdc) as revenue FROM daily_stats WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date DESC"
  ).all() as Array<{ date: string; total: number; revenue: number }>;

  return {
    total_operations: totalOps,
    by_type: {
      iban_validate: {
        total: ibanVal.total,
        valid_count: ibanVal.success_count,
        success_rate: rate(ibanVal.total, ibanVal.success_count),
      },
      iban_batch: {
        total: ibanBatch.total,
        valid_count: ibanBatch.success_count,
        success_rate: rate(ibanBatch.total, ibanBatch.success_count),
      },
      bic_lookup: {
        total: bicLookup.total,
        found_count: bicLookup.success_count,
        hit_rate: rate(bicLookup.total, bicLookup.success_count),
      },
    },
    total_revenue_usdc: Math.round(revenue.total * 1000000) / 1000000,
    top_countries: topCountries,
    last_7_days: last7,
  };
}

/**
 * Quick counts for health endpoint
 */
export function getQuickStats(): { total_operations: number; iban_validations: number; bic_lookups: number; success_rate: number } {
  const db = getStatsDB();
  const row = db.prepare(
    'SELECT COUNT(*) as total, COALESCE(SUM(success), 0) as success_count FROM operations'
  ).get() as { total: number; success_count: number };

  const ibanCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM operations WHERE operation_type IN ('iban_validate', 'iban_batch')"
  ).get() as { cnt: number };

  const bicCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM operations WHERE operation_type = 'bic_lookup'"
  ).get() as { cnt: number };

  return {
    total_operations: row.total,
    iban_validations: ibanCount.cnt,
    bic_lookups: bicCount.cnt,
    success_rate: rate(row.total, row.success_count),
  };
}
