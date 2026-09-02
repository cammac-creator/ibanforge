import { describe, it, expect, beforeEach } from 'vitest';
import { exportPaidState, restorePaidState, BACKUP_FORMAT } from './backup.js';
import { getStatsDB } from './db.js';

/**
 * THE RESTORE DRILL.
 *
 * This is the point of the whole module. A backup nobody has ever restored is
 * a belief, not a backup, and the day it is needed is the worst possible day
 * to find out which one it was. So the test does the real thing: it takes a
 * dump, destroys the rows, puts them back, and checks that a customer's
 * balance came back intact.
 *
 * Fixtures are invented — this repository is public.
 */
const MAIL = 'acme@example.com';

function seed(prefix: string, credits: number, remaining: number) {
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, credits_total, credits_remaining)
       VALUES (?, ?, ?, 200, ?, ?)`,
    )
    .run(`hash-${prefix}`, prefix, MAIL, credits, remaining);
  getStatsDB()
    .prepare('INSERT OR REPLACE INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)')
    .run(`hash-${prefix}`, '2026-08', 42);
}

function wipe() {
  const db = getStatsDB();
  db.prepare('DELETE FROM api_usage WHERE key_hash LIKE ?').run('hash-ifk_bk%');
  db.prepare('DELETE FROM api_keys WHERE key_prefix LIKE ?').run('ifk_bk%');
}

beforeEach(wipe);

describe('exportPaidState', () => {
  it('carries the balance a customer paid for', () => {
    seed('ifk_bk0001', 5_000, 1_627);
    const dump = exportPaidState('2026-08-21T22:00:00Z');
    const row = dump.api_keys.find((k) => k.key_prefix === 'ifk_bk0001');
    expect(row).toBeTruthy();
    expect(row!.credits_remaining).toBe(1_627);
    expect(dump.counts.api_keys).toBe(dump.api_keys.length);
  });

  it('exports every column, including ones added after this was written', () => {
    seed('ifk_bk0002', 1_000, 1_000);
    const dump = exportPaidState('2026-08-21T22:00:00Z');
    const row = dump.api_keys.find((k) => k.key_prefix === 'ifk_bk0002')!;
    const columns = (
      getStatsDB().prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    // SELECT * on purpose: a hand-written column list would silently stop
    // exporting a new column, and it would only show up on restore day.
    //
    // One column is dropped after the read, deliberately and by name:
    // `raw_key_one_time_view` is a live API key in clear, and a backup is made
    // to be copied off the server (SEC-03, audit 2026-09-01). The guard below
    // still covers every OTHER column, which is what this test exists for; the
    // exclusion has its own tests further down.
    const excluded = ['raw_key_one_time_view'];
    for (const c of columns.filter((name) => !excluded.includes(name))) {
      expect(Object.keys(row)).toContain(c);
    }
  });

  it('stamps the format so a future reader can refuse what it cannot read', () => {
    expect(exportPaidState('2026-08-21T22:00:00Z').format).toBe(BACKUP_FORMAT);
  });
});

describe('restorePaidState — the drill', () => {
  it('gives a customer back exactly what they had, after a total wipe', () => {
    seed('ifk_bk0003', 25_000, 24_940);
    const dump = exportPaidState('2026-08-21T22:00:00Z');

    // The volume is gone.
    wipe();
    expect(
      getStatsDB().prepare("SELECT COUNT(*) n FROM api_keys WHERE key_prefix = 'ifk_bk0003'").get(),
    ).toEqual({ n: 0 });

    const report = restorePaidState(dump);
    expect(report.keys_inserted).toBeGreaterThan(0);

    const back = getStatsDB()
      .prepare(
        "SELECT credits_total, credits_remaining, email FROM api_keys WHERE key_prefix = 'ifk_bk0003'",
      )
      .get() as { credits_total: number; credits_remaining: number; email: string };
    expect(back.credits_total).toBe(25_000);
    expect(back.credits_remaining).toBe(24_940);
    expect(back.email).toBe(MAIL);
  });

  it('brings the month usage back, so a restored key is not handed a free month', () => {
    seed('ifk_bk0004', 1_000, 900);
    const dump = exportPaidState('2026-08-21T22:00:00Z');
    wipe();
    restorePaidState(dump);
    const u = getStatsDB()
      .prepare(
        "SELECT count FROM api_usage WHERE key_hash = 'hash-ifk_bk0004' AND month = '2026-08'",
      )
      .get() as { count: number };
    expect(u.count).toBe(42);
  });

  it('never overwrites a row that is already there', () => {
    seed('ifk_bk0005', 1_000, 1_000);
    const dump = exportPaidState('2026-08-21T22:00:00Z');
    // The customer spent credits since the dump was taken.
    getStatsDB()
      .prepare("UPDATE api_keys SET credits_remaining = 12 WHERE key_prefix = 'ifk_bk0005'")
      .run();

    const report = restorePaidState(dump);
    expect(report.keys_skipped).toBeGreaterThan(0);

    const row = getStatsDB()
      .prepare("SELECT credits_remaining FROM api_keys WHERE key_prefix = 'ifk_bk0005'")
      .get() as { credits_remaining: number };
    // A restore run in a panic against a partly live database must not undo
    // real consumption by pouring an old balance over it.
    expect(row.credits_remaining).toBe(12);
  });

  it('is idempotent: running it twice changes nothing the second time', () => {
    seed('ifk_bk0006', 1_000, 500);
    const dump = exportPaidState('2026-08-21T22:00:00Z');
    wipe();
    const first = restorePaidState(dump);
    const second = restorePaidState(dump);
    expect(first.keys_inserted).toBeGreaterThan(0);
    expect(second.keys_inserted).toBe(0);
    expect(second.keys_skipped).toBe(first.keys_inserted + first.keys_skipped);
  });

  it('refuses a dump whose format it does not know, rather than importing half', () => {
    seed('ifk_bk0007', 1_000, 1_000);
    const dump = exportPaidState('2026-08-21T22:00:00Z');
    wipe();
    expect(() => restorePaidState({ ...dump, format: 999 })).toThrow(/unsupported backup format/);
    // Nothing landed: a partial restore of billing state looks like it worked.
    const n = getStatsDB()
      .prepare("SELECT COUNT(*) n FROM api_keys WHERE key_prefix = 'ifk_bk0007'")
      .get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('survives an empty dump without throwing', () => {
    const empty = {
      format: BACKUP_FORMAT,
      taken_at: 'x',
      counts: { api_keys: 0, api_usage: 0 },
      api_keys: [],
      api_usage: [],
    };
    expect(() => restorePaidState(empty)).not.toThrow();
  });
});

/**
 * A backup is made to be copied off the server. What it carries matters.
 *
 * `SELECT *` swept up `raw_key_one_time_view` — the API key IN CLEAR, held for
 * the few days between a purchase and the buyer collecting it. One admin call
 * therefore returned every uncollected key, in plaintext, next to every
 * customer address, in the one file whose whole purpose is to leave the
 * machine (SEC-03, audit 2026-09-01). Nothing is lost by dropping it: a restore
 * authenticates callers from `key_hash`, which is why the drill above still
 * passes.
 */
describe('exportPaidState — what must never leave the server', () => {
  function seedWithPlaintextKey(prefix: string) {
    getStatsDB()
      .prepare(
        `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, raw_key_one_time_view)
         VALUES (?, ?, ?, 200, ?)`,
      )
      .run(`hash-${prefix}`, prefix, MAIL, `${prefix}_not_a_real_key`);
  }

  it('leaves the plaintext one-time key out of the dump', () => {
    seedWithPlaintextKey('ifk_bk0100');
    const dump = exportPaidState('2026-09-01T21:00:00Z');
    const row = dump.api_keys.find((k) => k.key_prefix === 'ifk_bk0100');
    expect(row, 'the key row itself must still be exported').toBeDefined();
    expect(row!.key_hash, 'the hash is what a restore needs').toBe('hash-ifk_bk0100');
    expect(Object.keys(row!)).not.toContain('raw_key_one_time_view');
    // Belt and braces: not under any other key either.
    expect(JSON.stringify(dump)).not.toContain('_not_a_real_key');
  });

  it('still exports columns nobody remembered to name — the SELECT * doctrine holds', () => {
    seedWithPlaintextKey('ifk_bk0101');
    const dump = exportPaidState('2026-09-01T21:00:00Z');
    const row = dump.api_keys.find((k) => k.key_prefix === 'ifk_bk0101');
    for (const column of ['email', 'monthly_limit', 'credits_remaining', 'created_at']) {
      expect(Object.keys(row!), `column ${column} dropped out of the backup`).toContain(column);
    }
  });

  it('writes one events row per export, with the volume it carried', () => {
    seedWithPlaintextKey('ifk_bk0102');
    const before = (
      getStatsDB()
        .prepare("SELECT COUNT(*) n FROM events WHERE label LIKE 'backup export:%'")
        .get() as { n: number }
    ).n;
    const dump = exportPaidState('2026-09-01T21:00:00Z');
    const after = getStatsDB()
      .prepare(
        "SELECT label FROM events WHERE label LIKE 'backup export:%' ORDER BY id DESC LIMIT 1",
      )
      .get() as { label: string } | undefined;
    const count = (
      getStatsDB()
        .prepare("SELECT COUNT(*) n FROM events WHERE label LIKE 'backup export:%'")
        .get() as { n: number }
    ).n;
    expect(count, 'an export that leaves no trace is an export nobody can audit').toBe(before + 1);
    expect(after!.label).toContain(`${dump.counts.api_keys} keys`);
  });
});
