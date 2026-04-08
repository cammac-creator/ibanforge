import type { MiddlewareHandler } from 'hono';
import { validateApiKey, checkAndIncrementQuota } from '../lib/api-keys.js';

export function apiKeyMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ifk_')) {
      await next();
      return;
    }

    const key = authHeader.slice(7);
    const { valid, keyHash } = validateApiKey(key);

    if (!valid) {
      await next();
      return;
    }

    const quota = checkAndIncrementQuota(keyHash);

    if (!quota.allowed) {
      return c.json({
        error: 'quota_exceeded',
        message: 'Monthly limit of 200 requests reached. Use x402 payment for additional requests.',
        used: quota.used,
        limit: quota.limit,
        month: quota.month,
      }, 429);
    }

    c.set('apiKeyAuthenticated', true);
    await next();
  };
}
