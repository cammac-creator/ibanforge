import { Hono } from 'hono';
import { getStats } from '../lib/stats.js';
import { getEntryCount, getLastUpdated } from '../lib/bic-lookup.js';

const health = new Hono();
const startTime = Date.now();

health.get('/health', (c) => {
  try {
    const stats = getStats();
    const bicEntries = getEntryCount();

    return c.json({
      status: 'ok',
      version: '1.0.0',
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      bic_database_entries: bicEntries,
      bic_data_last_updated: getLastUpdated(),
      stats: {
        total_operations: stats.total_operations,
        iban_validations: stats.by_type.iban_validate.total,
        bic_lookups: stats.by_type.bic_lookup.total,
        total_revenue_usdc: stats.total_revenue_usdc,
      },
    });
  } catch {
    return c.json({ status: 'error', message: 'stats_unavailable' }, 503);
  }
});

export { health };
