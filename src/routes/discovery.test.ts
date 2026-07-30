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

/**
 * Paths machines actually ask for, taken from production request_log on
 * 2026-07-28 (distinct-IP counts in each test). Every one of these returned 404
 * while a near-identical path returned 200, which is the signature of a naming
 * convention we simply had not covered.
 */
describe('discovery — 404s measured on real crawler traffic (2026-07-28)', () => {
  it('serves /.well-known/agent-card.json, the A2A card spelling (104 distinct IPs)', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/agents.json')).json();
    const res = await app.request('/.well-known/agent-card.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves /.well-known/agent-directory.json, not only the bare path (3 distinct IPs)', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/agent-directory.json')).json();
    const res = await app.request('/.well-known/agent-directory.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves oauth-protected-resource under /mcp, the suffix form clients use (90 distinct IPs)', async () => {
    // RFC 9728 inserts the well-known segment before the path, which we already
    // serve at /.well-known/oauth-protected-resource/mcp. Many MCP clients
    // append it instead. Both must answer, or the client sees a 404 and cannot
    // tell "no OAuth here" from "server broken".
    const res = await makeApp().request('/mcp/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: string; authentication_methods: unknown[] };
    expect(body.resource).toBe('https://api.ibanforge.com/mcp');
    expect(Array.isArray(body.authentication_methods)).toBe(true);
  });

  it('serves /.well-known/glama.json with LIVE counts, never hardcoded (45 distinct IPs)', async () => {
    const res = await makeApp().request('/.well-known/glama.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; tools: { name: string }[]; description: string };
    expect(body.name).toBe('IBANforge');
    expect(body.tools.map((t) => t.name)).toEqual([
      'validate_iban',
      'batch_validate_iban',
      'lookup_bic',
      'check_compliance',
      'lookup_ch_clearing',
    ]);
    // The stale card on glama.ai still says "39K+ entries / 75+ countries".
    // Guard against ever serving a frozen figure again.
    expect(body.description).not.toMatch(/75\+\s*countries/i);
    expect(body.description).not.toMatch(/\b39K\+/i);
  });

  it('serves /.well-known/security.txt as plain text with a contact (16 distinct IPs)', async () => {
    const res = await makeApp().request('/.well-known/security.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await res.text()).toMatch(/^Contact: /m);
  });
});

describe('discovery — dead Stripe placeholders still followed from caches', () => {
  // The landing page shipped href="STRIPE_PAYMENT_LINK_*" literals between
  // 2026-05-12 and 2026-06-19. The HTML is fixed, but crawlers replay the
  // cached URLs: ~90 distinct IPs per pack were still hitting them on 28/07.
  const packs = [
    ['/STRIPE_PAYMENT_LINK_1K', '1k'],
    ['/STRIPE_PAYMENT_LINK_5K', '5k'],
    ['/STRIPE_PAYMENT_LINK_25K', '25k'],
  ] as const;

  for (const [path] of packs) {
    it(`redirects ${path} to a live Stripe Payment Link`, async () => {
      const res = await makeApp().request(path);
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toMatch(/^https:\/\/buy\.stripe\.com\//);
    });
  }

  it('sends each pack to its own link, not all to the same one', async () => {
    const app = makeApp();
    const locations = await Promise.all(
      packs.map(async ([p]) => (await app.request(p)).headers.get('location')),
    );
    expect(new Set(locations).size).toBe(3);
  });
});

describe('discovery — www-only pages probed on the api host', () => {
  // Claude Code fetched these on api.ibanforge.com and got 404 while the same
  // paths serve 200 on ibanforge.com. /docs already redirected; these did not.
  it('redirects /pricing to the pricing page', async () => {
    const res = await makeApp().request('/pricing');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://ibanforge.com/pricing');
  });

  for (const lang of ['en', 'de', 'fr']) {
    it(`redirects /${lang}/docs to the localised docs`, async () => {
      const res = await makeApp().request(`/${lang}/docs`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`https://ibanforge.com/${lang}/docs`);
    });
  }
});

describe('discovery — second sweep, 2026-07-29', () => {
  // The first sweep filtered the log too aggressively and missed these.
  it('serves /mcp/.well-known/mcp, the sibling of the oauth probe (90 distinct IPs)', async () => {
    const res = await makeApp().request('/mcp/.well-known/mcp');
    expect(res.status).toBe(200);
  });

  it('points /swagger.json at the OpenAPI document (13 distinct IPs)', async () => {
    const res = await makeApp().request('/swagger.json');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/openapi.json');
  });

  it('points /api/openapi.json at the OpenAPI document (9 distinct IPs)', async () => {
    const res = await makeApp().request('/api/openapi.json');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/openapi.json');
  });

  it('points /sse at the MCP endpoint (14 distinct IPs on the legacy transport)', async () => {
    const res = await makeApp().request('/sse');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/mcp');
  });

  it('tolerates the trailing dot in /mcp. (23 distinct IPs, a client-side bug)', async () => {
    const res = await makeApp().request('/mcp.');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/mcp');
  });

  it('sends /favicon.ico to the site favicon (366 distinct IPs, the largest 404 we had)', async () => {
    const res = await makeApp().request('/favicon.ico');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ibanforge.com/favicon.ico');
  });

  it('sends /sitemap.xml to the site sitemap (36 distinct IPs)', async () => {
    const res = await makeApp().request('/sitemap.xml');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ibanforge.com/sitemap.xml');
  });
});

// Third sweep, 2026-07-30, from the Clients Bot tab: what still 404s after the
// two passes above. Counts are hits over the ninety days to 30/07.
describe('discovery — third sweep', () => {
  it('answers POST / with 405 and says which verbs work (3,469 hits, one health checker)', async () => {
    // APIHub-HealthCheck POSTs the API root. 404 tells it we do not exist;
    // 405 tells it we do and it used the wrong verb, which is the truth.
    const res = await makeApp().request('/', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('leaves GET / alone, which the landing page answers', async () => {
    // discovery mounts before landing, so a catch-all here would eat the site.
    const res = await makeApp().request('/');
    expect(res.status).toBe(404);
  });

  it('serves /.well-known/x402.json, the name half the crawlers use (457 hits)', async () => {
    const res = await makeApp().request('/.well-known/x402.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { x402Version: number; endpoints: unknown[] };
    expect(body.x402Version).toBe(1);
    expect(Array.isArray(body.endpoints)).toBe(true);
  });

  it('sends /security.txt to its RFC 9116 home rather than duplicating it (83 hits)', async () => {
    const res = await makeApp().request('/security.txt');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/.well-known/security.txt');
  });

  it('sends /api/mcp to /mcp without losing the method (76 hits)', async () => {
    const res = await makeApp().request('/api/mcp', { method: 'POST' });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/mcp');
  });

  it('still refuses to invent an OAuth authorization server (1,044 hits, and rightly 404)', async () => {
    // aisec-registry probes RFC 8414 metadata. We have no authorization server:
    // authentication is an API key or an x402 payment. Publishing a document
    // there would misrepresent us to a security registry, of all readers.
    const res = await makeApp().request('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(404);
  });
});

// The x402 catalogue advertised the route TEMPLATE as the resource URL:
// "resource": "https://api.ibanforge.com/v1/bic/:code". An agent following the
// listing calls that literally, the server reads ":code" as a BIC and answers
// 400 — so the agent never sees the 402 and can neither learn the price nor
// pay. Two of five priced resources were unbuyable this way for two months.
describe('x402 catalogue — every advertised resource must be callable', () => {
  const accepts = async () => {
    const res = await makeApp().request('/.well-known/x402');
    const body = (await res.json()) as {
      endpoints: Array<{ method: string; path: string; accepts: Array<{ resource: string }> }>;
    };
    return body.endpoints;
  };

  it('never publishes a path parameter inside a resource URL', async () => {
    for (const e of await accepts()) {
      for (const a of e.accepts) {
        const pathPart = a.resource.replace('https://api.ibanforge.com', '');
        expect(pathPart, `${e.method} ${e.path} advertises a template`).not.toMatch(/[:{]/);
      }
    }
  });

  it('advertises a BIC that our own validator accepts, or the 402 never happens', async () => {
    const { validateBIC } = await import('../lib/bic-validator.js');
    const bic = (await accepts()).find((e) => e.path.startsWith('/v1/bic/'));
    const code = bic!.accepts[0].resource.split('/').pop()!;
    expect(validateBIC(code).valid).toBe(true);
  });

  it('advertises a Swiss IID our clearing register actually holds', async () => {
    const { lookupClearing } = await import('../lib/ch-clearing.js');
    const ch = (await accepts()).find((e) => e.path.startsWith('/v1/ch/clearing/'));
    const iid = ch!.accepts[0].resource.split('/').pop()!;
    expect(lookupClearing(iid)).not.toBeNull();
  });

  it('keeps the template in `path`, which is what documents the shape', async () => {
    const paths = (await accepts()).map((e) => e.path);
    expect(paths).toContain('/v1/bic/:code');
    expect(paths).toContain('/v1/ch/clearing/:iid');
  });

  it('leaves the bodyless endpoints exactly as they were', async () => {
    const validate = (await accepts()).find((e) => e.path === '/v1/iban/validate');
    expect(validate!.accepts[0].resource).toBe('https://api.ibanforge.com/v1/iban/validate');
  });
});
