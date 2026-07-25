import { Hono } from 'hono';
import { getStats, getStatsHistory, getHourlyStats, getErrorStats, getPatternStats, getStatusByPath, getBusinessFunnel, getSourceStats, getRejectionStats } from '../lib/stats.js';
import { getEntryCount } from '../lib/bic-lookup.js';

const stats = new Hono();

/**
 * Stats endpoints are protected by a bearer token (STATS_TOKEN env var).
 * The frontend dashboard passes this token when fetching stats.
 * If STATS_TOKEN is not set, stats are disabled (returns 403).
 */
function checkAuth(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  return authHeader === `Bearer ${token}`;
}

stats.get('/stats', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const overview = getStats();
    const bicEntries = getEntryCount();
    return c.json({ ...overview, bic_database_entries: bicEntries });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/history', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 7;
    if (isNaN(days)) days = 7;
    days = Math.max(1, Math.min(90, days));
    const history = getStatsHistory(days);
    return c.json(history);
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/hourly', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 7;
    if (isNaN(days)) days = 7;
    days = Math.max(1, Math.min(90, days));
    return c.json(getHourlyStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/errors', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json(getErrorStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

/**
 * Pourquoi un endpoint à part : un rejet de format n'est jamais une opération
 * (la requête n'atteint pas le service), il vit dans une voie séparée de la
 * table `operations` que toutes les autres agrégations excluent. C'est la
 * lecture qui décidera de la phase 2 — si le volume est surtout
 * `placeholder_literal`, le problème est dans la spec OpenAPI, pas dans la
 * tolérance des gardes.
 *
 * Le paramètre est `days` (et non `period` comme les routes voisines) : c'est
 * celui que lit la procédure de dépouillement de la phase 2.
 *
 * ⚠️ Les catégories n'ont pas toutes le même dénominateur. Toutes sont
 * comptées par la garde de format, AVANT les middlewares clé d'API et x402
 * — sauf `invalid_bic_shape`, seule à être enregistrée par la route, donc
 * APRÈS eux : elle ne voit que les requêtes qui ont payé ou présenté une clé.
 * Son compte est tiré d'une population plus petite que les autres et n'est pas
 * directement comparable — un petit chiffre ne veut PAS dire « la forme de
 * l'identifiant n'est pas un problème ».
 */
stats.get('/stats/rejections', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const daysParam = c.req.query('days');
    let days = daysParam ? parseInt(daysParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json({ period_days: days, rows: getRejectionStats(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/business-funnel', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json({ period_days: days, rows: getBusinessFunnel(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/status-by-path', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json({ period_days: days, rows: getStatusByPath(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/patterns', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json(getPatternStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/sources', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }
  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json(getSourceStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

export { stats };
