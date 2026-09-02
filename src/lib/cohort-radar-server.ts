/**
 * Cohort radar — the I/O half.
 *
 * Reads the signup ledger, hands it to the pure decision in cohort-radar.ts, and
 * applies the outcome: the matched signups are collapsed into one dossier under
 * a synthetic address, and opted out of the monthly allowance reset so an
 * allowance already spent does not come back on the 1st.
 *
 * Runs on its own periodic tick, off the request path: nothing here can add
 * latency to a customer call or refuse one. The worst case for a wrong match is
 * a display change plus a quota basis, both undone by a single call with the
 * saved mapping — no key is ever deactivated here.
 */

import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';
import { kvGet, kvSet, sendTelegramShort } from './forum-radar-server.js';
import { findCohorts, cohortAddress, type CreationRow, type Cohort } from './cohort-radar.js';

const TICK_MS = 60 * 60 * 1000;
/** Offset from the lifecycle (5'), forum (3') and prospect (4') radars. */
const BOOT_DELAY_MS = 6 * 60 * 1000;
const DUE_AFTER_MS = 60 * 60 * 1000;
const LOOKBACK_HOURS = 24 * 7;

const KV_LAST_RUN = 'cohort_radar_last_run';
const KV_LAST_REPORT = 'cohort_radar_last_report';

export interface CohortRadarReport {
  finished_at: string;
  scanned: number;
  cohorts: Array<{
    user_agent: string;
    address: string;
    keys: number;
    window_hours: number;
    machine_shape_ratio: number;
    first_seen: string;
    last_seen: string;
  }>;
  errors: string[];
}

/**
 * Signups from the lookback window, joined to the key they minted.
 *
 * The WHERE clause is the safety net, and every line of it is a class of key
 * this radar must never touch:
 *  - our own accounts;
 *  - anything already regrouped (idempotent re-runs, no cascading renames);
 *  - a key holding prepaid credits, or on a custom allowance: both mean money
 *    changed hands;
 *  - a key already switched off — nothing left to decide.
 */
function loadCreations(): CreationRow[] {
  return getStatsDB()
    .prepare(
      `SELECT c.key_prefix, c.user_agent, c.created_at, k.email
         FROM key_creations c
         JOIN api_keys k ON k.key_prefix = c.key_prefix
        WHERE c.created_at >= datetime('now', ?)
          AND c.key_prefix IS NOT NULL
          AND c.user_agent IS NOT NULL
          AND k.active = 1
          AND k.no_recredit = 0
          AND k.credits_remaining IS NULL
          AND k.credits_total IS NULL
          AND k.monthly_limit IS NULL
          AND k.email NOT LIKE '%@cohorte.invalid'`,
    )
    .all(`-${LOOKBACK_HOURS} hours`)
    .filter((r) => !isInternalEmail((r as { email: string }).email)) as CreationRow[];
}

/**
 * Collapse one cohort into a single dossier and take it off the monthly reset.
 * Each key's previous address is written to `cohort_relabels` first, in the same
 * transaction, so a wrong match can always be undone — the radar has no caller
 * to hand the mapping back to, unlike the manual relabel endpoint.
 */
function applyCohort(cohort: Cohort, day: string): string {
  const db = getStatsDB();
  const address = cohortAddress(cohort.userAgent, day);
  const readEmail = db.prepare('SELECT key_prefix, email FROM api_keys WHERE key_prefix = ?');
  const saveUndo = db.prepare(
    'INSERT INTO cohort_relabels (key_prefix, old_email, address) VALUES (?, ?, ?)',
  );
  const write = db.prepare('UPDATE api_keys SET email = ?, no_recredit = 1 WHERE key_prefix = ?');
  const tx = db.transaction(() => {
    for (const prefix of cohort.keyPrefixes) {
      const before = readEmail.get(prefix) as { key_prefix: string; email: string } | undefined;
      if (!before) continue; // key vanished between scan and apply — skip, don't invent
      saveUndo.run(before.key_prefix, before.email, address);
      write.run(address, prefix);
    }
  });
  tx();
  return address;
}

let running = false;

/**
 * One pass. Never throws upward: a radar that takes the process down with it is
 * worse than a radar that misses a pass.
 */
