import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { getStatsDB } from './db.js';
import { generateApiKey } from './api-keys.js';
import { getNudgeLedger, lastActivationReport, runActivationPass } from './activation-nudge-server.js';
import { apiKeys } from '../routes/api-keys.js';

/**
 * End to end against the real stats database, the way cohort-radar-server.test
 * does it: invented addresses carrying a per-run id, rows antedated by hand
 * (the age window is the whole point of the selection), everything removed in
 * afterAll. The suite runs in a single fork, so a leftover row would follow the
 * next file.
 *
 * The mail relay is NOT configured here, which is exactly what we want to
 * assert: the pass must refuse to claim anyone's single nudge while no mail can
 * leave. Claiming without sending would burn the one message each address ever
 * gets, silently.
 */
const RUN = Date.now();
const DOMAIN = 'alpha.example.net';

const SILENT = `silent-${RUN}@${DOMAIN}`;
const CALLED = `caller-${RUN}@${DOMAIN}`;
const FRESH = `fresh-${RUN}@${DOMAIN}`;
const INTERNAL = `ops-${RUN}@ibanforge.com`;
const PILOT = `alpha-${RUN}-pilot@${DOMAIN}`;

const emails = [SILENT, CALLED, FRESH, INTERNAL, PILOT];
const prefixes = new Map<string, string>();

function mint(email: string, ageHours: number): string {
  const result = generateApiKey(email);
  if (!result) throw new Error(`could not mint ${email}`);
  getStatsDB()
    .prepare(`UPDATE api_keys SET created_at = datetime('now', ?) WHERE key_prefix = ?`)
    .run(`-${ageHours} hours`, result.key_prefix);
  prefixes.set(email, result.key_prefix);
  return result.key_prefix;
}

beforeAll(() => {
  const db = getStatsDB();
  mint(SILENT, 72); // old enough, never called  -> the one candidate
  mint(CALLED, 72); // old enough, but has called -> excluded
  mint(FRESH, 3); // called never, but too young  -> excluded
  mint(INTERNAL, 72); // our own mailbox           -> excluded
  mint(PILOT, 72); // pilot convention             -> excluded

  db.prepare(
    `INSERT INTO request_log (method, path, status, key_prefix, created_at)
     VALUES ('POST', '/v1/iban/validate', 200, ?, datetime('now', '-1 hour'))`,
  ).run(prefixes.get(CALLED));
});

afterAll(() => {
  const db = getStatsDB();
  for (const email of emails) {
    const prefix = prefixes.get(email);
    if (prefix) {
      db.prepare('DELETE FROM api_keys WHERE key_prefix = ?').run(prefix);
      db.prepare('DELETE FROM request_log WHERE key_prefix = ?').run(prefix);
      db.prepare('DELETE FROM activation_nudges WHERE key_prefix = ?').run(prefix);
    }
    db.prepare('DELETE FROM email_messages WHERE customer_email = ?').run(email);
  }
});

describe('the daily first-call pass', () => {
  it('selects the silent key only, and refuses to burn its nudge without a relay', async () => {
    const report = await runActivationPass();

    const mine = report.nudged.filter((n) => n.email.includes(String(RUN)));
    // No relay in the test environment: nothing is claimed, nothing is sent.
    expect(report.nudges_skipped_reason).toBe('mail_not_configured');
    expect(mine).toEqual([]);
    expect(getNudgeLedger(1000).filter((r) => r.email.includes(String(RUN)))).toEqual([]);

    // The selection still ran, and it found one of our five fixtures.
    expect(report.nudge_candidates).toBeGreaterThanOrEqual(1);
  });

  it('publishes a readable report for the admin endpoint', async () => {
    await runActivationPass();
    const { last_run_at, report } = lastActivationReport();
    expect(last_run_at).toBeTruthy();
    expect(report).not.toBeNull();
    expect(typeof report!.nudge_candidates).toBe('number');
    expect(report!.errors).toEqual([]);
  });
});

/**
 * The sending half, with a relay that is "configured" and unreachable.
 *
 * Port 9 is discard: nothing listens, the connection is refused immediately, so
 * sendViaRelay returns false without a single byte leaving the machine. That is
 * the exact production shape of "the relay was down at that minute", and it is
 * what proves the claim-before-send order: the address is spent, marked
 * undelivered, and never written to a second time on its own.
 */
