import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ibanFormat } from './iban-format.js';

function buildApp() {
  const app = new Hono();
  app.route('/', ibanFormat);
  return app;
}

describe('GET /v1/iban/format (free, no payment)', () => {
  it('validates a correct Swiss IBAN and returns 200 without cost_usdc', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH9300762011623852957');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect((body.country as { code: string }).code).toBe('CH');
    expect(body.formatted).toBe('CH93 0076 2011 6238 5295 7');
    expect(body.cost_usdc).toBeUndefined();
    expect(body.upgrade_to_full_validation).toContain('/v1/iban/validate');
  });

  it('answers the same verdict to a POST with a JSON body, so the paid call shape works without a key', async () => {
    const app = buildApp();
    const res = await app.request('/v1/iban/format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'CH93 0076 2011 6238 5295 7' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      valid: boolean;
      country: { code: string };
      bban: { bank_code: string };
      cost_usdc?: unknown;
    };
    expect(body.valid).toBe(true);
    expect(body.country.code).toBe('CH');
    expect(body.bban.bank_code).toBe('00762');
    expect(body.cost_usdc).toBeUndefined();
  });

  it('rejects a wrong-checksum IBAN with valid: false and a clear error code', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH9300762011623852958');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.error).toBe('checksum_failed');
  });

  it('rejects an unknown country code', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=ZZ9300762011623852957');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.error).toBe('unsupported_country');
  });

  it('returns 400 with helpful error when iban query param is missing', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format');
    expect(r.status).toBe(400);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.error).toBe('missing_iban');
    expect(body.example).toContain('CH9300762011623852957');
  });

  it('returns 400 when iban is too short', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH9300');
    expect(r.status).toBe(400);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_iban_length');
  });

  it('accepts spaces in the IBAN (cleans them transparently)', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH93%200076%202011%206238%205295%207');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.iban).toBe('CH9300762011623852957');
  });

  it('exposes the upgrade hint on every response (success and failure)', async () => {
    const app = buildApp();
    for (const iban of ['CH9300762011623852957', 'CH9300762011623852958']) {
      const r = await app.request(`/v1/iban/format?iban=${iban}`);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.upgrade_to_full_validation).toContain('$0.005');
    }
  });
});
