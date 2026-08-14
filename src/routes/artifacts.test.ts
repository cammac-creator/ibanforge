import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { artifacts } from './artifacts.js';
import { discovery } from './discovery.js';
import { openapi } from './openapi.js';

/**
 * The point of these tests is not that the files exist — it is that apis.json
 * does not lie.
 *
 * apis.json is the index directories and agent crawlers read to find out what we
 * publish, and every entry is a promise that a URL answers. A promise that 404s
 * scores worse than a promise never made: the crawler records the artifact as
 * missing AND the index as unreliable. Since the list and the routes live in two
 * different files, nothing but a test keeps them honest.
 */
const app = new Hono();
app.route('/', discovery);
app.route('/', artifacts);
app.route('/', openapi);

/**
 * Two promised paths are registered on the root app in index.ts rather than in
 * a router, and index.ts starts a listening server on import so it cannot be
 * mounted here. Asserting on its source is uglier than mounting it and far
 * better than dropping them from the check: they are the two most-fetched
 * discovery files we publish.
 */
const INDEX_SOURCE = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const SERVED_BY_ROOT_APP: Record<string, string> = {
  '/llms.txt': "app.get('/llms.txt'",
};

async function get(path: string): Promise<Response> {
  return app.request(`https://api.ibanforge.com${path}`);
}

describe('the published operating artifacts', () => {
  const yamlFiles = [
    'agentic-access',
    'rate-limits',
    'error-semantics',
    'plans',
    'finops',
    'rules',
    'conformance',
    'skills/index',
  ];
  const markdownFiles = [
    'deprecation-policy',
    'auth',
    'roadmap',
    'skills/screen-iban-before-payout',
    'skills/resolve-bank-from-identifier',
  ];

  for (const name of yamlFiles) {
    it(`serves ${name}.yml as YAML`, async () => {
      const res = await get(`/${name}.yml`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('yaml');
      const body = await res.text();
      // A crawler scores an empty file as an absent one, and a truncated
      // template literal is silent.
      expect(body.length).toBeGreaterThan(200);
      expect(body).toContain('specification:');
    });
  }

  for (const name of markdownFiles) {
    it(`serves ${name}.md as Markdown`, async () => {
      const res = await get(`/${name}.md`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('markdown');
      expect((await res.text()).length).toBeGreaterThan(200);
    });
  }

  it('answers the .yaml spelling too, since crawlers disagree', async () => {
    expect((await get('/plans.yaml')).status).toBe(200);
    expect((await get('/.well-known/rate-limits.yml')).status).toBe(200);
  });

  it('states no price the middleware does not charge', async () => {
    // The unit prices in plans.yml are the ones x402 settles. Drifting them
    // apart would publish a tariff we do not honour.
    const plans = await (await get('/plans.yml')).text();
    for (const price of ['0.005', '0.002', '0.003', '0.02']) {
      expect(plans).toContain(price);
    }
  });

  it('marks buying credits as human-in-the-loop, never as autonomous', async () => {
    // The whole value of the access contract is this line. An agent granted
    // autonomy on reads must not read it as a mandate to spend.
    const contract = await (await get('/agentic-access.yml')).text();
    const [acting, human] = contract.split('human_in_the_loop:');
    expect(acting).not.toContain('/v1/credits/buy');
    expect(human).toContain('/v1/credits/buy');
    expect(human).toContain('/v1/keys');
  });
});

describe('apis.json', () => {
  it('promises no URL of ours that does not answer', async () => {
    const doc = (await (await get('/apis.json')).json()) as {
      common?: Array<{ type: string; url: string }>;
      apis?: Array<{ properties?: Array<{ type: string; url: string }> }>;
    };
    const entries = [...(doc.common ?? []), ...(doc.apis ?? []).flatMap((a) => a.properties ?? [])];
    expect(entries.length).toBeGreaterThan(20);

    // Only our own API host is testable here; ibanforge.com is a separate
    // deployment and GitHub is not ours to assert on.
    const ours = entries.filter((e) => e.url.startsWith('https://api.ibanforge.com/'));
    expect(ours.length).toBeGreaterThan(10);

    const broken: string[] = [];
    for (const entry of ours) {
      const path = entry.url.replace('https://api.ibanforge.com', '');
      // The MCP endpoint answers 405 to a sessionless GET by design.
      if (path === '/mcp') continue;
      const registeredOnRoot = SERVED_BY_ROOT_APP[path];
      if (registeredOnRoot) {
        if (!INDEX_SOURCE.includes(registeredOnRoot)) broken.push(`${entry.type} -> ${entry.url}`);
        continue;
      }
      const res = await get(path);
      if (res.status === 404) broken.push(`${entry.type} -> ${entry.url}`);
    }
    expect(broken).toEqual([]);
  });

  it('declares the artifacts an agent needs before committing to an API', async () => {
    const doc = (await (await get('/apis.json')).json()) as { common?: Array<{ type: string }> };
    const types = new Set((doc.common ?? []).map((c) => c.type));
    for (const required of [
      'Authentication',
      'AgenticAccess',
      'RateLimits',
      'ErrorSemantics',
      'Plans',
      'DeprecationPolicy',
      'Rules',
      'Conformance',
      'Skills',
    ]) {
      expect(types).toContain(required);
    }
  });
});
