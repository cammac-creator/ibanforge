import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import de from '@/messages/de.json';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import type { ActivationClientRow } from '@/components/dashboard/clients-table';
import type { StatusByPathRow } from '@/components/dashboard/status-by-path-table';
import {
  brokenLevel,
  chaseQueue,
  chaseReasonOf,
  daysSince,
  dedupeMarkers,
  externalClients,
  moneySummary,
  parseSqlUtc,
  recentSignups,
  refusalPaths,
  serverErrorPaths,
  trialFunnel,
} from './dashboard-overview';
import type { SignupSources, WebEventsSummary } from './dashboard-overview';

const NOW = new Date('2026-09-01T12:00:00Z');

const CLIENT_DEFAULTS = {
  keys: [],
  signup_at: '2026-08-01 08:00:00',
  source: 'direct',
  first_call_at: null,
  last_seen_at: null,
  calls_90d: 0,
  free_used_month: 0,
  free_quota: 200,
  paywall_hits: 0,
  credits_total: 0,
  credits_remaining: 0,
  packs: 0,
  status: 'new',
} satisfies Omit<ActivationClientRow, 'email'>;

function client(over: Partial<ActivationClientRow> & { email: string }): ActivationClientRow {
  return { ...CLIENT_DEFAULTS, ...over };
}

function pathRow(over: Partial<StatusByPathRow> & { path: string; total: number }): StatusByPathRow {
  return { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, avg_ms: null, ...over };
}

