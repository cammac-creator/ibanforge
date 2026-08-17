import { describe, expect, it } from 'vitest';
import { conversionSection, statsSection, weekly } from './weekly-veille.js';

type Row = Parameters<typeof weekly>[0][number];

/** Flat synthetic week; this repo is public and carries no real figure. */
function days(counts: number[], startDay = 1): Row[] {
  return counts.map((total, i) => ({
    date: `2026-03-${String(startDay + i).padStart(2, '0')}`,
    iban_validate: 0,
    iban_batch: 0,
    bic_lookup: 0,
    revenue_usdc: 0,
    revenue_attempted_usdc: 0,
    total_requests: total,
    s2xx: total,
    s4xx: 0,
    s5xx: 0,
  }));
}

describe('the comparison window', () => {
  // The defect this file exists for: /stats/history used to return 8 rows, so
  // slice(-14,-7) left ONE day standing in for a week and a flat week was
  // published as a jump of several hundred percent.
  it('refuses to print a delta when the previous window is a single day', () => {
    const w = weekly(days(Array(8).fill(1000)));
    expect(w.comparable).toBe(false);
    expect(w.reqDelta).toContain('fenêtre incomplète');
    expect(w.reqDelta).toContain('1/7');
    expect(w.reqDelta).not.toMatch(/%/);
  });

  it('does not let a short window inflate the number either', () => {
    // 7 days at 1000 against a single day at 1000 would read as +600%.
    const w = weekly(days(Array(8).fill(1000)));
    expect(w.req).toBe(7000);
    expect(w.reqDelta).not.toContain('600');
  });

  it('compares seven against seven once the history is long enough', () => {
    const w = weekly([...days(Array(7).fill(1000), 1), ...days(Array(7).fill(2000), 8)]);
    expect(w.comparable).toBe(true);
    expect(w.req).toBe(14000);
    expect(w.reqDelta).toBe('+100%');
  });

  it('reports a real drop as a drop', () => {
    const w = weekly([...days(Array(7).fill(2000), 1), ...days(Array(7).fill(1000), 8)]);
    expect(w.reqDelta).toBe('-50%');
  });

  it('says how many days it actually summed', () => {
    expect(weekly(days(Array(14).fill(10))).days).toBe(7);
  });
});

const emptyStats = { total_requests: 0, requests_today: 0, requests_by_path: [] };

describe('the revenue line', () => {
  it('never implies an amount is external when the split is not configured', () => {
    const out = statsSection(emptyStats, weekly(days(Array(14).fill(10))), null, {
      total_received_usdc: 0.226,
      internal_payers_configured: false,
    });
    expect(out).toContain('part de nos tests non départagée');
  });

  it('separates our own test settlements when the split is configured', () => {
    const out = statsSection(emptyStats, weekly(days(Array(14).fill(10))), null, {
      total_received_usdc: 0.2,
      internal_payers_configured: true,
      received_internal_usdc: 0.08,
      received_external_usdc: 0.12,
    });
    expect(out).toContain('de nos propres tests');
    expect(out).toContain('externe réel : $0.120');
  });

  it('says the on-chain figure is missing rather than printing nothing', () => {
    const out = statsSection(emptyStats, weekly(days(Array(14).fill(10))), null, null);
    expect(out).toContain('on-chain non mesuré');
  });
});

const summary = {
  window_days: 7,
  credits: {
    sold_credits: 6000,
    sold_usd: 25,
    sold_usd_is_estimate: false,
    consumed_credits: 300,
    consumption_pct: 5,
    paying_accounts: 2,
    idle_accounts: 1,
    accounts: [
      { key_prefix: 'ifk_a', domain: 'alpha.example.net', sold: 5000, consumed: 298, pct: 6 },
      { key_prefix: 'ifk_b', domain: 'beta.example.net', sold: 1000, consumed: 2, pct: 0.2 },
    ],
    accounts_omitted: 0,
  },
  keys: { total: 20, external: 14, never_called: 4, active_this_month: 5, at_cap_this_month: 1 },
  steady_unpaid: [
    {
      key_prefix: 'ifk_s',
      domain: 'gamma.example.net',
      months_active: 4,
      used_this_month: 44,
      used_all_time: 210,
    },
  ],
  steady_unpaid_omitted: 0,
  clients: { distinct: 2, active_days: 3, top_share_pct: 88 },
  traffic: {
    total: 1000,
    payment_required: 300,
    errors: 42,
    error_pct: 4.2,
    discovery: 310,
    discovery_pct: 31,
  },
};

describe('the conversion block', () => {
  it('leads with what was sold against what was consumed', () => {
    const out = conversionSection(summary);
    // The thousands separator is whatever fr-CH gives this ICU build; the
    // figures are what matter.
    expect(out).toMatch(/Crédits vendus : 6.?000 \(\$25\)/);
    expect(out).toContain('consommés : 300 (5%)');
    expect(out).toContain('1 pack(s) jamais ouvert(s)');
  });

  it('names the steady unpaid user the daily radar cannot see', () => {
    const out = conversionSection(summary);
    expect(out).toContain('gamma.example.net');
    expect(out).toContain("4 mois d'affilée");
  });

  it('identifies accounts by prefix and domain, never by address', () => {
    expect(conversionSection(summary)).not.toContain('@');
  });

  it('says so plainly when the endpoint is down', () => {
    expect(conversionSection(null)).toContain('indisponible');
  });
});

describe('the traffic block', () => {
  it('keeps 402 out of the error line and names it for what it is', () => {
    const out = statsSection(emptyStats, weekly(days(Array(14).fill(10))), summary, null);
    expect(out).toContain('Erreurs hors 402 : 4.2%');
    expect(out).toContain('402 émis : 300');
  });

  it('shows how concentrated the week was', () => {
    const out = statsSection(emptyStats, weekly(days(Array(14).fill(10))), summary, null);
    expect(out).toContain('Clients authentifiés : 2 sur 3 jour(s) actif(s)');
    expect(out).toContain('88% des appels par un seul');
  });

  it('does not attribute billed operations to the authenticated-client count', () => {
    // Billed operations come from the daily stats and count units; the client
    // figures come from the request log and count calls. Putting them on one
    // line would claim those clients made those operations.
    const out = statsSection(emptyStats, weekly(days(Array(14).fill(10))), summary, null);
    const paidLine = out.split('\n').find((l) => l.includes('Appels payants'));
    expect(paidLine).toBeDefined();
    expect(paidLine).not.toContain('client');
  });

  it('separates catalog reads from real API traffic', () => {
    const out = statsSection(emptyStats, weekly(days(Array(14).fill(10))), summary, null);
    expect(out).toContain('Découverte (catalogues, MCP) : 31%');
  });
});
