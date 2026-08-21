import { describe, expect, it } from 'vitest';
import { BUNDLES } from '../routes/api-keys.js';
import {
  buildBusinessSummary,
  creditPackUsd,
  CREDIT_PACK_USD,
  isDiscoveryPath,
  type BusinessKeyRow,
} from './business-summary.js';

/** Invented fixture; this repo is public and carries no real account. */
function key(over: Partial<BusinessKeyRow> = {}): BusinessKeyRow {
  return {
    key_prefix: 'ifk_test0001',
    email: 'acme@example.com',
    monthly_limit: null,
    credits_total: null,
    credits_remaining: null,
    // Default NULL, like every row minted before the amount was recorded.
    amount_paid_minor: null,
    amount_paid_currency: null,
    used: 0,
    used_all_time: 0,
    series: [0, 0, 0, 0, 0, 0],
    ...over,
  };
}

function summary(keys: BusinessKeyRow[], over: Partial<Parameters<typeof buildBusinessSummary>[0]> = {}) {
  return buildBusinessSummary({
    keys,
    traffic: { total: 0, s402: 0, s4xx: 0, s5xx: 0 },
    paths: [],
    clients: [],
    windowDays: 7,
    ...over,
  });
}

describe('credit pack pricing', () => {
  // The canary. business-summary.ts keeps its own copy of the price table
  // because a lib must not import a route; this is what stops the two from
  // drifting apart in silence.
  it('matches the bundles the payment route actually sells', () => {
    for (const b of Object.values(BUNDLES)) {
      expect(CREDIT_PACK_USD[b.credits]).toBe(b.price_usdc);
    }
    expect(Object.keys(CREDIT_PACK_USD)).toHaveLength(Object.keys(BUNDLES).length);
  });

  it('prices a known pack exactly', () => {
    expect(creditPackUsd(5000)).toEqual({ usd: 20, exact: true });
  });

  it('estimates an unknown pack rather than dropping the customer', () => {
    const out = creditPackUsd(2000);
    expect(out.exact).toBe(false);
    expect(out.usd).toBeGreaterThan(0);
  });
});

describe('credits', () => {
  it('reports what was sold, what was consumed, and how many packs sit idle', () => {
    const s = summary([
      key({ key_prefix: 'ifk_a', email: 'alpha@alpha.example.net', credits_total: 4000, credits_remaining: 1200 }),
      key({ key_prefix: 'ifk_b', email: 'beta@beta.example.net', credits_total: 1000, credits_remaining: 993 }),
    ]);
    expect(s.credits.sold_credits).toBe(5000);
    expect(s.credits.sold_usd).toBe(21);
    expect(s.credits.consumed_credits).toBe(2807);
    expect(s.credits.paying_accounts).toBe(2);
    // The second account bought a thousand credits and used seven: the pack
    // was paid for and never opened, which is the signal worth surfacing.
    expect(s.credits.idle_accounts).toBe(1);
  });

  it('never emits an email address, only a prefix and a domain', () => {
    const s = summary([
      key({ email: 'someone@alpha.example.net', credits_total: 1000, credits_remaining: 0 }),
    ]);
    expect(JSON.stringify(s)).not.toContain('someone@');
    expect(s.credits.accounts[0].domain).toBe('alpha.example.net');
  });

  it('counts a buyer who paid without giving an address, and names them', () => {
    // An agent buying a pack over x402 leaves no email. The CRM folds these
    // into its internal bucket because it has no one to write to; a revenue
    // report must not, or the agent-native bet becomes invisible the day it
    // starts working.
    const s = summary([
      key({ key_prefix: 'ifk_anon', email: 'credits-buyer', credits_total: 1000, credits_remaining: 200 }),
    ]);
    expect(s.credits.paying_accounts).toBe(1);
    expect(s.credits.sold_usd).toBe(5);
    expect(s.credits.accounts[0].domain).toBe('anonyme (x402)');
  });

  it('never prints a blank domain', () => {
    const s = summary([key({ email: 'no-at-sign', credits_total: 1000, credits_remaining: 0 })]);
    expect(s.credits.accounts[0].domain).toBe('sans domaine');
  });

  it('caps the printed list but never the totals, and says how many it dropped', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      key({
        key_prefix: `ifk_${i}`,
        email: `c${i}@alpha.example.net`,
        credits_total: 1000,
        credits_remaining: 0,
      }),
    );
    const s = summary(many);
    expect(s.credits.accounts).toHaveLength(12);
    expect(s.credits.accounts_omitted).toBe(3);
    // Totals still cover all 15.
    expect(s.credits.paying_accounts).toBe(15);
    expect(s.credits.sold_credits).toBe(15000);
    expect(s.credits.consumed_credits).toBe(15000);
  });

  it('leaves operator and test accounts out of the business figures', () => {
    const s = summary([
      key({ email: 'playground@ibanforge.com', credits_total: 25000, credits_remaining: 0, used_all_time: 25000 }),
      key({ email: 'alpha@alpha.example.net', credits_total: 1000, credits_remaining: 500 }),
    ]);
    expect(s.credits.paying_accounts).toBe(1);
    expect(s.credits.sold_credits).toBe(1000);
    expect(s.keys.external).toBe(1);
  });
});

