import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { getApiReads, resolveApiReadsWindow } from '../lib/api-reads.js';

/**
 * `GET /v1/admin/api-reads?from=…&to=…` : le comptage de `request_log` sur une fenêtre de
 * sept jours au plus, en UTC, `from` inclus et `to` exclu (`AAAA-MM-JJTHH:MM:SSZ` ou
 * `AAAA-MM-JJ HH:MM:SS`).
 *
 * Des AGRÉGATS sur des listes fermées (`src/lib/api-reads.ts`) : aucun chemin, aucune
 * adresse, aucun agent utilisateur, aucun préfixe de clé, aucun IBAN. Jamais en cache,
 * refus compris : l'en-tête est posé avant le contrôle du secret. Un refus de fenêtre ne
 * recopie pas ce qui a été reçu.
 */
export const adminApiReads = new Hono();

adminApiReads.get('/v1/admin/api-reads', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const window = resolveApiReadsWindow(c.req.query('from'), c.req.query('to'));
  if (!window.ok) return c.json({ error: window.error }, 400);
  return c.json(getApiReads(window.from, window.to));
});
