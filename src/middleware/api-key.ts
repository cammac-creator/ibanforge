import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateApiKey, checkAndIncrementQuota, decrementQuota } from '../lib/api-keys.js';

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
          message: `You have used your ${quota.limit} free calls this month. Continue without interruption by paying per call in USDC via x402 — no credit card, no signup, just a wallet on Base. Drop your API key from the request to switch to x402 mode automatically.`,
          used: quota.used,
          limit: quota.limit,
          month: quota.month,
          next: {
            mode: 'x402',
            how: 'Remove the Authorization/X-API-Key header and retry the same request — the API will respond with HTTP 402 Payment Required and a payment instruction conforming to https://x402.org.',
            pricing: {
              'POST /v1/iban/validate': '$0.005',
              'POST /v1/iban/batch': '$0.20',
              'GET /v1/bic/{code}': '$0.003',
              'GET /v1/ch/clearing/{iid}': '$0.003',
              'POST /v1/iban/compliance': '$0.02',
            },
            discovery: 'https://api.ibanforge.com/.well-known/x402',
            docs: 'https://x402.org',
          },
          quota_reset: 'Quota resets on the 1st of each month.',
          contact: 'For volume agreements (≥ 5M calls/month, prepaid), email sales@ibanforge.com.',
        },
        429,
      );
    }

    c.set('apiKeyAuthenticated', true);
    await next();

    // Refund the quota slot if the downstream handler rejected the request
    // with a 4xx client error (bad input, validation failure). Otherwise an
    // attacker could burn a key's monthly quota for free by spamming invalid
    // payloads. 5xx is NOT refunded — we charge for server-side failures to
    // avoid hiding infrastructure problems.
    if (c.res.status >= 400 && c.res.status < 500) {
      decrementQuota(keyHash);
    }
  };
}
