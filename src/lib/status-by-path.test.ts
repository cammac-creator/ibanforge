/**
 * Equivalence proof for the `getStatusByPath` rewrite — audit 2026-09-01,
 * findings PERF-06 and PERF-01.
 *
 * The old shape ran three queries, all of them filtering on `created_at` and
 * none of them USING that filter: SQLite chose `idx_request_log_path` to serve
 * `GROUP BY path`, so every call read the whole history instead of the window.
 * `EXPLAIN QUERY PLAN` on a 1 000 000-row projection of the 12-month retention
 * said `SCAN request_log USING INDEX idx_request_log_path`, and the three
 * passes cost 800 + 800 + 800 ms of a SYNCHRONOUS, single-instance event loop.
 *
 * A rewrite of an aggregate is only safe if the payload is proved identical, so
 * the OLD SQL is kept here as the oracle: this file runs both against the same
 * hermetic database and compares the results field by field. If someone ever
 * changes the payload on purpose, this file is where they say so.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rmSync } from 'node:fs';

const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-sbp-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { getStatusByPath, type StatusByPathRow } from './stats.js';
import { getStatsDB, closeAll } from './db.js';

/**
 * The query trio exactly as it stood before the rewrite. Kept verbatim so the
 * comparison below is against the shipped behaviour and not a paraphrase of it.
 */
function legacyStatusByPath(days: number): StatusByPathRow[] {
  const db = getStatsDB();
  const aggregates = db
    .prepare(
      `
    SELECT
      path,
      COUNT(*) as total,
      SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as s2xx,
      SUM(CASE WHEN status >= 300 AND status < 400 THEN 1 ELSE 0 END) as s3xx,
      SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) as s4xx,
      SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) as s5xx,
      ROUND(AVG(response_ms), 0) as avg_ms
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY path
    ORDER BY total DESC
    LIMIT 30
  `,
    )
    .all(days) as Array<Omit<StatusByPathRow, 'by_status' | 'by_method'>>;

  if (aggregates.length === 0) return [];

  const pathPlaceholders = aggregates.map(() => '?').join(',');
  const detailRows = db
    .prepare(
      `
    SELECT path, status, COUNT(*) as n
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
      AND path IN (${pathPlaceholders})
    GROUP BY path, status
  `,
    )
    .all(days, ...aggregates.map((r) => r.path)) as Array<{ path: string; status: number; n: number }>;

  const detailMap = new Map<string, Record<string, number>>();
  for (const r of detailRows) {
    const existing = detailMap.get(r.path) ?? {};
    existing[String(r.status)] = r.n;
    detailMap.set(r.path, existing);
  }

  const methodRows = db
    .prepare(
      `
    SELECT path, method, COUNT(*) as n
    FROM request_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
      AND path IN (${pathPlaceholders})
    GROUP BY path, method
  `,
    )
    .all(days, ...aggregates.map((r) => r.path)) as Array<{ path: string; method: string; n: number }>;

  const methodMap = new Map<string, Record<string, number>>();
  for (const r of methodRows) {
    const existing = methodMap.get(r.path) ?? {};
    existing[r.method] = r.n;
    methodMap.set(r.path, existing);
  }

  return aggregates.map((r) => ({
    ...r,
    by_status: detailMap.get(r.path) ?? {},
    by_method: methodMap.get(r.path) ?? {},
  }));
}

/** Rows are keyed by path so an ordering tie cannot be mistaken for a diff. */
function byPath(rows: StatusByPathRow[]): Map<string, StatusByPathRow> {
  return new Map(rows.map((r) => [r.path, r]));
}

