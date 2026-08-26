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

/**
 * The optional `reference` parameter — the paid half of the reference feature.
 *
 * The arithmetic itself is covered in lib/payment-reference.test.ts; what is
 * checked here is the WIRING: that the parameter reaches the block, that the
 * block is absent when nothing was asked, and that it does not leak into a
 * response that never requested it.
 *
 * The Swiss IBANs and the reference beside each are the paired examples of
 * Annex A of the SIX QR-bill guidelines.
 */
describe('POST /v1/iban/validate with a payment reference', () => {
  const call = async (body: Record<string, unknown>) => {
    const res = await makeApp().request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as {
      valid: boolean;
      reference_check?: { scheme: string; valid: boolean | null; pairing: string; source: string };
    };
  };

  it('adds no block at all when no reference is passed', async () => {
    const json = await call({ iban: 'CH4431999123000889012' });
    expect(json.reference_check).toBeUndefined();
  });

  it('pairs a QR reference with the QR-IBAN it belongs to', async () => {
    const json = await call({
      iban: 'CH4431999123000889012',
      reference: '210000000003139471430009017',
    });
    expect(json.reference_check?.scheme).toBe('qrr');
    expect(json.reference_check?.valid).toBe(true);
    expect(json.reference_check?.pairing).toBe('ok');
  });

  it('refuses a QR reference on an ordinary Swiss IBAN', async () => {
    const json = await call({
      iban: 'CH5204835012345671000',
      reference: '210000000003139471430009017',
    });
    expect(json.reference_check?.pairing).toBe('qrr_requires_qr_iban');
  });

  it('refuses an ISO 11649 reference on a QR-IBAN, honouring reference_type', async () => {
    const json = await call({
      iban: 'CH6431961000004421557',
      reference: 'RF18539007547034',
      reference_type: 'scor',
    });
    expect(json.reference_check?.pairing).toBe('scor_forbidden_with_qr_iban');
  });

  it('keeps the two verdicts independent outside Switzerland', async () => {
    const json = await call({ iban: 'DE89370400440532013000', reference: 'RF18539007547034' });
    expect(json.valid).toBe(true);
    expect(json.reference_check?.valid).toBe(true);
    expect(json.reference_check?.pairing).toBe('not_applicable');
  });

  it('judges the reference even when the IBAN itself fails', async () => {
    // A caller fixing a transcription error still wants to know whether the
    // reference they were given is sound.
    const json = await call({ iban: 'CH9300762011623852958', reference: 'RF18539007547034' });
    expect(json.valid).toBe(false);
    expect(json.reference_check?.valid).toBe(true);
    expect(json.reference_check?.pairing).toBe('not_applicable');
  });

  it('always names the document behind the verdict', async () => {
    const json = await call({
      iban: 'CH4431999123000889012',
      reference: '210000000003139471430009017',
    });
    expect(json.reference_check?.source).toBeTruthy();
  });
});
