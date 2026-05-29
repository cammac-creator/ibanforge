import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { getEntryCount, getLastUpdated } from '../lib/bic-lookup.js';
import { getChClearingCount } from '../lib/ch-clearing.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const health = new Hono();
const startTime = Date.now();

health.get('/health', (c) => {
  try {
    const bicEntries = getEntryCount();

    return c.json({
      status: 'ok',
      version: pkg.version,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      bic_database_entries: bicEntries,
      ch_clearing_entries: getChClearingCount(),
      bic_data_last_updated: getLastUpdated(),
    });
  } catch {
    return c.json({ status: 'error', message: 'health_check_failed' }, 503);
  }
});

export { health };
