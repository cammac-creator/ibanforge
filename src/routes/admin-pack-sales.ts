import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { readPackSaleRows, summarizePackSales } from '../lib/pack-sales.js';

export const adminPackSales = new Hono();

adminPackSales.get('/v1/admin/pack-sales', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  // Une ligne par achat, au registre (lot B1) : une recharge est une vente, une
  // rotation ne supprime ni ne double l'achat d'origine.
  c.header('Cache-Control', 'private, no-store');
  return c.json(summarizePackSales(readPackSaleRows()));
});
