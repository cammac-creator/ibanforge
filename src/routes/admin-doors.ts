import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { getDoorBoard } from '../lib/door-board.js';
import { readDigestState } from '../lib/door-board-digest.js';

/**
 * Le tableau des portes (plan d'audit du 22.09.2026, semaine 2).
 *
 * `GET /v1/admin/doors?weeks=10` : la semaine en cours et les semaines closes
 * demandées (2 à 52, 10 par défaut), porte par porte, plus l'état du résumé
 * du lundi. Les nombres sont ceux de `getDoorBoard`, la fonction que le résumé
 * du lundi lit aussi : la page et le message ne peuvent pas diverger.
 *
 * Des AGRÉGATS seulement : aucune adresse, aucun hachage, aucun préfixe. Jamais
 * en cache : un intermédiaire qui garderait le corps montrerait une semaine
 * figée à quelqu'un qui croit lire l'état du jour.
 */
export const adminDoors = new Hono();

adminDoors.get('/v1/admin/doors', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  // Borné par `getDoorBoard` ; une valeur illisible rend la valeur par défaut,
  // et `requested` dit ce qui a été demandé.
  const raw = c.req.query('weeks');
  const parsed = Number.parseInt(raw ?? '', 10);
  const board = getDoorBoard({ weeks: Number.isFinite(parsed) ? parsed : null });
  return c.json({
    ...board,
    digest: readDigestState(board),
    requested: { weeks: raw ?? null },
  });
});
