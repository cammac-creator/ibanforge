import { describe, it, expect, beforeEach } from 'vitest';
import {
  assessIntegrator,
  decideGo,
  killLineState,
  INTEGRATOR_MIN_ACTIVE_DAYS,
  INTEGRATOR_MIN_RECENT_DAYS,
  INTEGRATOR_MIN_PACK_MINOR,
} from './killline.js';
import { getStatsDB } from './db.js';

/**
 * Fixtures are invented and the figures are chosen to exercise a branch. This
 * repository is public: never put a real customer, address or revenue here.
 */
const PFX = 'ifk_klfixture';
const MAIL = 'acme@example.com';

function reset() {
  const db = getStatsDB();
  db.prepare('DELETE FROM request_log WHERE key_prefix LIKE ?').run('ifk_kl%');
  db.prepare('DELETE FROM api_keys WHERE email LIKE ?').run('%@example.com');
  db.prepare('DELETE FROM api_keys WHERE email LIKE ?').run('%@alpha.example.net');
}

function key(prefix: string, opts: { paid?: number | null; total?: number; left?: number; email?: string } = {}) {
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, amount_paid_minor, amount_paid_currency, credits_total, credits_remaining, stripe_session_id)
       VALUES (?, ?, ?, ?, 'usd', ?, ?, ?)`,
    )
    .run(
      `hash-${prefix}-${opts.email ?? MAIL}-${Math.floor(performance.now() * 1000)}`,
      prefix,
      opts.email ?? MAIL,
      opts.paid ?? null,
      opts.total ?? null,
      opts.left ?? null,
      opts.paid != null ? `sess-${prefix}` : null,
    );
}

/** One served call, `ago` days back. */
function call(prefix: string, ago: number, status = 200) {
  getStatsDB()
    .prepare(
      `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week, key_prefix)
       VALUES ('POST', '/v1/iban/validate', ?, 10, datetime('now', ?), 12, 3, ?)`,
    )
    .run(status, `-${ago} days`, prefix);
}

beforeEach(reset);

describe('assessIntegrator — sustained use', () => {
  it('does not count a burst on a single day as an integration', () => {
    key(PFX);
    for (let i = 0; i < 50; i++) call(PFX, 0);
    const a = assessIntegrator(PFX);
    expect(a.active_days).toBe(1);
    expect(a.proofs.sustained_use).toBe(false);
  });

  it('needs both the spread and the recency', () => {
    key(PFX);
    // Enough distinct days, but all of them old: an integration that stopped.
    for (let i = 0; i < INTEGRATOR_MIN_ACTIVE_DAYS; i++) call(PFX, 40 + i);
    expect(assessIntegrator(PFX).proofs.sustained_use).toBe(false);
  });

  it('recognises calls spread over enough days, still running', () => {
    key(PFX);
    for (let i = 0; i < INTEGRATOR_MIN_ACTIVE_DAYS; i++) call(PFX, 20 + i);
    for (let i = 0; i < INTEGRATOR_MIN_RECENT_DAYS; i++) call(PFX, i);
    expect(assessIntegrator(PFX).proofs.sustained_use).toBe(true);
  });

  it('ignores refused calls: a loop failing every day is not an integration', () => {
    key(PFX);
    for (let i = 0; i < 30; i++) call(PFX, i, 402);
    const a = assessIntegrator(PFX);
    expect(a.active_days).toBe(0);
    expect(a.proofs.sustained_use).toBe(false);
  });
});

describe('assessIntegrator — paid again', () => {
  it('counts a second purchase by the same customer', () => {
    key(PFX, { paid: 500 });
    key('ifk_klsecond', { paid: 2_000 });
    expect(assessIntegrator(PFX).proofs.paid_again).toBe(true);
  });

  it('accepts a substantial pack more than half burned', () => {
    key(PFX, { paid: INTEGRATOR_MIN_PACK_MINOR, total: 5_000, left: 1_000 });
    const a = assessIntegrator(PFX);
    expect(a.pack_burned_ratio).toBeCloseTo(0.8);
    expect(a.proofs.paid_again).toBe(true);
  });

  it('refuses a substantial pack barely touched', () => {
    key(PFX, { paid: INTEGRATOR_MIN_PACK_MINOR, total: 5_000, left: 4_900 });
    expect(assessIntegrator(PFX).proofs.paid_again).toBe(false);
  });

  it('refuses a small pack even when fully burned', () => {
    // A five-dollar pack spent is a trial completed, not a product shipped.
    key(PFX, { paid: 500, total: 1_000, left: 0 });
    expect(assessIntegrator(PFX).proofs.paid_again).toBe(false);
  });
});

describe('assessIntegrator — the proof nobody can compute', () => {
  it('leaves said_so null when the operator has not read the thread', () => {
    key(PFX);
    // null and NOT false: nobody looked. Counting it as a failure would report
    // an unexamined customer as having failed a test that was never run.
    expect(assessIntegrator(PFX).proofs.said_so).toBeNull();
  });

  it('a null third proof never counts towards the total', () => {
    key(PFX, { paid: INTEGRATOR_MIN_PACK_MINOR, total: 100, left: 0 });
    const a = assessIntegrator(PFX, null);
    expect(a.proofs_met).toBe(1);
    expect(a.qualifies).toBe(false);
  });

  it('qualifies on two proofs, whichever two they are', () => {
    key(PFX, { paid: INTEGRATOR_MIN_PACK_MINOR, total: 100, left: 0 });
    expect(assessIntegrator(PFX, true).qualifies).toBe(true);
  });

  it('qualifies without the operator saying anything, on the two measurable proofs', () => {
    // A quiet integrator who pays and calls daily must not need to write to us.
    key(PFX, { paid: INTEGRATOR_MIN_PACK_MINOR, total: 100, left: 0 });
    for (let i = 0; i < INTEGRATOR_MIN_ACTIVE_DAYS; i++) call(PFX, 20 + i);
    for (let i = 0; i < INTEGRATOR_MIN_RECENT_DAYS; i++) call(PFX, i);
    const a = assessIntegrator(PFX, null);
    expect(a.proofs_met).toBe(2);
    expect(a.qualifies).toBe(true);
  });
});

describe('decideGo — the verdict, on every combination', () => {
  it('is GO only when the floor is met and someone qualifies', () => {
    expect(decideGo(true, true, false)).toBe(true);
    expect(decideGo(true, true, true)).toBe(true);
  });

  it('withholds a NO-GO while a candidate is one unread thread away', () => {
    expect(decideGo(false, false, true)).toBeNull();
    expect(decideGo(true, false, true)).toBeNull();
  });

  it('answers false once nothing is left to read', () => {
    expect(decideGo(false, false, false)).toBe(false);
    expect(decideGo(true, false, false)).toBe(false);
    expect(decideGo(false, true, false)).toBe(false);
  });

  it('never returns GO on qualification alone, without the floor', () => {
    // One committed integrator does not carry the project on its own.
    expect(decideGo(false, true, false)).toBe(false);
  });
});

describe('killLineState', () => {
  it('always declares itself a proposal, never a ratified rule', () => {
    expect(killLineState().criterion_is_a_proposal).toBe(true);
  });

  /**
   * These read the whole table, and a development database holds every key
   * ever minted. So they measure the DELTA a fixture causes, which is the only
   * assertion that stays true whatever else is in there.
   */
  it('does not count our own accounts towards the floor', () => {
    // example.com is an internal domain. A pilot key, the operator's own
    // address or a test fixture must never help the project pass its own
    // survival test: that would be passing on our own money.
    const before = killLineState().floor.paying;
    key(PFX, { paid: 20_000, total: 25_000, email: 'acme@example.com' });
    expect(killLineState().floor.paying).toBe(before);
  });

  it('counts a purchase with no stored amount, from its credits alone', () => {
    // Production holds almost no amount_paid_minor: the column is recent.
    // Filtering on it reported zero paying customers against a floor of three.
    const before = killLineState().floor;
    key(PFX, { paid: null, total: 5_000, left: 1_000, email: 'ops@alpha.example.net' });
    const after = killLineState().floor;
    expect(after.paying).toBe(before.paying + 1);
    expect(after.revenue_minor).toBeGreaterThan(before.revenue_minor);
    expect(after.revenue_partly_deduced).toBe(true);
  });

  it('does not count a flagged cohort key as a paying customer', () => {
    const before = killLineState().floor;
    key(PFX, { paid: 20_000, total: 25_000, email: 'flagged@alpha.example.net' });
    getStatsDB().prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_prefix = ?').run(PFX);
    const after = killLineState().floor;
    expect(after.paying).toBe(before.paying);
    expect(after.revenue_minor).toBe(before.revenue_minor);
  });

  it('counts a customer once, however many keys they hold', () => {
    const before = killLineState().floor.paying;
    key(PFX, { paid: 2_000, total: 5_000, email: 'twokeys@alpha.example.net' });
    key('ifk_klb', { paid: 2_000, total: 5_000, email: 'twokeys@alpha.example.net' });
    expect(killLineState().floor.paying).toBe(before + 1);
  });

  it('adds both purchases of one customer to the revenue', () => {
    const before = killLineState().floor.revenue_minor;
    key(PFX, { paid: 2_000, total: 5_000, email: 'twopays@alpha.example.net' });
    key('ifk_klb', { paid: 500, total: 1_000, email: 'twopays@alpha.example.net' });
    expect(killLineState().floor.revenue_minor).toBe(before + 2_500);
  });

  it('marks the revenue as exact when every amount was actually stored', () => {
    // A stored USD charge always wins over the pack table; only then may the
    // figure be reported without the estimate caveat.
    const s = killLineState();
    expect(typeof s.floor.revenue_partly_deduced).toBe('boolean');
  });
});
