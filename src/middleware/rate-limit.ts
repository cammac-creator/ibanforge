import type { MiddlewareHandler } from 'hono';
import { extractClientIp } from '../lib/stats.js';

// Guarded like facilitatorTimeoutMs() in x402.ts, and for the same reason: a
// Railway variable set to a non-number (or to an EMPTY string, which `??`
// does not catch) must not silently turn the only per-IP flood control into
// `count > NaN` — always false, limiter inert, headers reading "NaN".
// Exported for /.well-known/rate-limits.yml (src/routes/artifacts.ts): the
// published contract must interpolate the SAME guarded value the middleware
// enforces, not re-parse the env var and risk publishing "NaN".
export const RATE_LIMIT = ((): number => {
  const raw = process.env.RATE_LIMIT_PER_MIN;
  if (raw === undefined || raw === '') return 100;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[rate-limit] RATE_LIMIT_PER_MIN=${raw} is not a positive number. Using 100.`);
    return 100;
  }
  return Math.floor(parsed);
})();
const WINDOW_MS = 60_000; // 1 minute
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes

interface Window {
  count: number;
  resetAt: number; // unix ms
}

const store = new Map<string, Window>();

// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, window] of store) {
    if (now >= window.resetAt) {
      store.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

// Use the shared, spoof-resistant extractor (trusted-proxy last hop / x-real-ip)
// so an attacker can't rotate the rate-limit key via a forged X-Forwarded-For.
function getClientIp(req: Request): string {
  return (
    extractClientIp({
      'x-forwarded-for': req.headers.get('x-forwarded-for'),
      'x-real-ip': req.headers.get('x-real-ip'),
    }) ?? 'unknown'
  );
}

/**
 * In-memory rate limiter middleware.
 *
 * - Default: 100 req/min per IP (configurable via RATE_LIMIT_PER_MIN)
 * - Adds both header spellings: the legacy X-RateLimit-Limit/-Remaining/-Reset
 *   (Reset = unix timestamp) and the IETF RateLimit-Limit/-Remaining/-Reset
 *   (Reset = delta-seconds), so standard-aware scorers and existing clients
 *   both find what they look for
 * - Returns 429 when limit exceeded
 * - Exempt paths: /health, /openapi.json, /ping, /stats, /v1/demo
 */
export function rateLimitMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;

    // Exempt free/monitoring routes from rate limiting
    if (path === '/health' || path === '/openapi.json' || path === '/ping' || path === '/stats' || path === '/v1/demo') {
      await next();
      return;
    }

    // Stripe webhooks come from Stripe's IP pool and can burst on retries.
    // The webhook handler itself verifies the signature, so rate-limiting by
    // IP gives us no security and risks dropping legitimate events.
    if (path === '/v1/stripe/webhook') {
      await next();
      return;
    }

    const ip = getClientIp(c.req.raw);
    const now = Date.now();

    let win = store.get(ip);
    if (!win || now >= win.resetAt) {
      win = { count: 0, resetAt: now + WINDOW_MS };
      store.set(ip, win);
    }

    win.count += 1;
    const remaining = Math.max(0, RATE_LIMIT - win.count);
    const resetSec = Math.ceil(win.resetAt / 1000);
    const resetDelta = Math.max(1, Math.ceil((win.resetAt - now) / 1000));

    // Legacy triple, kept because existing clients read it. X-RateLimit-Reset
    // is a unix timestamp here, which is why the IETF header below is NOT an
    // alias: the standard spells Reset as delta-seconds.
    c.header('X-RateLimit-Limit', String(RATE_LIMIT));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSec));

    // IETF draft-ietf-httpapi-ratelimit-headers spelling. Emitted alongside the
    // legacy names because automated agent-readiness scorers look for the
    // standard field names: the 2026-07-28 channel audit found api-evangelist
    // reporting `rate_limit_signal: false` while the server was already sending
    // the X-prefixed triple on every limited route.
    c.header('RateLimit-Limit', String(RATE_LIMIT));
    c.header('RateLimit-Remaining', String(remaining));
    c.header('RateLimit-Reset', String(resetDelta));

    if (win.count > RATE_LIMIT) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: 'rate_limit_exceeded',
          message: `Too many requests. Please retry after ${retryAfter} seconds.`,
          retry_after: retryAfter,
        },
        429,
      );
    }

    await next();
  };
}
