import type { MiddlewareHandler } from 'hono';

const LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN ?? '100', 10);
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

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * In-memory rate limiter middleware.
 *
 * - Default: 100 req/min per IP (configurable via RATE_LIMIT_PER_MIN)
 * - Adds X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers
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

    const ip = getClientIp(c.req.raw);
    const now = Date.now();

    let win = store.get(ip);
    if (!win || now >= win.resetAt) {
      win = { count: 0, resetAt: now + WINDOW_MS };
      store.set(ip, win);
    }

    win.count += 1;
    const remaining = Math.max(0, LIMIT - win.count);
    const resetSec = Math.ceil(win.resetAt / 1000);

    c.header('X-RateLimit-Limit', String(LIMIT));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSec));

    if (win.count > LIMIT) {
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
