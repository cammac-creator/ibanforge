import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { getEntryCount, getLastUpdated } from '../lib/bic-lookup.js';
import { getChClearingCount } from '../lib/ch-clearing.js';
import { getStatsDB } from '../lib/db.js';
import { getComplianceDB } from '../lib/compliance-db.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const health = new Hono();
const startTime = Date.now();

/**
 * The three databases this service cannot serve without, each touched by a
 * query cheap enough to run on every Railway healthcheck.
 *
 * 🚨 Until 20/08/2026 this endpoint proved only that `bic.sqlite` opened.
 * `compliance.sqlite` backs the most expensive endpoint we sell
 * (/v1/iban/compliance, $0.02) and `stats.sqlite` backs quota, credits and
 * every counter — either one could be missing, corrupt or unwritable while
 * /health answered a confident green, Railway kept the container in rotation,
 * and the site's stats bar quoted it. A healthcheck that watches one process
 * out of three is worse than none: it converts an outage into a silent one.
 *
 * `SELECT 1 FROM … LIMIT 1` on a real table, not `PRAGMA quick_check` (too
 * slow for a 30 s healthcheck loop) and not a bare connection (a handle opens
 * fine on a truncated file). Cheap, but it does read a page.
 */
function probeDatabases(): { bic: number; chClearing: number; lastUpdated: string | null } {
  const bicEntries = getEntryCount();
  const chClearing = getChClearingCount();
  const lastUpdated = getLastUpdated();
  getStatsDB().prepare('SELECT 1 FROM api_keys LIMIT 1').get();
  // A NAMED table, not sqlite_master: an empty or truncated file answers
  // sqlite_master without complaining, and the point is to catch a compliance
  // database that opened but lost its content.
  getComplianceDB().prepare('SELECT 1 FROM sanctioned_countries LIMIT 1').get();
  return { bic: bicEntries, chClearing, lastUpdated };
}

health.get('/health', (c) => {
  try {
    const db = probeDatabases();

    // ⚠️ The SHAPE of this response is a contract: Railway's healthcheck reads
    // the status code, and the public site's stats bar reads these fields.
    // `databases` was ADDED beside them; nothing was renamed or removed.
    return c.json({
      status: 'ok',
      version: pkg.version,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      bic_database_entries: db.bic,
      ch_clearing_entries: db.chClearing,
      bic_data_last_updated: db.lastUpdated,
      databases: { bic: 'ok', stats: 'ok', compliance: 'ok' },
    });
  } catch {
    return c.json({ status: 'error', message: 'health_check_failed' }, 503);
  }
});

export { health };
