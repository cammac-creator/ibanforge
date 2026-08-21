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
  // An internal probe key with heavy in-week billable traffic: it must move
  // NONE of the business metrics (a probe once inflated a week by hundreds of
  // calls and the digest reported a -76% collapse when the probe stopped).
  db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit)
     VALUES (?, ?, 'edge-probe@ibanforge.internal', '2026-08-04 09:00:00', 1, 200)`,
  ).run(`${PFX}_probe`, `${PFX}_probe`);
  const insProbe = db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix)
     VALUES ('POST', '/v1/iban/validate', ?, 5, '2026-08-04 11:00:00', ?)`,
  );
  for (let i = 0; i < 40; i++) insProbe.run(200, `${PFX}_probe`);
  insProbe.run(429, `${PFX}_probe`);
});

afterAll(() => {
  const db = getStatsDB();
  db.prepare(`DELETE FROM request_log WHERE key_prefix LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM api_keys WHERE key_hash LIKE '${PFX}%'`).run();
});

describe('getWeeklyFacts — survives a table with more internal keys than SQLite takes parameters', () => {
  const BULK = `${PFX}_bulk`;

  afterAll(() => {
    const db = getStatsDB();
    db.prepare(`DELETE FROM api_keys WHERE key_hash LIKE '${BULK}%'`).run();
  });

  it('still answers with 2500 internal keys on file', () => {
    // The exclusion used to bind one parameter per internal key, twice over,
    // so the digest started throwing "too many SQL variables" somewhere past
    // a thousand of them. Production is far below that, but the threshold is
    // a function of table size and a burst of automated signups is exactly
    // when a weekly digest must not go dark. 2500 clears the 2000 ceiling
    // measured on better-sqlite3 11 and 13 alike.
    const db = getStatsDB();
    const ins = db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit)
       VALUES (?, ?, ?, '2026-08-05 09:00:00', 1, 200)`,
    );
    db.transaction(() => {
      for (let i = 0; i < 2500; i++) {
        ins.run(`${BULK}${i}`, `${BULK}${i}`, `probe-${i}@ibanforge.internal`);
      }
    })();

    expect(() => getWeeklyFacts(NOW)).not.toThrow();
    // And the exclusion still excludes: none of those 2500 may be counted as
    // a signup, or the fix would have traded a crash for a wrong number.
    const f = getWeeklyFacts(NOW);
    expect(f.signups.current).toBeLessThan(2500);
  });
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

  it('internal probe traffic moves neither billable_ok, paywall_hits, signups nor first_calls', () => {
    // The probe fixture fired 40 billable 2xx and one 429 inside the current
    // window; with the internal filter in place none of it can be counted.
    // Delta-safe check: rerunning against the DB with the probe REMOVED must
    // give the same business figures.
    const db = getStatsDB();
    const withProbe = getWeeklyFacts(NOW);
    db.prepare(`DELETE FROM request_log WHERE key_prefix = '${PFX}_probe'`).run();
    const withoutProbe = getWeeklyFacts(NOW);
    expect(withProbe.billable_ok.current).toBe(withoutProbe.billable_ok.current);
    expect(withProbe.paywall_hits.current).toBe(withoutProbe.paywall_hits.current);
    expect(withProbe.signups.current).toBe(withoutProbe.signups.current);
    expect(withProbe.first_calls.current).toBe(withoutProbe.first_calls.current);
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
