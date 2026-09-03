/**
 * Boot survival on an unreadable stats database — audit 2026-09-01, PERF-03.
 *
 * The failure this file locks down was not "a red healthcheck". It was NO
 * healthcheck at all: `src/routes/feedback.ts` calls `getStatsDB()` as a module
 * side effect, so a corrupt `stats.sqlite` threw while `src/app.ts` was still
 * being imported. `serve()` never ran, nothing listened on the port, and
 * `/health` could not answer anything — measured as `curl` exit code 000. At
 * `restartPolicyMaxRetries = 3` Railway then stops restarting, while the only
 * watchdogs we own (`ops-probes`) live inside the process that just died and
 * the two crons that touch the API treat their own failure as non-blocking.
 * Worst case: a month of downtime with every automation green.
 *
 * `entrypoint.sh` is what makes this permanent rather than transient — it
 * deliberately never overwrites `stats.sqlite` (the file holds the API keys),
 * so a corrupt file survives every restart byte for byte. Nothing in that
 * script needs to change; what was missing is a process that stays up long
 * enough to SAY so.
 *
 * Its own file on purpose: the failure is recorded in module-level state inside
 * `db.ts`, and the suite runs single-fork (see vitest.config.ts). Poisoning that
 * state for a neighbouring file would turn every later `/health` red.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

/** 100 bytes of noise: opens as a file, is not a database. */
function corruptStatsDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibanforge-boot-'));
  const path = join(dir, 'stats.sqlite');
  writeFileSync(path, randomBytes(100));
  return path;
}

/** A fresh, valid database the app will initialise at boot: the control case. */
function healthyStatsDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibanforge-boot-ok-'));
  const path = join(dir, 'stats.sqlite');
  // A fresh, valid, empty database: the app creates its schema at boot, as it
  // does on a new volume. It used to copy data/stats.sqlite from the checkout,
  // a file that only existed because the test suite itself had written to it;
  // since every test file opens its own database, nothing creates it any more.
  new Database(path).close();
  return path;
}

interface HealthAnswer {
  status: number;
  body: {
    status?: string;
    message?: string;
    databases?: { bic?: string; stats?: string; compliance?: string };
  };
}

/**
 * Build the WHOLE application on a fresh module graph pointed at `dbPath`, then
 * ask it for /health. `buildApp()` is what imports `feedback.ts`, so this is the
 * import-time crash reproduced end to end and not a hand-made mini-app.
 */
async function bootWith(dbPath: string): Promise<HealthAnswer> {
  vi.resetModules();
  process.env.STATS_DB_PATH = dbPath;
  const [{ buildApp }, db, compliance] = await Promise.all([
    import('../app.js'),
    import('../lib/db.js'),
    import('../lib/compliance-db.js'),
  ]);
  try {
    const app = buildApp();
    const res = await app.request('/health');
    return { status: res.status, body: (await res.json()) as HealthAnswer['body'] };
  } finally {
    db.closeAll();
    compliance.closeComplianceDB();
  }
}

describe('PERF-03 — a corrupt stats database must not kill the boot', () => {
  it('builds the application instead of throwing at import', async () => {
    // The assertion IS "this call returns". Before the fix, the rejection came
    // from the dynamic import itself, several frames before buildApp().
    await expect(bootWith(corruptStatsDb())).resolves.toBeDefined();
  });

  it('answers 503 and names the stats database, with the SQLite cause', async () => {
    const { status, body } = await bootWith(corruptStatsDb());
    expect(status).toBe(503);
    expect(body.status).toBe('error');
    expect(body.databases?.stats).toBe('error');
    // The message is the whole point of the 503: a corrupt file survives every
    // restart, so the diagnosis has to be readable from outside the container.
    // Not the generic 'health_check_failed' this endpoint used to fall back to.
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toBe('health_check_failed');
    expect(body.message?.length).toBeGreaterThan(0);
  });

  it('reports the OTHER two databases separately, instead of condemning all three', async () => {
    const { body } = await bootWith(corruptStatsDb());
    // bic and compliance are untouched by the corrupt stats file, and a reader
    // must be able to tell "one database is gone" from "the volume is gone".
    expect(body.databases?.bic).toBe('ok');
    expect(body.databases?.compliance).toBe('ok');
  });

  it('leaves a healthy database answering exactly as before', async () => {
    const { status, body } = await bootWith(healthyStatsDb());
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.databases).toEqual({ bic: 'ok', stats: 'ok', compliance: 'ok' });
  });
});

describe('PERF-03 — a failed open must not leave a poisoned handle cached', () => {
  it('does not hand the half-initialised connection to the next caller', async () => {
    vi.resetModules();
    process.env.STATS_DB_PATH = corruptStatsDb();
    const db = await import('../lib/db.js');
    try {
      // `openStatsDB` assigns the module-level handle BEFORE the first PRAGMA
      // runs, so without the guard the second call returned that handle happily
      // — a connection whose schema migration never completed. Both calls must
      // throw, and the recorded state must stay negative.
      expect(() => db.getStatsDB()).toThrow();
      expect(() => db.getStatsDB()).toThrow();
      expect(db.getStatsDbState().ok).toBe(false);
      expect(db.getStatsDbState().error).toBeTruthy();
    } finally {
      db.closeAll();
    }
  });

  it('forgets a past failure once the connection is closed', async () => {
    vi.resetModules();
    process.env.STATS_DB_PATH = corruptStatsDb();
    const db = await import('../lib/db.js');
    expect(() => db.getStatsDB()).toThrow();
    db.closeAll();
    // Otherwise a repaired or reseeded file would keep /health red forever.
    expect(db.getStatsDbState().ok).toBe(true);
  });
});