beforeAll(() => {
  const db = getStatsDB();
  const insert = db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`,
  );

  db.transaction(() => {
    // A path seen under three statuses AND two methods: the case the two extra
    // legacy passes existed for.
    for (let i = 0; i < 12; i++) insert.run('POST', '/v1/iban/validate', 200, 3, '-2 days');
    for (let i = 0; i < 5; i++) insert.run('POST', '/v1/iban/validate', 402, 1, '-3 days');
    for (let i = 0; i < 2; i++) insert.run('GET', '/v1/iban/validate', 405, 1, '-4 days');

    // Scanner noise, 4xx only, one method.
    for (let i = 0; i < 9; i++) insert.run('GET', '/wp-admin', 404, 0, '-1 days');

    // 5xx and 3xx, so every counter of the row is exercised.
    for (let i = 0; i < 3; i++) insert.run('GET', '/v1/bic/:code', 500, 120, '-5 days');
    for (let i = 0; i < 4; i++) insert.run('GET', '/v1/bic/:code', 301, 2, '-6 days');

    // A path whose response_ms are ALL NULL: SQL AVG skips NULLs and returns
    // NULL, and the JS fold has to return null too, not 0.
    for (let i = 0; i < 6; i++) insert.run('GET', '/v1/untimed', 200, null, '-2 days');

    // Two paths with the SAME total, to pin the tie-break down.
    for (let i = 0; i < 7; i++) insert.run('GET', '/v1/tie/bravo', 200, 10, '-2 days');
    for (let i = 0; i < 7; i++) insert.run('GET', '/v1/tie/alpha', 200, 10, '-2 days');

    // Outside every window asked for below: proof the date filter is honoured.
    for (let i = 0; i < 500; i++) insert.run('GET', '/v1/ancient', 200, 9, '-200 days');
  })();
});

afterAll(() => {
  closeAll();
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

describe('getStatusByPath — the rewrite returns what the three old queries returned', () => {
  it.each([1, 7, 30, 90])('is field-for-field identical over %i day(s)', (days) => {
    const fresh = byPath(getStatusByPath(days));
    const legacy = byPath(legacyStatusByPath(days));

    expect([...fresh.keys()].sort()).toEqual([...legacy.keys()].sort());
    for (const [path, row] of legacy) {
      expect(fresh.get(path), path).toEqual(row);
    }
  });

  it('reports avg_ms as null for a path with no timed row, exactly as SQL AVG did', () => {
    const row = byPath(getStatusByPath(30)).get('/v1/untimed');
    expect(row?.total).toBe(6);
    expect(row?.avg_ms).toBeNull();
    expect(byPath(legacyStatusByPath(30)).get('/v1/untimed')?.avg_ms).toBeNull();
  });

  it('honours the window: a path only seen 200 days ago is absent from 90 days', () => {
    expect(byPath(getStatusByPath(90)).has('/v1/ancient')).toBe(false);
    // ...and present once the window is wide enough, so the absence above is
    // the filter working and not the row missing.
    expect(byPath(getStatusByPath(300)).has('/v1/ancient')).toBe(true);
  });

  it('breaks ties on path, which SQLite left to the scan order', () => {
    const rows = getStatusByPath(30);
    const alpha = rows.findIndex((r) => r.path === '/v1/tie/alpha');
    const bravo = rows.findIndex((r) => r.path === '/v1/tie/bravo');
    expect(rows[alpha].total).toBe(rows[bravo].total);
    expect(alpha).toBeLessThan(bravo);
  });

  it('keeps every counter consistent with the totals it publishes', () => {
    for (const r of getStatusByPath(30)) {
      expect(r.s2xx + r.s3xx + r.s4xx + r.s5xx).toBe(r.total);
      expect(Object.values(r.by_status).reduce((s, n) => s + n, 0)).toBe(r.total);
      expect(Object.values(r.by_method).reduce((s, n) => s + n, 0)).toBe(r.total);
    }
  });
});

describe('getStatusByPath — the query plan is what the fix is about', () => {
  it('leads with the date, so SQLite searches the window instead of scanning all of history', () => {
    const plan = (
      getStatsDB()
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT path, status, method, COUNT(*) AS n, SUM(response_ms) AS sum_ms,
                  SUM(CASE WHEN response_ms IS NULL THEN 0 ELSE 1 END) AS n_ms
           FROM request_log
           WHERE created_at >= datetime('now', '-' || ? || ' days')
           GROUP BY path, status, method`,
        )
        .all(30) as Array<{ detail: string }>
    )
      .map((r) => r.detail)
      .join(' | ');

    // The regression this guards against is a return to
    // `SCAN request_log USING INDEX idx_request_log_path`, which reads the whole
    // table whatever window was asked for.
    expect(plan).toContain('idx_request_log_date');
    expect(plan).not.toContain('SCAN request_log USING INDEX idx_request_log_path');
  });
});
