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
    const body = (await res.json()) as Record<string, unknown>;
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
    const body = (await res.json()) as { sepa: { member: boolean; vop_required: boolean } };
    expect(body.sepa.member).toBe(true);
    expect(body.sepa.vop_required).toBe(true);
  });

  it('lowercase country code is normalized', async () => {
    const res = await makeApp().request('/v1/iban/structure/fr');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { country: { code: string } };
    expect(body.country.code).toBe('FR');
  });

  it('returns 400 on the OpenAPI placeholder literal', async () => {
    const res = await makeApp().request('/v1/iban/structure/{country}');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('placeholder_literal');
  });

  it('returns 400 on a malformed country code', async () => {
    const res = await makeApp().request('/v1/iban/structure/ABC');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_country_code');
  });

  it('returns 404 on a non-IBAN country (US)', async () => {
    const res = await makeApp().request('/v1/iban/structure/US');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unsupported_country');
  });

  it('BG (previously structure-less) now exposes bban fields with charsets', async () => {
    // BG was in IBAN_LENGTHS but not in BBAN_STRUCTURE until the 2026-07-10
    // full-coverage sync; it must now decompose with SWIFT charsets.
    const res = await makeApp().request('/v1/iban/structure/BG');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bban: {
        bank_code: { charset: string };
        branch_code: { charset: string };
        account_number: { charset: string };
      };
      bban_pattern: string;
      iban_length: number;
      example_iban: string | null;
    };
    expect(body.iban_length).toBe(22);
    expect(body.bban_pattern).toBe('4!a4!n2!n8!c');
    expect(body.bban.bank_code.charset).toBe('4!a');
    expect(body.bban.branch_code.charset).toBe('4!n');
    expect(body.bban.account_number.charset).toBe('2!n8!c');
    expect(body.example_iban).toBe('BG80BNBG96611020345678');
  });

  it('non-SEPA country (BR) reports member=false', async () => {
    const res = await makeApp().request('/v1/iban/structure/BR');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sepa: { member: boolean; vop_required: boolean } };
    expect(body.sepa.member).toBe(false);
    expect(body.sepa.vop_required).toBe(false);
  });

  it('CH (SEPA but not EU) has vop_required=false', async () => {
    const res = await makeApp().request('/v1/iban/structure/CH');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sepa: { vop_required: boolean } };
    expect(body.sepa.vop_required).toBe(false);
  });
});

describe('GET /v1/iban/structure (list)', () => {
  it('returns every IBAN country with metadata flags (89 as of 2026-07)', async () => {
    const res = await makeApp().request('/v1/iban/structure');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      countries: Array<{ code: string; name: string; iban_length: number; sepa_member: boolean }>;
    };
    expect(body.total).toBeGreaterThanOrEqual(89);
    expect(body.countries.length).toBe(body.total);
    const ch = body.countries.find((c) => c.code === 'CH');
    expect(ch).toBeDefined();
    expect(ch!.iban_length).toBe(21);
    expect(ch!.sepa_member).toBe(true);
  });
});
