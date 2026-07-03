import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { apiKeyMiddleware } from './api-key.js';
import { ibanValidate } from '../routes/iban-validate.js';
import { generateApiKey, validateApiKey, getUsage, checkAndIncrementQuota } from '../lib/api-keys.js';
import type { HonoEnv } from '../types.js';

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.use('/v1/*', apiKeyMiddleware());
  app.route('/', ibanValidate);
  return app;
}

const RUN_ID = Date.now();

describe('apiKeyMiddleware — quota refund on 4xx', () => {
  it('refunds the quota slot when the handler returns 400 (invalid body)', async () => {
    const keyResult = generateApiKey(`refund-e2e-${RUN_ID}-1@example.com`);
    expect(keyResult).not.toBeNull();
    const key = keyResult!.api_key;
    const { keyHash } = validateApiKey(key);

    const before = getUsage(keyHash).used;

    const app = makeApp();
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}), // missing iban — handler replies 400
    });
    expect(res.status).toBe(400);

    const after = getUsage(keyHash).used;
    expect(after).toBe(before);
  });

  it('consumes quota when the handler returns 200', async () => {
    const keyResult = generateApiKey(`refund-e2e-${RUN_ID}-2@example.com`);
    const key = keyResult!.api_key;
    const { keyHash } = validateApiKey(key);

    const before = getUsage(keyHash).used;

    const app = makeApp();
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ iban: 'DE89370400440532013000' }),
    });
    expect(res.status).toBe(200);

    const after = getUsage(keyHash).used;
    expect(after).toBe(before + 1);
  });
});

describe('apiKeyMiddleware — per-client telemetry (apiKeyPrefix)', () => {
  it('sets apiKeyPrefix on the monthly-quota path so request_log can attribute the call', async () => {
    const keyResult = generateApiKey(`prefix-e2e-${RUN_ID}-3@example.com`);
    const key = keyResult!.api_key;

    let seenPrefix: string | null | undefined;
    const app = new Hono<HonoEnv>();
    app.use('/v1/*', apiKeyMiddleware());
    // Downstream probe: read what the middleware left in context.
    app.use('/v1/*', async (c, next) => {
      seenPrefix = c.get('apiKeyPrefix');
      await next();
    });
    app.route('/', ibanValidate);

    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'DE89370400440532013000' }),
    });
    expect(res.status).toBe(200);
    expect(seenPrefix).toBe(key.slice(0, 12));
  });

  it('does not set apiKeyPrefix without a key', async () => {
    let seenPrefix: string | null | undefined;
    const app = new Hono<HonoEnv>();
    app.use('/v1/*', apiKeyMiddleware());
    app.use('/v1/*', async (c, next) => {
      seenPrefix = c.get('apiKeyPrefix');
      await next();
    });
    app.route('/', ibanValidate);

    await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'DE89370400440532013000' }),
    });
    expect(seenPrefix ?? null).toBeNull();
  });
});

describe('apiKeyMiddleware — paywall cause surfaced in the 402 body', () => {
  // Mirror the production middleware order (src/index.ts): enrich-402 wraps
  // api-key, so the cause set by api-key is visible when enrich-402 patches
  // the 402 body on the way out. The paid route stands in for the x402
  // middleware: it 402s unless the key authenticated the request.
  async function makePaywalledApp() {
    const { enrich402Middleware } = await import('./enrich-402.js');
    const app = new Hono<HonoEnv>();
    app.use('/v1/*', enrich402Middleware());
    app.use('/v1/*', apiKeyMiddleware());
    app.get('/v1/paid', (c) => {
      if (c.get('apiKeyAuthenticated')) return c.json({ ok: true });
      return c.body('', 402);
    });
    return app;
  }

  it('names the invalid key as the cause instead of posing as anonymous', async () => {
    const app = await makePaywalledApp();
    const res = await app.request('/v1/paid', {
      headers: { Authorization: 'Bearer ifk_definitely_not_a_real_key' },
    });
    expect(res.status).toBe(402);
    expect(res.headers.get('X-API-Key-Invalid')).toBe('true');
    const body = (await res.json()) as { cause?: { reason?: string }; message?: string };
    expect(body.cause?.reason).toBe('invalid_api_key');
    expect(body.message).toContain('invalid or revoked');
  });

  it('names the exhausted monthly quota as the cause, with the numbers', async () => {
    const keyResult = generateApiKey(`cause-quota-${RUN_ID}@example.com`);
    const key = keyResult!.api_key;
    const { keyHash, monthlyLimit } = validateApiKey(key);

    // Burn the whole monthly allowance directly against the quota counter.
    let quota = checkAndIncrementQuota(keyHash, monthlyLimit ?? undefined);
    while (quota.allowed) {
      quota = checkAndIncrementQuota(keyHash, monthlyLimit ?? undefined);
    }

    const app = await makePaywalledApp();
    const res = await app.request('/v1/paid', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(402);
    expect(res.headers.get('X-Quota-Exhausted')).toBe('true');
    const body = (await res.json()) as {
      cause?: { reason?: string; quota?: { used: number; limit: number } };
      message?: string;
    };
    expect(body.cause?.reason).toBe('monthly_quota_exhausted');
    expect(body.cause?.quota?.limit).toBeGreaterThan(0);
    expect(body.message).toContain('resets on the 1st');
  });

  it('leaves the 402 body cause-free for genuinely anonymous requests', async () => {
    const app = await makePaywalledApp();
    const res = await app.request('/v1/paid');
    expect(res.status).toBe(402);
    const body = (await res.json()) as { cause?: unknown; message?: string };
    expect(body.cause).toBeUndefined();
    expect(body.message).toContain('Authentication or payment required');
  });
});