export async function runCohortScan(now: Date = new Date()): Promise<CohortRadarReport> {
  const report: CohortRadarReport = {
    finished_at: now.toISOString(),
    scanned: 0,
    cohorts: [],
    errors: [],
  };
  if (running) {
    report.errors.push('already_running');
    return report;
  }
  running = true;
  try {
    const rows = loadCreations();
    report.scanned = rows.length;
    const day = now.toISOString().slice(0, 10);

    for (const cohort of findCohorts(rows, now)) {
      try {
        const address = applyCohort(cohort, day);
        report.cohorts.push({
          user_agent: cohort.userAgent,
          address,
          keys: cohort.keyPrefixes.length,
          window_hours: cohort.windowHours,
          machine_shape_ratio: cohort.machineShapeRatio,
          first_seen: cohort.firstSeen,
          last_seen: cohort.lastSeen,
        });
      } catch (err) {
        // One bad cohort must not cost the others: record and carry on.
        report.errors.push(
          `${cohort.userAgent}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Persist the report BEFORE the Telegram call. sendTelegramShort throws on
    // failure; if it did so after these writes, a pass that already relabelled
    // keys would leave no trace at all (and the undo trail in cohort_relabels
    // would be the only record of what was touched).
    kvSet(KV_LAST_REPORT, JSON.stringify(report));
    kvSet(KV_LAST_RUN, report.finished_at);

    if (report.cohorts.length > 0) {
      const lines = report.cohorts.map(
        (c) => `• ${c.keys} inscriptions regroupées — ${c.user_agent.slice(0, 40)} (${c.address})`,
      );
      try {
        await sendTelegramShort(
          `IBANforge · inscriptions automatiques regroupées\n${lines.join('\n')}\nQuota mensuel non reconduit. Annulable via le mapping (POST /v1/admin/keys/relabel).`,
        );
      } catch (err) {
        // A missed notification must not lose the pass: the report is already saved.
        report.errors.push(`telegram: ${err instanceof Error ? err.message : String(err)}`);
        kvSet(KV_LAST_REPORT, JSON.stringify(report));
      }
    }
    return report;
  } finally {
    running = false;
  }
}

export function lastCohortReport(): {
  last_run_at: string | null;
  report: CohortRadarReport | null;
} {
  let parsed: CohortRadarReport | null;
  try {
    parsed = JSON.parse(kvGet(KV_LAST_REPORT) ?? 'null') as CohortRadarReport | null;
  } catch {
    parsed = null;
  }
  return { last_run_at: kvGet(KV_LAST_RUN) ?? null, report: parsed };
}

export function isCohortScanRunning(): boolean {
  return running;
}

/**
 * The undo trail: what each key's address was before the radar rewrote it.
 * To reverse a wrong match, feed these (key_prefix, old_email) pairs back to
 * POST /v1/admin/keys/relabel with no_recredit:false.
 */
export function getCohortRelabels(
  address?: string,
): Array<{ key_prefix: string; old_email: string; address: string; created_at: string }> {
  const db = getStatsDB();
  if (address) {
    return db
      .prepare(
        'SELECT key_prefix, old_email, address, created_at FROM cohort_relabels WHERE address = ? ORDER BY created_at DESC',
      )
      .all(address) as Array<{
      key_prefix: string;
      old_email: string;
      address: string;
      created_at: string;
    }>;
  }
  return db
    .prepare(
      'SELECT key_prefix, old_email, address, created_at FROM cohort_relabels ORDER BY created_at DESC LIMIT 500',
    )
    .all() as Array<{ key_prefix: string; old_email: string; address: string; created_at: string }>;
}

/** Hourly tick, first pass a few minutes after boot. Never throws upward. */
export function startCohortRadar(): void {
  const tick = async (): Promise<void> => {
    try {
      const last = kvGet(KV_LAST_RUN);
      if (last && Date.now() - new Date(last).getTime() < DUE_AFTER_MS) return;
      await runCohortScan();
    } catch (err) {
      console.error('[cohort-radar] run failed:', err instanceof Error ? err.message : err);
    }
  };
  setTimeout(() => void tick(), BOOT_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}
