import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getStatsDB } from './db.js';
import { getActivation } from './activation.js';

/**
 * Fixtures live in the real local stats DB (the whole suite is serialized on
 * it — see vitest.config.ts), so every aggregate assertion is a DELTA between
 * a "before" snapshot and the state after our inserts, never an absolute
 * count. Client-level assertions look up our fixture emails directly.
 *
 * Emails use alpha.example.net: @example.com is matched by INTERNAL_EMAIL_RE,
 * and activation must EXCLUDE internal accounts — one test relies on that.
 */
const PFX = 'ifk_actvt';
const BUYER = 'buyer@alpha.example.net';
const SLEEPER = 'sleeper@alpha.example.net';
const FRESH = 'fresh@alpha.example.net';
const INTERNAL = 'activation-probe@example.com';

function iso(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
const now = Date.now();
const daysAgo = (n: number) => iso(new Date(now - n * 86_400_000));
const month = new Date().toISOString().slice(0, 7);

beforeAll(() => {
  const db = getStatsDB();
  const insKey = db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit, credits_total, credits_remaining, source)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  );
  // BUYER: free key exhausted this month + paid pack key with used-counter at
  // zero by construction (credit keys never touch api_usage). The regression
  // this file exists for: this client must read as paying, never as unused.
  insKey.run(`${PFX}_b_free`, `${PFX}_b_free`, BUYER, daysAgo(10), 200, null, null, 'payqr');
  insKey.run(`${PFX}_b_paid`, `${PFX}_b_paid`, BUYER, daysAgo(2), null, 5000, 2400, null);
  // SLEEPER: bought a pack 20 days ago, never called since day 18.
  insKey.run(`${PFX}_s_paid`, `${PFX}_s_paid`, SLEEPER, daysAgo(20), null, 1000, 1000, null);
  // FRESH: signed up yesterday (Wednesday-independent), no call yet, no source.
  // created_at deliberately in FULL ISO form (T, millis, Z): production rows
  // written by application code carry this format while SQLite defaults write
  // 'YYYY-MM-DD HH:MM:SS' — the aggregation must survive both (it crashed on
  // the double-Z parse the first night it ran).
  insKey.run(
    `${PFX}_f_free`,
    `${PFX}_f_free`,
    FRESH,
    new Date(now - 86_400_000).toISOString(),
    200,
    null,
    null,
    null,
  );
  // INTERNAL: must never appear.
  insKey.run(`${PFX}_i_free`, `${PFX}_i_free`, INTERNAL, daysAgo(5), 200, null, null, null);

  db.prepare(`INSERT OR REPLACE INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)`).run(
    `${PFX}_b_free`,
    month,
    200,
  );

  const insLog = db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix)
     VALUES ('POST', '/v1/iban/validate', ?, 12, ?, ?)`,
  );
  // BUYER free key: first call 9 days ago, then a 429 at quota.
  insLog.run(200, daysAgo(9), `${PFX}_b_free`);
  insLog.run(429, daysAgo(3), `${PFX}_b_free`);
  // BUYER paid key: calls yesterday (this is what keeps them "paying", not "dormant").
  insLog.run(200, daysAgo(1), `${PFX}_b_paid`);
  // SLEEPER: one call 18 days ago, silent since.
  insLog.run(200, daysAgo(18), `${PFX}_s_paid`);
});

afterAll(() => {
  const db = getStatsDB();
  db.prepare(`DELETE FROM request_log WHERE key_prefix LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM api_usage WHERE key_hash LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM api_keys WHERE key_hash LIKE '${PFX}%'`).run();
});

describe('getActivation — per-email aggregation', () => {
  it('a paying client with used=0 on the paid key reads as paying, credits visible', () => {
    const buyer = getActivation(30).clients.find((c) => c.email === BUYER);
    expect(buyer).toBeDefined();
    expect(buyer!.status).toBe('paying');
    expect(buyer!.packs).toBe(1);
    expect(buyer!.credits_total).toBe(5000);
    expect(buyer!.credits_remaining).toBe(2400);
    expect(buyer!.free_used_month).toBe(200);
    expect(buyer!.free_quota).toBe(200);
    expect(buyer!.paywall_hits).toBeGreaterThanOrEqual(1);
    expect(buyer!.source).toBe('payqr');
    expect(buyer!.keys).toHaveLength(2);
  });

  it('a pack owner without a recent call is dormant, never silent/unused', () => {
    const sleeper = getActivation(30).clients.find((c) => c.email === SLEEPER);
    expect(sleeper!.status).toBe('dormant');
    expect(sleeper!.credits_remaining).toBe(1000);
  });

  it('a fresh signup with no call is "new", with source defaulted to direct', () => {
    const fresh = getActivation(30).clients.find((c) => c.email === FRESH);
    expect(fresh!.status).toBe('new');
    expect(fresh!.source).toBe('direct');
    expect(fresh!.first_call_at).toBeNull();
  });

  it('internal accounts are excluded', () => {
    const emails = getActivation(30).clients.map((c) => c.email);
    expect(emails).not.toContain(INTERNAL);
  });

  it('paying clients sort before free ones', () => {
    const clients = getActivation(30).clients;
    const firstFree = clients.findIndex((c) => c.packs === 0);
    const lastPaid = clients.map((c) => c.packs > 0).lastIndexOf(true);
    if (firstFree !== -1 && lastPaid !== -1) expect(lastPaid).toBeLessThan(firstFree);
  });
});

describe('getActivation — funnel, sources, cohorts', () => {
  it('funnel counts our fixtures among the period signups (delta-safe: >=)', () => {
    const f = getActivation(30).funnel;
    expect(f.period_days).toBe(30);
    // Our 3 non-internal fixtures signed up within 30 days.
    expect(f.signed_up).toBeGreaterThanOrEqual(3);
    expect(f.first_call).toBeGreaterThanOrEqual(2); // BUYER + SLEEPER called
    expect(f.hit_limit).toBeGreaterThanOrEqual(1); // BUYER hit 429 + quota
    expect(f.purchased).toBeGreaterThanOrEqual(2); // BUYER + SLEEPER own packs
    expect(f.median_hours_signup_to_first_call).not.toBeNull();
  });

  it('sources roll up with called/paying flags', () => {
    const rows = getActivation(30).sources;
    const payqr = rows.find((r) => r.source === 'payqr');
    expect(payqr).toBeDefined();
    expect(payqr!.signups).toBeGreaterThanOrEqual(1);
    expect(payqr!.called).toBeGreaterThanOrEqual(1);
    expect(payqr!.paying).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.source === 'direct')).toBeDefined();
  });

  it('cohorts cover 8 weeks, week_start is a Monday, our signups are counted', () => {
    const cohorts = getActivation(30).cohorts;
    expect(cohorts).toHaveLength(8);
    for (const c of cohorts) {
      // JS getUTCDay(): Monday = 1.
      expect(new Date(`${c.week_start}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    const total = cohorts.reduce((a, c) => a + c.signups, 0);
    expect(total).toBeGreaterThanOrEqual(3);
  });
});
