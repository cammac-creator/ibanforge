/**
 * The lock on the dashboard's numbers — audit DASH, 2026-09-01.
 *
 * The audit found seven pairs of figures that CONTRADICT EACH OTHER on the same
 * screen: a "Payées" column 35 times the business funnel it sits next to, a Top
 * pays whose leader is the very key farm the panel below it denounces, a KPI
 * series that no longer matched the curve drawn under it, a success rate and an
 * error rate that did not add up to 100 because they were computed over
 * different populations, a funnel step showing 300 %.
 *
 * None of those is a bug in one function. Each is two functions answering the
 * same question with different populations or different windows, and unit tests
 * on either side pass happily while the page lies. So this file asserts the
 * RELATIONS between blocks, on one hermetic database whose contamination is
 * built on purpose: an internal key farm loud enough to dominate every ranking,
 * a handful of real external calls, and the dashboard's own admin traffic.
 *
 * Remove any of the DASH fixes and something here goes red. That is the point.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rmSync } from 'node:fs';

const HERMETIC = vi.hoisted(() => {
  const previous = process.env.STATS_DB_PATH;
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-coherence-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  // The founder's own mailboxes come from the environment; an inherited value
  // would make this file's "external" fixture internal on one machine and not
  // on another. Pin it empty so the classification below is a property of the
  // code under test, never of the shell that ran it.
  process.env.CRM_INTERNAL_EMAILS = '';
  return { path, previous };
});

import {
  getStats,
  getStatsHistory,
  getSourceStats,
  getBusinessFunnel,
  getPatternStats,
  getErrorStats,
  getTypeSuccessRate,
} from './stats.js';
import { getActivation } from './activation.js';
import { isInternalEmail } from './internal-accounts.js';
import { getStatsDB, closeAll } from './db.js';

// Fixture addresses. `alpha.example.net` is the repo's external customer
// domain; `@example.com` is INSIDE the internal pattern, which is exactly why
// it may never be used for a "customer" fixture — see the first test below.
const FARM_EMAIL = 'farm@cohorte.invalid';
const PROBE_EMAIL = 'smoke@example.com';
const CUSTOMER_EMAIL = 'ops@alpha.example.net';
const BUYER_CARD_EMAIL = 'buyer-card@alpha.example.net';
const BUYER_CHAIN_EMAIL = 'buyer-chain@alpha.example.net';

const FARM_PREFIX = 'ibf_farm';
const PROBE_PREFIX = 'ibf_prb';
const CUSTOMER_PREFIX = 'ibf_cust';

/** Farmed volume, big enough that leaving it in changes every ranking. */
const FARM_OPS = 1000;
const PROBE_OPS = 5;
const CUSTOMER_OK = 10;
const CUSTOMER_KO = 2;
/** Admin calls the dashboard makes to render itself. */
const DASHBOARD_CALLS = 40;
const CUSTOMER_BILLABLE_CALLS = 3;
const CUSTOMER_REFUSALS = 4;

beforeAll(() => {
  const db = getStatsDB();

  const key = db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit,
                           credits_total, credits_remaining, stripe_session_id, x402_payment_ref,
                           amount_paid_minor, amount_paid_currency, issued_by_us)
     VALUES (?, ?, ?, datetime('now', '-10 days'), 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  key.run('h-farm', FARM_PREFIX, FARM_EMAIL, 200, null, null, null, null, null, null, 0);
  key.run('h-probe', PROBE_PREFIX, PROBE_EMAIL, 200, null, null, null, null, null, null, 0);
  key.run('h-cust', CUSTOMER_PREFIX, CUSTOMER_EMAIL, 200, null, null, null, null, null, null, 0);
  // Two buyers, two rails, one of each kind of dollar: a receipt the processor
  // reported, and a price the table had to deduce.
  key.run(
    'h-card',
    'ibf_card',
    BUYER_CARD_EMAIL,
    null,
    5000,
    5000,
    'cs_test_alpha',
    null,
    2000,
    'usd',
    0,
  );
  key.run(
    'h-chain',
    'ibf_chain',
    BUYER_CHAIN_EMAIL,
    null,
    1000,
    1000,
    null,
    '0xref-alpha',
    null,
    null,
    0,
  );

  const op = db.prepare(
    `INSERT INTO operations (operation_type, country_code, success, created_at, hour, day_of_week, error_detail, reject_reason, key_prefix)
     VALUES (?, ?, ?, datetime('now', '-1 days'), 12, 1, ?, NULL, ?)`,
  );
  for (let i = 0; i < FARM_OPS; i++) op.run('iban_batch', 'BE', 1, null, FARM_PREFIX);
  for (let i = 0; i < PROBE_OPS; i++) op.run('iban_validate', 'ES', 0, 'ES00', PROBE_PREFIX);
  for (let i = 0; i < CUSTOMER_OK; i++) op.run('iban_validate', 'DE', 1, null, CUSTOMER_PREFIX);
  for (let i = 0; i < CUSTOMER_KO; i++) op.run('iban_validate', null, 0, 'DE00', CUSTOMER_PREFIX);

  // daily_stats deliberately disagrees with `operations`: it is the table the
  // KPI used to read, it has no key_prefix column, and it therefore cannot tell
  // a customer from a farm. If the KPI series ever matches THESE numbers again,
  // it has been wired back to the wrong table.
  db.prepare(
    `INSERT INTO daily_stats (date, operation_type, total, success_count, revenue_usdc)
     VALUES (date('now','-1 days'), 'iban_batch', ?, ?, 0.5)`,
  ).run(FARM_OPS, FARM_OPS);

  const req = db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week, client_kind, key_prefix)
     VALUES (?, ?, ?, 12, datetime('now', '-1 days'), 12, 1, ?, ?)`,
  );
  for (let i = 0; i < DASHBOARD_CALLS; i++) req.run('GET', '/v1/admin/keys', 200, 'browser', null);
  for (let i = 0; i < CUSTOMER_BILLABLE_CALLS; i++)
    req.run('POST', '/v1/iban/validate', 200, 'api', CUSTOMER_PREFIX);
  for (let i = 0; i < CUSTOMER_REFUSALS; i++)
    req.run('POST', '/v1/iban/validate', 402, 'api', CUSTOMER_PREFIX);
  // The farm's own billable success: real HTTP, not market signal. The funnel
  // drops it; "Payées" must drop it too or the two can never be compared.
  req.run('POST', '/v1/iban/validate', 200, 'api', FARM_PREFIX);

  // The last second of the 31st calendar date back — one second before the
  // window the history curve draws. This is the boundary DASH-09 is about: a
  // window bounded on the rolling instant `datetime('now','-30 days')` swallows
  // this row and grows a 31st, partial column under a title that says 30 days,
  // while a window bounded on the calendar date does not. Aligned, the totals
  // below are equal; misaligned, they differ by exactly these two rows.
  const boundary = db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week, client_kind, key_prefix)
     VALUES (?, ?, 200, 12, datetime(date('now', '-29 days'), '-1 second'), 23, 1, 'api', ?)`,
  );
  boundary.run('GET', '/v1/iban/structure', null);
  boundary.run('POST', '/v1/iban/validate', CUSTOMER_PREFIX);
});

