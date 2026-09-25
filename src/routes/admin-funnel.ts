import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { getLineageFunnel } from '../lib/lineage-funnel.js';
import { adminDoors } from './admin-doors.js';

/**
 * Le tableau de cohortes de l'essai (lot M, contrat de mesure du 15/09/2026).
 *
 * `GET /v1/admin/funnel?since=YYYY-MM-DD&days=28`. Sans paramètre, la fenêtre
 * va du démarrage de la mesure à l'instant observé — la période descriptive de
 * 28 jours du contrat se demande explicitement, elle n'est pas imposée ici.
 *
 * 🚨 Cette réponse porte des AGRÉGATS et rien d'autre : aucune lignée nommée,
 * aucun hachage, aucune adresse. C'est aussi pourquoi elle ne met JAMAIS en
 * cache : un intermédiaire qui garderait le corps montrerait une cohorte figée
 * à quelqu'un qui croit lire l'état du jour.
 *
 * Elle n'est pas un texte publié : les chiffres qu'elle rend sont mesurés à la
 * lecture, jamais recopiés dans une surface. Le garde des textes ne la lit pas.
 */
export const adminFunnel = new Hono();

adminFunnel.get('/v1/admin/funnel', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const sinceRaw = c.req.query('since');
  // Borné à la forme, pas seulement cru : un `since` libre arriverait
  // directement dans une comparaison de dates SQLite, où une valeur non datée
  // se compare sans erreur et rend une fenêtre silencieusement fausse.
  const since = sinceRaw && /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) ? sinceRaw : null;
  const daysRaw = Number.parseInt(c.req.query('days') ?? '', 10);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 366) : null;
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    ...getLineageFunnel({ since, days }),
    // Dire ce qui a été demandé, et pas seulement ce qui a été appliqué : un
    // `since` mal formé est ignoré, et sans cette ligne l'appelant lirait une
    // fenêtre par défaut en croyant lire la sienne.
    requested: { since: sinceRaw ?? null, days: Number.isFinite(daysRaw) ? daysRaw : null },
  });
});

// Le tableau des portes du lundi (plan d'audit, semaine 2), voisin de ce tableau
// de cohortes : monté ici plutôt que dans app.ts, tenu ce jour-là par le lot B2
// de la clé unique. `app.route('/', adminFunnel)` le recopie avec cette route,
// et le test des routes d'administration le découvre comme les autres.
adminFunnel.route('/', adminDoors);