describe('steady unpaid users', () => {
  // The case the daily lifecycle radar cannot see: nothing about this account
  // ever transitions, so it fires no event, yet it is the most engaged unpaid
  // user in the base.
  it('surfaces an account that calls every month and never reaches the cap', () => {
    const s = summary([
      key({
        key_prefix: 'ifk_steady',
        email: 'ops@alpha.example.net',
        used: 44,
        used_all_time: 210,
        series: [0, 0, 31, 82, 53, 44],
      }),
    ]);
    expect(s.steady_unpaid).toHaveLength(1);
    expect(s.steady_unpaid[0].months_active).toBe(4);
    expect(s.steady_unpaid[0].domain).toBe('alpha.example.net');
  });

  it('ignores an account that has gone quiet', () => {
    const s = summary([
      key({ email: 'old@alpha.example.net', used: 0, used_all_time: 210, series: [70, 80, 60, 0, 0, 0] }),
    ]);
    expect(s.steady_unpaid).toHaveLength(0);
  });

  it('ignores a trickle of calls spread over two months', () => {
    // A key with a couple of lifetime calls is not a habit, and listing it
    // beside one with hundreds is how the useful name gets buried.
    const s = summary([
      key({ email: 'trickle@alpha.example.net', used: 1, used_all_time: 2, series: [0, 0, 0, 1, 0, 1] }),
    ]);
    expect(s.steady_unpaid).toHaveLength(0);
  });

  it('ignores a single-month burst', () => {
    const s = summary([
      key({ email: 'once@alpha.example.net', used: 40, used_all_time: 40, series: [0, 0, 0, 0, 0, 40] }),
    ]);
    expect(s.steady_unpaid).toHaveLength(0);
  });

  it('ignores an account that already pays', () => {
    const s = summary([
      key({
        email: 'client@alpha.example.net',
        credits_total: 5000,
        credits_remaining: 100,
        used: 50,
        series: [0, 10, 20, 30, 40, 50],
      }),
    ]);
    expect(s.steady_unpaid).toHaveLength(0);
  });
});

describe('the free-tier wall', () => {
  it('counts a free key sitting on its monthly limit', () => {
    const s = summary([key({ email: 'a@alpha.example.net', monthly_limit: 200, used: 200 })]);
    expect(s.keys.at_cap_this_month).toBe(1);
  });

  it('falls back to the default quota when no limit is stored', () => {
    const s = summary([key({ email: 'a@alpha.example.net', monthly_limit: null, used: 200 })]);
    expect(s.keys.at_cap_this_month).toBe(1);
  });

  it('does not call a credit key capped', () => {
    const s = summary([
      key({ email: 'a@alpha.example.net', monthly_limit: 200, used: 200, credits_total: 5000, credits_remaining: 10 }),
    ]);
    expect(s.keys.at_cap_this_month).toBe(0);
  });

  it('counts keys that were issued and never called', () => {
    const s = summary([
      key({ email: 'a@alpha.example.net', used_all_time: 0 }),
      key({ email: 'b@alpha.example.net', used_all_time: 12, used: 12 }),
    ]);
    expect(s.keys.never_called).toBe(1);
    expect(s.keys.active_this_month).toBe(1);
  });
});

