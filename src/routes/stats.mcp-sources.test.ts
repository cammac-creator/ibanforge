import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { stats } from './stats.js';
import {
  getMcpSourceFamilies,
  hashIp,
  type McpFamilyCounts,
  type McpSourceFamiliesReport,
} from '../lib/stats.js';
import { getStatsDB } from '../lib/db.js';
import { ANTHROPIC_OUTBOUND_V4 } from '../lib/net-family.js';
import { trialWeekStart } from '../lib/trial.js';

/**
 * The MCP sources split by address family, read from the hashes already in the
 * log. The stats database is this file's own (vitest `setupFiles`), so every
 * count below is exact.
 *
 * Two readings of the same rows: the counters through `getMcpSourceFamilies`
 * with a documentation block injected as the family (192.0.2.0/24), and the
 * route end to end with Anthropic's real ranges, which takes no parameter to
 * inject anything (an unknown parameter is a 400 on every /stats route).
 */

const app = new Hono();
app.route('/', stats);

const TOKEN = 'test-stats-token';
const PREVIOUS = process.env.STATS_TOKEN;
const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

/** Documentation addresses (RFC 5737) and two inside Anthropic's ranges. */
const A1 = '192.0.2.5';
const A2_MAPPED = '::ffff:192.0.2.9';
const A3 = '192.0.2.77';
const O1 = '198.51.100.7';
const CLAUDE_PLAIN = '160.79.104.7';
const CLAUDE_MAPPED = '::ffff:153.61.208.9';
const SEEDED = [A1, '192.0.2.9', A3, O1, '160.79.104.7', '153.61.208.9'];

function seed(
  ip: string | null,
  path: string,
  n: number,
  { daysAgo = 0, kind = 'mcp_http' }: { daysAgo?: number; kind?: string } = {},
): void {
  const insert = getStatsDB().prepare(
    `INSERT INTO request_log (method, path, status, client_kind, ip_hash, key_prefix, created_at)
     VALUES ('POST', ?, 200, ?, ?, NULL, datetime('now', ?))`,
  );
  for (let i = 0; i < n; i++) insert.run(path, kind, ip ? hashIp(ip) : null, `-${daysAgo} days`);
}

const zero = { '/mcp': 0, '/mcp/directory': 0, '/mcp/chatgpt': 0 };
function counts(partial: Partial<McpFamilyCounts>): McpFamilyCounts {
  return {
    sources: 0,
    sources_calling: 0,
    calls_served: 0,
    calls_refused: 0,
    sources_refused: 0,
    sessions_refused: 0,
    sources_session_refused: 0,
    ...partial,
    handshakes: { ...zero, ...partial.handshakes },
  };
}

let today = '';
let yesterday = '';

beforeAll(() => {
  process.env.STATS_TOKEN = TOKEN;
  ({ today } = getStatsDB().prepare("SELECT date('now') AS today").get() as { today: string });
  ({ yesterday } = getStatsDB().prepare("SELECT date('now', '-1 day') AS yesterday").get() as {
    yesterday: string;
  });

  // Today, inside 192.0.2.0/24: three sources, one of them under the mapped spelling.
  seed(A1, '/mcp', 2);
  seed(A1, '/mcp:tools-call', 3);
  seed(A1, '/mcp:tools-call:refused', 1);
  seed(A2_MAPPED, '/mcp/directory', 1);
  seed(A2_MAPPED, '/mcp:session:refused', 4);
  seed(A3, '/mcp/chatgpt', 1);
  seed(A3, '/mcp:session:refused', 1);
  // Today, outside it.
  seed(O1, '/mcp', 1);
  seed(O1, '/mcp:tools-call', 2);
  seed(O1, '/mcp:session:refused', 2);
  // Today, inside Anthropic's real ranges, plain and mapped.
  seed(CLAUDE_PLAIN, '/mcp', 1);
  seed(CLAUDE_PLAIN, '/mcp:tools-call', 2);
  seed(CLAUDE_MAPPED, '/mcp:session:refused', 3);
  // Yesterday.
  seed(A1, '/mcp:tools-call', 1, { daysAgo: 1 });
  seed(O1, '/mcp:tools-call:refused', 1, { daysAgo: 1 });

  // Left out, every one of them.
  seed(A1, '/mcp:tools-call', 5, { kind: 'internal' }); // our own tools, keyless
  seed(CLAUDE_PLAIN, '/mcp:tools-call', 5, { kind: 'internal' });
  seed(A1, '/v1/iban/validate', 5, { kind: 'api' }); // not the MCP transport
  seed(A1, '/mcp:tools-call', 5, { daysAgo: 40 }); // outside the window
  seed(null, '/mcp', 5); // no address: no family
});

afterAll(() => {
  if (PREVIOUS === undefined) delete process.env.STATS_TOKEN;
  else process.env.STATS_TOKEN = PREVIOUS;
});

