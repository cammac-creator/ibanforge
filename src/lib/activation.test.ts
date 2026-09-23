import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getStatsDB } from './db.js';
import { getActivation } from './activation.js';

/** Le 200 d'une ligne de journal est un code HTTP, pas un plafond. */
const HTTP_OK = 200;

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
  // `HTTP_OK` plutôt que le littéral : ici 200 est un CODE HTTP, et la garde
  // des promesses de palier ne peut pas distinguer les deux sur une ligne qui
  // porte aussi le mot « free ».
  insLog.run(HTTP_OK, daysAgo(9), `${PFX}_b_free`);
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

/**
 * A subscription is a way of paying. Until 23/09/2026 this module only knew
 * credit packs: a Pro subscriber read as `active`, their subscription key was
 * filed as a free key, and its monthly allowance swelled their free quota (the
 * overview then counted them as a pilot). Fixtures on alpha.example.net, keys
 * under the shared prefix so the file-level afterAll removes them.
 */
describe('getActivation — a subscription is a way of paying', () => {
  const SUBSCRIBER = 'subscriber@alpha.example.net';
  const LEGACY = 'legacy-subscriber@alpha.example.net';
  const CANCELED = 'canceled@alpha.example.net';

  beforeAll(() => {
    const db = getStatsDB();
    const ins = db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit, credits_total, credits_remaining, source, stripe_session_id, stripe_subscription_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    );
    // SUBSCRIBER: a free key first, then a subscription on the same address.
    ins.run(`${PFX}_u_free`, `${PFX}_u_free`, SUBSCRIBER, daysAgo(3), 1, 200, null, null);
    ins.run(
      `${PFX}_u_sub`,
      `${PFX}_u_sub`,
      SUBSCRIBER,
      daysAgo(1),
      1,
      10000,
      'cs_test_alpha',
      'sub_test_alpha',
    );
    // LEGACY: paid through Checkout, no credits, subscription id never stored.
    ins.run(`${PFX}_l_sub`, `${PFX}_l_sub`, LEGACY, daysAgo(4), 1, 10000, 'cs_test_gamma', null);
    // CANCELED: the webhook deactivated the key when the subscription ended.
    ins.run(
      `${PFX}_c_sub`,
      `${PFX}_c_sub`,
      CANCELED,
      daysAgo(40),
      0,
      10000,
      'cs_test_beta',
      'sub_test_beta',
    );
    const log = db.prepare(
      `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix)
       VALUES ('POST', '/v1/iban/validate', ?, 12, ?, ?)`,
    );
    log.run(HTTP_OK, daysAgo(1), `${PFX}_u_sub`);
    log.run(HTTP_OK, daysAgo(2), `${PFX}_l_sub`);
    log.run(HTTP_OK, daysAgo(2), `${PFX}_c_sub`);
  });

  it('reads a live subscriber as paying, the subscription key apart from the free quota', () => {
    const c = getActivation(30).clients.find((x) => x.email === SUBSCRIBER);
    expect(c).toBeDefined();
    expect(c!.subscriber).toBe(true);
    expect(c!.status).toBe('paying');
    // A subscription is not a credit pack, and its allowance is not free.
    expect(c!.packs).toBe(0);
    expect(c!.free_quota).toBe(200);
    expect(c!.keys.find((k) => k.key_prefix === `${PFX}_u_sub`)?.role).toBe('subscription');
    expect(c!.keys.find((k) => k.key_prefix === `${PFX}_u_free`)?.role).toBe('free');
  });

  it('recognises a subscription key by its shape when the subscription id is missing', () => {
    const c = getActivation(30).clients.find((x) => x.email === LEGACY);
    expect(c!.subscriber).toBe(true);
    expect(c!.status).toBe('paying');
    expect(c!.free_quota).toBe(0);
  });

  it('does not keep a canceled subscription as a subscriber', () => {
    const c = getActivation(30).clients.find((x) => x.email === CANCELED);
    expect(c!.subscriber).toBe(false);
    expect(c!.status).not.toBe('paying');
    expect(c!.free_quota).toBe(0);
  });

  it('ranks a subscriber with the paying clients, ahead of a free one', () => {
    const list = getActivation(30).clients;
    const sub = list.findIndex((x) => x.email === SUBSCRIBER);
    const fresh = list.findIndex((x) => x.email === FRESH);
    expect(sub).toBeGreaterThanOrEqual(0);
    expect(fresh).toBeGreaterThanOrEqual(0);
    expect(sub).toBeLessThan(fresh);
  });

  it('counts a subscriber as a purchase in the funnel and in their source row', () => {
    const { funnel, sources, clients } = getActivation(30);
    // The same period rule as the module: signed up inside the window.
    const since = Date.now() - 30 * 86_400_000;
    const inPeriod = (x: { signup_at: string }) =>
      Date.parse(x.signup_at.includes('T') ? x.signup_at : `${x.signup_at.replace(' ', 'T')}Z`) >=
      since;
    const payers = clients.filter((x) => inPeriod(x) && (x.packs > 0 || x.subscriber));
    expect(payers.some((x) => x.email === SUBSCRIBER)).toBe(true);
    expect(funnel.purchased).toBe(payers.length);
    const direct = sources.find((r) => r.source === 'direct');
    expect(direct!.paying).toBe(payers.filter((x) => x.source === 'direct').length);
  });
});
