import { Hono } from 'hono';
import { getStats, getStatsHistory } from '../lib/stats.js';
import { getEntryCount } from '../lib/bic-lookup.js';

const stats = new Hono();

stats.get('/stats', (c) => {
  try {
    const overview = getStats();
    const bicEntries = getEntryCount();

    return c.json({
      ...overview,
      bic_database_entries: bicEntries,
    });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/history', (c) => {
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