describe('parseSqlUtc', () => {
  it('reads the API SQL format as UTC', () => {
    expect(parseSqlUtc('2026-09-01 06:00:00')?.toISOString()).toBe('2026-09-01T06:00:00.000Z');
  });

  it('does not append a second Z to a value that already carries one', () => {
    // The double-Z is what put production at 500 on 12/08/2026: it yields an
    // Invalid Date, which then renders as NaN in a banner.
    expect(parseSqlUtc('2026-09-01T06:00:00Z')?.toISOString()).toBe('2026-09-01T06:00:00.000Z');
  });

  it('returns null rather than an Invalid Date for junk', () => {
    expect(parseSqlUtc('not a date')).toBeNull();
    expect(parseSqlUtc(null)).toBeNull();
    expect(parseSqlUtc('')).toBeNull();
  });
});

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince('2026-08-30 12:00:00', NOW)).toBe(2);
  });

  it('never goes negative for a timestamp in the future', () => {
    expect(daysSince('2026-09-10 12:00:00', NOW)).toBe(0);
  });

  it('is null when the date cannot be read, never zero', () => {
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe('externalClients', () => {
  it('drops the seeded outreach pilots', () => {
    const rows = externalClients([client({ email: 'acme@example.com' }), client({ email: 'alpha-pilot@example.net' })]);
    expect(rows.map((r) => r.email)).toEqual(['acme@example.com']);
  });
});

describe('dedupeMarkers (ENS-08)', () => {
  it('keeps one label per day', () => {
    const out = dedupeMarkers([
      { date: '2026-09-01', label: 'v1.4.4', kind: 'release' },
      { date: '2026-09-01', label: 'v1.4.4', kind: 'release' },
      { date: '2026-09-01', label: 'v1.4.4', kind: 'release' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('marks a release only on the first day it appears', () => {
    // Four "v1.4.4" over three days is one event. The old page drew a dotted
    // line on nearly every day, which is the same as drawing none.
    const out = dedupeMarkers([
      { date: '2026-08-30', label: 'v1.4.4', kind: 'release' },
      { date: '2026-08-31', label: 'v1.4.4', kind: 'release' },
      { date: '2026-09-01', label: 'v1.4.4', kind: 'release' },
      { date: '2026-09-01', label: 'v1.4.5', kind: 'release' },
    ]);
    expect(out).toEqual([
      { date: '2026-08-30', label: 'v1.4.4', kind: 'release' },
      { date: '2026-09-01', label: 'v1.4.5', kind: 'release' },
    ]);
  });

  it('never folds a hand-written note away', () => {
    const out = dedupeMarkers([
      { date: '2026-08-30', label: 'campagne', kind: 'manual' },
      { date: '2026-09-01', label: 'campagne', kind: 'manual' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('returns markers in date order whatever the input order', () => {
    const out = dedupeMarkers([
      { date: '2026-09-01', label: 'b', kind: 'release' },
      { date: '2026-08-20', label: 'a', kind: 'release' },
    ]);
    expect(out.map((m) => m.date)).toEqual(['2026-08-20', '2026-09-01']);
  });
});

describe('moneySummary', () => {
  const clients = [
    client({ email: 'acme@example.com', packs: 1, credits_total: 5000, credits_remaining: 4500, status: 'paying', last_seen_at: '2026-08-31 10:00:00', first_call_at: '2026-08-02 10:00:00' }),
    client({ email: 'beta@example.net', packs: 2, credits_total: 26_000, credits_remaining: 26_000, status: 'dormant', last_seen_at: '2026-07-02 10:00:00', first_call_at: '2026-07-01 10:00:00' }),
    client({ email: 'gamma@example.org', free_quota: 5000, first_call_at: '2026-08-10 10:00:00', status: 'active' }),
    client({ email: 'delta@example.org', free_quota: 5000, status: 'silent' }),
    client({ email: 'seed-pilot@example.net', packs: 9, credits_total: 99, credits_remaining: 99 }),
  ];

  it('aggregates the credits sold and never consumed', () => {
    const m = moneySummary(clients, NOW);
    expect(m.paying).toBe(2);
    expect(m.packs).toBe(3);
    expect(m.creditsSold).toBe(31_000);
    expect(m.creditsUnused).toBe(30_500);
    expect(m.consumedPct).toBe(2);
  });

  it('excludes the seeded pilots from every money figure', () => {
    const m = moneySummary(clients, NOW);
    expect(m.buyers.map((b) => b.email)).not.toContain('seed-pilot@example.net');
  });

  it('counts pilots by elevated free quota, and how many ever called', () => {
    const m = moneySummary(clients, NOW);
    expect(m.pilots).toBe(2);
    expect(m.activePilots).toBe(1);
  });

  it('separates buyers still calling from buyers gone quiet', () => {
    const m = moneySummary(clients, NOW);
    expect(m.payingActive).toBe(1);
  });

  it('lists buyers most recently active first', () => {
    const m = moneySummary(clients, NOW);
    expect(m.buyers.map((b) => b.email)).toEqual(['acme@example.com', 'beta@example.net']);
    expect(m.buyers[0].idleDays).toBe(1);
  });

  it('says null rather than 100% when nothing has been sold', () => {
    expect(moneySummary([client({ email: 'acme@example.com' })], NOW).consumedPct).toBeNull();
  });
});

describe('chaseReasonOf', () => {
  it('puts a buyer gone quiet in the paid bucket', () => {
    expect(chaseReasonOf(client({ email: 'a@example.com', status: 'dormant', packs: 1 }))).toBe('paid-dormant');
  });

  it('splits silent into never-called and gone-quiet (DASH-10)', () => {
    expect(chaseReasonOf(client({ email: 'a@example.com', status: 'silent' }))).toBe('never-called');
    expect(
      chaseReasonOf(client({ email: 'b@example.com', status: 'silent', first_call_at: '2026-07-01 10:00:00' })),
    ).toBe('gone-quiet');
  });

  it('names the paywall moment', () => {
    expect(chaseReasonOf(client({ email: 'a@example.com', status: 'at-limit' }))).toBe('at-limit');
  });

  it('leaves healthy accounts out of the queue', () => {
    expect(chaseReasonOf(client({ email: 'a@example.com', status: 'active' }))).toBeNull();
    expect(chaseReasonOf(client({ email: 'b@example.com', status: 'paying' }))).toBeNull();
    expect(chaseReasonOf(client({ email: 'c@example.com', status: 'new' }))).toBeNull();
  });
});

describe('chaseQueue', () => {
  const clients = [
    client({ email: 'never@example.com', status: 'silent', signup_at: '2026-08-01 08:00:00' }),
    client({ email: 'quiet@example.com', status: 'silent', first_call_at: '2026-07-01 10:00:00', last_seen_at: '2026-07-20 10:00:00' }),
    client({ email: 'wall@example.com', status: 'at-limit', first_call_at: '2026-08-25 10:00:00', last_seen_at: '2026-08-31 10:00:00' }),
    client({ email: 'buyer@example.com', status: 'dormant', packs: 1, credits_total: 5000, credits_remaining: 4900, last_seen_at: '2026-07-15 10:00:00' }),
    client({ email: 'ok@example.com', status: 'active' }),
  ];

  it('sorts by gravity: money at risk, then the paywall moment, then silence', () => {
    const { rows } = chaseQueue(clients, NOW);
    expect(rows.map((r) => r.reason)).toEqual(['paid-dormant', 'at-limit', 'gone-quiet', 'never-called']);
  });

  it('counts every due row even when the visible queue is capped', () => {
    const many = Array.from({ length: 20 }, (_, i) => client({ email: `c${i}@example.com`, status: 'silent' }));
    const q = chaseQueue(many, NOW, 6);
    expect(q.rows).toHaveLength(6);
    expect(q.total).toBe(20);
    expect(q.byReason['never-called']).toBe(20);
  });

  it('dates a never-called row from its signup, not from a call it never made', () => {
    const { rows } = chaseQueue([clients[0]], NOW);
    expect(rows[0].days).toBe(31);
  });

  it('dates the other rows from the last call', () => {
    const { rows } = chaseQueue([clients[3]], NOW);
    expect(rows[0].days).toBe(48);
  });

  it('ranks unused credits first inside the paid bucket', () => {
    const { rows } = chaseQueue(
      [
        client({ email: 'small@example.com', status: 'dormant', packs: 1, credits_remaining: 10, last_seen_at: '2026-01-01 10:00:00' }),
        client({ email: 'big@example.com', status: 'dormant', packs: 1, credits_remaining: 9000, last_seen_at: '2026-08-25 10:00:00' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.email)).toEqual(['big@example.com', 'small@example.com']);
  });

  it('keeps the seeded pilots out of the queue', () => {
    const q = chaseQueue([client({ email: 'x-pilot@example.net', status: 'silent' })], NOW);
    expect(q.total).toBe(0);
  });
});

describe('recentSignups', () => {
  const clients = [
    client({ email: 'today@example.com', signup_at: '2026-09-01 06:00:00' }),
    client({ email: 'yesterday@example.com', signup_at: '2026-08-31 06:00:00', first_call_at: '2026-08-31 07:00:00' }),
    client({ email: 'old@example.com', signup_at: '2026-07-01 06:00:00' }),
    client({ email: 'undated@example.com', signup_at: 'not a date' }),
    client({ email: 'x-pilot@example.net', signup_at: '2026-09-01 06:00:00' }),
  ];

  it('keeps only the signups of the window, newest first', () => {
    const { rows, total } = recentSignups(clients, NOW);
    expect(rows.map((r) => r.email)).toEqual(['today@example.com', 'yesterday@example.com']);
    expect(total).toBe(2);
  });

  it('says whether each one has called yet', () => {
    const { rows } = recentSignups(clients, NOW);
    expect(rows.map((r) => r.called)).toEqual([false, true]);
  });

  it('does not read an unreadable signup date as "today"', () => {
    expect(recentSignups(clients, NOW).rows.map((r) => r.email)).not.toContain('undated@example.com');
  });
});

describe('trialFunnel (keyless REST trial)', () => {
  const events = (rows: Array<[string, number]>): WebEventsSummary => ({
    days: 30,
    since: '2026-09-06 08:00:00',
    total: rows.reduce((n, [, c]) => n + c, 0),
    by_name: rows.map(([name, count]) => ({ name, count })),
    by_page: [],
    by_referrer: [],
    by_day: [],
  });
  const signups = (rows: Array<[string, number]>): SignupSources => ({
    period_days: 30,
    since: '2026-09-06 08:00:00',
    total: rows.reduce((n, [, n2]) => n + n2, 0),
    channels: rows.map(([channel, n]) => ({ channel, n })),
    landings: [],
    referrers: [],
    campaigns: [],
  });

  it('reads the three steps from the two payloads', () => {
    expect(
      trialFunnel(
        events([
          ['api:trial', 12],
          ['api:trial-exhausted', 3],
          ['cta:try', 40],
        ]),
        signups([
          ['src:api-trial', 2],
          ['direct', 9],
        ]),
      ),
    ).toEqual({ tried: 12, exhausted: 3, keys: 2 });
  });

  it('is zero, never NaN, when a reader came back empty', () => {
    expect(trialFunnel(null, null)).toEqual({ tried: 0, exhausted: 0, keys: 0 });
    expect(trialFunnel(events([['cta:try', 4]]), signups([['direct', 1]]))).toEqual({
      tried: 0,
      exhausted: 0,
      keys: 0,
    });
  });

  it('does not count a landing-page click as a trial', () => {
    // The two vocabularies share one table; only the `api:` names are the API's.
    expect(trialFunnel(events([['cta:key', 99]]), null).tried).toBe(0);
  });
});

describe('serverErrorPaths', () => {
  it('names the paths returning 5xx, worst first', () => {
    const out = serverErrorPaths([
      pathRow({ path: '/v1/iban/validate', total: 100, s2xx: 98, s5xx: 2 }),
      pathRow({ path: '/v1/bic/x', total: 50, s2xx: 40, s5xx: 10 }),
      pathRow({ path: '/health', total: 900, s2xx: 900 }),
    ]);
    expect(out).toEqual([
      { path: '/v1/bic/x', errors: 10, total: 50 },
      { path: '/v1/iban/validate', errors: 2, total: 100 },
    ]);
  });

  it('is empty on a clean day', () => {
    expect(serverErrorPaths([pathRow({ path: '/health', total: 10, s2xx: 10 })])).toEqual([]);
  });
});

describe('refusalPaths (ENS-21)', () => {
  const rows = [
    pathRow({ path: '/v1/bic/:code', total: 1000, s2xx: 100, s4xx: 900 }),
    pathRow({ path: '/v1/iban/validate', total: 1000, s2xx: 950, s4xx: 50 }),
    pathRow({ path: '/v1/rare', total: 4, s2xx: 0, s4xx: 4 }),
  ];

  it('ranks by the share of traffic refused, not by the HTTP class', () => {
    expect(refusalPaths(rows)).toEqual([{ path: '/v1/bic/:code', refused: 900, served: 100, ratio: 90 }]);
  });

  it('ignores a path too small to rank', () => {
    expect(refusalPaths(rows).map((r) => r.path)).not.toContain('/v1/rare');
    expect(refusalPaths(rows, { minTotal: 1 }).map((r) => r.path)).toContain('/v1/rare');
  });
});

describe('brokenLevel', () => {
  const base = { serverErrors: 0, staleSources: 0, unreadable: 0 };

  it('is green only when everything was read and everything is fine', () => {
    expect(brokenLevel(base)).toBe('ok');
  });

  it('never says green when a reader failed (ENS-04 applied to the band)', () => {
    expect(brokenLevel({ ...base, unreadable: 1 })).toBe('unknown');
  });

  it('lets a 5xx outrank everything else', () => {
    expect(brokenLevel({ ...base, serverErrors: 1, staleSources: 3, unreadable: 2 })).toBe('alert');
  });

  it('stays green under a wall of paywall refusals, which is the product working', () => {
    // The billable endpoints refuse most of their traffic every day. Counting
    // that as a fault would light the band amber forever, and a lamp that is
    // always on is not a lamp.
    expect(refusalPaths([pathRow({ path: '/v1/bic/:code', total: 1000, s2xx: 80, s4xx: 920 })])).toHaveLength(1);
    expect(brokenLevel(base)).toBe('ok');
  });

  it('warns on a stale register', () => {
    expect(brokenLevel({ ...base, staleSources: 1 })).toBe('warn');
  });
});

/**
 * Every message key the cockpit actually asks for, in all three languages.
 *
 * The section components cannot be rendered by this suite (vitest here is
 * `environment: 'node'` with no testing-library, and its `include` covers
 * lib/** and app/** only), so `tsc` and the parity check between the three
 * files both pass while a key that exists in NO file would still throw the
 * first time a browser loads the page. This reads the sources, collects every
 * literal handed to a translator, and resolves it — which is the part of a
 * render that can fail on data rather than on types.
 */
describe('the overview asks for keys that exist', () => {
  const dir = new URL('../components/dashboard/overview/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

  /** Keys reached through a template literal, which no regex can enumerate. */
  const DYNAMIC = [
    'chase.reason.paid-dormant',
    'chase.reason.at-limit',
    'chase.reason.gone-quiet',
    'chase.reason.never-called',
    'broken.verdict.ok',
    'broken.verdict.unknown',
    'broken.verdict.warn',
    'broken.verdict.alert',
  ];

  const used = new Set<string>(DYNAMIC);
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\b[to]\('([A-Za-z0-9_.-]+)'/g)) used.add(m[1]);
  }

  function resolve(tree: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], tree);
  }

  it('collected the keys rather than silently finding none', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(used.size).toBeGreaterThan(40);
  });

  it.each([
    ['fr', fr],
    ['en', en],
    ['de', de],
  ])('%s resolves every key the sections ask for', (_lang, tree) => {
    const dash = (tree as { dashboard: Record<string, unknown> }).dashboard;
    const overview = dash.overview as Record<string, unknown>;
    // Either namespace: the detail section reads `dashboard` for the country
    // names it shares with the rest of the app.
    const missing = [...used].filter(
      (k) => typeof resolve(overview, k) !== 'string' && typeof resolve(dash, k) !== 'string',
    );
    expect(missing).toEqual([]);
  });
});
