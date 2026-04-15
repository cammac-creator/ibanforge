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
    const { valid, keyHash, monthlyLimit } = validateApiKey(key);

    if (!valid) {
      await next();
      return;
    }

    const quota = checkAndIncrementQuota(keyHash, monthlyLimit);

    if (!quota.allowed) {
      return c.json(
        {
          error: 'quota_exceeded',
          message: `Monthly limit of ${quota.limit} requests reached. Quota resets on the 1st of each month.`,
          used: quota.used,
          limit: quota.limit,
          month: quota.month,
          upgrade: {
            description: 'Need more? Contact us for a custom plan with higher limits.',
            email: 'support@ibanforge.com',
            x402: 'Or use x402 micropayments for unlimited pay-per-call access (no quota).',
          },
        },
        429,
      );
    }

    c.set('apiKeyAuthenticated', true);
    await next();
  };
}
