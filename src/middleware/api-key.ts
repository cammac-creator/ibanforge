import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateApiKey, checkAndIncrementQuota, decrementQuota, decrementCredits, refundCredit } from '../lib/api-keys.js';
import { getIbansArray } from '../lib/request-helpers.js';
import { CARD_CHECKOUT_HINT } from '../lib/payment-links.js';
import { maybeSendQuotaWarning } from '../lib/quota-notice.js';

/**
 * Extract an IBANforge API key from common locations agents use:
 *   1. Authorization: Bearer ifk_xxx       (standard, recommended)
 *   2. X-API-Key: ifk_xxx                  (de-facto standard for many agents/SDKs)
 *   3. ?api_key=ifk_xxx                    (query param — last resort, used by curl/CLI examples)
 */
/**
 * Tell a successful caller where it stands.
 *
 * 🚨 These used to be set ONLY when a request was refused, so a client could
 * not see it approaching the wall — it learned at the moment it hit it. A
 * customer building a "warn me at N% of quota" guard had nothing to read, and
 * the 80% warning e-mail exists precisely because the response carried nothing.
 *
 * Set AFTER the handler runs, and after any 4xx refund, so the figure is the
 * balance the caller actually has left. Setting it before `next()` would
 * publish a slot that gets handed straight back.
 */
function setQuotaHeaders(
  c: Parameters<MiddlewareHandler<HonoEnv>>[0],
  q: { used: number; limit: number; month: string },
): void {
  c.header('X-Quota-Used', String(q.used));
  c.header('X-Quota-Limit', String(q.limit));
  c.header('X-Quota-Remaining', String(Math.max(q.limit - q.used, 0)));
  c.header('X-Quota-Month', q.month);
}

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


    const { valid, keyHash, email, monthlyLimit, creditsRemaining, creditsTotal, noRecredit } = validateApiKey(key);

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
              `Send a batch of ≤${remaining} IBANs, or top up now. ${CARD_CHECKOUT_HINT}. ` +
              'Prefer USDC? POST /v1/credits/buy/1k|5k|25k, or pay per call via x402.'
            : `Your prepaid credit bundle (${creditsTotal ?? 0} credits) is used up. ${CARD_CHECKOUT_HINT}. ` +
              'Prefer USDC? POST /v1/credits/buy/1k|5k|25k, or pay per call via x402.',
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
      c.header('X-Credits-Total', String(creditsTotal ?? 0));
      if (units > 1) c.header('X-Credits-Charged', String(units));
      c.set('apiKeyAuthenticated', true);
      await next();
      // Refund credits on 4xx client errors (mirror monthly quota behavior).
      // Same reason as the quota headers below: the balance is published after
      // the refund, otherwise it advertises credits that were handed back.
      let left = remaining;
      if (c.res.status >= 400 && c.res.status < 500) {
        refundCredit(keyHash, units);
        left = remaining + units;
      }
      c.header('X-Credits-Remaining', String(left));
      return;
    }

    // Monthly subscription path (existing behavior).
    const quota = checkAndIncrementQuota(keyHash, monthlyLimit, units, noRecredit);

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
            `or lift the limit now. ${CARD_CHECKOUT_HINT}. ` +
            'Prefer USDC? POST /v1/credits/buy/1k|5k|25k, or pay per call via x402.'
          : `Your free tier is exhausted for ${quota.month} (${quota.used}/${quota.limit} requests used) — ` +
            `it resets on the 1st of next month. To keep going now: ${CARD_CHECKOUT_HINT}. ` +
            'Prefer USDC? POST /v1/credits/buy/1k|5k|25k, or pay per call via x402.',
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

    // Upsell on the trajectory, not on the wall. A daily job cannot catch a
    // client that burns nearly its whole monthly allowance in a matter of
    // minutes (a real, measured case), so the warning is triggered by the very
    // call that crosses 80%.
    // Fire-and-forget: the customer's request must never wait on SMTP. The
    // notice bookkeeping touches the DB, so a lock or an in-flight shutdown
    // can reject — that must land in the log, never as an unhandled rejection.
    if (quota.crossedNoticeThreshold && email) {
      c.header('X-Quota-Notice', 'threshold-crossed');
      void maybeSendQuotaWarning({
        keyHash,
        email,
        keyPrefix: key.slice(0, 12),
        used: quota.used,
        limit: quota.limit,
        month: quota.month,
      }).catch((err) =>
        console.error('[quota-notice] warning failed:', err instanceof Error ? err.message : err),
      );
    }

    c.set('apiKeyAuthenticated', true);
    await next();

    // Refund the quota slots if the downstream handler rejected the request
    // with a 4xx client error (bad input, validation failure). Otherwise an
    // attacker could burn a key's monthly quota for free by spamming invalid
    // payloads. 5xx is NOT refunded — we charge for server-side failures to
    // avoid hiding infrastructure problems.
    let used = quota.used;
    if (c.res.status >= 400 && c.res.status < 500) {
      // Refund onto the month the increment was billed to, not the wall-clock
      // month now — they differ across a month boundary and the mismatch is
      // permanent for a key on the lifetime basis.
      decrementQuota(keyHash, units, quota.month);
      used = Math.max(quota.used - units, 0);
    }
    setQuotaHeaders(c, { used, limit: quota.limit, month: quota.month });
  };
}
