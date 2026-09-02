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
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  mcpHttp,
  mcpSessions,
  createMcpSessionStore,
  MCP_SESSIONS_PER_IP_DAY,
} from './mcp-http.js';
import { MCP_TOOLS } from '../mcp/inventory.js';
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
  if (!match)
    throw new Error(
      `No JSON-RPC frame in SSE body. Content-Type was "${ct}". First 200 chars: ${text.slice(0, 200)}`,
    );
  return JSON.parse(match[1]) as JsonRpcResponse;
}

/**
 * A fresh source address per call.
 *
 * Everything free on this transport is metered per IP: tool calls against a
 * daily allowance, and since 2026-09-01 session openings against their own.
 * Left unset, every test in this file shared the 'unknown' bucket, so an
 * eleventh tool call ANYWHERE made a different test fail with a rate-limit
 * error — and the day `batch_validate_iban` started billing per IBAN (MCP-07)
 * that shared bucket overflowed on the spot. Documentation addresses (RFC 5737
 * TEST-NET-2) hand each call its own allowance without loosening a single
 * limit. The tests that MEASURE a limit pin their own address on purpose.
 */
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 200) + 1}`;
}

async function initialize(
  app: ReturnType<typeof makeApp>,
  clientIp: string = freshIp(),
): Promise<string> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-real-ip': clientIp,
    },
    body: JSON.stringify({ ...RPC_BASE, method: 'initialize', params: INIT_PARAMS }),
  });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId, 'initialize must return mcp-session-id header').toBeTruthy();
  return sessionId!;
}

/**
 * `clientIp` exists because the free tier is 10 tool calls per IP per day and
 * this file is at the cap. Unset, every test shares the 'unknown' bucket, so
 * adding an eleventh `tools/call` anywhere makes a DIFFERENT test fail with a
 * rate-limit error — a confusing failure that says nothing about the code under
 * test. A documentation address (RFC 5737 TEST-NET-3) gives one test its own
 * allowance without loosening the limiter.
 */
async function rpc(
  app: ReturnType<typeof makeApp>,
  sessionId: string,
  method: string,
  params: Record<string, unknown> = {},
  id = 2,
  clientIp: string = freshIp(),
): Promise<JsonRpcResponse> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
      'x-real-ip': clientIp,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  expect(res.status).toBe(200);
  return parseStreamableHttp(res);
}

describe('GET /mcp (no session) — discovery hint', () => {
  it('answers 405 per the streamable-http spec, with the quickstart as body', async () => {
    // The status is the fix for a real incident: answering 200 made SSE
    // clients treat the JSON as a broken stream and retry in a tight loop,
    // ~45k GETs in one day. 405 stops the loop; the body keeps the endpoint
    // self-explaining for a human.
    const app = makeApp();
    const res = await app.request('/mcp');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.protocol).toBe('mcp');
    expect(body.transport).toBe('streamable-http');
    expect(Array.isArray(body.tools)).toBe(true);
  });

  /**
   * The hint and the server have to say the same thing (MCP-13, 2026-09-01).
   *
   * Both values used to be typed by hand into this document — the one a curious
   * developer opens in a browser — and both had drifted: it announced protocol
   * 2024-11-05 and 7 tools while the server negotiated 2025-06-18 and served 8.
   * A hand-kept copy of a list is a copy that goes stale in silence, so the
   * assertion compares the hint against the live tools/list rather than against
   * a third hand-written list here.
   */
  it('lists exactly the tools tools/list serves, and the protocol the SDK speaks', async () => {
    const app = makeApp();
    const hint = (await (await app.request('/mcp')).json()) as { tools: string[]; version: string };

    const sessionId = await initialize(app);
    const listResp = await rpc(app, sessionId, 'tools/list');
    const served = (listResp.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);

    expect([...hint.tools].sort(), 'the discovery hint and tools/list disagree').toEqual(
      [...served].sort(),
    );
    expect(hint.tools.length).toBe(9);
    expect(hint.version).toBe(LATEST_PROTOCOL_VERSION);
  });

  /**
   * The bridge between what this server RUNS and what the discovery documents
   * SAY (DX-01 / MCP-13, both 2026-09-01).
   *
   * `src/mcp/inventory.ts` is the single table the server card, the A2A card,
   * the x402 document, agents.json and /llms.txt all derive from, and its own
   * test welds those six documents to it. Nothing welded the table to the
   * server that actually answers, so a ninth tool could be registered here and
   * be missing from every document at once — the shape of the bug that gave
   * five different tool counts for one product. This is the missing weld: the
   * hint is derived from the live server, so comparing the two compares the
   * table against reality.
   */
  it('agrees with the inventory every discovery document is built from', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const listResp = await rpc(app, sessionId, 'tools/list');
    const served = (listResp.result as { tools: Array<{ name: string }> }).tools
      .map((t) => t.name)
      .sort();
    expect(
      MCP_TOOLS.map((t) => t.name).sort(),
      'src/mcp/inventory.ts and the running MCP server disagree on the tool list',
    ).toEqual(served);
  });
});

describe('POST /mcp — full handshake', () => {
  it('initialize → tools/list → tools/call validate_iban returns content + structuredContent', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);

    // tools/list
    const listResp = await rpc(app, sessionId, 'tools/list');
    expect(listResp.error).toBeUndefined();
    const tools = (
      listResp.result as {
        tools: Array<{ name: string; outputSchema?: unknown; inputSchema?: unknown }>;
      }
    ).tools;
    expect(tools).toHaveLength(9);

    const expectedNames = [
      'validate_iban',
      'batch_validate_iban',
      'lookup_bic',
      'check_compliance',
      'lookup_ch_clearing',
      'send_feedback',
      'validate_payment_reference',
      'check_postal_address',
      'check_swiss_qr_bill',
    ];
    for (const expected of expectedNames) {
      const tool = tools.find((t) => t.name === expected);
      expect(tool, `tool ${expected} should be registered`).toBeDefined();
      expect(tool!.inputSchema, `tool ${expected} should declare inputSchema`).toBeDefined();
      expect(
        tool!.outputSchema,
        `tool ${expected} should declare outputSchema (Smithery quality score)`,
      ).toBeDefined();
    }

    // tools/call validate_iban
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'validate_iban',
      arguments: { iban: 'DE89370400440532013000' },
    });
    expect(callResp.error).toBeUndefined();
    const callResult = callResp.result as {
      content: Array<{ type: string; text: string }>;
      structuredContent?: Record<string, unknown>;
    };
    expect(callResult.content).toBeDefined();
    expect(callResult.content[0].type).toBe('text');
    expect(
      callResult.structuredContent,
      'paid tools must return structuredContent for SDK runtime validation',
    ).toBeDefined();
    expect(callResult.structuredContent!.iban).toBe('DE89370400440532013000');
    expect(callResult.structuredContent!.valid).toBe(true);
  });

  /**
   * The Zod trap, checked on both shapes this tool can return.
   *
   * `validate_payment_reference` answers a plain checksum result without an
   * IBAN and a pairing block with one, and the SDK validates BOTH against a
   * single declared outputSchema. Zod strips what the schema does not name and
   * drops `structuredContent` entirely when a required field is missing — with
   * no error anywhere. These two assertions are what makes that visible.
   */
  it('tools/call validate_payment_reference keeps structuredContent without an IBAN', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'validate_payment_reference',
      arguments: { reference: 'RF18539007547034' },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent, 'schema mismatch silently drops this').toBeDefined();
    expect(result.structuredContent!.scheme).toBe('rf');
    expect(result.structuredContent!.valid).toBe(true);
    // The provenance must survive the schema — it is the point of the feature.
    expect(result.structuredContent!.source).toBeTruthy();
    expect(result.structuredContent!.as_of).toBe('2023-10');
  });

  it('tools/call validate_payment_reference keeps the pairing fields with an IBAN', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'validate_payment_reference',
      arguments: { reference: '210000000003139471430009017', iban: 'CH5204835012345671000' },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!.pairing).toBe('qrr_requires_qr_iban');
    expect(result.structuredContent!.pairing_source).toBeTruthy();
  });

  /**
   * The reason an agent branches on has to reach the agent.
   *
   * `bank_code_check.reason` separates "this bank code does not exist" from "we
   * could not answer just now" — the distinction a regulated pilot customer
   * required in writing before moving to production. Over MCP that distinction
   * survives only if the field is named in the tool's outputSchema: Zod strips
   * what the schema does not declare, silently and without an error, so a field
   * added to the response and forgotten here would be documented, served over
   * REST, and invisible to every agent.
   *
   * Asserted on `structuredContent`, which is the payload the strip applies to.
   */
  it('tools/call validate_iban keeps bank_code_check.reason through the schema', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(
      app,
      sessionId,
      'tools/call',
      // Valid mod-97, fabricated bank code, composite-map country.
      { name: 'validate_iban', arguments: { iban: 'FR1499999000010123456789A42' } },
      2,
      '203.0.113.10',
    );
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent, 'schema mismatch silently drops this').toBeDefined();
    const check = result.structuredContent!.bank_code_check as Record<string, unknown>;
    expect(check.status).toBe('not_in_register');
    expect(check.reason, 'stripped by the output schema').toBe('absent_from_reference_data');
    // The half that must never be inferred: a non-authoritative miss is not a
    // denial, and the reason an agent reads must not let it become one.
    expect(check.authoritative).toBe(false);
  });

  /**
   * The settlement question, asked over MCP.
   *
   * `bic.basis` is the field that says whether a derived BIC may be stored and
   * settled against or is advisory only. An agent that cannot see it has no way
   * to tell a register pairing from a prefix guess — and Zod strips undeclared
   * fields from `structuredContent` without an error, which is exactly how a
   * field can be documented, served over REST and invisible to every agent.
   */
  it('tools/call validate_iban keeps bic.basis through the schema', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(
      app,
      sessionId,
      'tools/call',
      // Germany: the one basis today that licenses settling against the BIC.
      { name: 'validate_iban', arguments: { iban: 'DE89370400440532013000' } },
      2,
      '203.0.113.11',
    );
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    const bic = result.structuredContent!.bic as Record<string, unknown>;
    expect(bic.basis, 'stripped by the output schema').toBe('national_register');
    expect(bic.authoritative).toBe(true);
  });

  it('tools/call batch_validate_iban keeps bic.basis through its own schema', async () => {
    // The batch tool declares its `bic` block separately from validate_iban, so
    // "the field is in the schema" has to be proved twice. A strip is silent by
    // construction: the only way to see one is to look at structuredContent.
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(
      app,
      sessionId,
      'tools/call',
      { name: 'batch_validate_iban', arguments: { ibans: ['DE89370400440532013000'] } },
      2,
      '203.0.113.12',
    );
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as {
      structuredContent?: { results?: Array<Record<string, unknown>> };
    };
    const first = result.structuredContent!.results![0];
    const bic = first.bic as Record<string, unknown>;
    expect(bic.basis, 'stripped by the batch output schema').toBe('national_register');
    const check = first.bank_code_check as Record<string, unknown>;
    expect(check.status).toBe('verified');
  });

  it('tools/call check_postal_address keeps findings and their sources through the schema', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'check_postal_address',
      arguments: {
        scheme: 'sps',
        address: {
          strt_nm: 'Bahnhofstrasse',
          bldg_nb: '45',
          pst_cd: '8001',
          twn_nm: 'Zurich',
          ctry: 'CH',
        },
      },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent, 'schema mismatch silently drops this').toBeDefined();
    expect(result.structuredContent!.conforms).toBe(true);
    const findings = result.structuredContent!.findings as Array<Record<string, unknown>>;
    expect(findings.length).toBeGreaterThan(0);
    // The provenance must survive the schema — it is the point of the feature.
    for (const f of findings) {
      expect(f.source, `finding ${String(f.rule)} lost its source`).toBeTruthy();
      expect(f.detail, `finding ${String(f.rule)} lost its detail`).toBeTruthy();
    }
    expect(result.structuredContent!.note).toBeTruthy();
  });

  it('tools/call check_postal_address fails a townless SPS address, with the rule named', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'check_postal_address',
      arguments: { scheme: 'sps', address: { strt_nm: 'Bahnhofstrasse', ctry: 'CH' } },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent!.conforms).toBe(false);
    const findings = result.structuredContent!.findings as Array<{ rule: string; verdict: string }>;
    expect(findings.find((f) => f.rule === 'twn_nm_required')?.verdict).toBe('fail');
  });

  it('tools/call validate_payment_reference answers null, never false, for a KID', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'validate_payment_reference',
      arguments: { reference: '12345678', reference_type: 'kid' },
    });
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent!.valid).toBeNull();
    expect(result.structuredContent!.status).toBe('unverifiable_without_creditor_config');
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
    expect(
      result.structuredContent!.compliance,
      'check_compliance must include a compliance bundle',
    ).toBeDefined();
  });

  it('tools/call batch_validate_iban returns wrapped { results, count } structuredContent', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'batch_validate_iban',
      arguments: { ibans: ['DE89370400440532013000', 'CH9300762011623852957'] },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as {
      structuredContent?: { results?: unknown[]; count?: number };
    };
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

/**
 * Regression guard for the 2026-07-25 security audit, finding 2.
 *
 * The daily allowance used to be checked with `body.method === 'tools/call'`.
 * A JSON-RPC BATCH is an ARRAY, so `body.method` was undefined and a batch of
 * N tool calls counted as ZERO — the whole paid catalogue was free and
 * unbounded, and because it rode in one HTTP request the global per-IP rate
 * limiter did not bound it either. Verified against production before the fix:
 * counter at 1, 60 tool calls served, counter still at 2.
 *
 * Each test pins its own X-Forwarded-For so it gets a fresh daily bucket
 * (the counter is module-level and keyed by client IP).
 */
describe('POST /mcp — JSON-RPC batch billing', () => {
  function batchOf(n: number, startId = 100) {
    return Array.from({ length: n }, (_, i) => ({
      jsonrpc: '2.0',
      id: startId + i,
      method: 'tools/call',
      params: { name: 'lookup_ch_clearing', arguments: { iid: '230' } },
    }));
  }

  async function postBatch(
    app: ReturnType<typeof makeApp>,
    sessionId: string,
    ip: string,
    n: number,
  ) {
    return app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        // Last segment is the trusted-proxy hop, which is what the limiter reads.
        'X-Forwarded-For': `198.51.100.1, ${ip}`,
      },
      body: JSON.stringify(batchOf(n)),
    });
  }

  it('bills every tool call in a batch, so an oversized batch is refused', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);

    // One batch carrying more calls than a whole day's allowance.
    const res = await postBatch(app, sessionId, '203.0.113.201', 40);
    const body = await parseStreamableHttp(res);

    expect(body.error, 'a 40-call batch must not slip past the daily allowance').toBeDefined();
    expect(body.error?.code).toBe(-32000);
    expect(body.error?.message).toContain('Daily MCP free tier limit reached');
  });

  it('leaves a single tool call unaffected', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'X-Forwarded-For': `198.51.100.1, 203.0.113.202`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'lookup_ch_clearing', arguments: { iid: '230' } },
      }),
    });
    const body = await parseStreamableHttp(res);
    expect(body.error).toBeUndefined();
  });

  it('does not bill discovery, even sent as a batch', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'X-Forwarded-For': `198.51.100.1, 203.0.113.203`,
      },
      body: JSON.stringify(
        Array.from({ length: 40 }, (_, i) => ({
          jsonrpc: '2.0',
          id: 300 + i,
          method: 'tools/list',
          params: {},
        })),
      ),
    });
    const body = await parseStreamableHttp(res);
    expect(body.error, 'tools/list is free and must stay free in a batch').toBeUndefined();
  });
});

/**
 * Two exit doors for MCP sessions, tested on a store of three.
 *
 * Each live session holds a whole McpServer — 2.77 MB of heap, measured after
 * two forced GCs during the 2026-09-01 security audit (SEC-01 / MCP-08) — and
 * until that audit the Map holding them had no exit at all: the SDK's close
 * hooks fire only for a client that sends DELETE or drops its stream, which
 * directory crawlers never do. The rules are exercised here on a store built
 * with a cap of 3 rather than on the live one: filling the real cap would
 * allocate hundreds of megabytes of McpServer and leave them in the runner for
 * every test file that comes after.
 */
describe('MCP session store — the two exit doors', () => {
  const fakeTransport = (): WebStandardStreamableHTTPServerTransport =>
    ({ close: () => Promise.resolve() }) as unknown as WebStandardStreamableHTTPServerTransport;

  it('drops a session left idle past the TTL', () => {
    const store = createMcpSessionStore(3, 30 * 60 * 1000);
    const t0 = 1_000_000;
    store.set('idle', fakeTransport(), t0);
    store.set('busy', fakeTransport(), t0);

    // 'busy' is read 29 minutes in, so it is not idle when the sweep runs.
    store.get('busy', t0 + 29 * 60 * 1000);
    expect(store.sweep(t0 + 31 * 60 * 1000)).toBe(1);

    expect(store.get('idle')).toBeUndefined();
    expect(store.get('busy')).toBeDefined();
  });

  it('evicts the least recently used session when the cap is reached', () => {
    const store = createMcpSessionStore(3, 30 * 60 * 1000);
    const t0 = 1_000_000;
    store.set('a', fakeTransport(), t0);
    store.set('b', fakeTransport(), t0 + 1);
    store.set('c', fakeTransport(), t0 + 2);
    // 'a' is used again, so 'b' becomes the oldest.
    store.get('a', t0 + 3);

    store.set('d', fakeTransport(), t0 + 4);

    expect(store.size).toBe(3);
    expect(store.get('b'), 'the least recently used session should have gone').toBeUndefined();
    expect(store.get('a')).toBeDefined();
    expect(store.get('c')).toBeDefined();
    expect(store.get('d')).toBeDefined();
  });

  it('never grows past the cap, however many sessions arrive', () => {
    const store = createMcpSessionStore(3, 30 * 60 * 1000);
    for (let i = 0; i < 50; i++) store.set(`s${i}`, fakeTransport(), 1_000_000 + i);
    expect(store.size).toBe(3);
  });
});

/**
 * What a client hears when its session is gone (MCP-09, audit 2026-09-01).
 *
 * The SDK answers `400 Bad Request: Server not initialized`, which describes
 * the server rather than the session — an LLM reading it concludes the service
 * is broken instead of re-opening a session. It happens after every redeploy
 * (the store is in memory) and now after an idle sweep too.
 */
describe('POST /mcp — an expired session says what to do about it', () => {
  async function callWithSession(app: ReturnType<typeof makeApp>, sessionId: string) {
    return app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'x-real-ip': freshIp(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }),
    });
  }

  it('answers 404 and names the remedy for an unknown session id', async () => {
    const app = makeApp();
    const res = await callWithSession(app, '00000000-0000-4000-8000-000000000000');
    // 404 is what the streamable-HTTP spec reserves for an unknown session id:
    // a compliant client re-sends `initialize` on it instead of retrying.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.message).toContain('Session expired or server redeployed');
    expect(body.error.message).toContain('initialize');
  });

  it('gives the same answer once the idle sweep has taken the session', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    // Only Date is faked: the awaits below still need real timers to resolve.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 31 * 60 * 1000);
      expect(mcpSessions.sweep()).toBeGreaterThanOrEqual(1);
      const res = await callWithSession(app, sessionId);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain('Send initialize again');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Opening a session is the expensive request, and nothing counted it (SEC-01).
 *
 * `initialize` is not a `tools/call`, so it escaped the daily allowance
 * entirely: 300 anonymous POSTs from one address retained 812 MB, at roughly
 * 277 MB a minute under the global rate limiter alone.
 */
describe('POST /mcp — opening a session is metered per address', () => {
  it(`refuses the ${MCP_SESSIONS_PER_IP_DAY + 1}st new session from one address in a day`, async () => {
    const app = makeApp();
    const ip = '198.51.100.240';
    // A POST with no session id builds a transport whatever it carries, and
    // that is the memory being metered — so the budget is burnt here with
    // requests that never become stored sessions, which keeps the test's own
    // footprint flat.
    const burn = async () =>
      app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'x-real-ip': ip,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
      });

    for (let i = 0; i < MCP_SESSIONS_PER_IP_DAY; i++) await burn();

    const refused = await burn();
    const body = (await refused.json()) as {
      error?: { code: number; message: string; data: { used: number } };
    };
    expect(body.error?.code).toBe(-32000);
    expect(body.error?.message).toContain('Daily MCP session limit reached');

    // And the same ledger stops a fresh handshake from that address.
    const initRes = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-real-ip': ip,
      },
      body: JSON.stringify({ ...RPC_BASE, method: 'initialize', params: INIT_PARAMS }),
    });
    expect(
      initRes.headers.get('mcp-session-id'),
      'no session should be opened past the cap',
    ).toBeNull();
  });
});

/**
 * The free tier, billed in units of data instead of calls (MCP-07).
 *
 * Ten calls of `batch_validate_iban` at 100 IBANs each was 1,000 enriched
 * validations per address per day, against 200 REST calls a MONTH for a
 * verified free key: the anonymous path was 150x more generous than the
 * signed-up one. Every other surface already bills this tool per IBAN.
 */
describe('POST /mcp — batch_validate_iban bills per IBAN', () => {
  it('spends a whole day of allowance on one 100-IBAN batch', async () => {
    const app = makeApp();
    const ip = '198.51.100.241';
    const sessionId = await initialize(app, ip);
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'x-real-ip': ip,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'batch_validate_iban',
          arguments: { ibans: Array.from({ length: 100 }, () => 'DE89370400440532013000') },
        },
      }),
    });
    const body = await parseStreamableHttp(res);
    expect(body.error, 'a 100-IBAN batch must not cost one unit').toBeDefined();
    expect(body.error?.code).toBe(-32000);
    expect((body.error as unknown as { data: { used: number } }).data.used).toBe(100);
  });

  it('leaves a small batch inside the allowance', async () => {
    const app = makeApp();
    const ip = '198.51.100.242';
    const sessionId = await initialize(app, ip);
    const callResp = await rpc(
      app,
      sessionId,
      'tools/call',
      {
        name: 'batch_validate_iban',
        arguments: { ibans: ['DE89370400440532013000', 'CH9300762011623852957'] },
      },
      12,
      ip,
    );
    expect(callResp.error).toBeUndefined();
  });
});

/**
 * What a call costs, and what it was billed (MCP-10 and MCP-17).
 *
 * Six of the seven data tools named no price at all, so an agent reading
 * tools/list had no basis on which to decide to pay — and every result
 * announced `cost_usdc: 0.005` on a tier that charges nothing, so an agent
 * relaying that field told its operator about a charge nobody made.
 */
describe('tools/list and tools/call — the price is stated, the bill is honest', () => {
  it('names a cost in every tool description', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const listResp = await rpc(app, sessionId, 'tools/list');
    const tools = (listResp.result as { tools: Array<{ name: string; description?: string }> })
      .tools;
    for (const tool of tools) {
      if (tool.name === 'send_feedback') continue; // free by design, and says so in its own words
      expect(tool.description, `${tool.name} states no price`).toContain('COST:');
      expect(tool.description, `${tool.name} states no free allowance`).toContain(
        '/v1/keys/generate',
      );
    }
  });

  it('bills validate_iban zero on this transport and still publishes the list price', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'validate_iban',
      arguments: { iban: 'DE89370400440532013000' },
    });
    expect(callResp.error).toBeUndefined();
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    // Asserted on structuredContent because that is what the schema strips:
    // a field missing from the outputSchema is a field no agent ever sees.
    expect(result.structuredContent!.cost_usdc, 'a free call must not report a charge').toBe(0);
    expect(result.structuredContent!.list_price_usdc, 'stripped by the output schema').toBe(0.005);
  });

  it('does the same inside every row of a batch', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'batch_validate_iban',
      arguments: { ibans: ['DE89370400440532013000'] },
    });
    const result = callResp.result as {
      structuredContent?: { results?: Array<Record<string, unknown>> };
    };
    const first = result.structuredContent!.results![0];
    expect(first.cost_usdc).toBe(0);
    expect(first.list_price_usdc).toBe(0.002);
  });

  it('publishes the outcome and the tool on the response itself', async () => {
    // The telemetry middleware in app.ts reads these headers to tell a served
    // call from a refused one (MCP-04). They have to survive on the Response
    // the SDK transport builds, not only on the JSON-RPC error path.
    const app = makeApp();
    const ip = freshIp();
    const sessionId = await initialize(app, ip);
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'x-real-ip': ip,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: { name: 'lookup_ch_clearing', arguments: { iid: '230' } },
      }),
    });
    expect(res.headers.get('X-MCP-Outcome')).toBe('ok');
    expect(res.headers.get('X-MCP-Tool')).toBe('lookup_ch_clearing');
  });

  it('does the same on the Swiss clearing lookup', async () => {
    const app = makeApp();
    const sessionId = await initialize(app);
    const callResp = await rpc(app, sessionId, 'tools/call', {
      name: 'lookup_ch_clearing',
      arguments: { iid: '230' },
    });
    const result = callResp.result as { structuredContent?: Record<string, unknown> };
    expect(result.structuredContent!.cost_usdc).toBe(0);
    expect(result.structuredContent!.list_price_usdc).toBe(0.003);
  });
});

/**
 * DNS rebinding, refused where it can happen and nowhere else (MCP-14/SEC-07).
 *
 * A page on an attacker's origin can point its own hostname at this container.
 * The SDK's guard is the cheap answer, but it only runs when BOTH
 * `allowedHosts` and `enableDnsRebindingProtection` are set — which is how this
 * can look done and not be. It stays off in dev and in tests, where the Host is
 * `localhost` and a strict list would refuse every local probe.
 */
describe('POST /mcp — Host allow-list', () => {
  it('is off by default, so local and test callers are never refused', async () => {
    expect(process.env.MCP_ALLOWED_HOSTS).toBeUndefined();
    const app = makeApp();
    const sessionId = await initialize(app);
    expect(sessionId).toBeTruthy();
  });

  it('refuses a Host outside the list once one is configured', async () => {
    process.env.MCP_ALLOWED_HOSTS = 'api.ibanforge.com';
    try {
      const app = makeApp();
      const res = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'x-real-ip': freshIp(),
          Host: 'attacker.example.net',
        },
        body: JSON.stringify({ ...RPC_BASE, method: 'initialize', params: INIT_PARAMS }),
      });
      expect(res.status).toBe(403);
      expect(res.headers.get('mcp-session-id')).toBeNull();
    } finally {
      delete process.env.MCP_ALLOWED_HOSTS;
    }
  });
});
