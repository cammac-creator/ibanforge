import { Hono } from 'hono';
import { generateApiKey, validateApiKey, getUsage } from '../lib/api-keys.js';

const apiKeys = new Hono();

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
    monthly_limit: 200,
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

export { apiKeys };
