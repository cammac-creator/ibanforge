import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { enrich402Middleware } from './enrich-402.js';

/**
 * The Bazaar discovery material a 402 carries: how to call the route, and what
 * a real answer looks like.
 *
 * It used to ride in a v1-only field — `outputSchema` at the top of each
 * accepts entry, the recipe documented in the CDP Discord — and moved into
 * `extensions.bazaar.info` when the announcement went to x402 v2 on
 * 17/08/2026. A v2 accepts entry carries payment terms and nothing else.
 * The contract that survived the move:
 *
 *   - `info.input` describes the call: example VALUES, not a JSON Schema.
 *   - `info.output.example` is a real captured response, stamped as a sample.
 *   - An empty 402 body still comes back fully formed: terms, free tier, x402.
 *   - Terms written by something upstream are never overwritten.
 *
 * If these break, the CDP catalog and agentic.market have nothing to index.
 */

function makeApp(handler: (c: import('hono').Context) => Promise<Response> | Response) {
  const app = new Hono();
  app.use('*', enrich402Middleware());
  app.get('/v1/iban/format', handler);
  app.post('/v1/iban/validate', handler);
  app.get('/v1/bic/UBSWCHZH80A', handler);
  app.get('/v1/ch/clearing/762', handler);
  app.post('/v1/iban/compliance', handler);
  app.post('/v1/iban/batch', handler);
  return app;
}

/** The 402 the x402 SDK actually produces: empty body, terms in the header. */
const emptyBody = () => new Response('', { status: 402, headers: { 'Content-Type': 'application/json' } });

interface BazaarBody {
  extensions?: {
    bazaar?: {
      info?: {
        input?: { type?: string; method?: string; bodyType?: string; body?: Record<string, unknown>; pathParams?: Record<string, string> };
        output?: { type?: string; example?: Record<string, unknown> };
      };
    };
  };
}

async function bazaarOf(res: Response) {
  const body = (await res.json()) as BazaarBody;
  return body.extensions?.bazaar?.info ?? {};
}

/**
 * Reco-IA audit 2026-07-25. Every discovery example is a FIXED sample record,
 * served whatever resource was asked for: the 402 for /v1/ch/clearing/779
 * (Nidwaldner Kantonalbank, Stans) ships the UBS Zürich record for IID 00230.
 * Unlabelled, an assistant reads that as the answer and reports it to its user
 * — IBANforge's own paywall producing a confident wrong answer about the Swiss
 * clearing data that IS the product. The stamp must survive on every path.
 */
describe('402 discovery examples are stamped as examples', () => {
  const NOTICE = /ILLUSTRATIVE SAMPLE/;

  it('stamps the example when terms come from upstream', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [{ scheme: 'exact', network: 'eip155:8453' }] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const info = await bazaarOf(await app.request('/v1/ch/clearing/762'));
    expect(info.output?.example?._example_notice).toMatch(NOTICE);
    // The sample values must still be there — the catalog extractor reads them.
    expect(info.output?.example).toHaveProperty('iid', '00230');
  });

  it('stamps the example on an empty-body 402 too', async () => {
    const app = makeApp(emptyBody);
    const info = await bazaarOf(await app.request('/v1/ch/clearing/762'));
    expect(info.output?.example?._example_notice).toMatch(NOTICE);
  });

  it('stamps every paid endpoint, not just the Swiss one', async () => {
    const app = makeApp(emptyBody);

    for (const [path, init] of [
      ['/v1/iban/validate', { method: 'POST', body: '{}' }],
      ['/v1/iban/compliance', { method: 'POST', body: '{}' }],
      ['/v1/bic/UBSWCHZH80A', {}],
    ] as const) {
      const info = await bazaarOf(await app.request(path, init));
      expect(info.output?.example?._example_notice, path).toMatch(NOTICE);
    }
  });
});

