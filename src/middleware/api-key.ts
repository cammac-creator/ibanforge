import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateApiKey, checkAndIncrementQuota } from '../lib/api-keys.js';

/**
 * Extract an IBANforge API key from common locations agents use:
 *   1. Authorization: Bearer ifk_xxx       (standard, recommended)
 *   2. X-API-Key: ifk_xxx                  (de-facto standard for many agents/SDKs)
 *   3. ?api_key=ifk_xxx                    (query param — last resort, used by curl/CLI examples)
 */
function extractKey(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string | null {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ifk_')) return auth.slice(7);
  if (auth?.startsWith('Bearer ')) {
    const v = auth.slice(7);
    if (v.startsWith('ifk_')) return v;
  }
  const xKey = c.req.header('X-API-Key') ?? c.req.header('x-api-key');
  if (xKey?.startsWith('ifk_')) return xKey;
  const queryKey = c.req.query('api_key');
  if (queryKey?.startsWith('ifk_')) return queryKey;
  return null;
}

export function apiKeyMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const key = extractKey(c);
    if (!key) {
      await next();
      return;
    }


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