describe('the nudge is claimed once and only once', () => {
  const saved = {
    url: process.env.MAIL_RELAY_URL,
    secret: process.env.MAIL_RELAY_SECRET,
  };
  /**
   * A developer database can hold other silent keys, and a real pass here would
   * spend their one nudge for good. Snapshot what was already claimed, put back
   * exactly that, and the local ledger comes out of the suite untouched.
   */
  let preexisting: Set<string>;

  beforeAll(() => {
    preexisting = new Set(getNudgeLedger(1000).map((r) => r.key_prefix));
    process.env.MAIL_RELAY_URL = 'http://127.0.0.1:9/relay-that-refuses';
    process.env.MAIL_RELAY_SECRET = 'not-a-real-secret';
  });

  afterAll(() => {
    const db = getStatsDB();
    for (const row of getNudgeLedger(1000)) {
      if (!preexisting.has(row.key_prefix)) {
        db.prepare('DELETE FROM activation_nudges WHERE key_prefix = ?').run(row.key_prefix);
      }
    }
    if (saved.url === undefined) delete process.env.MAIL_RELAY_URL;
    else process.env.MAIL_RELAY_URL = saved.url;
    if (saved.secret === undefined) delete process.env.MAIL_RELAY_SECRET;
    else process.env.MAIL_RELAY_SECRET = saved.secret;
  });

  it('claims the silent address, records the failed delivery, and never retries', async () => {
    const first = await runActivationPass();
    const claimed = first.nudged.filter((n) => n.email === SILENT);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].key_prefix).toBe(prefixes.get(SILENT));
    expect(claimed[0].delivered).toBe(false);
    expect(first.nudges_failed).toBeGreaterThanOrEqual(1);

    const ledger = getNudgeLedger(1000).filter((r) => r.email === SILENT);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delivered).toBe(0);

    // Second pass: the address is spent. Nothing is claimed, nothing is sent.
    const second = await runActivationPass();
    expect(second.nudged.filter((n) => n.email === SILENT)).toEqual([]);
    expect(getNudgeLedger(1000).filter((r) => r.email === SILENT)).toHaveLength(1);
  });

  it('never nudges an address that called, is too young, internal or a pilot', async () => {
    await runActivationPass();
    const written = new Set(getNudgeLedger(1000).map((r) => r.email));
    for (const email of [CALLED, FRESH, INTERNAL, PILOT]) {
      expect(written.has(email), `${email} must never receive a nudge`).toBe(false);
    }
  });

  it('reports what it did behind X-Admin-Secret, and nothing without it', async () => {
    await runActivationPass();
    const app = new Hono();
    app.route('/', apiKeys);

    const savedSecret = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = 'correct-horse-battery-staple';
    try {
      const denied = await app.request('/v1/admin/activation-nudges');
      expect(denied.status).toBe(401);

      const res = await app.request('/v1/admin/activation-nudges', {
        headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        nudges_enabled: boolean;
        mail_configured: boolean;
        kill_switch_env: string;
        not_delivered: number;
        ledger: Array<{ email: string; key_prefix: string; delivered: number }>;
      };
      expect(body.nudges_enabled).toBe(true);
      expect(body.mail_configured).toBe(true);
      expect(body.kill_switch_env).toBe('ACTIVATION_NUDGE_DISABLED');
      // The report says WHO, which is the whole point of reading it.
      expect(body.ledger.some((r) => r.email === SILENT)).toBe(true);
      expect(body.not_delivered).toBeGreaterThanOrEqual(1);
    } finally {
      if (savedSecret === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = savedSecret;
    }
  });

  it('goes silent on the kill switch', async () => {
    const before = process.env.ACTIVATION_NUDGE_DISABLED;
    process.env.ACTIVATION_NUDGE_DISABLED = '1';
    try {
      const report = await runActivationPass();
      expect(report.nudges_enabled).toBe(false);
      expect(report.nudges_skipped_reason).toBe('kill_switch');
      expect(report.nudges_sent).toBe(0);
      expect(report.nudged).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.ACTIVATION_NUDGE_DISABLED;
      else process.env.ACTIVATION_NUDGE_DISABLED = before;
    }
  });
});
