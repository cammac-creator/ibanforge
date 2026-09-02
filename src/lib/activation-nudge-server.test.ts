import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * A hermetic stats database, and it is load-bearing, not hygiene: the pass
 * under test is CAPPED (NUDGE_MAX_PER_PASS newest-first candidates), and the
 * long-lived developer database holds thousands of leftover keys from earlier
 * suite runs inside the very age window this suite antedates its fixtures
 * into. On such a base the cap is eaten by strangers and the one address this
 * suite promises to claim never reaches the pass — measured at 6,331 window
 * candidates the day this hoist was added. The env must be set before any
 * import touches db.js, whose path constant is read at module load; hence
 * vi.hoisted, not beforeAll.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-nudge-hermetic-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { getStatsDB } from './db.js';
import { ensureAliasTable } from './email-aliases.js';
import { generateApiKey } from './api-keys.js';
import { draftId } from './activation-nudge.js';
import {
  getNudgeLedger,
  lastActivationReport,
  runActivationPass,
} from './activation-nudge-server.js';
import { apiKeys } from '../routes/api-keys.js';
import { rmSync } from 'node:fs';

afterAll(() => {
  // Three files: SQLite in WAL mode keeps -shm and -wal beside the base.
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

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
const WITH_THREAD = `threaded-${RUN}@${DOMAIN}`;
/**
 * The same human, twice, in the two spellings the database really holds: the
 * free-tier mint lowercases, a Stripe key stores whatever customer_details
 * carried. One person must still get one message.
 */
const MIXED_LOWER = `mixed-${RUN}@${DOMAIN}`;
const MIXED_UPPER = `Mixed-${RUN}@${DOMAIN}`;
/** Silent and old enough, but the founder already WROTE to them ('out' row). */
const TALKED = `talked-${RUN}@${DOMAIN}`;
/** Silent and old enough, but the key was minted BY US (issued_by_us = 1). */
const ISSUED = `handed-${RUN}@${DOMAIN}`;
/** One declared person behind two addresses (email_aliases row). */
const ALIAS_CANON = `canon-${RUN}@${DOMAIN}`;
const ALIAS_OTHER = `other-${RUN}@${DOMAIN}`;

const emails = [
  SILENT,
  CALLED,
  FRESH,
  INTERNAL,
  PILOT,
  WITH_THREAD,
  MIXED_LOWER,
  MIXED_UPPER,
  TALKED,
  ISSUED,
  ALIAS_CANON,
  ALIAS_OTHER,
];
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
  // Inside the 48 h draft window, near its old edge on purpose: drafts are
  // served oldest first, so these two are examined whatever else a developer
  // database happens to hold. Still under the nudge threshold, so still no mail.
  mint(FRESH, 47); // never called, but too young to nudge -> draft only
  mint(INTERNAL, 72); // our own mailbox           -> excluded
  mint(PILOT, 72); // pilot convention             -> excluded
  mint(WITH_THREAD, 46); // in the window, but already has a thread -> no draft
  // One human, two spellings -> exactly one nudge. The LOWERCASE key is the
  // newer of the two on purpose: candidates are served newest first, so this is
  // the order in which the marker gets written lowercase and the still-unclaimed
  // key is the mixed-case one. The reverse order hides the bug behind the
  // primary key on key_prefix and the test would pass over a broken guard.
  mint(MIXED_UPPER, 72);
  mint(MIXED_LOWER, 71);

  db.prepare(
    `INSERT INTO request_log (method, path, status, key_prefix, created_at)
     VALUES ('POST', '/v1/iban/validate', 200, ?, datetime('now', '-1 hour'))`,
  ).run(prefixes.get(CALLED));

  db.prepare(
    `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject)
     VALUES (?, ?, 'in', ?, 'Existing conversation')`,
  ).run(`inbound-${RUN}`, WITH_THREAD, new Date().toISOString().slice(0, 16));

  // The founder already wrote to this one — a real 'out' row, not a draft.
  mint(TALKED, 72);
  db.prepare(
    `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject)
     VALUES (?, ?, 'out', ?, 'A personal note')`,
  ).run(`outbound-${RUN}`, TALKED, new Date().toISOString().slice(0, 16));

  // A key we minted and handed over: the flag, not the address, says so.
  mint(ISSUED, 72);
  db.prepare('UPDATE api_keys SET issued_by_us = 1 WHERE key_prefix = ?').run(prefixes.get(ISSUED));

  // One person, two addresses, declared by the operator: one nudge, ever.
  // The alias table self-creates on first READ (ensureAliasTable inside
  // loadAliasMap); a hermetic base has never been read, so create it first.
  ensureAliasTable();
  mint(ALIAS_CANON, 72);
  mint(ALIAS_OTHER, 71);
  db.prepare('INSERT INTO email_aliases (alias, canonical) VALUES (?, ?)').run(
    ALIAS_OTHER,
    ALIAS_CANON,
  );
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
  db.prepare('DELETE FROM email_messages WHERE id = ?').run(`inbound-${RUN}`);
  db.prepare('DELETE FROM email_messages WHERE id = ?').run(`outbound-${RUN}`);
  db.prepare('DELETE FROM email_aliases WHERE alias = ?').run(ALIAS_OTHER);
});

