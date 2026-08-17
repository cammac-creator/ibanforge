// src/middleware/enrich-402.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { enrich402Middleware } from './enrich-402.js';
import type { HonoEnv, PaywallCause } from '../types.js';

/**
 * Reco-IA audit 2026-07-25. The x402 SDK emits an EMPTY 402 body ({}) for every
 * gated route, so enrich-402 rebuilds the whole envelope from its own PRICING
 * table. The credit-pack sales routes were gated but absent from that table, so
 * they answered 402 with `accepts: []` — no scheme, no payTo, no amount. An
 * x402 client reads accepts[] to build its EIP-3009 signature, so the ONLY
 * autonomous way to buy credits was unusable, exactly at the point of
 * conversion, while "no dead-ends: your agent always has a path to pay" was
 * published on every surface.
 */
describe('credit-pack purchase routes are payable by a machine', () => {
  const app = new Hono();
  app.use('*', enrich402Middleware());
  for (const slug of ['1k', '5k', '25k']) {
    app.post(`/v1/credits/buy/${slug}`, () => new Response('', { status: 402 }));
  }

  it.each([
    ['1k', '5000000'],
    ['5k', '20000000'],
    ['25k', '80000000'],
  ])('bundle %s advertises a payable offer of %s (USDC, 6 decimals)', async (slug, amount) => {
    const res = await app.request(`/v1/credits/buy/${slug}`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      accepts: Array<Record<string, unknown>>;
      resource: { url: string };
    };

    expect(body.accepts).toHaveLength(1);
    const offer = body.accepts[0];
    expect(offer.amount).toBe(amount);
    expect(offer.scheme).toBe('exact');
    expect(offer.network).toBe('eip155:8453');
    expect(offer.payTo).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(offer.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(body.resource.url).toBe(`https://api.ibanforge.com/v1/credits/buy/${slug}`);
  });

  it('states what the buyer receives, so an agent can choose a bundle', async () => {
    const res = await app.request('/v1/credits/buy/5k', { method: 'POST', body: '{}' });
    const body = (await res.json()) as { resource: { description: string } };
    expect(body.resource.description).toMatch(/5,000 credits/);
  });

  // `extra` is the EIP-712 domain the payer signs against. v1 let us stuff
  // inputSchema and outputExample in there; doing that in v2 puts arbitrary
  // metadata inside signing material.
  it('keeps the signing domain clean of discovery metadata', async () => {
    const res = await app.request('/v1/credits/buy/1k', { method: 'POST', body: '{}' });
    const body = (await res.json()) as { accepts: Array<{ extra: Record<string, unknown> }> };
    expect(Object.keys(body.accepts[0].extra).sort()).toEqual(['name', 'version']);
  });
});

describe('enrich402Middleware', () => {
  it('enriches empty 402 responses with helpful body', async () => {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.get('/test', (c) => {
      return new Response('{}', {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'payment-required': 'base64-x402-data-here',
        },
      });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body.error).toBe('payment_required');
    expect(body.message).toContain('API key');
    expect(body.free_tier).toBeDefined();
    expect(body.free_tier.signup).toContain('/v1/keys/generate');
    expect(body.x402).toBeDefined();
    expect(res.headers.get('payment-required')).toBe('base64-x402-data-here');
  });

  it('passes through non-402 responses unchanged', async () => {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('passes through 402 responses that already have content', async () => {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.get('/test', (c) => {
      return c.json({ error: 'custom_402', detail: 'Already has body' }, 402);
    });

    const res = await app.request('/test');
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('custom_402');
  });

  it('Path 1 — exposes the credit_packs rail and a 3-way message', async () => {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.post('/v1/iban/validate', () => {
      return new Response('{}', {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    expect(res.status).toBe(402);

    const body = await res.json();
    // new credit_packs rail
    expect(body.credit_packs).toBeDefined();
    expect(body.credit_packs.pay_by_card).toBe('https://api.ibanforge.com/#pricing');
    expect(body.credit_packs.pay_by_usdc).toContain('/v1/credits/buy');
    expect(body.credit_packs.pricing).toContain('$5');
    // message now names the packs rail
    expect(body.message).toContain('credit pack');
    // existing blocks keep their field names
    expect(body.free_tier.signup).toContain('/v1/keys/generate');
    expect(body.x402).toBeDefined();
  });
});

describe('enrich402Middleware — the exhausted client must not be handed a way out for free', () => {
  function appWithCause(cause: PaywallCause) {
    const app = new Hono<HonoEnv>();
    app.use('*', async (c, next) => {
      c.set('paywallCause', cause);
      await next();
    });
    app.use('*', enrich402Middleware());
    app.post('/v1/iban/validate', () =>
      new Response('{}', { status: 402, headers: { 'Content-Type': 'application/json' } }),
    );
    return app;
  }

  it('drops the free_tier block when the monthly quota is exhausted', async () => {
    const app = appWithCause({
      reason: 'monthly_quota_exhausted',
      detail: 'Your free tier is exhausted for 2026-07.',
    });

    const res = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.free_tier).toBeUndefined();
    expect(body.credit_packs).toBeDefined();
  });

  it('drops the free_tier block when a prepaid credit bundle is exhausted', async () => {
    const app = appWithCause({
      reason: 'credits_exhausted',
      detail: 'Your prepaid credit bundle is used up.',
      credits: { total: 1000, remaining: 0, topup: 'POST /v1/credits/buy/1k' },
    });

    const res = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.free_tier).toBeUndefined();
  });

  it('keeps the free_tier block for an invalid key — that client may genuinely need one', async () => {
    const app = appWithCause({
      reason: 'invalid_api_key',
      detail: 'An API key was provided but it is invalid or revoked.',
    });

    const res = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    const body = (await res.json()) as { free_tier?: { signup?: string } };

    expect(body.free_tier?.signup).toContain('/v1/keys/generate');
  });
});

describe('the Bazaar discovery block the catalog ingester reads', () => {
  it('names the resource over https, and shows what an answer looks like', async () => {
    // Coinbase's validator, 14/08/2026: every transport and payment check
    // passed and the run still died on "resource must start with 'https://'".
    // The resource lives in the v2 ResourceInfo now, and it must never go out
    // as the plain-http URL Railway hands us behind its TLS terminator.
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.post('/v1/iban/validate', () => new Response('{}', {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    }));

    const res = await app.request('/v1/iban/validate', { method: 'POST' });
    const body = await res.json();
    expect(body.resource.url.startsWith('https://')).toBe(true);
    const bazaar = body.extensions?.bazaar;
    expect(bazaar).toBeDefined();
    expect(bazaar.info.input.type).toBe('http');
    expect(bazaar.info.input.method).toBe('POST');
    // The validator's advisory: consumers need a response example.
    expect(bazaar.info.output.type).toBe('json');
    expect(bazaar.info.output.example).toBeDefined();
  });

  it('groups a parameterised route under its template, not the probed value', async () => {
    // Without this, every BIC ever probed would be catalogued as its own resource.
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.get('/v1/bic/:code', () => new Response('{}', {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    }));

    const res = await app.request('/v1/bic/COBADEFFXXX');
    const body = await res.json();
    expect(body.extensions.bazaar.routeTemplate).toBe('/v1/bic/:code');
    // The resource itself stays the URL that was actually called: a ":code"
    // template published as callable answers 400, which is how two priced
    // resources went unbuyable for two months.
    expect(body.resource.url).toBe('https://api.ibanforge.com/v1/bic/COBADEFFXXX');
  });

  it('still stamps every sample payload as a sample', async () => {
    // The guard that stops an assistant reading the paywall's demo values and
    // reporting them to a user as the real answer. Audit 2026-07-25.
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.get('/v1/ch/clearing/:iid', () => new Response('{}', {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    }));

    const res = await app.request('/v1/ch/clearing/779');
    const example = (await res.json()).extensions.bazaar.info.output.example;
    expect(example._example_notice).toMatch(/ILLUSTRATIVE SAMPLE/);
  });
});

/**
 * The body used to be built here by hand while the SDK put its own
 * announcement in the `PAYMENT-REQUIRED` header, and the two disagreed: the
 * header said x402 v2 with `amount` on `eip155:8453`, the body said v1 with
 * `maxAmountRequired` on `base`. Two answers to "what do I owe you" for one
 * resource, and which one a client believed depended on where it looked.
 */
describe('the body is the header, not a second opinion', () => {
  const announcement = {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: 'https://api.ibanforge.com/v1/iban/validate',
      description: 'Validate a European IBAN.',
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '5000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x0000000000000000000000000000000000000001',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
    extensions: { bazaar: { discoverable: true } },
  };

  function appServing(header: string) {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.post('/v1/iban/validate', () => new Response('{}', {
      status: 402,
      headers: { 'Content-Type': 'application/json', 'payment-required': header },
    }));
    return app;
  }

  const encoded = Buffer.from(JSON.stringify(announcement)).toString('base64');

  it('repeats the header verbatim rather than re-deriving the terms', async () => {
    const res = await appServing(encoded).request('/v1/iban/validate', { method: 'POST' });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.x402Version).toBe(2);
    expect(body.accepts).toEqual(announcement.accepts);
    expect(body.resource).toEqual(announcement.resource);
    expect(body.extensions).toEqual(announcement.extensions);
  });

  it('keeps the published error CODE, which is the one agents branch on', async () => {
    // The header carries the SDK's prose. `payment_required` is what llms.txt
    // and the error table promise, so the body keeps it.
    const res = await appServing(encoded).request('/v1/iban/validate', { method: 'POST' });
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('payment_required');
  });

  it('falls back to its own table when the header is unreadable', async () => {
    const res = await appServing('not-base64-at-all!!').request('/v1/iban/validate', { method: 'POST' });
    const body = (await res.json()) as { x402Version: number; accepts: Array<{ amount: string }> };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0].amount).toBe('5000');
  });

  it('never announces the v1 dialect, whichever path built the body', async () => {
    for (const app of [appServing(encoded), appServing('unreadable')]) {
      const res = await app.request('/v1/iban/validate', { method: 'POST' });
      const body = (await res.json()) as { accepts: Array<Record<string, unknown>> };
      expect(body.accepts[0]).not.toHaveProperty('maxAmountRequired');
      expect(body.accepts[0].network).toBe('eip155:8453');
    }
  });
});
