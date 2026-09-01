/**
 * WAL housekeeping — audit 2026-09-01, finding PERF-09.
 *
 * Nothing in this service ever checkpointed the write-ahead log: `grep -rn
 * wal_checkpoint src/ scripts/` returned nothing, so only SQLite's passive
 * auto-checkpoint at 1 000 pages (4 Mo) ran, and any long-lived reader is
 * enough to keep it from truncating. The developer `stats.sqlite-wal` was
 * already sitting above that threshold. On a Railway volume an unbounded WAL is
 * disk that never comes back.
 *
 * `checkpointStatsWal()` is now called right after the retention purges — the
 * deletions are exactly what fills the log — at boot and on every daily tick
 * (`src/index.ts`).
 *
 * Its own file, and its own database path: the check is a FILE SIZE on disk, so
 * it cannot share a database with a suite that keeps writing to it.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { statSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// vi.hoisted, not beforeAll: db.ts reads STATS_DB_PATH into a module-level
// constant at import time. Built from string parts only — hoisted code runs
// before this file's own imports, so nothing imported is callable in there.
const WAL_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-wal-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { getStatsDB, checkpointStatsWal, closeAll } from './db.js';

afterAll(() => {
  closeAll();
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${WAL_DB}${suffix}`, { force: true });
});

/** Bytes of `stats.sqlite-wal`, 0 when SQLite has truncated it away. */
function walBytes(): number {
  const wal = `${WAL_DB}-wal`;
  return existsSync(wal) ? statSync(wal).size : 0;
}

describe('checkpointStatsWal', () => {
  it('truncates a write-ahead log that has grown', () => {
    const db = getStatsDB();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');

    // Enough rows to push the log well past a page or two. Written in one
    // transaction so nothing else can checkpoint it out from under the test.
    const insert = db.prepare(
      'INSERT INTO request_log (method, path, status, response_ms) VALUES (?, ?, ?, ?)',
    );
    db.transaction(() => {
      for (let i = 0; i < 20_000; i++) insert.run('GET', `/v1/bench/${i % 50}`, 200, i % 40);
    })();

    const before = walBytes();
    expect(before).toBeGreaterThan(0);

    // 🚨 The assertion is the file on disk, not the return value. A BUSY
    // checkpoint reports busy=1 and truncates nothing, so a test that only
    // checked "the call returned" would pass on the exact failure it exists to
    // catch.
    expect(checkpointStatsWal()).toBe(true);
    expect(walBytes()).toBeLessThan(before);
    expect(walBytes()).toBe(0);
  });

  it('leaves the data intact — this is housekeeping, not a purge', () => {
    const db = getStatsDB();
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM request_log WHERE path LIKE '/v1/bench/%'").get() as {
      n: number;
    };
    expect(n).toBe(20_000);
  });

  it('reports failure instead of throwing when the database cannot be reached', async () => {
    // Called from the retention tick and at boot: a broken database must cost a
    // false and a log line, never an exception that takes the boot down.
    vi.resetModules();
    const previous = process.env.STATS_DB_PATH;
    process.env.STATS_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ibanforge-wal-ro-')), 'nope', 'x.sqlite');
    const fresh = await import('./db.js');
    try {
      expect(fresh.checkpointStatsWal()).toBe(false);
    } finally {
      fresh.closeAll();
      process.env.STATS_DB_PATH = previous;
      vi.resetModules();
    }
  });
});
