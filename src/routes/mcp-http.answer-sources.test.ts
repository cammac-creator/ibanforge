import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/**
 * The anonymous count of answer sources on the hosted MCP transport (Privacy
 * Policy 1.13, src/lib/answer-sources.ts). A hermetic statistics database, as
 * in src/lib/answer-sources.test.ts: the path is read by db.js at load.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-mcp-answer-sources-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { rmSync } from 'node:fs';
import { Hono } from 'hono';
import { mcpHttp } from './mcp-http.js';
import { getStatsDB } from '../lib/db.js';
import { generateApiKey } from '../lib/api-keys.js';
import type { HonoEnv } from '../types.js';

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

beforeEach(() => {
  getStatsDB().prepare('DELETE FROM answer_sources_daily').run();
});

const app = new Hono<HonoEnv>();
app.route('/', mcpHttp);

/** A documentation address per call (RFC 5737 TEST-NET-2): each its own allowance. */
let ipCounter = 0;
const freshIp = () => `198.51.100.${(++ipCounter % 200) + 1}`;

async function firstEnvelope(res: Response): Promise<{ result?: unknown; error?: unknown }> {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('application/json')) return JSON.parse(text);
  const match = text.match(/^data:\s*(\{.*\})$/m);
  if (!match) throw new Error(`no JSON-RPC frame: ${text.slice(0, 200)}`);
  return JSON.parse(match[1]);
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ result?: unknown; error?: unknown }> {
  const ip = freshIp();
  const base = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'x-real-ip': ip,
    ...headers,
  };
  const init = await app.request('/mcp', {
    method: 'POST',
    headers: base,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest-answer-sources', version: '1.0.0' },
      },
    }),
  });
  expect(init.status).toBe(200);
  const sessionId = init.headers.get('mcp-session-id')!;
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { ...base, 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  expect(res.status).toBe(200);
  return firstEnvelope(res);
}

function counted(): number {
  return (
    getStatsDB().prepare('SELECT COALESCE(SUM(count), 0) AS n FROM answer_sources_daily').get() as {
      n: number;
    }
  ).n;
}

describe('the hosted MCP validation tools count each valid IBAN served', () => {
  it('validate_iban: one valid IBAN, one count, in its country', async () => {
    const env = await callTool('validate_iban', { iban: 'DE89370400440532013000' });
    expect(env.error).toBeUndefined();
    expect(
      getStatsDB().prepare('SELECT country, family, count FROM answer_sources_daily').all(),
    ).toEqual([{ country: 'DE', family: 'national_register', count: 1 }]);
  });

  it('batch_validate_iban: N valid IBANs count N, an invalid one none', async () => {
    const env = await callTool('batch_validate_iban', {
      ibans: [
        'DE89370400440532013000',
        'CH9300762011623852957',
        'FR1420041010050500013M02606',
        'DE89370400440532013001',
      ],
    });
    expect(env.error).toBeUndefined();
    expect(counted()).toBe(3);
  });

  it('a keyless call signed by one of our tools is not counted', async () => {
    await callTool(
      'validate_iban',
      { iban: 'DE89370400440532013000' },
      { 'User-Agent': 'ibanforge-outil/probe' },
    );
    expect(counted()).toBe(0);
  });

  it('a call served on a key is counted once: the key meter runs no REST route', async () => {
    const minted = generateApiKey(null);
    if (!minted) throw new Error('could not mint a key');
    const env = await callTool(
      'validate_iban',
      { iban: 'DE89370400440532013000' },
      { Authorization: `Bearer ${minted.api_key}` },
    );
    expect(env.error).toBeUndefined();
    expect(counted()).toBe(1);
  });
});
