import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mcpCard } from './mcp-card.js';

function makeApp() {
  const app = new Hono();
  app.route('/', mcpCard);
  return app;
}

describe('mcpCard — MCP server card + discovery aliases', () => {
  it('serves the canonical /.well-known/mcp/server-card.json', async () => {
    const res = await makeApp().request('/.well-known/mcp/server-card.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; tools: unknown[] };
    expect(body.name).toBe('IBANforge');
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(7);
  });

  it('serves the same card on the /.well-known/mcp.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/mcp/server-card.json')).json();
    const res = await app.request('/.well-known/mcp.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves the same card on the /mcp.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/mcp/server-card.json')).json();
    const res = await app.request('/mcp.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });
});

describe('mcp card — extensionless alias measured on crawler traffic', () => {
  // /.well-known/mcp was requested 254 times by 6 distinct IPs on 2026-07-28
  // and returned 404, while /.well-known/mcp.json returned 200.
  it('serves /.well-known/mcp identically to /.well-known/mcp.json', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/mcp.json')).json();
    const res = await app.request('/.well-known/mcp');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });
});
