/**
 * A refused MCP call must not look like a served one (MCP-04, audit 2026-09-01).
 *
 * `recordRequest` stores method, path and status and nothing else, and every
 * MCP call — a success, an unknown tool, a free-tier refusal — landed as
 * `POST /mcp:tools-call 200`. Eleven deliberately different calls produced
 * eleven identical rows. The cause was ORDER: the route set its
 * `mcpToolCall` marker BEFORE testing the daily cap, so a refusal was recorded
 * as a tool that ran. Nobody could measure how many agents the free tier turns
 * away, which is the one number the free tier exists to inform.
 *
 * Driven through `buildApp()` because the fix spans the route and the telemetry
 * middleware: the route now publishes the outcome and the middleware reads it.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;

/** Paths recorded for /mcp since the marker, newest first. */
function recentMcpPaths(limit = 12): string[] {
  return (
    getStatsDB()
      .prepare("SELECT path FROM request_log WHERE path LIKE '/mcp%' ORDER BY id DESC LIMIT ?")
      .all(limit) as Array<{ path: string }>
  ).map((r) => r.path);
}

async function openSession(app: ReturnType<typeof buildApp>, ip: string): Promise<string> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'x-real-ip': ip },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1' },
      },
    }),
  });
  return res.headers.get('mcp-session-id') ?? '';
}

async function callTool(
  app: ReturnType<typeof buildApp>,
  sessionId: string,
  ip: string,
  iid = '230',
) {
  return app.request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'x-real-ip': ip, 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'lookup_ch_clearing', arguments: { iid } },
    }),
  });
}

describe('MCP telemetry — a refusal has its own path', () => {
  it('records a served tool call and a refused one under different paths', async () => {
    const app = buildApp();
    // TEST-NET-3, one address for this test alone: the allowance is per IP.
    const ip = '203.0.113.170';
    const sessionId = await openSession(app, ip);
    expect(sessionId).toBeTruthy();

    await callTool(app, sessionId, ip);
    expect(recentMcpPaths(1)).toEqual(['/mcp:tools-call']);

    // Spend the rest of the daily allowance, then one more.
    for (let i = 0; i < 9; i++) await callTool(app, sessionId, ip);
    const refused = await callTool(app, sessionId, ip);
    // The refusal is a JSON-RPC error carried in a 200, which is exactly why
    // the status could not tell the two apart.
    expect(refused.status).toBe(200);
    const body = (await refused.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32000);

    const paths = recentMcpPaths(3);
    expect(paths[0], 'a refused call was logged as a served one').toBe('/mcp:tools-call:refused');
    expect(paths).toContain('/mcp:tools-call');
  });

  it('gives a refused session opening its own path too', async () => {
    const app = buildApp();
    const ip = '203.0.113.172';
    // A POST with no session id builds a transport whatever it carries, and
    // that is what the per-address session meter counts. 30 a day is the cap.
    const burn = () =>
      app.request('/mcp', {
        method: 'POST',
        headers: { ...MCP_HEADERS, 'x-real-ip': ip },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
      });
    for (let i = 0; i < 30; i++) await burn();
    const refused = await burn();
    const body = (await refused.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain('Daily MCP session limit reached');
    expect(recentMcpPaths(1)).toEqual(['/mcp:session:refused']);
  });

  it('leaves a discovery handshake under the plain path', async () => {
    const app = buildApp();
    const ip = '203.0.113.171';
    await openSession(app, ip);
    expect(recentMcpPaths(1)).toEqual(['/mcp']);
  });
});
