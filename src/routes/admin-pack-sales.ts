import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';
import type { PackKeyRow } from '../lib/business-summary.js';
import { summarizePackSales } from '../lib/pack-sales.js';

export const adminPackSales = new Hono();

adminPackSales.get('/v1/admin/pack-sales', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  // Garder les clés inactives : une rotation ne supprime pas l'achat d'origine.
  const rows = getStatsDB()
    .prepare(
      `SELECT email, credits_total, amount_paid_minor, amount_paid_currency,
            stripe_session_id, x402_payment_ref, issued_by_us, created_at
       FROM api_keys WHERE credits_total IS NOT NULL AND credits_total > 0`,
    )
    .all() as PackKeyRow[];
  c.header('Cache-Control', 'private, no-store');
  return c.json(summarizePackSales(rows));
});
