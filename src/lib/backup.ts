/**
 * Exporting and restoring what a customer paid for.
 *
 * ## Why this exists
 *
 * `stats.sqlite` lives on a single Railway volume and has no backup of any
 * kind: no dump, no replication, no export. It holds the API keys, the monthly
 * quotas and the prepaid credit balances. Measured on 21/08/2026, tens of
 * thousands of purchased credits were sitting in it unconsumed — money already
 * taken, service still owed.
 *
 * If that volume is lost, every customer loses the access they paid for and
 * there is no way to give it back. Not a degraded feature: a broken contract,
 * silently, with no way to even know who was owed what.
 *
 * ## What is in scope, and what is deliberately not
 *
 * Only what is **irreplaceable and contractual**: the keys themselves, their
 * allowances and balances, and the usage counters that decide whether a caller
 * is inside their quota this month.
 *
 * The mail archive, the CRM, prospects and forum threads are NOT here. They are
 * valuable and their loss would hurt, but they are not owed to anyone, and an
 * export endpoint that carries a company's entire correspondence is a much
 * larger thing to leave lying around behind one secret.
 *
 * 🚨 A dump of this is customer data: addresses and key hashes. It must never
 * be committed, never be attached to a public artifact, and never be written
 * anywhere inside the repository. The endpoint that serves it is admin-only.
 *
 * ⚠️ Key hashes, never keys. The raw key is not stored by the product at all,
 * so a restore brings back a customer's balance and their existing key keeps
 * working — it cannot mint a key nobody holds.
 */
import { getStatsDB } from './db.js';
import { recordEvent } from './events.js';

/** Bumped when the shape changes, so a restore can refuse a dump it cannot read. */
export const BACKUP_FORMAT = 1;

export interface BackupPayload {
  format: number;
  /** Stamped by the caller, not by this module: the clock is not our business. */
  taken_at: string;
  counts: { api_keys: number; api_usage: number };
  api_keys: Array<Record<string, unknown>>;
  api_usage: Array<Record<string, unknown>>;
}

/**
 * Columns dropped from the export after they are read.
 *
 * `raw_key_one_time_view` is the API key IN CLEAR, kept for the few days
 * between a purchase and the buyer collecting it. Its whole reason to exist is
 * to bound how long a key lives in plaintext — and the export walked straight
 * past that bound: one admin call returned every uncollected key, in clear,
 * next to every customer address, in a file whose entire purpose is to be
 * copied off the server (SEC-03, audit 2026-09-01).
 *
 * Nothing is lost. A restore rebuilds access from `key_hash`, which is what
 * authenticates a caller; the buyer's existing key keeps working. Only the
 * convenience of re-serving a key nobody collected goes, and that is a
 * plaintext credential we should not be shipping in a backup anyway.
 */
const EXPORT_EXCLUDED_COLUMNS = ['raw_key_one_time_view'] as const;

/**
 * Everything needed to give a paying customer their access back.
 *
 * Columns are read with `SELECT *` on purpose. A hand-written column list
 * silently stops exporting anything added later, and the failure only shows up
 * on the day someone tries to restore — which is the worst possible day to
 * discover that the backup was incomplete. The one column removed is removed
 * AFTER the read, by name, so the doctrine survives: a new column is exported
 * without anyone having to remember it, and only a deliberate line here can
 * ever leave one out.
 */
export function exportPaidState(takenAt: string): BackupPayload {
  const db = getStatsDB();
  const keys = (db.prepare('SELECT * FROM api_keys').all() as Array<Record<string, unknown>>).map((row) => {
    const copy = { ...row };
    for (const column of EXPORT_EXCLUDED_COLUMNS) delete copy[column];
    return copy;
  });
  const usage = db.prepare('SELECT * FROM api_usage').all() as Array<Record<string, unknown>>;
  // An export is the one read that takes the whole customer base off the
  // server, and it left no trace of its own: a single `request_log` line,
  // indistinguishable from any other call. This annotation puts it on the
  // dashboard timeline with its volume, so "when was the last dump taken, and
  // how big was it" has an answer that does not require log archaeology.
  try {
    recordEvent('manual', `backup export: ${keys.length} keys, ${usage.length} usage rows`);
  } catch (err) {
    // A disaster-recovery export must not fail over its own annotation: the
    // stats DB has writers outside this process and a BUSY here would turn the
    // one call that saves the billing state into a 500.
    console.error('[backup] export annotation failed:', err instanceof Error ? err.message : err);
  }
  return {
    format: BACKUP_FORMAT,
    taken_at: takenAt,
    counts: { api_keys: keys.length, api_usage: usage.length },
    api_keys: keys,
    api_usage: usage,
  };
}

export interface RestoreReport {
  keys_inserted: number;
  keys_skipped: number;
  usage_inserted: number;
  usage_skipped: number;
}

/**
 * Put a dump back, without destroying anything already present.
 *
 * Additive by design: rows whose key already exists are SKIPPED, never
 * overwritten. A restore is run in a panic, often against a database that is
 * partly alive, and the mode that cannot make things worse is the only one
 * worth having. Recovering a wiped volume and merging an old dump into a live
 * one are then the same operation.
 *
 * Refuses a dump whose format it does not know rather than importing half of
 * it: a partial restore of billing state is worse than a refused one, because
 * it looks like it worked.
 */
export function restorePaidState(payload: BackupPayload): RestoreReport {
  if (payload?.format !== BACKUP_FORMAT) {
    throw new Error(`unsupported backup format: ${payload?.format ?? 'missing'} (expected ${BACKUP_FORMAT})`);
  }
  const db = getStatsDB();
  const report: RestoreReport = { keys_inserted: 0, keys_skipped: 0, usage_inserted: 0, usage_skipped: 0 };

  const insertRow = (table: string, row: Record<string, unknown>): boolean => {
    const cols = Object.keys(row);
    if (cols.length === 0) return false;
    const sql = `INSERT OR IGNORE INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
      .map(() => '?')
      .join(', ')})`;
    const info = db.prepare(sql).run(...cols.map((c) => row[c] as never));
    return info.changes > 0;
  };

  // One transaction: a restore that stops halfway leaves a billing table in a
  // state nobody can reason about.
  const run = db.transaction(() => {
    for (const row of payload.api_keys ?? []) {
      if (insertRow('api_keys', row)) report.keys_inserted++;
      else report.keys_skipped++;
    }
    for (const row of payload.api_usage ?? []) {
      if (insertRow('api_usage', row)) report.usage_inserted++;
      else report.usage_skipped++;
    }
  });
  run();

  return report;
}
