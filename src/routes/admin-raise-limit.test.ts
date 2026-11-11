import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { apiKeys, RAISE_LIMIT_MAX, RAISE_LIMIT_MIN, SITE_RAISE_LIMIT_MAX } from './api-keys.js';
import { generateApiKey, OEM_MONTHLY_LIMIT, validateApiKey } from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';

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

/**
 * Audit C10, section 5 (11.11.2026) : la clé du site ne fait que RELEVER un
 * plafond, jusqu'à 20 000 par mois, le plus haut palier du bouton du CRM. Le
 * secret complet garde toute la plage, baisse comprise.
 */
describe('POST /v1/admin/keys/raise-limit with the site key', () => {
  const SITE = 'site-key-for-the-raise-limit-test-0123456789';
  const avant = process.env.SITE_ADMIN_TOKEN;
  beforeAll(() => {
    process.env.SITE_ADMIN_TOKEN = SITE;
  });
  afterAll(() => {
    if (avant === undefined) delete process.env.SITE_ADMIN_TOKEN;
    else process.env.SITE_ADMIN_TOKEN = avant;
  });

  const raise = (secret: string, keyPrefix: string, monthly_limit: number) =>
    app().request('/v1/admin/keys/raise-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
      body: JSON.stringify({ key_prefix: keyPrefix, monthly_limit }),
    });
  const freshKey = (email: string): string => {
    const k = generateApiKey(email);
    if (!k) throw new Error('fixture key not minted');
    return k.key_prefix;
  };

  it('raises up to SITE_RAISE_LIMIT_MAX, and no further', async () => {
    const key = freshKey('site-cap@alpha.example.net');
    const over = await raise(SITE, key, SITE_RAISE_LIMIT_MAX + 1);
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: string }).error).toBe('invalid_input');
    const vendor = await raise(SITE, key, OEM_MONTHLY_LIMIT * 5);
    expect(vendor.status).toBe(400);
    const top = await raise(SITE, key, SITE_RAISE_LIMIT_MAX);
    expect(top.status).toBe(200);
    // Le secret complet, lui, garde la plage entière.
    expect((await raise(SECRET, key, OEM_MONTHLY_LIMIT * 5)).status).toBe(200);
  });

  it('refuses a raise when the current limit already sits at its bound (400), and leaves it there', async () => {
    const key = freshKey('site-borne@alpha.example.net');
    expect((await raise(SITE, key, SITE_RAISE_LIMIT_MAX)).status).toBe(200);
    const again = await raise(SITE, key, SITE_RAISE_LIMIT_MAX);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe('invalid_input');
    expect((await raise(SITE, key, SITE_RAISE_LIMIT_MAX + 1)).status).toBe(400);
    const row = getStatsDB()
      .prepare('SELECT monthly_limit FROM api_keys WHERE key_prefix = ?')
      .get(key) as { monthly_limit: number };
    expect(row.monthly_limit).toBe(SITE_RAISE_LIMIT_MAX);
  });

  it('never lowers a limit, nor rewrites it unchanged; the full secret still can', async () => {
    const key = freshKey('site-lower@alpha.example.net');
    expect((await raise(SECRET, key, 5_000)).status).toBe(200);
    const lower = await raise(SITE, key, 1_000);
    expect(lower.status).toBe(400);
    expect((await raise(SITE, key, 5_000)).status).toBe(400);
    expect((await raise(SITE, key, 10_000)).status).toBe(200);
    expect((await raise(SECRET, key, 1_000)).status).toBe(200);
  });
});
