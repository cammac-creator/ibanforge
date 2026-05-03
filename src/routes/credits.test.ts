/**
 * Bundle credits feature — end-to-end tests.
 *
 * Validates the prepaid-bundle flow:
 *  - Anonymous and email-attached key minting
 *  - Credit decrement per call
 *  - Refund on 4xx
 *  - Fall-through to x402 when balance reaches 0
 *  - /v1/credits/balance reflects state correctly
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { creditsBuy } from './credits-buy.js';
import { apiKeys } from './api-keys.js';
import { ibanValidate } from './iban-validate.js';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import { generateApiKey, generateCreditKey, validateApiKey, decrementCredits, refundCredit } from '../lib/api-keys.js';
import { closeAll } from '../lib/db.js';
import type { HonoEnv } from '../types.js';

afterAll(() => {
  closeAll();
});

function makeAppWithCredits() {
  const app = new Hono<HonoEnv>();
  app.route('/', apiKeys);
  app.use('/v1/*', apiKeyMiddleware());
  app.route('/', creditsBuy);
  app.route('/', ibanValidate);
  return app;
}

describe('generateCreditKey', () => {
  it('mints an anonymous key with the requested credits', () => {
    const k = generateCreditKey(null, 1000);
    expect(k.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(k.credits).toBe(1000);
    expect(k.key_prefix).toMatch(/^ifk_[a-f0-9]{8}$/);
  });

  it('mints an email-attached key when an email is provided', () => {
    const k = generateCreditKey('agent@example.com', 5000);
    const v = validateApiKey(k.api_key);
    expect(v.valid).toBe(true);
    expect(v.email).toBe('agent@example.com');
    expect(v.creditsRemaining).toBe(5000);
    expect(v.creditsTotal).toBe(5000);
  });

  it('does not impose the daily-rate-limit (unlike /v1/keys/generate)', () => {
    // Two keys for the same email back-to-back should both succeed.
    const a = generateCreditKey('rapid@example.com', 1000);
    const b = generateCreditKey('rapid@example.com', 1000);
    expect(a.api_key).not.toBe(b.api_key);
  });
});

describe('decrementCredits / refundCredit', () => {
  it('atomically decrements and returns the new balance', () => {
    const k = generateCreditKey(null, 10);
    const v = validateApiKey(k.api_key);
    const after1 = decrementCredits(v.keyHash);
    expect(after1).toBe(9);
    const after2 = decrementCredits(v.keyHash);
    expect(after2).toBe(8);
  });

  it('returns -1 when credits are exhausted (caller falls through to x402)', () => {
    const k = generateCreditKey(null, 2);
    const v = validateApiKey(k.api_key);
    expect(decrementCredits(v.keyHash)).toBe(1);
    expect(decrementCredits(v.keyHash)).toBe(0);
    expect(decrementCredits(v.keyHash)).toBe(-1);
    // Subsequent decrements stay at -1 — never goes negative.
    expect(decrementCredits(v.keyHash)).toBe(-1);
  });

  it('refundCredit re-credits a previously consumed call', () => {
    const k = generateCreditKey(null, 10);
    const v = validateApiKey(k.api_key);
    decrementCredits(v.keyHash);
    decrementCredits(v.keyHash);
    refundCredit(v.keyHash);
    const v2 = validateApiKey(k.api_key);
    expect(v2.creditsRemaining).toBe(9);
  });

  it('refundCredit is a no-op for monthly-quota keys (credits_remaining IS NULL)', () => {
    // Keys minted via generateApiKey have credits_remaining=NULL; refund should
    // not bump them (they don't track credits).
    const k = generateApiKey('monthly-' + Date.now() + '@example.com');
    expect(k).not.toBeNull();
    const v = validateApiKey(k!.api_key);
    refundCredit(v.keyHash);
    const v2 = validateApiKey(k!.api_key);
    expect(v2.creditsRemaining).toBeUndefined();
  });
});

describe('GET /v1/credits/bundles', () => {
  it('returns the 3 bundles with their pricing', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const res = await app.request('/v1/credits/bundles');
    expect(res.status).toBe(200);
    const body = await res.json() as { bundles: Array<{ slug: string; credits: number; price_usdc: number; price_per_call_usdc: number }> };
    expect(body.bundles).toHaveLength(3);
    const slugs = body.bundles.map((b) => b.slug);
    expect(slugs).toContain('1k');
    expect(slugs).toContain('5k');
    expect(slugs).toContain('25k');
    const oneK = body.bundles.find((b) => b.slug === '1k')!;
    expect(oneK.credits).toBe(1000);
    expect(oneK.price_usdc).toBe(5);
    expect(oneK.price_per_call_usdc).toBe(0.005);
  });
});

describe('GET /v1/credits/balance', () => {
  it('returns 401 when no API key is provided', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const res = await app.request('/v1/credits/balance');
    expect(res.status).toBe(401);
  });

  it('returns the credit balance for a credit-bundle key', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const k = generateCreditKey(null, 1000);
    const res = await app.request('/v1/credits/balance', {
      headers: { Authorization: `Bearer ${k.api_key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { type: string; credits_remaining: number; credits_total: number; credits_used: number };
    expect(body.type).toBe('credit_bundle');
    expect(body.credits_remaining).toBe(1000);
    expect(body.credits_total).toBe(1000);
    expect(body.credits_used).toBe(0);
  });

  it('flags monthly-subscription keys distinctly from credit bundles', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const k = generateApiKey('subscriber-' + Date.now() + '@example.com');
    expect(k).not.toBeNull();
    const res = await app.request('/v1/credits/balance', {
      headers: { Authorization: `Bearer ${k!.api_key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { type: string };
    expect(body.type).toBe('subscription');
  });
});

describe('apiKeyMiddleware — credit-bundle path', () => {
  it('decrements credits on a successful 200 response', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 100);
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${k.api_key}`,
      },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-credits-remaining')).toBe('99');
    expect(res.headers.get('x-credits-total')).toBe('100');
  });

  it('refunds the credit when the handler returns 4xx (bad input)', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 50);
    // Send malformed body — handler returns 400, middleware should refund.
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${k.api_key}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    // Middleware decremented to 49, then refunded to 50. We assert via DB.
    const v = validateApiKey(k.api_key);
    expect(v.creditsRemaining).toBe(50);
  });

  it('falls through to x402 (no apiKeyAuthenticated) when credits are exhausted', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 1);
    // Burn the only credit
    const res1 = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-credits-remaining')).toBe('0');

    // Next call: balance is 0 — middleware sets X-Credits-Exhausted and falls
    // through. Without x402 middleware in this test app, the request is
    // served free (which is fine — we're testing the fall-through behavior,
    // not the x402 gate which is tested elsewhere).
    const res2 = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    expect(res2.headers.get('x-credits-exhausted')).toBe('true');
    expect(res2.headers.get('x-credits-topup-hint')).toContain('1k');
  });
});
