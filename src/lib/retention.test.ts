import { describe, it, expect } from 'vitest';
import { getStatsDB } from './db.js';
import { purgeOldRequestLog } from './stats.js';

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
});