afterAll(() => {
  closeAll();
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC.path}${suffix}`, { force: true });
  if (HERMETIC.previous === undefined) delete process.env.STATS_DB_PATH;
  else process.env.STATS_DB_PATH = HERMETIC.previous;
});

describe('the fixture means what it says', () => {
  // Advisory from the review of this work: every assertion below turns on the
  // internal/external split, so a silently misclassified fixture would make the
  // whole file pass for the wrong reason.
  it('classifies the farm and the probe as internal, the customers as external', () => {
    expect(isInternalEmail(FARM_EMAIL)).toBe(true);
    expect(isInternalEmail(PROBE_EMAIL)).toBe(true);
    expect(isInternalEmail(CUSTOMER_EMAIL)).toBe(false);
    expect(isInternalEmail(BUYER_CARD_EMAIL)).toBe(false);
    expect(isInternalEmail(BUYER_CHAIN_EMAIL)).toBe(false);
  });
});

describe('DASH-05 — the KPI series and the curve describe the same population', () => {
  it('reads operations, says so, and counts no internal unit', () => {
    const hist = getStatsHistory(30);
    expect(hist.length).toBeGreaterThan(0);
    for (const d of hist) expect(d.ops_source).toBe('operations');

    const served = hist.reduce((t, d) => t + d.iban_validate + d.iban_batch + d.bic_lookup, 0);
    // Exactly the customer's operations. The farm's 1 000 and the probe's 5 are
    // out; the 1 000 sitting in daily_stats for the same day are out too.
    expect(served).toBe(CUSTOMER_OK + CUSTOMER_KO);
    expect(served).toBeLessThan(FARM_OPS);
  });

  it('publishes what it removed instead of making it vanish', () => {
    const hist = getStatsHistory(30);
    const internal = hist.reduce((t, d) => t + d.ops_internal, 0);
    expect(internal).toBe(FARM_OPS + PROBE_OPS);
  });
});

describe('DASH-04 — the Top pays is not the key farm', () => {
  it('ranks the customer country first and never lists a farm-only country', () => {
    const patterns = getPatternStats(30);
    expect(patterns.top_countries_list).toContain('DE');
    expect(patterns.top_countries_list).not.toContain('BE');
    expect(patterns.top_countries_list).not.toContain('ES');
    for (const row of patterns.geo_trend) {
      expect(Object.keys(row)).not.toContain('BE');
      expect(Object.keys(row)).not.toContain('ES');
    }
  });

  it('agrees with the all-time ranking getStats already decontaminated', () => {
    const fromStats = (getStats().top_countries ?? []).map((c) => c.country);
    expect(fromStats).not.toContain('BE');
    // The two blocks sit on the same page; the period view may hold fewer
    // countries, but it may never hold one the all-time view excludes.
    for (const c of getPatternStats(30).top_countries_list) expect(fromStats).toContain(c);
  });

  it('serves as many countries as the card is willing to draw (DASH-15)', () => {
    const many = getPatternStats(30).top_countries_list;
    expect(many.length).toBeLessThanOrEqual(6);
  });
});

describe('DASH-03 — "Payées" cannot exceed the business funnel beside it', () => {
  it("drops the dashboard's own admin traffic and our own keys", () => {
    const paid = getSourceStats(30).by_client_kind.reduce((t, r) => t + r.paid_calls, 0);
    expect(paid).toBe(CUSTOMER_BILLABLE_CALLS);
    // 40 admin calls + 1 internal billable success are in the log and must not
    // be in this column.
    expect(paid).toBeLessThan(DASHBOARD_CALLS);
  });

  it('holds paid_calls <= funnel success over the same window', () => {
    const paid = getSourceStats(30).by_client_kind.reduce((t, r) => t + r.paid_calls, 0);
    const funnelSuccess = getBusinessFunnel(30).reduce((t, d) => t + d.success, 0);
    expect(paid).toBeLessThanOrEqual(funnelSuccess);
  });
});

describe('DASH-09 — the three "30 days" cover the same 30 days', () => {
  it('gives the channel panel and the history curve the same request total', () => {
    const channels = getSourceStats(30).total_requests;
    const curve = getStatsHistory(30).reduce((t, d) => t + d.total_requests, 0);
    expect(channels).toBe(curve);
  });

  it('never dates the business funnel outside the history window', () => {
    const dates = getStatsHistory(30).map((d) => d.date);
    for (const day of getBusinessFunnel(30)) expect(dates).toContain(day.date);
  });
});

describe('DASH-08 — success rate and error rate add up to 100', () => {
  it('at equal window and equal population', () => {
    const success = getTypeSuccessRate('iban_validate', 30).success_rate;
    const error = getErrorStats(30).error_rate.iban_validate.rate;
    expect(success + error).toBeCloseTo(100, 1);
    // And the population is the customer's, not the probe's: 10 of 12.
    expect(getTypeSuccessRate('iban_validate', 30).total).toBe(CUSTOMER_OK + CUSTOMER_KO);
  });
});

describe('DASH-11 / DASH-18 — the error card and its sparkline', () => {
  it('draws both sparklines on one axis of the requested length', () => {
    const errors = getErrorStats(30);
    expect(errors.error_rate.iban_validate.trend).toHaveLength(30);
    expect(errors.error_rate.bic_lookup.trend).toHaveLength(30);
  });

  it("keeps the probe's failures out of the invalid-IBAN table", () => {
    const prefixes = getErrorStats(30).top_invalid_ibans.map((r) => r.prefix);
    expect(prefixes).toContain('DE00');
    expect(prefixes).not.toContain('ES00');
  });

  it('derives the country from the prefix instead of printing XX everywhere', () => {
    const row = getErrorStats(30).top_invalid_ibans.find((r) => r.prefix === 'DE00');
    expect(row?.country).toBe('DE');
  });
});

describe('DASH-13 — no expected band on the day that has not finished', () => {
  it('leaves the current UTC date without a band', () => {
    const today = new Date().toISOString().slice(0, 10);
    const row = getStatsHistory(30).find((d) => d.date === today);
    if (row) {
      expect(row.expected_min).toBeNull();
      expect(row.expected_max).toBeNull();
    }
  });
});

describe('DASH-06 / DASH-07 — the human funnel', () => {
  it('counts the limit step on the requested window, not the calendar month', () => {
    const { funnel } = getActivation(30);
    expect(funnel.hit_limit_basis).toBe('refusals_402_429_in_window');
    // The customer was refused four times inside the window and holds no pack;
    // api_usage is empty, so the old calendar-month term would have said zero.
    expect(funnel.hit_limit).toBeGreaterThanOrEqual(1);
  });

  it('never lets a step exceed the population it is a share of', () => {
    const { funnel } = getActivation(30);
    for (const step of [funnel.first_call, funnel.hit_limit, funnel.purchased]) {
      expect(step).toBeLessThanOrEqual(funnel.signed_up);
      // The percentage the card prints. Under the old step-over-previous-step
      // rule, 3 buyers over 1 refusal rendered 300 %.
      expect(Math.round((step / Math.max(funnel.signed_up, 1)) * 100)).toBeLessThanOrEqual(100);
    }
  });

  it('says how many clients each median rests on', () => {
    const { funnel } = getActivation(30);
    expect(typeof funnel.median_n_signup_to_first_call).toBe('number');
    expect(typeof funnel.median_n_first_call_to_purchase).toBe('number');
  });

  it('marks the running ISO week as partial (DASH-19)', () => {
    const { cohorts } = getActivation(30);
    expect(cohorts).toHaveLength(8);
    expect(cohorts.filter((c) => c.partial)).toHaveLength(1);
    expect(cohorts[cohorts.length - 1].partial).toBe(true);
  });
});

describe('the clients table and the funnel count the same people', () => {
  it('draws both from one payload', () => {
    const { clients, funnel } = getActivation(30);
    // Every client of the funnel population is a row of the table; the table
    // may be longer (older signups), never shorter.
    expect(clients.length).toBeGreaterThanOrEqual(funnel.signed_up);
    for (const c of clients) expect(isInternalEmail(c.email)).toBe(false);
  });
});
