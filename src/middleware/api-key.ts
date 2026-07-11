import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateApiKey, checkAndIncrementQuota, decrementQuota, decrementCredits, refundCredit } from '../lib/api-keys.js';
import { getIbansArray } from '../lib/request-helpers.js';

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

/**
 * How many quota slots / credits this request bills.
 *
 * Batch validation bills 1 unit per IBAN — pricing parity with the x402
 * per-IBAN price ($0.002 × N). Before 2026-07-11 a whole batch billed a
 * single unit, so a 100-IBAN batch cost the same as one validation: a ~100×
 * underbilling on prepaid packs and the free tier. Every other endpoint
 * bills 1 unit per request.
 *
 * Reading the body here is safe — Hono caches parsed bodies, the downstream
 * handler re-reads it freely. Capped at the batch size limit (100): larger
 * batches are rejected 400 by the handler (and refunded); the cap only keeps
 * a 402 from quoting a shortfall no valid request could ever bill.
 */
async function billableUnits(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): Promise<number> {
  if (c.req.method !== 'POST' || c.req.path !== '/v1/iban/batch') return 1;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const ibans = getIbansArray(body);
  if (!Array.isArray(ibans) || ibans.length === 0) return 1;
  return Math.min(ibans.length, 100);
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
      // A key WAS supplied but doesn't validate (typo, truncation, revoked).
      // Without this marker the request is indistinguishable from anonymous
      // traffic and the client is never told its key is broken.
      c.set('paywallCause', {
        reason: 'invalid_api_key',
        detail:
          'An API key was provided (ifk_…) but it is invalid or revoked. ' +
          'Check for typos or truncation, or generate a new free key: POST /v1/keys/generate.',
      });
      c.header('X-API-Key-Invalid', 'true');
      await next();
      return;
    }

    // Attribute the request to this key for per-client telemetry (CRM usage
    // charts) on EVERY valid-key path — including quota/credit exhaustion
    // fall-throughs, where the request still belongs to this customer.
    c.set('apiKeyPrefix', key.slice(0, 12));

    // Billable units for this request: 1 everywhere except batch validation,
    // which bills 1 per IBAN (same rule as the x402 per-IBAN price).
    const units = await billableUnits(c);

    // Bundle credits path: the key has a prepaid balance (credits_remaining
    // is an integer, monthly_limit is NULL). Decrement atomically and serve.
    // When credits run out (or don't cover this batch), fall through to x402
    // instead of hard-blocking, exactly like the monthly-quota path below.
    if (typeof creditsRemaining === 'number') {
      const { ok, remaining } = decrementCredits(keyHash, units);
      if (!ok) {
        // remaining > 0 means the balance exists but can't cover this batch
        // (all-or-nothing — nothing was debited). remaining === 0 is the
        // classic exhaustion.
        const shortfall = remaining > 0;
        c.set('paywallCause', {
          reason: shortfall ? 'credits_insufficient' : 'credits_exhausted',
          detail: shortfall
            ? `This batch of ${units} IBANs needs ${units} credits (1 credit per IBAN) but only ${remaining} remain — nothing was debited. ` +
              `Send a batch of ≤${remaining} IBANs, top up (POST /v1/credits/buy/1k|5k|25k), or pay per call via x402.`
            : `Your prepaid credit bundle (${creditsTotal ?? 0} credits) is used up. ` +
              'Top up: POST /v1/credits/buy/1k|5k|25k — or pay per call via x402.',
          credits: { required: units, remaining, total: creditsTotal ?? 0, topup: 'POST /v1/credits/buy/1k|5k|25k' },
        });
        c.header(shortfall ? 'X-Credits-Insufficient' : 'X-Credits-Exhausted', 'true');
        c.header('X-Credits-Required', String(units));
        c.header('X-Credits-Remaining', String(remaining));
        c.header('X-Credits-Total', String(creditsTotal ?? 0));
        c.header('X-Credits-Topup-Hint', 'POST /v1/credits/buy/1k for a fresh 1,000-credit bundle');
        await next();
        return;
      }
      c.header('X-Credits-Remaining', String(remaining));
      c.header('X-Credits-Total', String(creditsTotal ?? 0));
      if (units > 1) c.header('X-Credits-Charged', String(units));
      c.set('apiKeyAuthenticated', true);
      await next();
      // Refund credits on 4xx client errors (mirror monthly quota behavior).
      if (c.res.status >= 400 && c.res.status < 500) {
        refundCredit(keyHash, units);
      }
      return;
    }

    // Monthly subscription path (existing behavior).
    const quota = checkAndIncrementQuota(keyHash, monthlyLimit, units);

    if (!quota.allowed) {
      // Quota exhausted — or too small for this batch (all-or-nothing, nothing
      // was consumed). Instead of returning a hard 429 (which is a dead-end
      // for autonomous agents), we fall through WITHOUT setting
      // apiKeyAuthenticated. The x402 middleware will then advertise
      // payment requirements and the agent can pay-per-call seamlessly until
      // their quota resets next month.
      // Hint headers tell the agent what happened so it can log + decide.
      const shortfall = quota.remaining > 0;
      c.set('paywallCause', {
        reason: shortfall ? 'monthly_quota_insufficient' : 'monthly_quota_exhausted',
        detail: shortfall
          ? `This batch of ${units} IBANs needs ${units} free-tier requests (1 per IBAN) but only ${quota.remaining} remain for ${quota.month} ` +
            `(${quota.used}/${quota.limit} used) — nothing was consumed. Send a batch of ≤${quota.remaining} IBANs, ` +
            'use prepaid credit packs (POST /v1/credits/buy/1k|5k|25k), or pay per call via x402.'
          : `Your free tier is exhausted for ${quota.month} (${quota.used}/${quota.limit} requests used) — ` +
            'it resets on the 1st of next month. To keep going now: prepaid credit packs ' +
            '(POST /v1/credits/buy/1k|5k|25k) or pay per call via x402.',
        quota: { used: quota.used, limit: quota.limit, month: quota.month, resets: '1st of month', required: units, remaining: quota.remaining },
      });
      c.header(shortfall ? 'X-Quota-Insufficient' : 'X-Quota-Exhausted', 'true');
      c.header('X-Quota-Required', String(units));
      c.header('X-Quota-Remaining', String(quota.remaining));
      c.header('X-Quota-Used', String(quota.used));
      c.header('X-Quota-Limit', String(quota.limit));
      c.header('X-Quota-Month', quota.month);
      c.header('X-Quota-Reset-Hint', 'monthly, 1st of month');
      await next();
      return;
    }

    if (units > 1) c.header('X-Quota-Charged', String(units));
    c.set('apiKeyAuthenticated', true);
    await next();

    // Refund the quota slots if the downstream handler rejected the request
    // with a 4xx client error (bad input, validation failure). Otherwise an
    // attacker could burn a key's monthly quota for free by spamming invalid
    // payloads. 5xx is NOT refunded — we charge for server-side failures to
    // avoid hiding infrastructure problems.
    if (c.res.status >= 400 && c.res.status < 500) {
      decrementQuota(keyHash, units);
    }
  };
}
