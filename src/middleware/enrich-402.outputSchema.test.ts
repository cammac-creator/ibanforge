import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { enrich402Middleware } from './enrich-402.js';

/**
 * Targeted tests for the CyberSapper Bazaar recipe injection in
 * enrich-402.ts. The contract:
 *
 *   - 402 responses with `accepts` get an `outputSchema` injected at the top
 *     of each accept entry (NOT under `extra` or `extensions.bazaar`).
 *   - `outputSchema.input.body` carries example values, not a JSON Schema.
 *   - `outputSchema.output` is a bare example object (no {type, example} wrap).
 *   - Empty 402 bodies still get a fully-formed body with accepts +
 *     free_tier + x402 hints.
 *   - The middleware never overwrites an outputSchema that was already there.
 *
 * If any of these break, CDP catalog and agentic.market stop indexing
 * IBANforge — the 4 settlements we did get rejected as "invalid discovery
 * configuration" downstream.
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

describe('enrich402 outputSchema injection (CyberSapper recipe)', () => {
  it('injects outputSchema on a paid endpoint when the upstream emits a 402 with accepts', async () => {
    const app = makeApp(() =>
      new Response(
        JSON.stringify({
          accepts: [
            {
              scheme: 'exact',
              network: 'base',
              maxAmountRequired: '5000',
              payTo: '0xD13bD0A4120BA301125290e5cc0c7EFD4CB40a55',
            },
          ],
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    expect(r.status).toBe(402);
    const body = (await r.json()) as { accepts: Array<Record<string, unknown>> };
    expect(body.accepts).toHaveLength(1);
    const accept = body.accepts[0];
    expect(accept).toHaveProperty('outputSchema');
    expect(accept.outputSchema).toMatchObject({ input: { type: 'http' } });
  });

  it('outputSchema.input.body holds example VALUES (not a JSON Schema)', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [{}] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    const body = (await r.json()) as {
      accepts: Array<{ outputSchema?: { input?: { body?: { iban?: string } } } }>;
    };
    const sample = body.accepts[0].outputSchema?.input?.body;
    expect(sample?.iban).toBe('CH1000230000000012345');
  });

  it('outputSchema.input.bodyType = "json" for POST endpoints', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [{}] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    for (const path of ['/v1/iban/validate', '/v1/iban/batch', '/v1/iban/compliance']) {
      const r = await app.request(path, { method: 'POST', body: '{}' });
      const body = (await r.json()) as {
        accepts: Array<{ outputSchema?: { input?: { bodyType?: string } } }>;
      };
      expect(body.accepts[0].outputSchema?.input?.bodyType).toBe('json');
    }
  });

  it('outputSchema.output is a BARE example object (no {type, example} wrapping)', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [{}] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    const body = (await r.json()) as {
      accepts: Array<{ outputSchema?: { output?: Record<string, unknown> } }>;
    };
    const out = body.accepts[0].outputSchema?.output ?? {};

    // BARE = the shape itself, not wrapped in {type, example}
    expect(out).not.toHaveProperty('type');
    expect(out).not.toHaveProperty('example');
    expect(out).toHaveProperty('iban');
    expect(out).toHaveProperty('valid');
  });

  it('GET endpoints get outputSchema.input.method = "GET" with pathParams', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [{}] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const r = await app.request('/v1/bic/UBSWCHZH80A');
    const body = (await r.json()) as {
      accepts: Array<{
        outputSchema?: {
          input?: { method?: string; pathParams?: { code?: string }; bodyType?: string };
        };
      }>;
    };
    const input = body.accepts[0].outputSchema?.input ?? {};
    expect(input.method).toBe('GET');
    expect(input.pathParams?.code).toBe('UBSWCHZH80A');
    expect(input.bodyType).toBeUndefined(); // GET has no body
  });

  it('does NOT overwrite an existing outputSchema (idempotent)', async () => {
    const existing = { input: { type: 'http', method: 'POST', custom: true }, output: { mine: 1 } };
    const app = makeApp(() =>
      new Response(
        JSON.stringify({
          accepts: [{ outputSchema: existing }],
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    const body = (await r.json()) as {
      accepts: Array<{
        outputSchema?: {
          input?: { custom?: boolean };
          output?: { mine?: number };
        };
      }>;
    };
    expect(body.accepts[0].outputSchema?.input?.custom).toBe(true);
    expect(body.accepts[0].outputSchema?.output?.mine).toBe(1);
  });

  it('builds a full 402 body from pricing config when upstream body is empty', async () => {
    const app = makeApp(() =>
      new Response('', { status: 402, headers: { 'Content-Type': 'application/json' } }),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    expect(r.status).toBe(402);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.x402Version).toBe(1);
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

  it('compliance endpoint output sample contains sanctions / fatf / sepa / vop', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [{}] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const r = await app.request('/v1/iban/compliance', { method: 'POST', body: '{}' });
    const body = (await r.json()) as {
      accepts: Array<{ outputSchema?: { output?: Record<string, unknown> } }>;
    };
    const out = body.accepts[0].outputSchema?.output ?? {};
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

  it('Swiss BC-Nummer endpoint output sample carries SIX-specific fields', async () => {
    const app = makeApp(() =>
      new Response(JSON.stringify({ accepts: [{}] }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const r = await app.request('/v1/ch/clearing/762');
    const body = (await r.json()) as {
      accepts: Array<{ outputSchema?: { output?: Record<string, unknown> } }>;
    };
    const out = body.accepts[0].outputSchema?.output ?? {};
    expect(out).toHaveProperty('institution');
    expect(out).toHaveProperty('payment_services');
    expect(out).toHaveProperty('qr_iid');
  });

  it('Path 2 — adds the access ramp without disturbing accepts / outputSchema', async () => {
    const app = makeApp(() =>
      new Response(
        JSON.stringify({
          accepts: [
            {
              scheme: 'exact',
              network: 'base',
              maxAmountRequired: '5000',
              payTo: '0xD13bD0A4120BA301125290e5cc0c7EFD4CB40a55',
            },
          ],
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await app.request('/v1/iban/validate', { method: 'POST', body: '{}' });
    expect(r.status).toBe(402);
    const body = (await r.json()) as {
      accepts: Array<Record<string, unknown>>;
      credit_packs?: Record<string, unknown>;
      free_tier?: Record<string, unknown>;
    };
    // access ramp added alongside accepts
    expect(body.credit_packs).toBeDefined();
    expect(body.free_tier).toBeDefined();
    // accepts untouched: count preserved, outputSchema still injected
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toHaveProperty('outputSchema');
  });
});