describe('the Bazaar info block', () => {
  it('describes the call as an HTTP request', async () => {
    const app = makeApp(emptyBody);
    const info = await bazaarOf(await app.request('/v1/iban/validate', { method: 'POST', body: '{}' }));
    expect(info.input?.type).toBe('http');
    expect(info.input?.method).toBe('POST');
  });

  it('input.body holds example VALUES, not a JSON Schema', async () => {
    const app = makeApp(emptyBody);
    const info = await bazaarOf(await app.request('/v1/iban/validate', { method: 'POST', body: '{}' }));
    expect(info.input?.body?.iban).toBe('CH1000230000000012345');
  });

  it('input.bodyType = "json" for POST endpoints', async () => {
    const app = makeApp(emptyBody);
    for (const path of ['/v1/iban/validate', '/v1/iban/batch', '/v1/iban/compliance']) {
      const info = await bazaarOf(await app.request(path, { method: 'POST', body: '{}' }));
      expect(info.input?.bodyType, path).toBe('json');
    }
  });

  it('GET endpoints get method "GET" with pathParams and no bodyType', async () => {
    const app = makeApp(emptyBody);
    const info = await bazaarOf(await app.request('/v1/bic/UBSWCHZH80A'));
    expect(info.input?.method).toBe('GET');
    expect(info.input?.pathParams?.code).toBe('UBSWCHZH80A');
    expect(info.input?.bodyType).toBeUndefined();
  });

  it('output is wrapped as {type, example}, which is what the validator reads', async () => {
    const app = makeApp(emptyBody);
    const info = await bazaarOf(await app.request('/v1/iban/validate', { method: 'POST', body: '{}' }));
    expect(info.output?.type).toBe('json');
    expect(info.output?.example).toHaveProperty('iban');
    expect(info.output?.example).toHaveProperty('valid');
  });

  it('compliance sample contains sanctions / fatf / sepa / vop', async () => {
    const app = makeApp(emptyBody);
    const info = await bazaarOf(await app.request('/v1/iban/compliance', { method: 'POST', body: '{}' }));
    const out = info.output?.example ?? {};
    // Real response shape: compliance layer nested under `compliance`,
    // with risk_score / risk_level / sanctions / reachability / vop inside.
    expect(out).toHaveProperty('compliance');
    const compliance = (out as { compliance?: Record<string, unknown> }).compliance ?? {};
    expect(compliance).toHaveProperty('risk_score');
    expect(compliance).toHaveProperty('risk_level');
    expect(compliance).toHaveProperty('sanctions');
    expect(compliance).toHaveProperty('reachability');
    expect(compliance).toHaveProperty('vop');
    expect(compliance).toHaveProperty('flags');
  });

  it('Swiss BC-Nummer sample carries SIX-specific fields', async () => {
    const app = makeApp(emptyBody);
    const info = await bazaarOf(await app.request('/v1/ch/clearing/762'));
    const out = info.output?.example ?? {};
    expect(out).toHaveProperty('institution');
    expect(out).toHaveProperty('payment_services');
    expect(out).toHaveProperty('qr_iid');
  });
});

describe('what enrich402 does and does not rewrite', () => {
  it('builds a full v2 body from pricing config when upstream body is empty', async () => {
    const app = makeApp(emptyBody);
    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    expect(r.status).toBe(402);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.x402Version).toBe(2);
    expect(body.error).toBe('payment_required');
    expect(body).toHaveProperty('accepts');
    expect(body).toHaveProperty('free_tier');
    expect(body).toHaveProperty('x402');
  });

  it('does not touch non-402 responses', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('leaves a 402 that is not a payment offer entirely alone', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ error: 'custom_402', detail: 'Another middleware owns this' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const body = (await (await app.request('/v1/iban/validate', { method: 'POST', body: '{}' })).json()) as {
      error: string;
      free_tier?: unknown;
    };
    expect(body.error).toBe('custom_402');
    expect(body.free_tier).toBeUndefined();
  });

  it('adds the access ramp around upstream terms without rewriting them', async () => {
    const terms = {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '5000',
      payTo: '0x0000000000000000000000000000000000000001',
    };
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [terms] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    expect(r.status).toBe(402);
    const body = (await r.json()) as {
      accepts: Array<Record<string, unknown>>;
      credit_packs?: Record<string, unknown>;
      free_tier?: Record<string, unknown>;
    };
    expect(body.credit_packs).toBeDefined();
    expect(body.free_tier).toBeDefined();
    // The terms themselves are quoted back exactly as they arrived. Editing a
    // price on its way out is how a payer signs for one amount and is charged
    // another.
    expect(body.accepts).toEqual([terms]);
  });
});
