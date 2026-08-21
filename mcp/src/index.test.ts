/**
 * The published `ibanforge-mcp` package, driven exactly the way a client
 * drives it: over stdio, through the MCP protocol, against the built
 * `dist/index.js`.
 *
 * These tests exist because of a bug that no unit test could have caught. All
 * every tool declares an `outputSchema`; none of them returned
 * `structuredContent`. The spec says a tool that declares the first must
 * provide the second, and conformant clients enforce it — the official Python
 * SDK raises `RuntimeError: Tool <name> has an output schema but did not
 * return structured content` and the call never completes. The server starts,
 * `tools/list` looks healthy, and every single call fails. A maintainer at
 * agno hit exactly this on 2026-05-28 and it sat unnoticed for two months.
 *
 * So the assertion has to be made where the client makes it: on the wire.
 * The API is stubbed on localhost, which keeps the test hermetic and lets us
 * pin the payload the schema is checked against.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');

/** A BIC payload shaped like the real one, satisfying `required: [bic, found, valid_format]`. */
const BIC_PAYLOAD = {
  bic: 'UBSWCHZH80A',
  found: true,
  valid_format: true,
  bank_name: 'UBS Switzerland AG',
  country: { code: 'CH', name: 'Switzerland' },
  city: 'Zurich',
};

let api: HttpServer;
let apiBase: string;
let client: Client;
/** Raw bodies the tool POSTed to /v1/feedback, so the relayed shape can be asserted. */
const feedbackBodies: string[] = [];

beforeAll(async () => {
  api = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/v1/bic/')) {
      res.writeHead(200).end(JSON.stringify(BIC_PAYLOAD));
      return;
    }
    // send_feedback relays to the real route rather than writing anything of
    // its own — that relay is what gives it the route's per-source quota. The
    // stub answers the route's real shape (201, extra fields the tool drops).
    if (req.url === '/v1/feedback' && req.method === 'POST') {
      feedbackBodies.push('');
      let raw = '';
      req.on('data', (chunk) => { raw += String(chunk); });
      req.on('end', () => {
        feedbackBodies[feedbackBodies.length - 1] = raw;
        res.writeHead(201).end(JSON.stringify({ ok: true, id: 4242, message: 'Feedback received.', status: 'open', next_steps: {} }));
      });
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
  const addr = api.address();
  if (typeof addr === 'string' || addr === null) throw new Error('no port');
  apiBase = `http://127.0.0.1:${addr.port}`;

  client = new Client({ name: 'contract-test', version: '1' }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      env: { ...process.env, IBANFORGE_API_BASE: apiBase, IBANFORGE_API_KEY: '' } as Record<string, string>,
    }),
  );
}, 30_000);

afterAll(async () => {
  await client?.close();
  await new Promise<void>((ok) => api?.close(() => ok()));
});

describe('every tool declaring an outputSchema honours it', () => {
  it('exposes six tools, all of them declaring an output schema', async () => {
    const { tools } = await client.listTools();
    // Six depuis le 21/08/2026 : `send_feedback` a rejoint les 5 outils de
    // donnée (audit B3 — le paquet npm était la seule surface sans boîte à
    // réclamations, alors que c'est le canal de distribution principal).
    expect(tools).toHaveLength(6);
    for (const t of tools) {
      expect(t.outputSchema, `${t.name} declares no outputSchema`).toBeDefined();
    }
  });

  it('returns structuredContent on a successful call', async () => {
    const res = await client.callTool({ name: 'lookup_bic', arguments: { bic: 'UBSWCHZH80A' } });

    // The precise failure a conformant client reports. Asserted first so a
    // regression reads as "no structured content" rather than a type error
    // three lines down.
    expect(res.structuredContent, 'lookup_bic returned no structuredContent').toBeDefined();
    expect(res.structuredContent).toMatchObject({ bic: 'UBSWCHZH80A', found: true });
    expect(res.isError).toBeFalsy();
  });

  it('still carries the text content, for clients that only read that', async () => {
    const res = await client.callTool({ name: 'lookup_bic', arguments: { bic: 'UBSWCHZH80A' } });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');
    expect(JSON.parse(content[0].text)).toMatchObject({ bic: 'UBSWCHZH80A' });
  });
});

describe('send_feedback: the complaint box is open on the npm package too', () => {
  /**
   * Until 21/08/2026 this tool existed only on the HTTP transport. npm is the
   * main distribution channel, so the agent that hit the quota wall or could
   * not prefund an x402 payment had no way at all to say "I could not pay you"
   * (audit B3). `scripts/mcp-parity.test.ts` keeps the three surfaces aligned;
   * this test checks that THIS surface actually works on the wire.
   */
  it('relays the report to POST /v1/feedback and answers the {ok, id} contract', async () => {
    const before = feedbackBodies.length;
    const res = await client.callTool({
      name: 'send_feedback',
      arguments: { error_type: 'stale_bic', notes: 'Bank merged last year, the name is out of date.', endpoint: '/v1/bic/UBSWCHZH80A' },
    });

    expect(res.isError).toBeFalsy();
    // The route answers {ok, id, message, status, next_steps}; the tool contract
    // is {ok, id} on all three surfaces. Parity on names would be worthless if
    // the shapes disagreed.
    expect(res.structuredContent).toEqual({ ok: true, id: 4242 });
    expect(feedbackBodies.length, 'the tool did not call the route at all').toBe(before + 1);
    const sent = JSON.parse(feedbackBodies[feedbackBodies.length - 1]) as Record<string, unknown>;
    expect(sent.error_type).toBe('stale_bic');
    expect(sent.endpoint).toBe('/v1/bic/UBSWCHZH80A');
    // Provenance: a report arriving through the npm package has no IP and no
    // key, so the agent field is the only thing that says where it came from.
    expect(sent.agent).toBe('mcp-npm');
  });

  it('refuses an empty report locally rather than spending a round trip', async () => {
    const before = feedbackBodies.length;
    const res = await client.callTool({ name: 'send_feedback', arguments: { error_type: 'other', notes: 'x' } });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    expect(feedbackBodies.length, 'a rejected input must not reach the route').toBe(before);
  });
});

describe('errors are flagged, not dressed up as results', () => {
  // A rejected input cannot satisfy `required: [bic, found, valid_format]`, so
  // attaching structuredContent to it would trade one validation failure for
  // another. `isError` is the branch the spec reserves for this, and it is
  // what tells a client to skip output-schema validation.
  it('marks a rejected input as an error and omits structuredContent', async () => {
    const res = await client.callTool({ name: 'lookup_bic', arguments: { bic: 'XX' } });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    const content = res.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text).error).toBe('invalid_bic');
  });

  it('marks an unknown tool as an error', async () => {
    const res = await client.callTool({ name: 'no_such_tool', arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
  });

  it('marks an upstream failure as an error rather than a result', async () => {
    // The stub 404s everything but /v1/bic/, so this exercises the `_error`
    // branch of apiCall with a real non-ok response.
    const res = await client.callTool({ name: 'check_compliance', arguments: { iban: 'CH9300762011623852957' } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
  });
});
