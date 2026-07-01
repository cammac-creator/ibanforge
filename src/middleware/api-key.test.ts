import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { apiKeyMiddleware } from './api-key.js';
import { ibanValidate } from '../routes/iban-validate.js';
import { generateApiKey, validateApiKey, getUsage } from '../lib/api-keys.js';
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
