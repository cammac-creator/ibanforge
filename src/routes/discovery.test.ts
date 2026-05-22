import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { discovery } from './discovery.js';

function makeApp() {
  const app = new Hono();
  app.route('/', discovery);
  return app;
}

describe('discovery — agent manifest + aliases', () => {
  it('serves the canonical /.well-known/agents.json', async () => {
    const res = await makeApp().request('/.well-known/agents.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schema_version: string; capabilities: unknown[] };
    expect(body.schema_version).toBe('v1');
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBeGreaterThan(0);
  });

  it('serves the same manifest on the /.well-known/agent.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/agents.json')).json();
    const res = await app.request('/.well-known/agent.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves the same manifest on the /agents.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/agents.json')).json();
    const res = await app.request('/agents.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves the same manifest on the /agent-directory.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/agents.json')).json();
    const res = await app.request('/agent-directory.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves /agents.txt as plain text', async () => {
    const res = await makeApp().request('/agents.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body).toContain('IBANforge');
    expect(body).toContain('llms.txt');
  });
});
