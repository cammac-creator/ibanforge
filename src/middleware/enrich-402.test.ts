// src/middleware/enrich-402.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { enrich402Middleware } from './enrich-402.js';

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
