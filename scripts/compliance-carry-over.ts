import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';

/**
 * Carry a sanctions list over from the previous compliance.sqlite when its
 * download fails.
 *
 * ## The failure this answers
 *
 * On 06/09/2026 the weekly refresh lost the EU consolidated list to an HTTP
 * 500 at the Commission's file server (SECO's export answered 500 as well, as
 * it has since July). The refresher is best-effort per list, so it shipped a
 * database holding OFAC and UN only — and the claims gate in the workflow
 * (src/routes/sanctions-claims.test.ts) correctly refused it, because every
 * served surface names the EU list. Right outcome, wrong cost: the OFAC and UN
 * rows that HAD refreshed were thrown away with the failed run, the database
 * in production aged a full week, and the alert woke a human for a transient
 * outage upstream.
 *
 * ## What this does instead
 *
 * When one list cannot be downloaded, its rows are copied from the database
 * currently shipped (the previous successful refresh), so the set of lists
 * stays whole and the fresh lists ship. The copy is recorded in `metadata`
 * under `carried_over`, list by list with the date of the refresh the rows
 * really come from, so an auditor reading the database can see which list is
 * stale and by how much.
 *
 * ## The bound that keeps this honest
 *
 * A carry-over is a bridge over one bad week, not a way of never refreshing.
 * The previous database must itself be younger than CARRY_OVER_MAX_AGE_DAYS;
 * past that, the list is dropped as before and the claims gate fails the run
 * — a list three weeks stale is a coverage claim, not a coverage.
 */
export const CARRY_OVER_MAX_AGE_DAYS = 21;

export type CarryOverReason = 'carried' | 'no_previous_db' | 'previous_too_old' | 'no_rows';

export interface CarryOverResult {
  rows: number;
  /** `last_refresh` of the database the rows come from, when one was read. */
  previousRefresh: string | null;
  reason: CarryOverReason;
}

interface EntityRow {
  bic8: string;
  entity_name: string | null;
  source_list: string;
  country_code: string | null;
  directory_match: number;
}

/**
 * Copy `list`'s rows from `previousDbPath` into `target`. Never throws on a
 * missing or unreadable previous database: the caller is already inside a
 * failure path, and a second failure there must not mask the first.
 */
export function carryOverList(
  target: Database.Database,
  previousDbPath: string,
  list: string,
  now: Date = new Date(),
): CarryOverResult {
  if (!existsSync(previousDbPath)) {
    return { rows: 0, previousRefresh: null, reason: 'no_previous_db' };
  }
  let previous: Database.Database | null = null;
  try {
    previous = new Database(previousDbPath, { readonly: true, fileMustExist: true });
    const meta = previous.prepare(`SELECT value FROM metadata WHERE key = 'last_refresh'`).get() as
      { value: string } | undefined;
    const previousRefresh = meta?.value ?? null;
    const refreshedAt = previousRefresh ? new Date(previousRefresh).getTime() : NaN;
    const ageDays = (now.getTime() - refreshedAt) / 86_400_000;
    if (!Number.isFinite(ageDays) || ageDays > CARRY_OVER_MAX_AGE_DAYS) {
      return { rows: 0, previousRefresh, reason: 'previous_too_old' };
    }
    const rows = previous
      .prepare(
        `SELECT bic8, entity_name, source_list, country_code, directory_match
           FROM sanctioned_entities WHERE source_list = ?`,
      )
      .all(list) as EntityRow[];
    if (!rows.length) {
      return { rows: 0, previousRefresh, reason: 'no_rows' };
    }
    const insert = target.prepare(
      `INSERT OR IGNORE INTO sanctioned_entities (bic8, entity_name, source_list, country_code, directory_match)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const note = target.prepare(
      `INSERT OR REPLACE INTO metadata (key, value) VALUES ('carried_over', ?)`,
    );
    const existing = target
      .prepare(`SELECT value FROM metadata WHERE key = 'carried_over'`)
      .get() as { value: string } | undefined;
    const marker = `${list}@${previousRefresh}`;
    const value = existing?.value ? `${existing.value},${marker}` : marker;
    target.transaction(() => {
      for (const r of rows) {
        insert.run(r.bic8, r.entity_name, r.source_list, r.country_code, r.directory_match);
      }
      note.run(value);
    })();
    return { rows: rows.length, previousRefresh, reason: 'carried' };
  } catch {
    return { rows: 0, previousRefresh: null, reason: 'no_previous_db' };
  } finally {
    previous?.close();
  }
}
