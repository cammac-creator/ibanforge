import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiKeys } from './api-keys.js';
import { Hono } from 'hono';

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = 'correct-horse-battery-staple';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('/v1/admin/keys — admin auth (timing-safe)', () => {
  it('rejects requests without X-Admin-Secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of same length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'wrong-horse-battery-staple-BAD', // padded to 30 chars
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of different length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'short',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when ADMIN_SECRET env is not set (defence in depth)', async () => {
    delete process.env.ADMIN_SECRET;
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'anything',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts correct secret and issues a key', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ email: `admin-test-${Date.now()}@example.com` }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { api_key: string };
    expect(json.api_key).toMatch(/^ifk_/);
  });
});

describe('/v1/admin/keys GET — listing', () => {
  it('unauthorized without secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys');
    expect(res.status).toBe(401);
  });

  it('authorized with correct secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(json.keys)).toBe(true);
  });
});
