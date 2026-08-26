/**
 * The free reference endpoint, tested against the REAL assembled application.
 *
 * Why not a hand-assembled `new Hono()` like iban-format.test.ts does: this
 * route lives under `/v1/*`, which is where enrich-402, the API-key middleware
 * and the x402 paywall are mounted. A mini-app has none of them, so it would
 * answer 200 whether or not the route is payable — and the claim being made here
 * is precisely that it is NOT payable. The paywall is therefore ARMED for every
 * test below, pointed at a local stand-in facilitator, and a paid route is
 * checked in the same breath to prove the arming actually took.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { closeAll } from '../lib/db.js';

// Our own bucket in the process-wide in-memory rate limiter. TEST-NET-2.
const IP = '198.51.100.77';
const H = { 'x-real-ip': IP };
const WALLET = '0x00000000000000000000000000000000000000A1';

let facilitator: Server;
let facilitatorUrl: string;
const originalEnv = { ...process.env };

beforeAll(async () => {
  facilitator = createServer((req, res) => {
    if (req.url === '/supported') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => facilitator.listen(0, '127.0.0.1', resolve));
  facilitatorUrl = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => facilitator.close(() => resolve()));
  process.env = originalEnv;
  closeAll();
});

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = facilitatorUrl;
  // A stray CDP key would build a Coinbase client and bypass the local
  // facilitator, and every assertion here would then be measuring nothing.
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
});

const req = (path: string, init: RequestInit = {}) =>
  buildApp().request(`https://api.ibanforge.com${path}`, {
    ...init,
    headers: { ...H, ...(init.headers as Record<string, string> | undefined) },
  });

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('GET /v1/reference/validate is free while the paywall is armed', () => {
  it('answers 200 on a route the paywall does not sell, in the same app that sells others', async () => {
    const free = await req('/v1/reference/validate?reference=RF18539007547034');
    const paid = await req('/v1/bic/COBADEFFXXX');

    expect(free.status, 'the reference endpoint must be free').toBe(200);
    // The control. If this were not 402 the test above would prove nothing:
    // it would only mean the paywall was never armed.
    expect(paid.status, 'the paywall really is armed in this process').toBe(402);
  });

  it('never announces a price', async () => {
    const r = await req('/v1/reference/validate?reference=RF18539007547034');
    const body = await json(r);
    expect(body.cost_usdc).toBeUndefined();
    expect(r.headers.get('www-authenticate')).toBeNull();
  });
});

describe('the free endpoint contract', () => {
  it('serves a valid RF reference with its scheme, expected check digits and source', async () => {
    const body = await json(await req('/v1/reference/validate?reference=RF18539007547034'));
    expect(body.scheme).toBe('rf');
    expect(body.valid).toBe(true);
    expect(body.status).toBe('checked');
    // A string, so that a two-digit value beginning with zero survives.
    expect(body.check_digit_expected).toBe('18');
    expect(String(body.source)).toContain('Finance Finland');
    expect(body.as_of).toMatch(/^\d{4}-\d{2}$/);
  });

  it('serves the Swiss QR reference of the guidelines worked example', async () => {
    const body = await json(await req('/v1/reference/validate?reference=210000000003139471430009017'));
    expect(body.scheme).toBe('qrr');
    expect(body.valid).toBe(true);
    expect(String(body.source)).toContain('Annex B');
  });

  it('reports the second reading of an ambiguous 12-digit string', async () => {
    const body = await json(await req('/v1/reference/validate?reference=010806817183'));
    expect(body.scheme).toBe('ogm');
    expect(body.valid).toBe(true);
    expect((body.also_valid_as as Record<string, unknown>).scheme).toBe('viitenumero');
  });

  it('accepts the Belgian printed form, url-encoded', async () => {
    const body = await json(await req('/v1/reference/validate?reference=%2B%2B%2B010%2F8068%2F17183%2B%2B%2B'));
    expect(body.reference).toBe('010806817183');
    expect(body.valid).toBe(true);
  });

  it('answers valid: null — never false — for KID and OCR', async () => {
    for (const type of ['kid', 'ocr']) {
      const body = await json(await req(`/v1/reference/validate?reference=12345678&reference_type=${type}`));
      expect(body.valid, type).toBeNull();
      expect(body.valid, type).not.toBe(false);
      expect(body.status, type).toBe('unverifiable_without_creditor_config');
      expect(body.source, type).toBeTruthy();
    }
  });

  it('accepts the same input by POST', async () => {
    const r = await req('/v1/reference/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: '1234561' }),
    });
    expect(r.status).toBe(200);
    expect((await json(r)).scheme).toBe('viitenumero');
  });

  it('returns 400 with usage help when the reference is missing', async () => {
    const r = await req('/v1/reference/validate');
    expect(r.status).toBe(400);
    const body = await json(r);
    expect(body.error).toBe('missing_reference');
    expect(String(body.example)).toContain('RF18539007547034');
  });

  it('says so plainly when nothing matches, instead of guessing', async () => {
    const body = await json(await req('/v1/reference/validate?reference=%21%21%21%21%21'));
    expect(body.scheme).toBeNull();
    expect(body.status).toBe('unrecognised');
    expect(body.source).toBeNull();
  });

  it('ships a source on every answer that names a scheme', async () => {
    const paths = [
      'reference=RF18539007547034',
      'reference=210000000003139471430009017',
      'reference=010806817183',
      'reference=1234561',
      'reference=12345678&reference_type=kid',
      'reference=12345678&reference_type=ocr',
    ];
    for (const q of paths) {
      const body = await json(await req(`/v1/reference/validate?${q}`));
      expect(body.scheme, q).not.toBeNull();
      expect(body.source, q).toBeTruthy();
      expect(body.as_of, q).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});
