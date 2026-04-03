import { Hono } from 'hono';
import { getStats, getStatsHistory } from '../lib/stats.js';
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

export { stats };
