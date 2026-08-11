import { getStatsDB } from './db.js';

/**
 * Chart annotations. A traffic curve that moves without a "what happened that
 * day" marker costs a diagnosis session; a deploy or a manual note written
 * here shows up as a vertical marker on the dashboard charts.
 */

export interface EventRow {
  created_at: string;
  kind: string;
  label: string;
}

const LABEL_MAX = 120;

export function recordEvent(kind: 'deploy' | 'manual', label: string): void {
  const db = getStatsDB();
  const clean = label.trim().slice(0, LABEL_MAX);
  if (!clean) return;
  if (kind === 'deploy') {
    // Railway restarts replay the boot hook with the same version string —
    // one marker per release, not one per restart.
    const recent = db
      .prepare(
        `SELECT 1 FROM events
         WHERE kind = 'deploy' AND label = ? AND created_at >= datetime('now', '-6 hours')
         LIMIT 1`,
      )
      .get(clean);
    if (recent) return;
  }
  db.prepare(`INSERT INTO events (kind, label) VALUES (?, ?)`).run(kind, clean);
}

export function getEvents(days = 90): EventRow[] {
  return getStatsDB()
    .prepare(
      `SELECT created_at, kind, label FROM events
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all(Math.max(1, Math.min(365, days))) as EventRow[];
}
