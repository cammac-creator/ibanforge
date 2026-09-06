// src/middleware/enrich-402.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { enrich402Middleware } from './enrich-402.js';
import {
  ENTRY_PAYMENT_LINK,
  PAYMENT_LINKS,
  PRICING_PAGE,
  PRO_PAYMENT_LINK,
} from '../lib/payment-links.js';
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
    app.get('/test', (_c) => {
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
    // The wall names the free structural route, so a keyless caller learns what
    // costs nothing before deciding whether the registry is worth paying for.
    expect(body.free_structural_check.endpoint).toContain('/v1/iban/format');
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
    // 🚨 This assertion used to demand the HTML anchor, and so locked in the
    // bug: an anonymous 402 — the overwhelming majority of them — pointed a
    // machine client at `https://api.ibanforge.com/#pricing`, a fragment no
    // agent renders. It is now the live Stripe checkout, from the same
    // constant every other card surface uses.
    expect(body.credit_packs.pay_by_card).toBe(ENTRY_PAYMENT_LINK);
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
    app.post(
      '/v1/iban/validate',
      () => new Response('{}', { status: 402, headers: { 'Content-Type': 'application/json' } }),
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

  it('keeps the free_tier block when the KEYLESS trial runs out — that is the conversion', async () => {
    // The one 402 where the signup rail matters most: this caller holds no key
    // at all, has just seen the product work ten times, and the whole trial
    // exists to end here with a key rather than with a shrug.
    const app = appWithCause({
      reason: 'trial_exhausted',
      detail:
        'You used the 10 keyless validations this address gets today; the allowance resets at midnight UTC.',
      quota: { used: 11, limit: 10, month: 'day', resets: 'midnight UTC', remaining: 0 },
    });

    const res = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    const body = (await res.json()) as {
      free_tier?: { signup?: string };
      cause?: { reason: string };
      message?: string;
    };

    expect(body.cause?.reason).toBe('trial_exhausted');
    expect(body.message).toContain('midnight UTC');
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
    app.post(
      '/v1/iban/validate',
      () =>
        new Response('{}', {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

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
    app.get(
      '/v1/bic/:code',
      () =>
        new Response('{}', {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

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
    app.get(
      '/v1/ch/clearing/:iid',
      () =>
        new Response('{}', {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

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
    app.post(
      '/v1/iban/validate',
      () =>
        new Response('{}', {
          status: 402,
          headers: { 'Content-Type': 'application/json', 'payment-required': header },
        }),
    );
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
    const res = await appServing('not-base64-at-all!!').request('/v1/iban/validate', {
      method: 'POST',
    });
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

/**
 * A 402 answering a payment that was actually made has to say why it was
 * refused. On 17/08/2026 /v1/bic/:code did exactly that — rejected a valid
 * signature — and the body said only `payment_required`, so the reason (the
 * CDP facilitator refusing the payload) was reachable only by base64-decoding
 * a response header.
 */
describe('a refused payment says why', () => {
  function appAnnouncing(error: string) {
    const announcement = {
      x402Version: 2,
      error,
      resource: { url: 'https://api.ibanforge.com/v1/iban/validate' },
      accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '5000' }],
    };
    const header = Buffer.from(JSON.stringify(announcement)).toString('base64');
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.post(
      '/v1/iban/validate',
      () =>
        new Response('{}', {
          status: 402,
          headers: { 'Content-Type': 'application/json', 'payment-required': header },
        }),
    );
    return app;
  }

  async function bodyOf(app: Hono) {
    const res = await app.request('/v1/iban/validate', { method: 'POST' });
    return (await res.json()) as { error: string; payment_error?: string };
  }

  it('surfaces the refusal beside the code agents branch on', async () => {
    const body = await bodyOf(appAnnouncing('Facilitator verify failed (400): invalid payload'));
    expect(body.error).toBe('payment_required');
    expect(body.payment_error).toBe('Facilitator verify failed (400): invalid payload');
  });

  it('stays quiet when nobody tried to pay', async () => {
    // "Payment required" is the SDK saying the request was simply unpaid.
    // Repeating it as a failure would cry wolf on every anonymous probe.
    for (const generic of ['Payment required', 'payment_required', '']) {
      const body = await bodyOf(appAnnouncing(generic));
      expect(body.payment_error, generic).toBeUndefined();
    }
  });
});

/**
 * Audit B2, recommendation 1. The one payment rail with a measured conversion
 * — a caller hits the wall, buys a pack under two minutes later — was reaching
 * a fraction of a percent of the callers who saw a wall.
 *
 * The clickable Stripe link entered the 402 body through exactly ONE path:
 * `CARD_CHECKOUT_HINT`, written into `paywallCause.detail` by the api-key
 * middleware, i.e. only for a caller holding a valid key that had run out of
 * allowance. Every other 402 — every anonymous one, which is nearly all of
 * them — got the generic ramp, whose `pay_by_card` was an HTML anchor with a
 * fragment. That is verbatim the failure `src/lib/payment-links.ts` documents
 * as its own reason for existing; the 25/07 fix landed on one branch out of
 * two, and left the frequent one behind.
 */
describe('every 402 carries a card link a machine can follow', () => {
  function anonymous402(path = '/v1/iban/validate') {
    const app = new Hono<HonoEnv>();
    app.use('*', enrich402Middleware());
    app.post(
      path,
      () => new Response('{}', { status: 402, headers: { 'Content-Type': 'application/json' } }),
    );
    return app.request(path, { method: 'POST', body: '{}' });
  }

  it('quotes the live checkout, not an HTML fragment, with no key involved', async () => {
    const body = (await (await anonymous402()).json()) as {
      credit_packs: Record<string, unknown>;
      cause?: unknown;
    };
    // No paywallCause: this is the anonymous branch, the one that was broken.
    expect(body.cause).toBeUndefined();

    expect(body.credit_packs.pay_by_card).toBe(ENTRY_PAYMENT_LINK);
    expect(body.credit_packs.pay_by_card).toMatch(/^https:\/\/buy\.stripe\.com\//);
    // The precise regression: a fragment is not a checkout.
    expect(body.credit_packs.pay_by_card).not.toContain('#pricing');
    expect(body.credit_packs.pay_by_card_all_packs).toBe(PRICING_PAGE);
    // The prose form of the same offer is NOT repeated here: on the
    // exhausted-allowance branch it is already the body's `message`, and one
    // offer stated twice in one response reads worse than stated once.
    expect(body.credit_packs.card_checkout).toBeUndefined();
  });

  it('says the same thing on every paid route, not just the one', async () => {
    for (const path of [
      '/v1/iban/validate',
      '/v1/iban/batch',
      '/v1/iban/compliance',
      '/v1/credits/buy/5k',
    ]) {
      const body = (await (await anonymous402(path)).json()) as {
        credit_packs: { pay_by_card: string };
      };
      expect(body.credit_packs.pay_by_card, path).toBe(ENTRY_PAYMENT_LINK);
    }
  });

  /**
   * The constraint that makes this change safe to ship: catalogs and x402
   * clients read `accepts` and the resource block, and a rename or a removal
   * there is a broken contract, not an improvement. The ramp lives beside
   * those, never inside them.
   */
  it('leaves the machine half of the body untouched', async () => {
    const body = (await (await anonymous402()).json()) as {
      accepts: Array<Record<string, unknown>>;
      resource: { url: string; description: string };
      error: string;
      free_tier: Record<string, unknown>;
      x402: Record<string, unknown>;
      credit_packs: Record<string, unknown>;
    };
    expect(body.error).toBe('payment_required');
    expect(body.accepts).toHaveLength(1);
    expect(Object.keys(body.accepts[0]).sort()).toEqual(
      ['amount', 'asset', 'extra', 'maxTimeoutSeconds', 'network', 'payTo', 'scheme'].sort(),
    );
    expect(body.accepts[0].amount).toBe('5000');
    expect(body.resource.url).toBe('https://api.ibanforge.com/v1/iban/validate');
    // Every field the ramp published before is still published, under its own
    // name — the two card fields were ADDED next to them.
    for (const key of ['description', 'pay_by_card', 'pay_by_usdc', 'pricing']) {
      expect(Object.keys(body.credit_packs), key).toContain(key);
    }
    expect(body.free_tier.signup).toContain('/v1/keys/generate');
    expect(body.x402.discovery).toContain('/.well-known/x402');
  });

  /**
   * The private Editor/OEM Payment Link is sold in conversation and must never
   * appear on a public surface. It is not in payment-links.ts at all, which is
   * what makes importing from that module safe — this test says so out loud so
   * nobody adds it there later. The public links are the three packs and, since
   * 2026-09-02, the Pro monthly plan (`monthly_plan.subscribe_by_card`), which
   * is public by design and lives in the same module.
   */
  it('publishes only the public links: three packs and the Pro plan', async () => {
    const raw = await (await anonymous402()).text();
    const links = raw.match(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    const allowed = [...Object.values(PAYMENT_LINKS as Record<string, string>), PRO_PAYMENT_LINK];
    for (const link of links) {
      expect(allowed).toContain(link);
    }
    expect(links).toContain(PRO_PAYMENT_LINK);
  });
});

/**
 * Audit C2, R2. `/v1/iban/validate/` — the same resource, with the trailing
 * slash a URL normaliser adds by default — answered 404 on POST and 405 on a
 * bare GET. Both are mute: an agent reads "broken" or "does not speak x402" and
 * a trust registry records the same, and neither ever sees the price.
 *
 * 308 rather than 402, deliberately: no handler is mounted on the slashed path,
 * so quoting a price there would charge a payer for a 404. 308 preserves the
 * method AND the body, so the replay lands on the route that can serve it.
 */
describe('a paid route reached with a trailing slash is not a dead end', () => {
  function appWithPaidRoutes() {
    const app = new Hono<HonoEnv>();
    app.use('/v1/*', enrich402Middleware());
    app.post('/v1/iban/validate', () => new Response('{}', { status: 402 }));
    app.post('/v1/iban/batch', () => new Response('{}', { status: 402 }));
    app.get('/v1/bic/:code', () => new Response('{}', { status: 402 }));
    app.post('/v1/credits/buy/:bundle', () => new Response('{}', { status: 402 }));
    return app;
  }

  it.each([
    ['POST', '/v1/iban/validate/', '/v1/iban/validate'],
    ['GET', '/v1/iban/validate/', '/v1/iban/validate'],
    ['POST', '/v1/iban/batch/', '/v1/iban/batch'],
    ['GET', '/v1/bic/UBSWCHZH80A/', '/v1/bic/UBSWCHZH80A'],
    ['POST', '/v1/iban/compliance/', '/v1/iban/compliance'],
    ['GET', '/v1/ch/clearing/230/', '/v1/ch/clearing/230'],
    ['POST', '/v1/credits/buy/1k/', '/v1/credits/buy/1k'],
  ])('%s %s is sent to %s with a method-preserving redirect', async (method, from, to) => {
    const res = await appWithPaidRoutes().request(from, {
      method,
      body: method === 'POST' ? '{}' : undefined,
    });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(to);
  });

  it('keeps the query string, so a keyed or referred call is not silently stripped', async () => {
    const res = await appWithPaidRoutes().request('/v1/iban/validate/?api_key=ifk_x', {
      method: 'POST',
      body: '{}',
    });
    expect(res.headers.get('location')).toBe('/v1/iban/validate?api_key=ifk_x');
  });

  it('leaves the canonical paths exactly as they were', async () => {
    const res = await appWithPaidRoutes().request('/v1/iban/validate', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(402);
  });

  /**
   * Free and non-paid routes are NOT touched. This is a payment-surface fix,
   * not a global routing change: `strict: false` on the Hono instance would
   * have altered matching for every route in the app, admin and discovery
   * included.
   */
  it('does not redirect a path that sells nothing', async () => {
    const app = new Hono<HonoEnv>();
    app.use('/v1/*', enrich402Middleware());
    app.get('/v1/iban/format', () => new Response('{}', { status: 200 }));
    for (const path of ['/v1/iban/format/', '/v1/keys/generate/', '/v1/credits/bundles/']) {
      const res = await app.request(path, { method: 'GET' });
      expect(res.status, path).not.toBe(308);
    }
  });

  /** A GET must never be walked into the purchase flow — probes do not buy. */
  it('does not redirect a bare GET onto a selling route', async () => {
    const res = await appWithPaidRoutes().request('/v1/credits/buy/1k/', { method: 'GET' });
    expect(res.status).not.toBe(308);
  });
});
