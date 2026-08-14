import { getStatsDB } from './db.js';

/**
 * Are we still listed where we worked to get listed?
 *
 * Getting into a directory is a one-off effort; STAYING in it is nobody's job.
 * A registry rebuild, a purge of entries whose CORS could not be verified, a
 * catalog migration: any of these drops a listing silently, and the only way
 * we would learn about it today is by opening thirty pages by hand. So a VPS
 * probe walks the surfaces daily and posts what it saw here, and the overview
 * carries one line per surface with the day it was last seen.
 *
 * The table stores one row per (surface, day): probes are idempotent, a second
 * run on the same day corrects the first rather than inflating history. That
 * keeps "last seen" honest, which is the only figure a delisting alarm can
 * safely read.
 */

export type VisibilityState = 'present' | 'absent' | 'error';

export interface VisibilityRow {
  surface: string;
  state: VisibilityState;
  detail: string | null;
  url: string | null;
  checked_on: string;
}

export interface SurfaceStatus {
  surface: string;
  state: VisibilityState;
  detail: string | null;
  url: string | null;
  /** Day of the most recent probe, whatever it found. */
  checked_on: string;
  /** Day we last saw it present, null if never. A delisting shows up here. */
  last_present_on: string | null;
  /** True when it was present before and is not now: the alarm case. */
  lost: boolean;
}

const STATES: VisibilityState[] = ['present', 'absent', 'error'];

export function isVisibilityState(v: unknown): v is VisibilityState {
  return typeof v === 'string' && STATES.includes(v as VisibilityState);
}

/** Record one probe result. Same surface twice in a day overwrites. */
export function recordVisibility(input: {
  surface: string;
  state: VisibilityState;
  detail?: string | null;
  url?: string | null;
  day?: string;
}): void {
  const surface = input.surface.trim().slice(0, 60);
  if (!surface) return;
  const day = input.day ?? new Date().toISOString().slice(0, 10);
  getStatsDB()
    .prepare(
      `INSERT INTO visibility_checks (surface, checked_on, state, detail, url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(surface, checked_on) DO UPDATE SET
         state = excluded.state, detail = excluded.detail, url = excluded.url`,
    )
    .run(surface, day, input.state, (input.detail ?? '').slice(0, 300) || null, input.url ?? null);
}

/**
 * The current picture: newest probe per surface, plus the last day each was
 * seen present. `lost` is computed rather than stored so a surface that comes
 * back clears its own alarm without anyone editing a row.
 */
export function getVisibility(): SurfaceStatus[] {
  const db = getStatsDB();
  const latest = db
    .prepare(
      `SELECT v.surface, v.state, v.detail, v.url, v.checked_on
       FROM visibility_checks v
       JOIN (SELECT surface, MAX(checked_on) AS d FROM visibility_checks GROUP BY surface) m
         ON m.surface = v.surface AND m.d = v.checked_on
       ORDER BY v.surface`,
    )
    .all() as VisibilityRow[];

  const seen = db
    .prepare(
      `SELECT surface, MAX(checked_on) AS last_present_on
       FROM visibility_checks WHERE state = 'present' GROUP BY surface`,
    )
    .all() as Array<{ surface: string; last_present_on: string }>;
  const presentBy = new Map(seen.map((r) => [r.surface, r.last_present_on]));

  return latest.map((r) => {
    const lastPresent = presentBy.get(r.surface) ?? null;
    return {
      ...r,
      last_present_on: lastPresent,
      // Errors are not losses: an unreachable directory is our probe's problem,
      // not a delisting, and crying wolf on a timeout would make the whole
      // panel ignorable.
      lost: r.state === 'absent' && lastPresent !== null && lastPresent < r.checked_on,
    };
  });
}