describe('the daily first-call pass', () => {
  it('selects the silent key only, and refuses to burn its nudge without a relay', async () => {
    const report = await runActivationPass();

    const mine = report.nudged.filter((n) => n.email.includes(String(RUN)));
    // No relay in the test environment: nothing is claimed, nothing is sent.
    expect(report.nudges_skipped_reason).toBe('mail_not_configured');
    expect(mine).toEqual([]);
    expect(getNudgeLedger(1000).filter((r) => r.email.includes(String(RUN)))).toEqual([]);

    // The selection still ran, and it found exactly one of our six fixtures.
    expect(report.nudge_candidates).toBeGreaterThanOrEqual(1);
  });

  it('writes a founder draft for a new signup with no thread yet', async () => {
    await runActivationPass();
    const draft = getStatsDB()
      .prepare('SELECT id, direction, subject, body FROM email_messages WHERE customer_email = ?')
      .get(FRESH) as { id: string; direction: string; subject: string; body: string } | undefined;
    expect(draft).toBeDefined();
    expect(draft!.id).toBe(draftId(FRESH));
    expect(draft!.direction).toBe('draft');
    expect(draft!.body).toContain('How did you find us?');
  });

  it('never writes a draft where a conversation already exists', async () => {
    await runActivationPass();
    const rows = getStatsDB()
      .prepare('SELECT direction FROM email_messages WHERE customer_email = ?')
      .all(WITH_THREAD) as Array<{ direction: string }>;
    expect(rows.map((r) => r.direction)).toEqual(['in']);
  });

  it('never writes a draft for an internal or pilot address', async () => {
    await runActivationPass();
    for (const email of [INTERNAL, PILOT]) {
      const row = getStatsDB()
        .prepare('SELECT 1 AS hit FROM email_messages WHERE customer_email = ?')
        .get(email);
      expect(row, `${email} must stay out of the CRM drafts`).toBeUndefined();
    }
  });

  it('never overwrites a draft a human has edited', async () => {
    const db = getStatsDB();
    db.prepare('UPDATE email_messages SET body = ? WHERE id = ?').run(
      'Edited by hand, must survive every pass.',
      draftId(FRESH),
    );
    await runActivationPass();
    const after = db
      .prepare('SELECT body FROM email_messages WHERE id = ?')
      .get(draftId(FRESH)) as { body: string };
    expect(after.body).toBe('Edited by hand, must survive every pass.');
  });

  it('is idempotent: repeated passes create nothing more', async () => {
    const count = () =>
      (
        getStatsDB()
          .prepare(
            `SELECT COUNT(*) AS n FROM email_messages WHERE customer_email LIKE ? AND direction = 'draft'`,
          )
          .get(`%-${RUN}@%`) as { n: number }
      ).n;
    const before = count();
    await runActivationPass();
    await runActivationPass();
    expect(count()).toBe(before);
  });

  it('publishes a readable report for the admin endpoint', async () => {
    await runActivationPass();
    const { last_run_at, report } = lastActivationReport();
    expect(last_run_at).toBeTruthy();
    expect(report).not.toBeNull();
    expect(typeof report!.nudge_candidates).toBe('number');
    expect(typeof report!.drafts_created).toBe('number');
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

  it('treats two spellings of one address as one person', async () => {
    // Two passes, because within a single pass the per-address collapse in
    // selectNudgeCandidates already hides the bug. The hole was in the SQL that
    // asks "have we written to this address before": compared raw, the marker
    // written as `mixed-…` did not match the key stored as `Mixed-…`, and the
    // second pass mailed the same human a second time.
    await runActivationPass();
    await runActivationPass();
    const forThisHuman = getNudgeLedger(1000).filter(
      (r) => r.email.toLowerCase() === MIXED_LOWER.toLowerCase(),
    );
    expect(forThisHuman).toHaveLength(1);
  });

  it('never nudges an address that called, is too young, internal, a pilot, already written to, or holding a key we minted', async () => {
    await runActivationPass();
    const written = new Set(getNudgeLedger(1000).map((r) => r.email));
    for (const email of [CALLED, FRESH, INTERNAL, PILOT, WITH_THREAD, TALKED, ISSUED]) {
      expect(written.has(email), `${email} must never receive a nudge`).toBe(false);
    }
  });

  it('treats two ALIASED addresses as one person', async () => {
    // The operator declared them equivalent; the draft half already honoured
    // it, and one aliased human once got two nudges in a single pass.
    await runActivationPass();
    const written = getNudgeLedger(1000).filter(
      (r) => r.email === ALIAS_CANON || r.email === ALIAS_OTHER,
    );
    expect(written, 'one declared person must hold exactly one nudge').toHaveLength(1);
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
