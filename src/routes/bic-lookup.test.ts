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

  it('returns a registered GLEIF address (with romanization) for a head-office BIC', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/ABOCCNBJXXX');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      found: boolean;
      address_available: boolean;
      address: {
        type: string;
        street: string | null;
        post_code: string | null;
        country: string;
        romanized: string | null;
        romanization: 'original_latin' | 'gleif_english' | 'unavailable';
        source: string;
      } | null;
    };
    expect(json.found).toBe(true);
    expect(json.address_available).toBe(true);
    expect(json.address).not.toBeNull();
    expect(json.address!.type).toBe('registered');
    expect(json.address!.country).toBe('CN');
    expect(json.address!.post_code).toBe('100005');
    expect(json.address!.romanized).toContain('Jianguomen Nei Avenue');
    expect(json.address!.source).toBe('GLEIF');
    // romanization provenance must be consistent with the fields (logic, not
    // data-coupled): a distinct Latin reading for a non-Latin address = GLEIF English.
    expect(['original_latin', 'gleif_english', 'unavailable']).toContain(
      json.address!.romanization,
    );
    expect(json.address!.romanization).toBe('gleif_english');
  });

  it('reports romanization provenance consistently with the fields', async () => {
    const app = makeApp();
    // ING NL — a Latin-script registered address: romanized equals the address itself.
    const res = await app.request('/v1/bic/INGBNL2AXXX');
    const json = (await res.json()) as {
      address: { street: string | null; romanized: string | null; romanization: string } | null;
    };
    expect(json.address).not.toBeNull();
    const a = json.address!;
    // Invariant the API guarantees, independent of which exact bank this is:
    if (a.romanized === null) {
      expect(a.romanization).toBe('unavailable');
    } else if (a.romanized === a.street) {
      expect(a.romanization).toBe('original_latin');
    } else {
      expect(a.romanization).toBe('gleif_english');
    }
  });

  it('suppresses the address for a foreign-branch BIC (same-country guard)', async () => {
    const app = makeApp();
    const res = await app.request('/v1/bic/FABMCNSHXXX');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { address: unknown; address_available: boolean };
    expect(json.address).toBeNull();
    expect(json.address_available).toBe(false);
  });
});
