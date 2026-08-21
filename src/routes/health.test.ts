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

/**
 * The UK modulus table refreshes ONLY at image build. Between deploys it ages
 * with nothing watching: the daily probe checks that a verdict comes back, which
 * a six-month-old table does just as convincingly as a fresh one, while
 * answering wrongly for every sorting code reallocated since. Making the age
 * readable here is what lets anything alert on it.
 */
describe('/health — freshness of the UK modulus table', () => {
  /** A run whose table path points at a file that does not exist. */
  async function healthWithoutUkTable(): Promise<{ status: number; body: Record<string, unknown> }> {
    vi.resetModules();
    process.env.UK_MODULUS_PATH = join(mkdtempSync(join(tmpdir(), 'ibanforge-uk-')), 'absent.json');
    const [{ health: freshHealth }, db, compliance] = await Promise.all([
      import('./health.js'),
      import('../lib/db.js'),
      import('../lib/compliance-db.js'),
    ]);
    const isolated = new Hono();
    isolated.route('/', freshHealth);
    try {
      const res = await isolated.request('/health');
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    } finally {
      db.closeAll();
      compliance.closeComplianceDB();
    }
  }

  it('exposes the age of the table beside the rest', async () => {
    const body = (await (await app.request('/health')).json()) as Record<string, unknown>;
    // Shape only, no value: the table is absent in CI by design (fetched at
    // image build, never committed), so asserting a date here would make this
    // test pass locally and fail in the pipeline.
    expect(Object.keys(body)).toContain('uk_modulus');
    expect(Object.keys(body.uk_modulus as object)).toEqual(
      expect.arrayContaining(['available', 'fetched_on', 'age_days', 'stale']),
    );
  });

  /**
   * The one that matters. The Dockerfile lets the table download fail without
   * failing the build, on purpose: a rotted link must cost the UK check and
   * never the deploy. If its absence could turn this endpoint red, Railway
   * would evict a healthy container over a dataset allowed to be missing —
   * turning a degraded feature into an outage.
   */
  it('stays green with no table at all, and says so instead of claiming fresh', async () => {
    const { status, body } = await healthWithoutUkTable();
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    const uk = body.uk_modulus as Record<string, unknown>;
    expect(uk.available).toBe(false);
    // null, not false: a freshness check that could not run has not passed.
    expect(uk.stale).toBeNull();
  });
});
