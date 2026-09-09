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
 */
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll } from '../lib/db.js';

afterAll(() => closeAll());

const TOKEN = 'test-stats-token';

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
  it('reports the JWKS origin of a signed request and ignores unsigned traffic', async () => {
    const app = buildApp();

    await app.request('/robots.txt', {
      headers: {
        'x-real-ip': '203.0.113.10',
        'Signature-Agent':
          '"https://agent.example.com/.well-known/http-message-signatures-directory"',
        'Signature-Input': 'sig1=("@authority");created=1',
      },
    });
    // Unsigned: the shape of every request served today.
    await app.request('/robots.txt', { headers: { 'x-real-ip': '203.0.113.11' } });

    const { status, rows, docs } = await readSignedAgents(app);
    expect(status).toBe(200);
    // The origin, never the full directory URL: the path is the caller's to choose.
    const signed = rows.find((r) => r.agent === 'https://agent.example.com');
    expect(signed, JSON.stringify(rows)).toBeDefined();
    expect(signed?.total).toBeGreaterThanOrEqual(1);
    // An empty list is the correct answer in production; the docs string has to
    // say so, or the next reader will file a bug against a working column.
    expect(docs.toLowerCase()).toContain('empty');
    // Unsigned requests are absent, not counted as a nameless agent.
    expect(rows.every((r) => r.agent !== null)).toBe(true);
  });

  it("files a signature without a directory as 'unnamed' and a broken one as 'malformed'", async () => {
    const app = buildApp();

    await app.request('/robots.txt', {
      headers: { 'x-real-ip': '203.0.113.12', 'Signature-Input': 'sig1=("@authority");created=1' },
    });
    await app.request('/robots.txt', {
      headers: { 'x-real-ip': '203.0.113.13', 'Signature-Agent': 'not-a-url-at-all' },
    });
    // http:// is not https:// — a directory served in clear is not an identity.
    await app.request('/robots.txt', {
      headers: {
        'x-real-ip': '203.0.113.14',
        'Signature-Agent': '"http://agent.example.com/jwks"',
      },
    });

    const { rows } = await readSignedAgents(app);
    const agents = rows.map((r) => r.agent);
    expect(agents, JSON.stringify(rows)).toContain('unnamed');
    expect(agents, JSON.stringify(rows)).toContain('malformed');
    expect(rows.find((r) => r.agent === 'malformed')?.total).toBeGreaterThanOrEqual(2);
  });
});