describe('traffic', () => {
  it('keeps 402 out of the error rate', () => {
    const s = summary([], {
      traffic: { total: 1000, s402: 300, s4xx: 340, s5xx: 2 },
    });
    // 40 real 4xx + 2 5xx out of 1000, not 342.
    expect(s.traffic.errors).toBe(42);
    expect(s.traffic.error_pct).toBe(4.2);
    expect(s.traffic.payment_required).toBe(300);
  });

  it('separates catalog reads from API calls', () => {
    const s = summary([], {
      traffic: { total: 100, s402: 0, s4xx: 0, s5xx: 0 },
      paths: [
        { path: '/mcp', count: 40 },
        { path: '/.well-known/x402', count: 10 },
        { path: '/v1/iban/validate', count: 50 },
      ],
    });
    expect(s.traffic.discovery).toBe(50);
    expect(s.traffic.discovery_pct).toBe(50);
  });

  it('classifies well-known paths as discovery whatever their suffix', () => {
    expect(isDiscoveryPath('/.well-known/anything-new')).toBe(true);
    expect(isDiscoveryPath('/v1/bic/:code')).toBe(false);
  });
});

describe('concentration', () => {
  // A weekly total from one customer on two days is a different fact from the
  // same total spread over twenty customers, and the report used to show only
  // the total.
  it('reports distinct clients, active days and the busiest share', () => {
    const s = summary([], {
      clients: [
        { key_prefix: 'ifk_a', calls: 900, active_days: 2 },
        { key_prefix: 'ifk_b', calls: 100, active_days: 6 },
      ],
    });
    expect(s.clients.distinct).toBe(2);
    expect(s.clients.active_days).toBe(6);
    expect(s.clients.top_share_pct).toBe(90);
  });
});

/**
 * The price table answers "what does this pack cost today", never "what did
 * this customer pay". A price change, a discount or a partial refund makes it
 * wrong retroactively across the whole history, and nothing in the report would
 * show it. So a stored amount wins, and a deduction has to say so.
 */
describe('credit revenue prefers what was charged over what the table says', () => {
  const paid = (over = {}) =>
    key({
      key_prefix: 'ifk_test0002',
      // Not the default @example.com, which the internal filter drops.
      email: 'buyer@alpha.example.net',
      credits_total: 1000,
      credits_remaining: 1000,
      ...over,
    });

  it('uses the stored amount when there is one, even when it differs from the table', () => {
    // 1000 credits list at $5. This buyer was charged $3.50 (a discount the
    // table knows nothing about); the report must show what was taken.
    const s = summary([paid({ amount_paid_minor: 350, amount_paid_currency: 'usd' })]);
    expect(s.credits.sold_usd).toBe(3.5);
    expect(s.credits.accounts[0].amount_source).toBe('measured');
    expect(s.credits.sold_usd_deduced_accounts).toBe(0);
  });

  it('falls back to the table for older rows, and counts them as deduced', () => {
    const s = summary([paid()]);
    expect(s.credits.sold_usd).toBe(CREDIT_PACK_USD[1000]);
    expect(s.credits.accounts[0].amount_source).toBe('deduced');
    expect(s.credits.sold_usd_deduced_accounts).toBe(1);
  });

  it('does not read a foreign-currency amount as dollars', () => {
    // Treating 350 minor units of another currency as $3.50 would invent a
    // rate and a date. The table answers instead, and says it did.
    const s = summary([paid({ amount_paid_minor: 350, amount_paid_currency: 'eur' })]);
    expect(s.credits.sold_usd).toBe(CREDIT_PACK_USD[1000]);
    expect(s.credits.accounts[0].amount_source).toBe('deduced');
  });

  /**
   * The two flags answer different questions and must not merge: one is "the
   * table did not know this pack size", the other is "the table answered at
   * all". A measured amount on an unknown pack size is exact AND measured.
   */
  it('keeps the pro-rata estimate flag separate from the deduced count', () => {
    const odd = paid({ credits_total: 3000, credits_remaining: 3000 });
    expect(summary([odd]).credits.sold_usd_is_estimate).toBe(true);

    const measuredOdd = paid({
      credits_total: 3000,
      credits_remaining: 3000,
      amount_paid_minor: 1200,
      amount_paid_currency: 'usd',
    });
    const s = summary([measuredOdd]);
    expect(s.credits.sold_usd).toBe(12);
    expect(s.credits.sold_usd_is_estimate).toBe(false);
    expect(s.credits.sold_usd_deduced_accounts).toBe(0);
  });
});
