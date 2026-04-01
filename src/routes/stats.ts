import { Hono } from 'hono';
import { getStats } from '../lib/stats.js';
import { getEntryCount } from '../lib/db.js';

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

export { stats };
