import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { apiKeys, RAISE_LIMIT_MAX, RAISE_LIMIT_MIN } from './api-keys.js';
import { generateApiKey, OEM_MONTHLY_LIMIT, validateApiKey } from '../lib/api-keys.js';
import { closeAll } from '../lib/db.js';

/**
 * The admin relief valve is the only gesture that can set an allowance above
 * what a subscription mints. Until 2026-09-07 it stopped at 20 000, below the
 * vendor licence itself (50 000): a vendor asking for more meant a deploy.
 */
const SECRET = 'test-admin-secret-raise-limit';
const app = () => new Hono().route('/', apiKeys);
const H = { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET };

let prefix = '';
let raw = '';

beforeAll(() => {
  process.env.ADMIN_SECRET = SECRET;
  const k = generateApiKey('acme@example.com');
  if (!k) throw new Error('fixture key not minted');
  raw = k.api_key;
  prefix = k.key_prefix;
});

afterAll(() => {
  closeAll();
});

describe('POST /v1/admin/keys/raise-limit', () => {
  it('reaches a vendor-sized allowance, above what the OEM subscription mints', async () => {
    const wanted = OEM_MONTHLY_LIMIT * 5;
    expect(wanted).toBeGreaterThan(20_000);
    const res = await app().request('/v1/admin/keys/raise-limit', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ key_prefix: prefix, monthly_limit: wanted }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { monthly_limit: number };
    expect(body.monthly_limit).toBe(wanted);
    // Effective on the very next request: validateApiKey re-reads the row.
    expect(validateApiKey(raw).monthlyLimit).toBe(wanted);
  });

  it('is still a valve, not a tap: the bounds hold at both ends', async () => {
    for (const bad of [RAISE_LIMIT_MIN - 1, RAISE_LIMIT_MAX + 1, 0, -5]) {
      const res = await app().request('/v1/admin/keys/raise-limit', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ key_prefix: prefix, monthly_limit: bad }),
      });
      expect(res.status).toBe(400);
    }
    const top = await app().request('/v1/admin/keys/raise-limit', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ key_prefix: prefix, monthly_limit: RAISE_LIMIT_MAX }),
    });
    expect(top.status).toBe(200);
  });

  it('refuses without the admin secret', async () => {
    const res = await app().request('/v1/admin/keys/raise-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_prefix: prefix, monthly_limit: 1000 }),
    });
    expect(res.status).toBe(401);
  });
});
