/**
 * /health is the most consequential endpoint nobody looks at: Railway keeps the
 * container in rotation on its verdict, and the public site quotes its numbers.
 *
 * 🚨 Until 20/08/2026 it proved that ONE database out of three opened.
 * `compliance.sqlite` backs the most expensive endpoint we sell
 * (/v1/iban/compliance, $0.02) and `stats.sqlite` backs quota, credits and
 * every counter — either could be missing, corrupt or unwritable while this
 * answered a confident green. A healthcheck that watches a third of the
 * service does not fail to catch an outage; it converts it into a silent one.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { health } from './health.js';

const app = new Hono();
app.route('/', health);

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

/** A file that is not a SQLite database, in a directory that is thrown away. */
function corruptDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibanforge-health-'));
  const path = join(dir, name);
  writeFileSync(path, 'this is not a sqlite file');
  return path;
}

/**
 * A fresh copy of the module graph, so the database paths — module-level
 * constants read at import time — pick up the env we just set. The instance is
 * disposed afterwards so the corrupt handles never leak into another test.
 */
async function healthWithBrokenDb(envVar: string, fileName: string): Promise<number> {
  vi.resetModules();
  process.env[envVar] = corruptDbPath(fileName);
  const [{ health: freshHealth }, db, compliance] = await Promise.all([
    import('./health.js'),
    import('../lib/db.js'),
    import('../lib/compliance-db.js'),
  ]);
  const isolated = new Hono();
  isolated.route('/', freshHealth);
  try {
    return (await isolated.request('/health')).status;
  } finally {
    db.closeAll();
    compliance.closeComplianceDB();
  }
}

describe('/health', () => {
  it('answers green with every database reachable', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.databases).toEqual({ bic: 'ok', stats: 'ok', compliance: 'ok' });
  });

  /**
   * The response SHAPE is a contract: Railway reads the status code, the site's
   * stats bar reads these fields by name. `databases` was added beside them.
   */
  it('keeps every field the healthcheck and the stats bar already read', async () => {
    const body = (await (await app.request('/health')).json()) as Record<string, unknown>;
    for (const field of [
      'status',
      'version',
      'uptime_seconds',
      'bic_database_entries',
      'ch_clearing_entries',
      'bic_data_last_updated',
    ]) {
      expect(Object.keys(body), field).toContain(field);
    }
    expect(typeof body.bic_database_entries).toBe('number');
    expect(body.bic_database_entries as number).toBeGreaterThan(0);
    expect(typeof body.ch_clearing_entries).toBe('number');
  });

  /**
   * The whole point. Before this change, only the first of these three was
   * red — the two most expensive failures answered 200.
   */
  it.each([
    ['compliance', 'COMPLIANCE_DB_PATH', 'compliance.sqlite'],
    ['stats', 'STATS_DB_PATH', 'stats.sqlite'],
    ['bic', 'BIC_DB_PATH', 'bic.sqlite'],
  ])('goes red when the %s database is unreadable', async (_name, envVar, fileName) => {
    expect(await healthWithBrokenDb(envVar, fileName)).toBe(503);
  });
});
