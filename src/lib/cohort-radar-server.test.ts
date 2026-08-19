import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCohortScan, getCohortRelabels } from './cohort-radar-server.js';
import { generateApiKey, validateApiKey, checkAndIncrementQuota } from './api-keys.js';
import { recordKeyCreation } from './key-creation-guard.js';
import { getStatsDB } from './db.js';

const RUN = Date.now();
const UA = `test-burst-client/${RUN}`;
const HUMAN_UA = `test-human-client/${RUN}`;
const created: string[] = [];

/** Mint a key and log its signup as if it came from this client. */
function signup(localPart: string, ua: string): { prefix: string; key: string } {
  const email = `${localPart}@alpha.example.net`;
  const result = generateApiKey(email);
  if (!result) throw new Error(`could not mint ${email}`);
  created.push(result.key_prefix);
  recordKeyCreation(`cohort-test-${RUN}`, ua, result.key_prefix);
  return { prefix: result.key_prefix, key: result.api_key };
}

/** Machine-made shapes: no vowels, or a long consonant run. */
const MACHINE = ['pwwhqjpghlvj', 'koulnvwrgccu', 'ugmicpdrqxca', 'mnbvpdxndxwv', 'gfdrroavihgz'];
const HUMAN = ['marie.duval', 'jean.bernard', 'paul.henry', 'anne.moreau', 'luc.petit'];

beforeAll(() => {
  MACHINE.forEach((lp) => signup(`${lp}${RUN}`.slice(0, 12), UA));
  HUMAN.forEach((lp) => signup(`${lp}.${RUN}`, HUMAN_UA));
});

afterAll(() => {
  const db = getStatsDB();
  for (const prefix of created) {
    db.prepare('DELETE FROM api_keys WHERE key_prefix = ?').run(prefix);
    db.prepare('DELETE FROM key_creations WHERE key_prefix = ?').run(prefix);
    db.prepare('DELETE FROM cohort_relabels WHERE key_prefix = ?').run(prefix);
  }
});

describe('cohort radar, end to end', () => {
  it('collapses the burst into one dossier and off the monthly reset', async () => {
    const report = await runCohortScan();
    const mine = report.cohorts.find((c) => c.user_agent === UA);
    expect(mine).toBeDefined();
    expect(mine!.keys).toBe(MACHINE.length);
    expect(mine!.address).toContain('@cohorte.invalid');

    const rows = getStatsDB()
      .prepare(
        `SELECT email, no_recredit FROM api_keys WHERE key_prefix IN (${MACHINE.map(() => '?').join(',')})`,
      )
      .all(...created.slice(0, MACHINE.length)) as Array<{ email: string; no_recredit: number }>;
    expect(rows).toHaveLength(MACHINE.length);
    for (const r of rows) {
      expect(r.email).toBe(mine!.address);
      expect(r.no_recredit).toBe(1);
    }
  });

  it('saves an undo trail so a match is reversible', async () => {
    // The first pass already regrouped the burst; the mapping must record each
    // key's real previous address, not the synthetic one.
    const trail = getCohortRelabels();
    const mine = trail.filter((r) => created.slice(0, MACHINE.length).includes(r.key_prefix));
    expect(mine.length).toBe(MACHINE.length);
    for (const r of mine) {
      expect(r.old_email).toContain('@alpha.example.net');
      expect(r.old_email).not.toContain('@cohorte.invalid');
      expect(r.address).toContain('@cohorte.invalid');
    }
  });

  it('leaves the human client untouched', async () => {
    const report = await runCohortScan();
    expect(report.cohorts.find((c) => c.user_agent === HUMAN_UA)).toBeUndefined();
    const rows = getStatsDB()
      .prepare(`SELECT email, no_recredit FROM api_keys WHERE key_prefix IN (${HUMAN.map(() => '?').join(',')})`)
      .all(...created.slice(MACHINE.length)) as Array<{ email: string; no_recredit: number }>;
    for (const r of rows) {
      expect(r.email).not.toContain('@cohorte.invalid');
      expect(r.no_recredit).toBe(0);
    }
  });

  it('is idempotent — a second pass does not re-group what it already grouped', async () => {
    const again = await runCohortScan();
    expect(again.cohorts.find((c) => c.user_agent === UA)).toBeUndefined();
  });

  it('a grouped key measures its ceiling across every month', () => {
    const db = getStatsDB();
    const prefix = created[0];
    const row = db.prepare('SELECT key_hash FROM api_keys WHERE key_prefix = ?').get(prefix) as { key_hash: string };
    db.prepare('INSERT OR REPLACE INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)').run(
      row.key_hash,
      '2000-01',
      200,
    );
    // The flag the radar set is what makes the earlier month still count.
    const q = checkAndIncrementQuota(row.key_hash, 200, 1, true);
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
    db.prepare('DELETE FROM api_usage WHERE key_hash = ? AND month = ?').run(row.key_hash, '2000-01');
  });

  it('never touches a key that carries prepaid credits', async () => {
    const paid = generateApiKey(`paying-${RUN}@alpha.example.net`);
    created.push(paid!.key_prefix);
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 1000, credits_total = 1000 WHERE key_prefix = ?')
      .run(paid!.key_prefix);
    const paidUA = `test-paid-client/${RUN}`;
    for (let i = 0; i < 6; i++) recordKeyCreation(`cohort-test-${RUN}`, paidUA, paid!.key_prefix);

    await runCohortScan();
    const after = validateApiKey(paid!.api_key);
    expect(after.email).toBe(`paying-${RUN}@alpha.example.net`);
    expect(after.noRecredit).toBe(false);
  });
});
