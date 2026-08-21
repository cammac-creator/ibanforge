import { describe, it, expect } from 'vitest';
import { getStatsDB } from './db.js';
import { purgeOldRequestLog, purgeTerminatedKeyTelemetry } from './stats.js';

describe('purgeOldRequestLog', () => {
  it('deletes only request_log rows older than the retention window', () => {
    const db = getStatsDB();
    const insert = db.prepare(
      `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week)
       VALUES ('GET', '/retention-test', 200, 1, ?, 0, 0)`,
    );
    insert.run("2020-01-01 00:00:00");
    insert.run(new Date().toISOString().replace('T', ' ').slice(0, 19));

    const before = db
      .prepare(`SELECT COUNT(*) AS n FROM request_log WHERE path = '/retention-test'`)
      .get() as { n: number };
    expect(before.n).toBe(2);

    const purged = purgeOldRequestLog(12);
    expect(purged).toBeGreaterThanOrEqual(1);

    const after = db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_log WHERE path = '/retention-test' AND created_at < datetime('now', '-12 months')`,
      )
      .get() as { n: number };
    expect(after.n).toBe(0);

    // cleanup the fresh row
    db.prepare(`DELETE FROM request_log WHERE path = '/retention-test'`).run();
  });

  it('purges operations rows past the window (invalid-IBAN prefixes live there)', () => {
    const db = getStatsDB();
    const insert = db.prepare(
      `INSERT INTO operations (operation_type, country_code, success, created_at, hour, day_of_week, error_detail)
       VALUES ('retention_test', 'XX', 0, ?, 0, 0, 'XX99RETAIN')`,
    );
    insert.run('2020-01-01 00:00:00');
    insert.run(new Date().toISOString().replace('T', ' ').slice(0, 19));

    purgeOldRequestLog(12);

    const rows = db
      .prepare(`SELECT created_at FROM operations WHERE operation_type = 'retention_test'`)
      .all() as Array<{ created_at: string }>;
    expect(rows).toHaveLength(1); // only the fresh row survives
    db.prepare(`DELETE FROM operations WHERE operation_type = 'retention_test'`).run();
  });

  it('purges feedback rows past the window when the table exists', () => {
    const db = getStatsDB();
    // The route creates this table lazily; mirror its current DDL here.
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        tx_hash TEXT, endpoint TEXT, error_type TEXT, expected TEXT, got TEXT,
        notes TEXT, contact TEXT, agent TEXT, ip_hash TEXT,
        status TEXT NOT NULL DEFAULT 'open'
      );
    `);
    const insert = db.prepare(
      `INSERT INTO feedback (created_at, endpoint, error_type) VALUES (?, '/retention-test', 'other')`,
    );
    insert.run('2020-01-01 00:00:00');
    insert.run(new Date().toISOString().replace('T', ' ').slice(0, 19));

    purgeOldRequestLog(12);

    const rows = db
      .prepare(`SELECT id FROM feedback WHERE endpoint = '/retention-test'`)
      .all();
    expect(rows).toHaveLength(1);
    db.prepare(`DELETE FROM feedback WHERE endpoint = '/retention-test'`).run();
  });

  it('clears raw one-time key views older than 7 days (DPA 4.2)', () => {
    const db = getStatsDB();
    const prefix = `ifk_ret_raw${Date.now()}`.slice(0, 12);
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, active, created_at, raw_key_one_time_view)
       VALUES (?, ?, 'retention-raw@example.com', 1, '2020-01-01 00:00:00', 'ifk_secret_never_retrieved')`,
    ).run(`hash-${prefix}`, prefix);

    purgeOldRequestLog(12);

    const row = db
      .prepare(`SELECT raw_key_one_time_view FROM api_keys WHERE key_prefix = ?`)
      .get(prefix) as { raw_key_one_time_view: string | null };
    expect(row.raw_key_one_time_view).toBeNull();
    db.prepare(`DELETE FROM api_keys WHERE key_prefix = ?`).run(prefix);
  });
});

describe('purgeTerminatedKeyTelemetry (DPA clause 4.7)', () => {
  const RUN = Date.now();

  function seedKey(opts: { prefix: string; email: string; active: number; deactivatedAt: string | null }) {
    const db = getStatsDB();
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, active, deactivated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`hash-${opts.prefix}-${RUN}`, opts.prefix, opts.email, opts.active, opts.deactivatedAt);
  }

  function seedLog(prefix: string) {
    const db = getStatsDB();
    db.prepare(
      `INSERT INTO request_log (method, path, status, response_ms, hour, day_of_week, key_prefix)
       VALUES ('POST', '/dpa47-test', 200, 1, 0, 0, ?)`,
    ).run(prefix);
  }

  function countLogs(prefix: string): number {
    const db = getStatsDB();
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM request_log WHERE key_prefix = ?`).get(prefix) as { n: number }
    ).n;
  }

  function cleanup(prefixes: string[]) {
    const db = getStatsDB();
    for (const p of prefixes) {
      db.prepare(`DELETE FROM request_log WHERE key_prefix = ?`).run(p);
      db.prepare(`DELETE FROM api_keys WHERE key_prefix = ?`).run(p);
    }
  }

  it('deletes telemetry of a key terminated >30 days ago (no active key left)', () => {
    const prefix = `ifk_dpa_old${RUN}`.slice(0, 12);
    seedKey({ prefix, email: `dpa47-old-${RUN}@example.com`, active: 0, deactivatedAt: '2026-01-01 00:00:00' });
    seedLog(prefix);

    purgeTerminatedKeyTelemetry(30);
    expect(countLogs(prefix)).toBe(0);
    cleanup([prefix]);
  });

  it('deletes operations rows of a terminated key too (same clause, same window)', () => {
    const db = getStatsDB();
    const prefix = `ifk_dpa_ops${RUN}`.slice(0, 12);
    seedKey({ prefix, email: `dpa47-ops-${RUN}@example.com`, active: 0, deactivatedAt: '2026-01-01 00:00:00' });
    db.prepare(
      `INSERT INTO operations (operation_type, country_code, success, hour, day_of_week, key_prefix)
       VALUES ('validate', 'CH', 1, 0, 0, ?)`,
    ).run(prefix);

    purgeTerminatedKeyTelemetry(30);
    const n = (
      db.prepare(`SELECT COUNT(*) AS n FROM operations WHERE key_prefix = ?`).get(prefix) as { n: number }
    ).n;
    expect(n).toBe(0);
    cleanup([prefix]);
  });

  it('keeps telemetry inside the 30-day window, and of active keys', () => {
    const recent = `ifk_dpa_rec${RUN}`.slice(0, 12);
    const live = `ifk_dpa_liv${RUN}`.slice(0, 12);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    seedKey({ prefix: recent, email: `dpa47-recent-${RUN}@example.com`, active: 0, deactivatedAt: now });
    seedKey({ prefix: live, email: `dpa47-live-${RUN}@example.com`, active: 1, deactivatedAt: null });
    seedLog(recent);
    seedLog(live);

    purgeTerminatedKeyTelemetry(30);
    expect(countLogs(recent)).toBe(1); // deactivated 0 days ago — countdown running
    expect(countLogs(live)).toBe(1); // active customer — untouched
    cleanup([recent, live]);
  });

  it('does NOT delete history of a customer who merely rotated a key', () => {
    // Same email: old key deactivated long ago, but a fresh key is active —
    // the customer never terminated, their attribution history stays.
    const email = `dpa47-rotate-${RUN}@example.com`;
    const oldKey = `ifk_dpa_rot${RUN}`.slice(0, 12);
    const newKey = `ifk_dpa_new${RUN}`.slice(0, 12);
    seedKey({ prefix: oldKey, email, active: 0, deactivatedAt: '2026-01-01 00:00:00' });
    seedKey({ prefix: newKey, email, active: 1, deactivatedAt: null });
    seedLog(oldKey);

    purgeTerminatedKeyTelemetry(30);
    expect(countLogs(oldKey)).toBe(1);
    cleanup([oldKey, newKey]);
  });

  it('purges placeholder-email keys per key (shared email must not block deletion)', () => {
    // Two anonymous credits buyers share the 'credits-buyer' placeholder.
    // One terminated long ago, one is active — the terminated one's telemetry
    // must still be deleted.
    const gone = `ifk_dpa_gon${RUN}`.slice(0, 12);
    const alive = `ifk_dpa_ali${RUN}`.slice(0, 12);
    seedKey({ prefix: gone, email: 'credits-buyer', active: 0, deactivatedAt: '2026-01-01 00:00:00' });
    seedKey({ prefix: alive, email: 'credits-buyer', active: 1, deactivatedAt: null });
    seedLog(gone);
    seedLog(alive);

    purgeTerminatedKeyTelemetry(30);
    expect(countLogs(gone)).toBe(0);
    expect(countLogs(alive)).toBe(1);
    cleanup([gone, alive]);
  });
});
