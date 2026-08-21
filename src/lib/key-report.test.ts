import { describe, it, expect, beforeEach } from 'vitest';
import { getKeyReport, explainStatus, UNUSUAL_NETWORK_COUNT } from './key-report.js';
import { getStatsDB } from './db.js';

/**
 * Fixtures are invented — this repository is public. The prefix below is not a
 * key that ever existed, and the call counts are chosen to exercise a branch,
 * not copied from real traffic.
 */
const PREFIX = 'ifk_testrep0';

function logCall(opts: {
  status?: number;
  path?: string;
  ip?: string | null;
  prefix?: string;
  ago?: number;
}) {
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week, ip_hash, key_prefix)
     VALUES ('POST', ?, ?, 20, datetime('now', ?), 12, 3, ?, ?)`,
  ).run(
    opts.path ?? '/v1/iban/validate',
    opts.status ?? 200,
    `-${opts.ago ?? 0} days`,
    opts.ip === undefined ? 'hash-a' : opts.ip,
    opts.prefix ?? PREFIX,
  );
}

beforeEach(() => {
  getStatsDB().prepare('DELETE FROM request_log WHERE key_prefix LIKE ?').run('ifk_test%');
});

describe('explainStatus', () => {
  it('gives a cause and a fix for the codes a key holder actually meets', () => {
    for (const s of [400, 401, 402, 429, 404, 503]) {
      const e = explainStatus(s, '/v1/iban/validate');
      expect(e.meaning.length).toBeGreaterThan(10);
      expect(e.fix.length).toBeGreaterThan(10);
    }
  });

  it('says nothing it does not know rather than inventing a cause', () => {
    const e = explainStatus(418, '/v1/iban/validate');
    expect(e.meaning).toContain('418');
    expect(e.fix).toBe('');
  });

  it('names our side as the culprit on a server error', () => {
    expect(explainStatus(500, '/x').meaning).toMatch(/ours/);
  });

  /**
   * The customer-facing strings are English on purpose. The site speaks three
   * languages; the API is one surface, and the people holding these keys are
   * Finnish, Spanish and German before they are French.
   */
  it('speaks to the customer in the language of the API', () => {
    const all = [400, 401, 402, 404, 429, 500].flatMap((s) => {
      const e = explainStatus(s, '/v1/iban/validate');
      return [e.meaning, e.fix];
    });
    for (const line of all) {
      expect(line).not.toMatch(/[éèêàçù]/);
    }
  });
});

describe('getKeyReport', () => {
  it('counts only the calls of the presented key', () => {
    logCall({});
    logCall({});
    logCall({ prefix: 'ifk_testother' });
    const r = getKeyReport(PREFIX);
    expect(r.total).toBe(2);
  });

  it('splits served from failed', () => {
    logCall({ status: 200 });
    logCall({ status: 400 });
    logCall({ status: 500 });
    const r = getKeyReport(PREFIX);
    expect(r.total).toBe(3);
    expect(r.ok).toBe(1);
    expect(r.failed).toBe(2);
  });

  it('attaches a readable cause to every error group', () => {
    logCall({ status: 400 });
    logCall({ status: 400 });
    const r = getKeyReport(PREFIX);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].count).toBe(2);
    expect(r.errors[0].meaning).toBeTruthy();
  });

  it('leaves errors empty when nothing failed', () => {
    logCall({ status: 200 });
    expect(getKeyReport(PREFIX).errors).toEqual([]);
  });

  it('honours the window and excludes older calls', () => {
    logCall({ ago: 0 });
    logCall({ ago: 40 });
    expect(getKeyReport(PREFIX, 30).total).toBe(1);
    expect(getKeyReport(PREFIX, 90).total).toBe(2);
  });

  it('reports the footprint as unknown, not clean, for a key that never called', () => {
    const r = getKeyReport('ifk_testnever');
    expect(r.total).toBe(0);
    // null and not false: an unused key has not passed a leak check.
    expect(r.footprint.unusual).toBeNull();
  });

  it('counts distinct networks and stays calm below the threshold', () => {
    logCall({ ip: 'hash-a' });
    logCall({ ip: 'hash-a' });
    logCall({ ip: 'hash-b' });
    const r = getKeyReport(PREFIX);
    expect(r.footprint.distinct_networks).toBe(2);
    expect(r.footprint.unusual).toBe(false);
  });

  it('flags a key seen from more networks than the threshold', () => {
    for (let i = 0; i <= UNUSUAL_NETWORK_COUNT; i++) logCall({ ip: `hash-${i}` });
    const r = getKeyReport(PREFIX);
    expect(r.footprint.distinct_networks).toBe(UNUSUAL_NETWORK_COUNT + 1);
    expect(r.footprint.unusual).toBe(true);
  });

  it('does not count a missing network as a distinct one', () => {
    logCall({ ip: null });
    logCall({ ip: null });
    expect(getKeyReport(PREFIX).footprint.distinct_networks).toBe(0);
  });

  it('ranks endpoints by use', () => {
    logCall({ path: '/v1/iban/validate' });
    logCall({ path: '/v1/iban/validate' });
    logCall({ path: '/v1/bic/AAAACHZZ' });
    const r = getKeyReport(PREFIX);
    expect(r.endpoints[0]).toEqual({ path: '/v1/iban/validate', count: 2 });
  });

  it('returns days sparse, without inventing a zero-filled axis', () => {
    logCall({ ago: 0 });
    logCall({ ago: 2 });
    const r = getKeyReport(PREFIX);
    // Two days with calls, and NOT three: filling the gap is the browser's job,
    // because only it knows the reader's day boundary.
    expect(r.days).toHaveLength(2);
    expect(r.days.every((d) => d.count > 0)).toBe(true);
  });
});
