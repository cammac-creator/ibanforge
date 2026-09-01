import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { MCP_TOOLS, FREE_ENDPOINTS, dataTools } from './inventory.js';

/**
 * Every surface that publishes the tool list publishes the SAME list.
 *
 * ## Why this file exists
 *
 * The audit of 2026-09-01 counted the MCP tools on every surface and got five
 * different answers for one product (DX-01): 8 served, 7 on the server card,
 * "7 tools" in the prose of /llms.txt, 5 in the A2A agent card, 5 in the x402
 * document, 5 in the static frontend mcp.json — which had also been frozen at
 * version 1.3.3 since 2026-07-03 (MCP-05).
 *
 * The damage was concentrated exactly where it hurts: the A2A card and the
 * x402 document are what agent directories and x402 indexers read, and the two
 * tools missing from both (`validate_payment_reference`, `check_postal_address`,
 * shipped 2026-08-26) are the only two that answer with no key and no payment
 * (MCP-18). The surfaces meant to attract an agent were the surfaces hiding
 * the free doors.
 *
 * So the list now lives in ONE place and the documents derive from it. This
 * file is the other half: a document that drops a tool goes red here.
 *
 * ## Two families, deliberately
 *
 * - The DATA tools (`dataTools()`, i.e. everything read-only) belong on the
 *   surfaces that advertise buyable capabilities: server card, A2A skills,
 *   x402 `mcp.tools`, agents.json `capabilities`. `send_feedback` writes and
 *   is excluded there on purpose.
 * - ALL tools, `send_feedback` included, belong on the surfaces that describe
 *   the MCP server itself: the static `mcp.json` and `/llms.txt`.
 *
 * ## Out of scope on purpose
 *
 * `GET /mcp` (`src/routes/mcp-http.ts`) also publishes a count; since the
 * 2026-09-01 audit it is derived from the live server and asserted against
 * this inventory in `mcp-http.test.ts`. The JSON-RPC `tools/list` needs an
 * `initialize` handshake and is asserted there too. This one covers the six
 * discovery documents, which are the ones that were wrong.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = buildApp();

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const res = await app.request(`https://api.ibanforge.com${path}`);
  expect(res.status, `${path} did not answer 200`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function fetchText(path: string): Promise<string> {
  const res = await app.request(`https://api.ibanforge.com${path}`);
  expect(res.status, `${path} did not answer 200`).toBe(200);
  return res.text();
}

describe('the inventory is internally coherent', () => {
  it('names no tool twice', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every data tool a capability slug, and the writing tool none', () => {
    for (const tool of dataTools()) {
      expect(tool.capability, `${tool.name} has no capability slug`).not.toBeNull();
    }
    for (const tool of MCP_TOOLS.filter((t) => !t.readOnly)) {
      expect(tool.capability, `${tool.name} writes and must not be advertised as a capability`).toBeNull();
    }
  });

  it('has strictly fewer data tools than tools, so `readOnly` really discriminates', () => {
    expect(dataTools().length).toBeLessThan(MCP_TOOLS.length);
    expect(dataTools().length).toBeGreaterThan(0);
  });
});

describe('the served discovery documents carry every data tool', () => {
  it('the MCP server card lists them all', async () => {
    const card = await fetchJson('/.well-known/mcp/server-card.json');
    const names = (card.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names.sort()).toEqual(dataTools().map((t) => t.name).sort());
  });

  it('the A2A agent card exposes one skill per data tool', async () => {
    const card = await fetchJson('/.well-known/agent-card.json');
    const ids = (card.skills as Array<{ id: string }>).map((s) => s.id);
    expect(ids.sort()).toEqual(dataTools().map((t) => t.name).sort());
  });

  it('the x402 document names them under mcp.tools', async () => {
    const doc = await fetchJson('/.well-known/x402');
    const names = (doc.mcp as { tools: string[] }).tools;
    expect([...names].sort()).toEqual(dataTools().map((t) => t.name).sort());
  });

  it('agents.json declares the capability slug of each data tool', async () => {
    const manifest = await fetchJson('/.well-known/agents.json');
    const capabilities = manifest.capabilities as string[];
    for (const tool of dataTools()) {
      expect(capabilities, `agents.json is missing the capability of ${tool.name}`).toContain(tool.capability);
    }
  });
});

describe('the surfaces that describe the server itself carry all tools', () => {
  it('/llms.txt names every tool, the writing one included', async () => {
    const llms = await fetchText('/llms.txt');
    for (const tool of MCP_TOOLS) {
      expect(llms, `/llms.txt never mentions ${tool.name}`).toContain(tool.name);
    }
  });

  it('/llms.txt announces the real number of tools, not a literal', async () => {
    const llms = await fetchText('/llms.txt');
    expect(llms).toContain(`${MCP_TOOLS.length} tools, no signup`);
    // The count that was actually served while eight tools existed. If it ever
    // comes back, someone typed a number again.
    expect(llms).not.toContain('(7 tools');
  });

  it('the static frontend mcp.json lists every tool and the released version', () => {
    const doc = JSON.parse(readFileSync(resolve(ROOT, 'frontend/public/.well-known/mcp.json'), 'utf8')) as {
      version: string;
      tools: Array<{ name: string }>;
    };
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string };
    // The version guard is the point of this case: the file sat at 1.3.3 for
    // two months while production served 1.4.x, and nothing was watching.
    expect(doc.version).toBe(pkg.version);
    expect(doc.tools.map((t) => t.name).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  it('the static frontend llms.txt names both free tools', () => {
    const llms = readFileSync(resolve(ROOT, 'frontend/public/llms.txt'), 'utf8');
    for (const tool of MCP_TOOLS) {
      expect(llms, `frontend/public/llms.txt never mentions ${tool.name}`).toContain(tool.name);
    }
  });

  it('the static frontend llms.txt counts them right', () => {
    // A static asset cannot interpolate, so its two counts are typed by hand —
    // which is the exact defect this audit spent the evening removing. They
    // cannot be derived, so they are asserted instead.
    const llms = readFileSync(resolve(ROOT, 'frontend/public/llms.txt'), 'utf8');
    const heading = llms.match(/^## (\d+) MCP tools$/m);
    expect(heading, 'the "## N MCP tools" heading is gone').not.toBeNull();
    expect(Number(heading?.[1])).toBe(MCP_TOOLS.length);
    expect(llms).toContain(`the ${MCP_TOOLS.length} tools auto-load`);
  });
});

describe('the free endpoints are advertised where an agent looks before paying', () => {
  it('the x402 document lists all six', async () => {
    const doc = await fetchJson('/.well-known/x402');
    const paths = (doc.free_endpoints as Array<{ path: string }>).map((e) => e.path);
    for (const endpoint of FREE_ENDPOINTS) {
      expect(paths, `free_endpoints omits ${endpoint.path}`).toContain(endpoint.path);
    }
  });

  it('each of them really answers without a key or a payment', async () => {
    // A list of free endpoints is only worth its weight if the endpoints are
    // free. The two shipped on 2026-08-26 answer 200 unauthenticated in
    // production; this asserts the property, not the audit's transcript.
    for (const endpoint of FREE_ENDPOINTS) {
      // /v1/iban/format needs its query parameter to say anything useful, and
      // /v1/address/check and /v1/reference/validate are POST-first; a GET
      // that answers anything other than 401/402 proves the point either way.
      const res = await app.request(`https://api.ibanforge.com${endpoint.path}`);
      expect([401, 402], `${endpoint.path} is advertised as free but answered ${res.status}`).not.toContain(
        res.status,
      );
    }
  });
});
