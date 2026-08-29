import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * A hermetic stats database, same idiom as activation-nudge-server.test.ts and
 * load-bearing for the same reason: this file asserts EXACT percentiles on
 * specific calendar days, and the long-lived developer database holds real
 * rows on any date — enough stray 200s five and six days back to move a p95
 * and conjure a p99 below its sample floor (measured 29/08/2026). The first
 * fix deleted those days from the shared database, which destroys real
 * developer history; owning a private file destroys nothing. The env must be
 * set before any import touches db.js, whose path constant is read at module
 * load; hence vi.hoisted, not beforeAll.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-stats-hermetic-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { stats } from './stats.js';
import { recordRejection, getStatsHistory } from '../lib/stats.js';
import { getStatsDB } from '../lib/db.js';
import type { RejectionRow } from '../lib/stats.js';
import { rmSync } from 'node:fs';

const app = new Hono();
app.route('/', stats);

const TOKEN = 'test-stats-token';
const PREVIOUS = process.env.STATS_TOKEN;

beforeAll(() => {
  process.env.STATS_TOKEN = TOKEN;
});

afterAll(() => {
  if (PREVIOUS === undefined) delete process.env.STATS_TOKEN;
  else process.env.STATS_TOKEN = PREVIOUS;
  // Three files: SQLite in WAL mode keeps -shm and -wal beside the base.
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

describe('GET /stats/rejections', () => {
  it('exige le même Bearer STATS_TOKEN que les autres routes /stats/*', async () => {
    const res = await app.request('/stats/rejections');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('refuse un token faux', async () => {
    const res = await app.request('/stats/rejections', {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(403);
  });

  it('renvoie les catégories de rejet agrégées', async () => {
    recordRejection('bic_lookup', 'normalizable');
    const res = await app.request('/stats/rejections', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { period_days: number; rows: RejectionRow[] };
    expect(body.period_days).toBe(30);
    const row = body.rows.find(
      (r) => r.operation_type === 'bic_lookup' && r.reject_reason === 'normalizable',
    );
    expect(row).toBeDefined();
    expect(row!.count).toBeGreaterThan(0);
  });

  it('borne la fenêtre à 90 jours et retombe sur 30 si le paramètre est illisible', async () => {
    const clamped = await app.request('/stats/rejections?days=999', auth);
    expect(((await clamped.json()) as { period_days: number }).period_days).toBe(90);

    const floored = await app.request('/stats/rejections?days=0', auth);
    expect(((await floored.json()) as { period_days: number }).period_days).toBe(1);

    // `parseInt('abc')` vaut NaN : sans garde, il traverserait Math.max/min et
    // produirait la fenêtre SQL '-NaN days', silencieusement vide.
    const garbage = await app.request('/stats/rejections?days=abc', auth);
    expect(((await garbage.json()) as { period_days: number }).period_days).toBe(30);
  });
});

describe('GET /stats — clean revenue total', () => {
  it('serves total_revenue_usdc_clean, bounded by the raw total', async () => {
    const res = await app.request('/stats', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_revenue_usdc: number;
      total_revenue_usdc_clean: number;
    };
    expect(typeof body.total_revenue_usdc_clean).toBe('number');
    // The clean figure excludes the pre-2026-04-18 drift, so it can never
    // exceed the all-time attempted sum.
    expect(body.total_revenue_usdc_clean).toBeLessThanOrEqual(body.total_revenue_usdc);
  });
});

describe('GET /stats — freshness witness', () => {
  it('serves last_write_at so the dashboard can tell a dead collector from a quiet day', async () => {
    // The hermetic database starts empty, so this test writes the row the
    // witness must notice — which is also the honest shape of the claim: the
    // witness reflects writes, not the accident of a shared file's history.
    getStatsDB()
      .prepare(
        `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week)
         VALUES ('GET', '/freshness-witness-fixture', 200, 1, datetime('now'), 12, 3)`,
      )
      .run();
    const res = await app.request('/stats', auth);
    const body = (await res.json()) as { last_write_at: string | null };
    expect(typeof body.last_write_at).toBe('string');
  });
});

describe('GET /stats/events', () => {
  it('requires the stats token', async () => {
    const res = await app.request('/stats/events');
    expect(res.status).toBe(403);
  });

  it('returns annotation rows', async () => {
    const { recordEvent } = await import('../lib/events.js');
    recordEvent('manual', 'stats-route-events-fixture');
    const res = await app.request('/stats/events?period=7', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ label: string; kind: string }> };
    expect(body.events.some((e) => e.label === 'stats-route-events-fixture')).toBe(true);
    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare(`DELETE FROM events WHERE label = 'stats-route-events-fixture'`).run();
  });
});

describe('GET /stats/history — expected weekday band', () => {
  it('every entry carries expected_min/expected_max fields (null when history is short)', async () => {
    // The history is data-driven, not a calendar spine: an empty hermetic
    // database serves an empty array. One row today gives it one entry.
    getStatsDB()
      .prepare(
        `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week)
         VALUES ('GET', '/weekday-band-fixture', 200, 1, datetime('now'), 12, 3)`,
      )
      .run();
    const res = await app.request('/stats/history?period=7', auth);
    const body = (await res.json()) as Array<{
      date: string;
      expected_min: number | null;
      expected_max: number | null;
    }>;
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect('expected_min' in row).toBe(true);
      expect('expected_max' in row).toBe(true);
    }
  });
});

/**
 * Daily traffic split by caller nature.
 *
 * The whole table hangs on one property: the six natures partition the day, so
 * they must add up to `total`. A reader who can add up the columns can trust
 * the split; one who cannot has no way to tell a missing bucket from a quiet
 * channel.
 */
describe('GET /stats/traffic-trend', () => {
  // A day of its own, for the same reason the percentile tests own theirs:
  // these assert EXACT per-nature counts, and today's row is shared with every
  // other fixture in this file. Days 5 and 6 are taken above.
  const DAY_AGO = 9;
  const CLIENT_PFX = 'ifk_trendclient';
  const INTERNAL_PFX = 'ifk_trendcohort';

  function log(opts: {
    status?: number;
    kind?: string | null;
    key?: string | null;
    ip?: string | null;
    path?: string;
  }) {
    getStatsDB()
      .prepare(
        `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week, client_kind, ip_hash, key_prefix)
         VALUES ('GET', ?, ?, 5, datetime('now', ?), 12, 3, ?, ?, ?)`,
      )
      .run(
        opts.path ?? '/v1/demo',
        opts.status ?? 200,
        `-${DAY_AGO} days`,
        opts.kind ?? null,
        opts.ip ?? null,
        opts.key ?? null,
      );
  }

  const theDay = new Date(Date.now() - DAY_AGO * 86_400_000).toISOString().slice(0, 10);

  type TrendDay = {
    date: string;
    total: number;
    with_key: number;
    agent: number;
    declared_bot: number;
    browser: number;
    anonymous_api: number;
    internal: number;
    not_found: number;
    paywall: number;
    server_error: number;
    distinct_ips: number;
  };

  async function fetchDay(): Promise<TrendDay> {
    const res = await app.request('/stats/traffic-trend?period=30', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { period_days: number; days: TrendDay[] };
    return body.days.find((d) => d.date === theDay)!;
  }

  /**
   * The hermetic database isolates the rows; it does not isolate the ENV.
   * isInternalEmail also honours CRM_INTERNAL_EMAILS, a comma-separated list of
   * fragments matched anywhere in an address — so a machine that has it set to
   * something overlapping the customer fixture would move that key into
   * `internal` and turn `with_key` red for reasons that have nothing to do with
   * this code. Pinned empty here, restored after.
   */
  const PREVIOUS_FRAGMENTS = process.env.CRM_INTERNAL_EMAILS;

  afterAll(() => {
    if (PREVIOUS_FRAGMENTS === undefined) delete process.env.CRM_INTERNAL_EMAILS;
    else process.env.CRM_INTERNAL_EMAILS = PREVIOUS_FRAGMENTS;
  });

  beforeAll(() => {
    process.env.CRM_INTERNAL_EMAILS = '';
    const db = getStatsDB();
    db.prepare("DELETE FROM request_log WHERE date(created_at) = date('now', ?)").run(`-${DAY_AGO} days`);
    // Two keys with contrasting addresses: one customer, one of ours. The
    // cohort suffix is what makes the second internal — see INTERNAL_EMAIL_RE.
    db.prepare('INSERT INTO api_keys (key_hash, key_prefix, email) VALUES (?, ?, ?)').run(
      'hash-trend-client',
      CLIENT_PFX,
      'client-alpha@alpha.example.net',
    );
    db.prepare('INSERT INTO api_keys (key_hash, key_prefix, email) VALUES (?, ?, ?)').run(
      'hash-trend-cohort',
      INTERNAL_PFX,
      'burst-0001@cohorte.invalid',
    );

    // Customers (3). One of them declares a browser user agent: if the query
    // ever forgot `key_prefix IS NULL` on the keyless branches, this row would
    // be counted twice and the sum invariant would catch it.
    log({ key: CLIENT_PFX, ip: 'ip-a' });
    log({ key: CLIENT_PFX, kind: 'api', ip: 'ip-a' });
    log({ key: CLIENT_PFX, kind: 'web', ip: 'ip-b' });
    // Ours (2) — same shape as a customer, told apart only by the address.
    log({ key: INTERNAL_PFX, kind: 'api', ip: 'ip-b' });
    log({ key: INTERNAL_PFX, kind: 'mcp_http', ip: 'ip-b' });
    // Agents (2), one of them turned away at the paywall.
    log({ kind: 'mcp_http', ip: 'ip-c' });
    log({ kind: 'mcp_stdio', status: 402, ip: 'ip-c' });
    // A crawler that says so (1).
    log({ kind: 'bot', ip: 'ip-c' });
    // Browsers (2) — one reading a page, one sweeping for a file we never
    // served. Same nature, and only the status tells them apart.
    log({ kind: 'web', ip: 'ip-c' });
    log({ kind: 'web', status: 404, path: '/package.json', ip: 'ip-c' });
    // Anonymous API (2). The second predates the client_kind column and so
    // carries NULL, not 'api' — it must still be counted somewhere, which is
    // what the terminal ELSE of the CASE guarantees.
    log({ kind: 'api', status: 500, ip: null });
    log({ kind: null, ip: null });
  });

  it('requires the same Bearer STATS_TOKEN as the other /stats/* routes', async () => {
    const res = await app.request('/stats/traffic-trend');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('unauthorized');
  });

  it('refuses a wrong token', async () => {
    const res = await app.request('/stats/traffic-trend', {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(403);
  });

  it('splits the day into six natures that add up to the total', async () => {
    const day = await fetchDay();
    expect(day.total).toBe(12);
    expect(day.with_key).toBe(3);
    expect(day.internal).toBe(2);
    expect(day.agent).toBe(2);
    expect(day.declared_bot).toBe(1);
    expect(day.browser).toBe(2);
    expect(day.anonymous_api).toBe(2);
    // The invariant itself, stated as the reader would check it.
    expect(
      day.with_key + day.internal + day.agent + day.declared_bot + day.browser + day.anonymous_api,
    ).toBe(day.total);
  });

  it('counts our own keys as internal and never as customers', async () => {
    const day = await fetchDay();
    // Two of the internal rows are an api call and an MCP call; neither may
    // reappear in with_key or agent. The named column is the whole point —
    // subtracting them silently is what this endpoint refuses to do.
    expect(day.internal).toBe(2);
    expect(day.with_key).toBe(3);
    expect(day.agent).toBe(2);
  });

  it('reports not_found, paywall and server_error ACROSS the natures, not beside them', async () => {
    const day = await fetchDay();
    // The 404 was issued by a `web` caller: it is inside `browser` AND inside
    // `not_found`. Anyone adding the status columns to the natures would get
    // 15 instead of 12 — which is exactly the misreading the comments guard.
    expect(day.not_found).toBe(1);
    expect(day.paywall).toBe(1);
    expect(day.server_error).toBe(1);
    expect(day.browser).toBe(2);
    expect(day.not_found + day.paywall + day.server_error).toBeLessThan(day.total);
  });

  it('counts distinct IPs and ignores the rows that carry none', async () => {
    const day = await fetchDay();
    // Three hashes over ten rows, plus two rows with no IP at all: COUNT
    // DISTINCT skips NULL, so those two add nothing rather than a phantom.
    expect(day.distinct_ips).toBe(3);
  });

  it('clamps the period to [1, 90] and falls back to 30 on an unreadable one', async () => {
    const clamped = await app.request('/stats/traffic-trend?period=999', auth);
    expect(((await clamped.json()) as { period_days: number }).period_days).toBe(90);

    const floored = await app.request('/stats/traffic-trend?period=0', auth);
    expect(((await floored.json()) as { period_days: number }).period_days).toBe(1);

    const garbage = await app.request('/stats/traffic-trend?period=abc', auth);
    expect(((await garbage.json()) as { period_days: number }).period_days).toBe(30);

    const omitted = await app.request('/stats/traffic-trend', auth);
    expect(((await omitted.json()) as { period_days: number }).period_days).toBe(30);
  });

  it('honours the period: a day outside the window is not served', async () => {
    // The fixture day sits 9 days back, so a 7-day window must not reach it —
    // and a 1-day window is today alone, never yesterday.
    const res = await app.request('/stats/traffic-trend?period=7', auth);
    const body = (await res.json()) as { days: TrendDay[] };
    expect(body.days.some((d) => d.date === theDay)).toBe(false);
  });
});

/**
 * Served latency on the public status page.
 *
 * Percentiles and not a mean: one slow outlier moves a mean and moves nobody's
 * experience. And a percentile over a handful of samples is noise wearing a
 * number's clothes, which on a page customers are invited to trust is worse
 * than an honest gap.
 */
describe('getStatsHistory — served latency', () => {
  const PFX = 'ifk_lattest';

  function log(status: number, ms: number, ago = 0) {
    getStatsDB()
      .prepare(
        `INSERT INTO request_log (method, path, status, response_ms, created_at, hour, day_of_week, key_prefix)
         VALUES ('POST', '/v1/iban/validate', ?, ?, datetime('now', ?), 12, 3, ?)`,
      )
      .run(status, ms, `-${ago} days`, PFX);
  }

  beforeEach(() => {
    getStatsDB().prepare('DELETE FROM request_log WHERE key_prefix = ?').run(PFX);
  });

  /**
   * These measure the EFFECT of a fixture, not an absolute value: today's row
   * is shared with whatever else this suite writes, so asserting a number
   * would describe the neighbours as much as the fixture.
   */
  it('never lets a refused request make the service look fast', () => {
    // A 402 answered in one millisecond by the paywall is not evidence of
    // speed. Counting it would improve the figure every time a farm knocks.
    const before = getStatsHistory(1).at(-1)?.p50_ms ?? null;
    for (let i = 0; i < 200; i++) log(402, 1);
    const after = getStatsHistory(1).at(-1)?.p50_ms ?? null;
    expect(after).toBe(before);
  });

  it('does not report a percentile for a day with too few served requests', () => {
    // The guard itself, on a day far enough back to be empty.
    const rows = getStatsHistory(90);
    for (const r of rows) {
      if (r.p50_ms == null) continue;
      // Any day that DOES carry a figure must have had the traffic for it.
      expect(r.total_requests).toBeGreaterThanOrEqual(20);
    }
  });

  it('measures served requests once there are enough of them', () => {
    for (let i = 0; i < 100; i++) log(200, 20 + (i % 5));
    const rows = getStatsHistory(1);
    const today = rows[rows.length - 1];
    expect(today.p50_ms).toBeGreaterThan(0);
    expect(today.p95_ms).toBeGreaterThanOrEqual(today.p50_ms as number);
  });

  it('puts the p95 above the median when a tail exists', () => {
    for (let i = 0; i < 95; i++) log(200, 10);
    for (let i = 0; i < 20; i++) log(200, 900);
    const rows = getStatsHistory(1);
    const today = rows[rows.length - 1];
    expect(today.p50_ms).toBeLessThan(today.p95_ms as number);
  });

  /**
   * The tail, which is what an integrator is actually exposed to.
   *
   * A payout run makes thousands of calls; the slowest one in a hundred sets
   * the timeout budget, and a median answers a question nobody asked. Published
   * on the status page beside the other two — asked for in writing by a
   * regulated pilot customer, in those words: the p99, not the median.
   */
  /**
   * These two run on PAST days, unlike the ones above, because they assert
   * EXACT percentiles and today's row is shared with whatever the rest of the
   * suite logs. The database is hermetic (see the hoist at the top — the
   * shared developer file held real rows on any calendar date, which is how
   * these assertions first went red), and each test still purges the day it
   * owns: cheap insurance against a rerun on the same file and against any
   * future fixture that antedates rows.
   */
  function ownDay(n: number): string {
    getStatsDB()
      .prepare("DELETE FROM request_log WHERE date(created_at) = date('now', ?)")
      .run(`-${n} days`);
    return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  }
  const row = (date: string) => getStatsHistory(8).find((r) => r.date === date)!;

  it('separates the tail from the p95 instead of restating it', () => {
    // 200 samples, shaped so the two percentiles cannot coincide: the p95 lands
    // on rank 190 and the p99 on rank 198. A payout run makes thousands of
    // calls, and the slowest one in a hundred is what sets its timeout budget —
    // which is why a regulated pilot customer asked for this figure in those
    // words: the p99, not the median.
    const day6 = ownDay(6);
    for (let i = 0; i < 189; i++) log(200, 10, 6);
    for (let i = 0; i < 8; i++) log(200, 100, 6);
    for (let i = 0; i < 3; i++) log(200, 900, 6);
    const day = row(day6);
    expect(day.p95_ms).toBe(100);
    expect(day.p99_ms).toBe(900);
  });

  it('reports no p99 below a hundred samples, where it would only repeat the p95', () => {
    // The arithmetic this floor exists for: at n=20 the rank n*0.99 truncates
    // to 19, which is exactly where n*0.95 truncates to. Sharing the p50/p95
    // floor of 20 would publish the p95 twice, once labelled p99 — on the one
    // figure a customer asked for BECAUSE the median flatters us.
    const day5 = ownDay(5);
    for (let i = 0; i < 25; i++) log(200, 30, 5);
    const day = row(day5);
    expect(day.p95_ms).not.toBeNull();
    expect(day.p99_ms).toBeNull();
  });
});
