import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { getEntryCount, getLastUpdated } from '../lib/bic-lookup.js';
import { getChClearingCount } from '../lib/ch-clearing.js';
import { getStatsDB } from '../lib/db.js';
import { getComplianceDB } from '../lib/compliance-db.js';
import { ukModulusStatus, type UkModulusStatus } from '../lib/uk-modulus.js';
import { verificationDelivery, type VerificationDelivery } from '../lib/key-creation-guard.js';

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

/**
 * The UK modulus table is OPTIONAL, and this endpoint must keep saying so.
 *
 * It is fetched at image build and the Dockerfile lets that step fail without
 * failing the build, because a rotted download link must cost the UK check and
 * never the deploy. So its absence is a degraded feature, not an outage: if it
 * could turn /health red, Railway would pull a perfectly healthy container out
 * of rotation over a check that is allowed to be missing.
 *
 * Hence its own guard. `ukModulusStatus()` swallows its own read errors today,
 * but this endpoint must not depend on that staying true.
 */
function probeUkModulus(): UkModulusStatus {
  try {
    return ukModulusStatus();
  } catch {
    return { available: false, fetched_on: null, age_days: null, stale: null };
  }
}

/**
 * How the verification-code channel is doing, guarded like the UK table above.
 *
 * Same reasoning: a mail channel in trouble is a degraded feature, never a
 * reason to have a healthy container pulled out of rotation. `refused_ratio`
 * stays null when nothing was attempted — no traffic is not a clean channel.
 *
 * Why it belongs in a health response at all: verification is the ONLY one of
 * our four outbound messages whose failure blocks a customer, and it is the one
 * with no second path. Before this, a holder stuck at that step was invisible.
 */
function probeVerificationMail(): VerificationDelivery {
  try {
    return verificationDelivery(24);
  } catch {
    return { window_hours: 24, attempted: 0, refused: 0, refused_ratio: null };
  }
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
      // The one outbound message whose failure blocks a customer, and the one
      // with no fallback path. Reported, never used to fail the check.
      verification_mail: probeVerificationMail(),
      // ADDED beside the contract, nothing renamed. `stale` is what alerting
      // hangs off: the table refreshes only at image build, so without a deploy
      // it ages with no signal anywhere. The daily probe watches `checked:
      // true`, which a six-month-old table satisfies just as well as a fresh
      // one, while answering wrongly for every sorting code reallocated since.
      uk_modulus: probeUkModulus(),
    });
  } catch {
    return c.json({ status: 'error', message: 'health_check_failed' }, 503);
  }
});

export { health };
