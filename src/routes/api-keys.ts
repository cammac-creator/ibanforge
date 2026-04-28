import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { generateApiKey, validateApiKey, getUsage } from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';

const apiKeys = new Hono();

/**
 * Constant-time admin auth. Returns true only if ADMIN_SECRET is set AND
 * the provided header matches exactly. Length-normalized before timing-safe
 * compare so comparison cost does not leak the secret's length.
 */
function isAdminAuthorized(provided: string | undefined): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  // Pad provided to the same length (compare a dummy if mismatched) to make
  // the decision branch-free from attacker's POV.
  if (expectedBuf.length !== providedBuf.length) {
    // Still do a dummy compare to equalize timing.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

apiKeys.post('/v1/keys/generate', async (c) => {
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const email = body.email;
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 255) {
    return c.json({ error: 'invalid_email', message: 'A valid email address is required' }, 400);
  }

  const result = generateApiKey(email.trim().toLowerCase());

  if (!result) {
    return c.json({
      error: 'rate_limited',
      message: 'Only one API key can be generated per email per day. Try again tomorrow.',
    }, 429);
  }

  return c.json({
    api_key: result.api_key,
    key_prefix: result.key_prefix,
    email: email.trim().toLowerCase(),
    monthly_limit: 1000,
    message: 'Save this key — it will not be shown again.',
  }, 201);
});

apiKeys.get('/v1/keys/usage', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json({ error: 'missing_key', message: 'Provide your API key via Authorization: Bearer ifk_xxx' }, 401);
  }

  const key = authHeader.slice(7);
  const { valid, keyHash, monthlyLimit } = validateApiKey(key);

  if (!valid) {
    return c.json({ error: 'invalid_key', message: 'API key not found or inactive' }, 401);
  }

  const usage = getUsage(keyHash, monthlyLimit);
  return c.json({ ...usage, key_prefix: key.slice(0, 12) });
});

apiKeys.post('/v1/admin/keys', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: { email?: unknown; monthly_limit?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; monthly_limit?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const email = body.email;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return c.json({ error: 'invalid_email' }, 400);
  }

  const monthlyLimit = typeof body.monthly_limit === 'number' ? body.monthly_limit : undefined;
  const result = generateApiKey(email.trim().toLowerCase(), monthlyLimit);
  if (!result) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  return c.json({
    api_key: result.api_key,
    key_prefix: result.key_prefix,
    email: email.trim().toLowerCase(),
    monthly_limit: monthlyLimit ?? 1000,
  }, 201);
});

apiKeys.post('/v1/admin/keys/import', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: { api_key?: unknown; email?: unknown; monthly_limit?: unknown };
  try {
    body = await c.req.json<{ api_key?: unknown; email?: unknown; monthly_limit?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const apiKey = body.api_key;
  const email = body.email;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('ifk_')) {
    return c.json({ error: 'invalid_key', message: 'api_key must start with ifk_' }, 400);
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return c.json({ error: 'invalid_email' }, 400);
  }

  const { createHash } = await import('node:crypto');
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const keyPrefix = apiKey.slice(0, 12);
  const monthlyLimit = typeof body.monthly_limit === 'number' ? body.monthly_limit : null;

  const db = getStatsDB();
  const existing = db.prepare('SELECT id FROM api_keys WHERE key_hash = ?').get(keyHash);
  if (existing) {
    return c.json({ error: 'key_exists', key_prefix: keyPrefix }, 409);
  }

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit) VALUES (?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, email.trim().toLowerCase(), monthlyLimit);

  return c.json({ imported: true, key_prefix: keyPrefix, email: email.trim().toLowerCase(), monthly_limit: monthlyLimit ?? 1000 }, 201);
});

apiKeys.get('/v1/admin/keys', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);
  const rows = db.prepare(
    `SELECT k.key_prefix, k.email, k.monthly_limit, k.active, k.created_at,
            COALESCE(u.count, 0) as used
     FROM api_keys k
     LEFT JOIN api_usage u ON u.key_hash = k.key_hash AND u.month = ?
     ORDER BY k.created_at DESC`
  ).all(month);
  return c.json({ month, keys: rows });
});

export { apiKeys };
