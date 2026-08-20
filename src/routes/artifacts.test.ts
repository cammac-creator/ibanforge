import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { artifacts } from './artifacts.js';
import { discovery } from './discovery.js';
import { openapi } from './openapi.js';
import { buildApp } from '../app.js';

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
 * Some promised paths (/llms.txt) are registered on the root app rather than in
 * a router. They used to be checked by scanning index.ts as TEXT, because
 * index.ts starts a listening server on import and could not be mounted here —
 * so the check verified that a string appeared in a file, not that a URL
 * answered. Since the assembly was extracted into `buildApp()` (src/app.ts,
 * which starts nothing on import), they are fetched for real like every other
 * entry.
 */
const rootApp = buildApp();

async function get(path: string): Promise<Response> {
  const url = `https://api.ibanforge.com${path}`;
  const res = await app.request(url);
  // Not served by the three routers mounted above → ask the full application,
  // which is where the root-level discovery files live.
  return res.status === 404 ? rootApp.request(url) : res;
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
