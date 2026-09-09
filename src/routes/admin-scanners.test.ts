/**
 * Web Bot Auth: count the signature headers we receive, without letting the
 * caller choose our cardinality (decision 10, 2026-09-09).
 *
 * `Signature-Agent` carries the URL of the agent's JWKS directory, and the
 * identity it attributes is that directory — the ORIGIN, not the whole string.
 * Storing the raw header would hand an unauthenticated caller a free write into
 * a table with twelve months of retention, and turn the GROUP BY behind
 * /admin/scanners into a full scan on a synchronous better-sqlite3 handle that
 * sits in front of paying traffic. So the middleware normalises at the source
 * and the log keeps four readings in one column: an https origin, 'malformed',
 * 'unnamed', or NULL.
 *
 * Driven through `buildApp()` because the behaviour spans three files: the
 * tracking middleware normalises, `recordRequest` stores, and the admin route
 * aggregates. No agent signs anything in 2026 — an EMPTY list is the correct
 * answer in production today, and this test is what says so the day it stops
 * being empty.
 *
 * 🚨 The assertions that carry this file are the EXACT ones: one row, and a
 * total equal to the number of SIGNED requests. The first version of this file
 * guarded unsigned traffic with `rows.every((r) => r.agent !== null)`, which can
 * never fail: the route's own `WHERE agent_signature IS NOT NULL` makes a null
 * agent unreachable. Labelling every unsigned request — 100% of production
 * traffic — as a signed agent left the suite green. Shape taken from spec-05
 * test 26: three signed requests, two unsigned, one entry, `total: 3`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll } from '../lib/db.js';

afterAll(() => closeAll());

const TOKEN = 'test-stats-token';

const DIRECTORY = '"https://agent.example.com/.well-known/http-message-signatures-directory"';
const SIGNATURE_INPUT = 'sig1=("@authority");created=1';

interface SignedAgentRow {
  agent: string;
  total: number;
  first_seen: string;
  last_seen: string;
}

async function readSignedAgents(
  app: ReturnType<typeof buildApp>,
): Promise<{ status: number; rows: SignedAgentRow[]; docs: string }> {
  const prev = process.env.STATS_TOKEN;
  process.env.STATS_TOKEN = TOKEN;
  try {
    const res = await app.request('/admin/scanners?days=1', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await res.json()) as { signed_agents?: SignedAgentRow[]; docs: string };
    return { status: res.status, rows: body.signed_agents ?? [], docs: body.docs };
  } finally {
    if (prev === undefined) delete process.env.STATS_TOKEN;
    else process.env.STATS_TOKEN = prev;
  }
}

describe('GET /admin/scanners — signed_agents', () => {
  // ⚠️ This first test counts the WHOLE list, so it has to run on a log that
  // holds nothing but its own rows. Vitest runs a file's tests in declaration
  // order and `vitest.config.ts` sets no `sequence.shuffle`; the day someone
  // adds shuffling or `describe.concurrent`, move this file to its own
  // STATS_DB_PATH rather than weakening the length assertion.
  it('counts three signed requests as one agent and files two unsigned ones nowhere', async () => {
    const app = buildApp();

    for (const ip of ['203.0.113.10', '203.0.113.11', '203.0.113.12']) {
      await app.request('/robots.txt', {
        headers: {
          'x-real-ip': ip,
          'Signature-Agent': DIRECTORY,
          'Signature-Input': SIGNATURE_INPUT,
        },
      });
    }
    // Unsigned: the shape of every request served today.
    await app.request('/robots.txt', { headers: { 'x-real-ip': '203.0.113.13' } });
    await app.request('/robots.txt', { headers: { 'x-real-ip': '203.0.113.14' } });

    const { status, rows, docs } = await readSignedAgents(app);
    expect(status).toBe(200);
    // ONE row: the two unsigned requests are absent from the list, not filed
    // under a nameless agent. Length is the only assertion that can say this —
    // the route filters `agent_signature IS NOT NULL`, so looking for a null
    // agent among the rows returned is looking for something the SQL forbids.
    expect(rows, JSON.stringify(rows)).toHaveLength(1);
    // The origin, never the full directory URL: the path is the caller's to choose.
    expect(rows[0].agent).toBe('https://agent.example.com');
    // Exactly the three signed requests, never the five requests served.
    expect(rows[0].total).toBe(3);
    // An empty list is the correct answer in production; the docs string has to
    // say so, or the next reader will file a bug against a working column.
    expect(docs.toLowerCase()).toContain('empty');
  });

  it("files a signature without a directory as 'unnamed' and a broken one as 'malformed'", async () => {
    const app = buildApp();

    await app.request('/robots.txt', {
      headers: { 'x-real-ip': '203.0.113.20', 'Signature-Input': SIGNATURE_INPUT },
    });
    await app.request('/robots.txt', {
      headers: { 'x-real-ip': '203.0.113.21', 'Signature-Agent': 'not-a-url-at-all' },
    });
    // http:// is not https:// — a directory served in clear is not an identity.
    await app.request('/robots.txt', {
      headers: {
        'x-real-ip': '203.0.113.22',
        'Signature-Agent': '"http://agent.example.com/jwks"',
      },
    });

    const { rows } = await readSignedAgents(app);
    const byAgent = new Map(rows.map((r) => [r.agent, r.total]));
    // Exact totals, not `toBeGreaterThanOrEqual`: a floor passes at the two
    // numbers this test exists to separate (see the warning in vitest.config.ts).
    // The first test signs three requests and produces neither sentinel, so
    // these two counts are this test's own.
    expect(byAgent.get('unnamed'), JSON.stringify(rows)).toBe(1);
    expect(byAgent.get('malformed'), JSON.stringify(rows)).toBe(2);
  });
});
