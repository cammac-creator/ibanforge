import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { generateApiKey, generateOemKey } from '../lib/api-keys.js';
import { ATTRIBUTION } from '../lib/attribution.js';

const app = buildApp();
const bearer = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'content-type': 'application/json',
});
const validate = (headers: Record<string, string>) =>
  app.request('/v1/iban/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ iban: 'DE89 3704 0044 0532 0130 00' }),
  });

describe('attribution on the free tier', () => {
  it('a free key gets the credit block on validate, batch, bic and clearing', async () => {
    const key = generateApiKey('attribution-free@acme.example.net');
    expect(key).not.toBeNull();
    const h = bearer(key!.api_key);
    const v = await validate(h);
    expect(v.status).toBe(200);
    expect(((await v.json()) as { attribution?: unknown }).attribution).toEqual(ATTRIBUTION);
    const b = await app.request('/v1/iban/batch', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ ibans: ['DE89370400440532013000'] }),
    });
    expect(b.status).toBe(200);
    expect(((await b.json()) as { attribution?: unknown }).attribution).toEqual(ATTRIBUTION);
    const bic = await app.request('/v1/bic/COBADEFFXXX', { headers: h });
    expect(bic.status).toBe(200);
    expect(((await bic.json()) as { attribution?: unknown }).attribution).toEqual(ATTRIBUTION);
    const ch = await app.request('/v1/ch/clearing/230', { headers: h });
    expect(ch.status).toBe(200);
    expect(((await ch.json()) as { attribution?: unknown }).attribution).toEqual(ATTRIBUTION);
  });

  it('a paid plan key carries no attribution', async () => {
    const oem = generateOemKey(
      'attribution-oem@acme.example.net',
      50_000,
      `cs_test_${Date.now()}`,
      null,
    );
    expect(oem.api_key).toBeTruthy();
    const v = await validate(bearer(oem.api_key as string));
    expect(v.status).toBe(200);
    expect('attribution' in ((await v.json()) as object)).toBe(false);
  });

  it('the free structural route never carries it, and neither does an anonymous call', async () => {
    const f = await app.request('/v1/iban/format?iban=DE89370400440532013000');
    expect(f.status).toBe(200);
    expect('attribution' in ((await f.json()) as object)).toBe(false);
    // Anonymous: a paywall body in production, a served answer where the test
    // environment has no facilitator; in neither case is there a free key.
    const anon = await validate({ 'content-type': 'application/json' });
    expect('attribution' in ((await anon.json()) as object)).toBe(false);
  });
});
