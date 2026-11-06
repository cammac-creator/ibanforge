import { getStatsDB } from './db.js';

/** Tentatives vérifiées, jamais un relevé des encaissements sur la chaîne. */
export interface PaymentAttempts {
  version: 1;
  source: 'daily_stats';
  currency: 'USDC';
  basis: 'verified_payment_attempts';
  settlement: 'not_reconciled';
  read_at: string;
  total_since: '2026-04-18';
  total_attempted_usdc: number;
  window: { from: string; to: string; time_zone: 'UTC'; days: 7 };
  days: Array<{ date: string; attempted_usdc: number }>;
}

function amount(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value * 1_000_000 > Number.MAX_SAFE_INTEGER) {
    throw new Error('Montant des tentatives illisible');
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Lecture de la seule table quotidienne : aucun regroupement du journal HTTP. */
export function getPaymentAttempts(now = new Date()): PaymentAttempts {
  const db = getStatsDB();
  const readAt = now.toISOString();
  const to = readAt.slice(0, 10);
  const dates = Array.from({ length: 7 }, (_, index) =>
    new Date(now.getTime() - (6 - index) * 86_400_000).toISOString().slice(0, 10),
  );
  // Même début que total_revenue_usdc_clean : les tentatives antérieures ne
  // participent pas au cumul. Les dates futures ne constituent pas de l'activité.
  const since = '2026-04-18';
  const total = db
    .prepare(
      `SELECT COALESCE(SUM(revenue_usdc), 0) AS total,
        COALESCE(SUM(CASE WHEN typeof(revenue_usdc) NOT IN ('integer', 'real')
          OR revenue_usdc < 0 OR length(date) <> 10 OR date(date, '+0 days') IS NOT date
          THEN 1 ELSE 0 END), 0) AS invalid
       FROM daily_stats WHERE date >= ? AND date <= ?`,
    )
    .get(since, to) as { total: number; invalid: number };
  if (total.invalid) throw new Error('Tentatives quotidiennes illisibles');
  const rows = db
    .prepare(
      `SELECT date, COALESCE(SUM(revenue_usdc), 0) AS attempted_usdc
       FROM daily_stats WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`,
    )
    .all(dates[0], to) as Array<{ date: string; attempted_usdc: number }>;
  const byDate = new Map(rows.map((row) => [row.date, amount(row.attempted_usdc)]));
  return {
    version: 1,
    source: 'daily_stats',
    currency: 'USDC',
    basis: 'verified_payment_attempts',
    settlement: 'not_reconciled',
    read_at: readAt,
    total_since: since,
    total_attempted_usdc: amount(total.total),
    window: { from: dates[0], to, time_zone: 'UTC', days: 7 },
    // Aucune ligne de daily_stats signifie aucune tentative enregistrée ce jour.
    days: dates.map((date) => ({ date, attempted_usdc: byDate.get(date) ?? 0 })),
  };
}
