import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bicLookup } from './bic-lookup.js';
import type { HonoEnv } from '../types.js';

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', bicLookup);
  return app;
}

describe('GET /v1/bic/:code', () => {
  it('rejects a BIC with wrong length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/ABC');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('invalid_bic_format');
  });

  it('returns 400 for invalid character content', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/ABCD123!');
    expect(res.status).toBe(400);
  });

  it('returns a result shape for a plausible BIC8', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/UBSWCHZH');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      bic: string;
      bic8: string;
      bic11: string;
      valid_format: boolean;
      found: boolean;
      cost_usdc: number;
      is_test_bic: boolean;
    };
    expect(json.valid_format).toBe(true);
    expect(json.bic8).toBe('UBSWCHZH');
    expect(typeof json.found).toBe('boolean');
    expect(typeof json.cost_usdc).toBe('number');
    expect(typeof json.is_test_bic).toBe('boolean');
  });

  it('handles BIC11 input', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/UBSWCHZH80A');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bic11: string };
    expect(json.bic11).toBe('UBSWCHZH80A');
  });

  it('returns a dedicated 400 when the agent sends the literal {code} placeholder', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/%7Bcode%7D');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; example: string };
    expect(json.error).toBe('placeholder_literal');
    expect(json.example).toContain('UBSWCHZH');
  });
});
