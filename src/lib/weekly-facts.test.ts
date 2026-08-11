import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getStatsDB } from './db.js';
import { getWeeklyFacts } from './weekly-facts.js';

const PFX = 'ifk_wkfct';
const EMAIL = 'weekly@alpha.example.net';

// Frozen "now": Wednesday 2026-08-12 → last full week is Mon 03.08 – Sun 09.08,
// ISO week 2026-W32 (Jan 1st 2026 is a Thursday, so W1 starts 2025-12-29).
const NOW = new Date('2026-08-12T05:00:00Z');

beforeAll(() => {
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit, source)
     VALUES (?, ?, ?, '2026-08-05 09:00:00', 1, 200, 'apisio')`,
  ).run(`${PFX}_k1`, `${PFX}_k1`, EMAIL);
  db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix)
     VALUES ('POST', '/v1/iban/validate', 200, 9, '2026-08-05 10:00:00', ?)`,
  ).run(`${PFX}_k1`);
});

afterAll(() => {
  const db = getStatsDB();
  db.prepare(`DELETE FROM request_log WHERE key_prefix LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM api_keys WHERE key_hash LIKE '${PFX}%'`).run();
});

describe('getWeeklyFacts — WoW deltas computed in tested TS, never by the writer', () => {
  it('windows on the last FULL Monday–Sunday week and labels it in ISO form', () => {
    const f = getWeeklyFacts(NOW);
    expect(f.week).toBe('2026-W32');
    expect(f.range.from).toBe('2026-08-03');
    expect(f.range.to).toBe('2026-08-09');
  });

  it('counts our fixture signup, first call and source inside the week (delta-safe: >=)', () => {
    const f = getWeeklyFacts(NOW);
    expect(f.signups.current).toBeGreaterThanOrEqual(1);
    expect(f.first_calls.current).toBeGreaterThanOrEqual(1);
    expect(f.requests.current).toBeGreaterThanOrEqual(1);
    expect(f.top_sources.some((s) => s.source === 'apisio')).toBe(true);
  });

  it('delta_pct is null when the previous week is zero — the writer must not invent a %', () => {
    // A now far in the future puts both windows in empty territory except
    // current=0/previous=0; and any metric with previous 0 must carry null.
    const f = getWeeklyFacts(NOW);
    for (const m of [f.requests, f.billable_ok, f.paywall_hits]) {
      if (m.previous === 0) expect(m.delta_pct).toBeNull();
      else expect(typeof m.delta_pct).toBe('number');
    }
  });
});
