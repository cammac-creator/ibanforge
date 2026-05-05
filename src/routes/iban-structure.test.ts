import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { ibanStructure } from './iban-structure.js';
import { closeAll } from '../lib/db.js';

afterAll(() => {
  closeAll();
});

function makeApp() {
  const app = new Hono();
  app.route('/', ibanStructure);
  return app;
}

describe('GET /v1/iban/structure/:country', () => {
  it('returns the full structure for CH', async () => {
    const res = await makeApp().request('/v1/iban/structure/CH');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.country).toEqual({ code: 'CH', name: 'Switzerland' });
    expect(body.iban_length).toBe(21);
    expect(body.bban_length).toBe(17);
    expect(body.bban).toBeDefined();
    expect(body.example_iban).toBe('CH9300762011623852957');
    expect((body.sepa as { member: boolean }).member).toBe(true);
    expect(body.cost_usdc).toBe(0);
  });

  it('returns 200 for a SEPA EU member with vop_required=true', async () => {
    const res = await makeApp().request('/v1/iban/structure/DE');
    expect(res.status).toBe(200);
    const body = await res.json() as { sepa: { member: boolean; vop_required: boolean } };
    expect(body.sepa.member).toBe(true);
    expect(body.sepa.vop_required).toBe(true);
  });

  it('lowercase country code is normalized', async () => {
    const res = await makeApp().request('/v1/iban/structure/fr');
    expect(res.status).toBe(200);
    const body = await res.json() as { country: { code: string } };
    expect(body.country.code).toBe('FR');
  });

  it('returns 400 on the OpenAPI placeholder literal', async () => {
    const res = await makeApp().request('/v1/iban/structure/{country}');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('placeholder_literal');
  });

  it('returns 400 on a malformed country code', async () => {
    const res = await makeApp().request('/v1/iban/structure/ABC');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_country_code');
  });

  it('returns 404 on a non-IBAN country (US)', async () => {
    const res = await makeApp().request('/v1/iban/structure/US');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unsupported_country');
  });

  it('handles country with no declared BBAN structure (returns null bban)', async () => {
    // BG is in IBAN_LENGTHS but not in BBAN_STRUCTURE.
    const res = await makeApp().request('/v1/iban/structure/BG');
    expect(res.status).toBe(200);
    const body = await res.json() as { bban: unknown; iban_length: number };
    expect(body.bban).toBeNull();
    expect(body.iban_length).toBe(22);
  });

  it('non-SEPA country (BR) reports member=false', async () => {
    const res = await makeApp().request('/v1/iban/structure/BR');
    expect(res.status).toBe(200);
    const body = await res.json() as { sepa: { member: boolean; vop_required: boolean } };
    expect(body.sepa.member).toBe(false);
    expect(body.sepa.vop_required).toBe(false);
  });

  it('CH (SEPA but not EU) has vop_required=false', async () => {
    const res = await makeApp().request('/v1/iban/structure/CH');
    expect(res.status).toBe(200);
    const body = await res.json() as { sepa: { vop_required: boolean } };
    expect(body.sepa.vop_required).toBe(false);
  });
});

describe('GET /v1/iban/structure (list)', () => {
  it('returns all 84 countries with metadata flags', async () => {
    const res = await makeApp().request('/v1/iban/structure');
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; countries: Array<{ code: string; name: string; iban_length: number; sepa_member: boolean }> };
    expect(body.total).toBeGreaterThanOrEqual(84);
    expect(body.countries.length).toBe(body.total);
    const ch = body.countries.find((c) => c.code === 'CH');
    expect(ch).toBeDefined();
    expect(ch!.iban_length).toBe(21);
    expect(ch!.sepa_member).toBe(true);
  });
});
