import { Hono } from 'hono';
import { getEntryCount, getLastUpdated } from '../lib/bic-lookup.js';

const health = new Hono();
const startTime = Date.now();

health.get('/health', (c) => {
  try {
    const bicEntries = getEntryCount();

    return c.json({
      status: 'ok',
      version: '1.0.0',
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      bic_database_entries: bicEntries,
      bic_data_last_updated: getLastUpdated(),
    });
  } catch {
    return c.json({ status: 'error', message: 'health_check_failed' }, 503);
  }
});

export { health };