describe('getMcpSourceFamilies, with an injected family', () => {
  let report: McpSourceFamiliesReport;
  beforeAll(() => {
    report = getMcpSourceFamilies(30, ['192.0.2.0/24']);
  });

  it('lists every day of the window, oldest first, today last', () => {
    expect(report.period_days).toBe(30);
    expect(report.days).toHaveLength(30);
    expect(report.days.at(-1)!.day).toBe(today);
    expect(report.days.at(-2)!.day).toBe(yesterday);
    expect(report.ranges.anthropic).toEqual(['192.0.2.0/24']);
    expect(report.ranges.addresses).toBe(256);
  });

  it('counts each figure of today, family by family', () => {
    const day = report.days.at(-1)!;
    expect(day.anthropic).toEqual(
      counts({
        sources: 3,
        sources_calling: 1,
        calls_served: 3,
        calls_refused: 1,
        sources_refused: 1,
        sessions_refused: 5,
        sources_session_refused: 2,
        handshakes: { '/mcp': 2, '/mcp/directory': 1, '/mcp/chatgpt': 1 },
      }),
    );
    expect(day.other).toEqual(
      counts({
        sources: 3,
        sources_calling: 2,
        calls_served: 4,
        sessions_refused: 5,
        sources_session_refused: 2,
        handshakes: { '/mcp': 2, '/mcp/directory': 0, '/mcp/chatgpt': 0 },
      }),
    );
  });

  it('counts yesterday apart, and leaves the empty days at zero', () => {
    const day = report.days.at(-2)!;
    expect(day.anthropic).toEqual(counts({ sources: 1, sources_calling: 1, calls_served: 1 }));
    expect(day.other).toEqual(counts({ sources: 1, calls_refused: 1, sources_refused: 1 }));
    expect(report.days[0]!.anthropic).toEqual(counts({}));
    expect(report.days[0]!.other).toEqual(counts({}));
  });

  it('counts distinct sources over the window, and the share of the most refused one', () => {
    expect(report.totals.anthropic).toEqual({
      ...counts({
        sources: 3,
        sources_calling: 1,
        calls_served: 4,
        calls_refused: 1,
        sources_refused: 1,
        sessions_refused: 5,
        sources_session_refused: 2,
        handshakes: { '/mcp': 2, '/mcp/directory': 1, '/mcp/chatgpt': 1 },
      }),
      sessions_refused_top_source_share: 0.8,
    });
    expect(report.totals.other).toEqual({
      ...counts({
        sources: 3,
        sources_calling: 2,
        calls_served: 4,
        calls_refused: 1,
        sources_refused: 1,
        sessions_refused: 5,
        sources_session_refused: 2,
        handshakes: { '/mcp': 2, '/mcp/directory': 0, '/mcp/chatgpt': 0 },
      }),
      sessions_refused_top_source_share: 0.6,
    });
  });

  it('counts the ISO weeks as distinct sources, never as a sum of days', () => {
    const at = (day: string) => trialWeekStart(new Date(`${day}T12:00:00Z`));
    expect(report.weeks.reduce((sum, w) => sum + w.days_covered, 0)).toBe(30);
    const thisWeek = report.weeks.at(-1)!;
    expect(thisWeek.week_start).toBe(at(today));
    if (at(today) === at(yesterday)) {
      // A1 called on both days: one source of the week, not two.
      expect(thisWeek.anthropic).toEqual({ sources: 3, sources_calling: 1, sources_refused: 1 });
      expect(thisWeek.other).toEqual({ sources: 3, sources_calling: 2, sources_refused: 1 });
    } else {
      expect(thisWeek.anthropic).toEqual({ sources: 3, sources_calling: 1, sources_refused: 1 });
      expect(thisWeek.other).toEqual({ sources: 3, sources_calling: 2, sources_refused: 0 });
      const lastWeek = report.weeks.at(-2)!;
      expect(lastWeek.week_start).toBe(at(yesterday));
      expect(lastWeek.anthropic).toEqual({ sources: 1, sources_calling: 1, sources_refused: 0 });
      expect(lastWeek.other).toEqual({ sources: 1, sources_calling: 0, sources_refused: 1 });
    }
  });
});

describe('GET /stats/mcp-sources', () => {
  it('asks for the same bearer as every /stats route', async () => {
    expect((await app.request('/stats/mcp-sources')).status).toBe(403);
    const wrong = await app.request('/stats/mcp-sources', {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(wrong.status).toBe(403);
  });

  it('refuses an unknown parameter and a window past the ceiling', async () => {
    expect((await app.request('/stats/mcp-sources?cidr=192.0.2.0/24', auth)).status).toBe(400);
    expect((await app.request('/stats/mcp-sources?days=91', auth)).status).toBe(400);
  });

  it("classifies against Anthropic's published ranges, both spellings", async () => {
    const res = await app.request('/stats/mcp-sources?days=30', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpSourceFamiliesReport;
    expect(body.ranges.anthropic).toEqual([...ANTHROPIC_OUTBOUND_V4]);
    expect(body.ranges.addresses).toBe(6144);
    expect(body.ranges.source).toMatch(/^https:\/\//);
    expect(body.note).toContain('::ffff:');
    expect(body.totals.anthropic).toEqual({
      ...counts({
        sources: 2,
        sources_calling: 1,
        calls_served: 2,
        sessions_refused: 3,
        sources_session_refused: 1,
        handshakes: { '/mcp': 1, '/mcp/directory': 0, '/mcp/chatgpt': 0 },
      }),
      sessions_refused_top_source_share: 1,
    });
    expect(body.totals.other.sources).toBe(4);
    expect(body.totals.other.calls_served).toBe(6);
    expect(body.totals.other.sessions_refused).toBe(7);
  });

  it('returns no hash and no address', async () => {
    const text = await (await app.request('/stats/mcp-sources?days=30', auth)).text();
    expect(text).not.toMatch(/[0-9a-f]{16}/i);
    for (const ip of [...SEEDED, A2_MAPPED, CLAUDE_MAPPED]) {
      expect(text, ip).not.toContain(ip);
      expect(text, ip).not.toContain(hashIp(ip)!);
    }
  });
});
