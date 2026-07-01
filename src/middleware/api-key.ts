import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateApiKey, checkAndIncrementQuota, decrementQuota, decrementCredits, refundCredit } from '../lib/api-keys.js';

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


    const { valid, keyHash, monthlyLimit, creditsRemaining, creditsTotal } = validateApiKey(key);

    if (!valid) {
      await next();
      return;
    }

    // Attribute the request to this key for per-client telemetry (CRM usage
    // charts) on EVERY valid-key path — including quota/credit exhaustion
    // fall-throughs, where the request still belongs to this customer.
    c.set('apiKeyPrefix', key.slice(0, 12));

    // Bundle credits path: the key has a prepaid balance (credits_remaining
    // is an integer, monthly_limit is NULL). Decrement atomically and serve.
    // When credits run out, fall through to x402 instead of hard-blocking,
    // exactly like the monthly-quota exhaustion path below.
    if (typeof creditsRemaining === 'number') {
      const newBalance = decrementCredits(keyHash);
      if (newBalance < 0) {
        c.header('X-Credits-Exhausted', 'true');
        c.header('X-Credits-Used', String(creditsTotal ?? 0));
        c.header('X-Credits-Total', String(creditsTotal ?? 0));
        c.header('X-Credits-Topup-Hint', 'POST /v1/credits/buy/1k for a fresh 1000-call bundle');
        await next();
        return;
      }
      c.header('X-Credits-Remaining', String(newBalance));
      c.header('X-Credits-Total', String(creditsTotal ?? 0));
      c.set('apiKeyAuthenticated', true);
      await next();
      // Refund credit on 4xx client errors (mirror monthly quota behavior).
      if (c.res.status >= 400 && c.res.status < 500) {
        refundCredit(keyHash);
      }
      return;
    }

    // Monthly subscription path (existing behavior).
    const quota = checkAndIncrementQuota(keyHash, monthlyLimit);

    if (!quota.allowed) {
      // Quota exhausted. Instead of returning a hard 429 (which is a dead-end
      // for autonomous agents), we fall through WITHOUT setting
      // apiKeyAuthenticated. The x402 middleware will then advertise
      // payment requirements and the agent can pay-per-call seamlessly until
      // their quota resets next month.
      // Hint headers tell the agent what happened so it can log + decide.
      c.header('X-Quota-Exhausted', 'true');
      c.header('X-Quota-Used', String(quota.used));
      c.header('X-Quota-Limit', String(quota.limit));
      c.header('X-Quota-Month', quota.month);
      c.header('X-Quota-Reset-Hint', 'monthly, 1st of month');
      await next();
      return;
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
