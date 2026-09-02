import { Hono } from 'hono';
import { createRequire } from 'node:module';
import {
  getEntryCount,
  getLastUpdated,
  getSourceFreshness,
  type SourceFreshness,
} from '../lib/bic-lookup.js';
import { getChClearingCount } from '../lib/ch-clearing.js';
import { getStatsDB, getStatsDbState } from '../lib/db.js';
import { getComplianceDB } from '../lib/compliance-db.js';
import { ukModulusStatus, type UkModulusStatus } from '../lib/uk-modulus.js';
import { verificationDelivery } from '../lib/key-creation-guard.js';

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
 * reason to have a healthy container pulled out of rotation.
 *
 * Why it belongs in a health response at all: verification is the ONLY one of
 * our four outbound messages whose failure blocks a customer, and it is the one
 * with no second path. Before this, a holder stuck at that step was invisible.
 *
 * 🚨 NO VOLUME IS PUBLISHED HERE. /health takes no authentication, so the raw
 * count of codes sent in 24 h would tell anyone — competitors included — how
 * many people are signing up per day. That is real activity data and it does
 * not belong on a public surface; only the shape of the failure does. The
 * counts stay readable internally through `verificationDelivery()`.
 *
 * Below MIN_JUDGEABLE_SENDS the state is 'unknown' rather than a ratio: one
 * refusal out of one send is not a 100% failure rate, it is a sample too small
 * to mean anything — and publishing that ratio would leak the volume it was
 * computed from.
 */
const MIN_JUDGEABLE_SENDS = 5;

/** Degraded above this share of refusals, once there is enough to judge. */
const DEGRADED_REFUSAL_RATIO = 0.5;

/**
 * Guarded like the two probes above and for the same reason: freshness
 * reporting is a feature, and a feature's failure must never pull a healthy
 * container out of rotation.
 */
function probeSourceFreshness(): SourceFreshness[] {
  try {
    return getSourceFreshness();
  } catch {
    return [];
  }
}

function probeVerificationMail(): { window_hours: number; state: 'ok' | 'degraded' | 'unknown' } {
  try {
    const d = verificationDelivery(24);
    if (d.attempted < MIN_JUDGEABLE_SENDS || d.refused_ratio == null) {
      return { window_hours: d.window_hours, state: 'unknown' };
    }
    return {
      window_hours: d.window_hours,
      state: d.refused_ratio > DEGRADED_REFUSAL_RATIO ? 'degraded' : 'ok',
    };
  } catch {
    return { window_hours: 24, state: 'unknown' };
  }
}

/** Did this database answer at all? Used only to qualify a degraded response. */
function probeState(probe: () => void): 'ok' | 'error' {
  try {
    probe();
    return 'ok';
  } catch {
    return 'error';
  }
}

/**
 * 🚨 PERF-03 (audit 2026-09-01): the answer given when the stats database could
 * not be opened at all.
 *
 * Until this change that failure was not a red healthcheck, it was NO
 * healthcheck: `getStatsDB()` runs as an import side effect of
 * `src/routes/feedback.ts`, so a corrupt `stats.sqlite` threw before `serve()`,
 * no listener ever existed, Railway gave up after `restartPolicyMaxRetries = 3`
 * and every in-process watchdog died with it. The container that never exists
 * looks, from outside, exactly like a network problem.
 *
 * So the point of this payload is the `message`: `entrypoint.sh` deliberately
 * never overwrites `stats.sqlite` (it holds the API keys), which means a
 * corrupt file survives every restart untouched. Being able to READ the SQLite
 * error is what turns a silent month of downtime into one line of diagnosis.
 * The other two databases are probed so the reader sees which of the three is
 * down instead of assuming all of them are.
 */
function statsDbUnavailable(error: string | undefined): {
  status: string;
  version: string;
  uptime_seconds: number;
  databases: { bic: string; stats: string; compliance: string };
  message: string;
} {
  return {
    status: 'error',
    version: pkg.version,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    databases: {
      bic: probeState(() => void getEntryCount()),
      stats: 'error',
      compliance: probeState(
        () => void getComplianceDB().prepare('SELECT 1 FROM sanctioned_countries LIMIT 1').get(),
      ),
    },
    message: error ?? 'stats_database_unavailable',
  };
}

health.get('/health', (c) => {
  try {
    // Read BEFORE probing: on a boot where the DDL already failed at import,
    // the cause is recorded and there is no reason to make the corrupt file
    // throw a second time.
    const bootState = getStatsDbState();
    if (!bootState.ok) return c.json(statsDbUnavailable(bootState.error), 503);

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
      // with no fallback path. Reported as a STATE and never as a volume:
      // this endpoint is public. Never used to fail the check.
      verification_mail: probeVerificationMail(),
      // ADDED beside the contract, nothing renamed. `stale` is what alerting
      // hangs off: the table refreshes only at image build, so without a deploy
      // it ages with no signal anywhere. The daily probe watches `checked:
      // true`, which a six-month-old table satisfies just as well as a fresh
      // one, while answering wrongly for every sorting code reallocated since.
      uk_modulus: probeUkModulus(),
      // Per-register freshness, added 01/09/2026 and additive like the two
      // blocks above. The global date one screen up answers "did the refresh
      // run"; this answers "did every source survive it" — a register whose
      // fetch step silently emptied would otherwise rot behind a green
      // headline, because the newest GLEIF row keeps MAX(updated_at) young.
      // Deliberately PUBLIC: entry counts per public register are product
      // facts (the /sources page already names them), not activity data.
      // Memoised — one scan per process, see getSourceFreshness. Never used
      // to fail the check: stale data is a degraded feature, not an outage.
      bic_sources: probeSourceFreshness(),
    });
  } catch {
    // The probe itself may be the first thing to touch a broken stats database
    // (nothing had opened it yet). It records the cause on its way out, so ask
    // again before falling back to the anonymous failure.
    const state = getStatsDbState();
    if (!state.ok) return c.json(statsDbUnavailable(state.error), 503);
    return c.json({ status: 'error', message: 'health_check_failed' }, 503);
  }
});

export { health };
