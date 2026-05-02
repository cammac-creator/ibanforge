/**
 * End-to-end tests for the HTTP MCP backend mounted at /mcp.
 *
 * Why these matter: Smithery, Glama, MCP.so, Decixa, and any agent that
 * connects via Streamable HTTP all hit this endpoint. The middleware chain
 * (initialize → tools/list → tools/call) must round-trip cleanly, every
 * registered tool must declare an outputSchema (CyberSapper recipe — drives
 * Smithery's Quality Score from 90 → 100), and every paid tool must return
 * structuredContent so the SDK's runtime validation passes.
 *
 * Without these checks a regression on /mcp would silently break listings.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mcpHttp } from './mcp-http.js';
import type { HonoEnv } from '../types.js';

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', mcpHttp);
  return app;
}

const RPC_BASE = {
  jsonrpc: '2.0',
  id: 1,
};

const INIT_PARAMS = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'vitest-mcp-e2e', version: '1.0.0' },
};

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Parses a Streamable HTTP body which can be either application/json
 * (single JSON-RPC envelope) or text/event-stream (one or more SSE
 * `data: {...}` frames). Returns the FIRST JSON-RPC envelope found.
 */
async function parseStreamableHttp(res: Response): Promise<JsonRpcResponse> {
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (ct.includes('application/json')) {
    return JSON.parse(text) as JsonRpcResponse;
  }
  // text/event-stream — extract first `data: {...}` frame
  const match = text.match(/^data:\s*(\{.*\})$/m);
  if (!match) throw new Error(`No JSON-RPC frame in SSE body. Content-Type was "${ct}". First 200 chars: ${text.slice(0, 200)}`);
  return JSON.parse(match[1]) as JsonRpcResponse;
}

async function initialize(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ ...RPC_BASE, method: 'initialize', params: INIT_PARAMS }),
  });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId, 'initialize must return mcp-session-id header').toBeTruthy();
  return sessionId!;
}

async function rpc(app: ReturnType<typeof makeApp>, sessionId: string, method: string, params: Record<string, unknown> = {}, id = 2): Promise<JsonRpcResponse> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  expect(res.status).toBe(200);
  return parseStreamableHttp(res);
}

describe('GET /mcp (no session) — discovery hint', () => {
  it('returns a JSON quickstart envelope', async () => {
    const app = makeApp();
    const res = await app.request('/mcp');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.protocol).toBe('mcp');
    expect(body.transport).toBe('streamable-http');
    expect(body.tools).toEqual([
      'validate_iban',
      'batch_validate_iban',
      'lookup_bic',
      'lookup_ch_clearing',
      'check_compliance',
    ]);
  });
});

describe('POST /mcp — full handshake', () => {
  it('initialize → tools/list → tools/call validate_iban returns content + structuredContent', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);

    // tools/list
    const listResp = await rpc(app, sessionId, 'tools/list');
    expect(listResp.error).toBeUndefined();
    const tools = (listResp.result as { tools: Array<{ name: string; outputSchema?: unknown; inputSchema?: unknown }> }).tools;
    expect(tools).toHaveLength(5);

    const expectedNames = ['validate_iban', 'batch_validate_iban', 'lookup_bic', 'check_compliance', 'lookup_ch_clearing'];
    for (const expected of expectedNames) {
      const tool = tools.find((t) => t.name === expected);
      expect(tool, `tool ${expected} should be registered`).toBeDefined();
      expect(tool!.inputSchema, `tool ${expected} should declare inputSchema`).toBeDefined();
      expect(tool!.outputSchema, `tool ${expected} should declare outputSchema (Smithery quality score)`).toBeDefined();
    }

    // tools/call validate_iban
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'validate_iban',
      arguments: { iban: 'DE89370400440532013000' },
    });
    expect(callResp.error).toBeUndefined();
    const callResult = callResp.result as { content: Array<{ type: string; text: string }>; structuredContent?: Record<string, unknown> };
    expect(callResult.content).toBeDefined();
    expect(callResult.content[0].type).toBe('text');
    expect(callResult.structuredContent, 'paid tools must return structuredContent for SDK runtime validation').toBeDefined();
    expect(callResult.structuredContent!.iban).toBe('DE89370400440532013000');
    expect(callResult.structuredContent!.valid).toBe(true);
  });

  it('tools/call lookup_bic returns structuredContent on a valid BIC', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'lookup_bic',
      arguments: { bic: 'DEUTDEFF' },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.bic).toBe('DEUTDEFF');
    expect(result.structuredContent!.valid_format).toBe(true);
  });

  it('tools/call lookup_ch_clearing returns structuredContent for a valid Swiss IID', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'lookup_ch_clearing',
      arguments: { iid: '230' },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.iid).toBe('00230');
  });

  it('tools/call check_compliance returns structuredContent with a compliance bundle', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'check_compliance',
      arguments: { iban: 'DE89370400440532013000' },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.compliance, 'check_compliance must include a compliance bundle').toBeDefined();
  });

  it('tools/call batch_validate_iban returns wrapped { results, count } structuredContent', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'batch_validate_iban',
      arguments: { ibans: ['DE89370400440532013000', 'CH9300762011623852957'] },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: { results?: unknown[]; count?: number } };
    expect(result.structuredContent).toBeDefined();
    expect(Array.isArray(result.structuredContent!.results)).toBe(true);
    expect(result.structuredContent!.results).toHaveLength(2);
    expect(result.structuredContent!.count).toBe(2);
  });

  it('returns the registered resources via resources/list', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const listResp = await rpc(app, sessionId, 'resources/list');
    expect(listResp.error).toBeUndefined();
    const resources = (listResp.result as { resources: Array<{ uri: string }> }).resources;
    expect(resources.length).toBeGreaterThanOrEqual(2);
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('ibanforge://countries');
    expect(uris).toContain('ibanforge://pricing');
  });
});
