import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ibanValidate } from './iban-validate.js';
import type { HonoEnv } from '../types.js';

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', ibanValidate);
  return app;
}

describe('POST /v1/iban/validate', () => {
  it('validates a correct IBAN and returns enriched result', async () => {
    const app = makeApp();
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'DE89370400440532013000' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      valid: boolean;
      country: { code: string };
      cost_usdc: number;
      processing_ms: number;
    };
    expect(json.valid).toBe(true);
    expect(json.country.code).toBe('DE');
    expect(typeof json.cost_usdc).toBe('number');
    expect(typeof json.processing_ms).toBe('number');
  });

  it('rejects a bad-checksum IBAN with valid:false', async () => {
    const app = makeApp();
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'DE89370400440532013001' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { valid: boolean; error: string };
    expect(json.valid).toBe(false);
    expect(json.error).toBe('checksum_failed');
  });

  it('rejects non-JSON body with 400', async () => {
    const app = makeApp();
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing iban field with 400', async () => {
    const app = makeApp();
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('accepts uppercase IBAN field (case-insensitive)', async () => {
    const app = makeApp();
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IBAN: 'DE89370400440532013000' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { valid: boolean };
    expect(json.valid).toBe(true);
  });
});
