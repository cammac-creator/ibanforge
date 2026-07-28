import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware } from './rate-limit.js';

/**
 * The IETF draft names (RateLimit-Limit / -Remaining / -Reset) exist alongside
 * the legacy X-RateLimit-* triple because automated readiness scorers look for
 * the standard spelling. The 2026-07-28 channel audit found api-evangelist
 * scoring IBANforge `rate_limit_signal: false` while the server was in fact
 * emitting the legacy names on every limited route.
 *
 * The two differ in more than spelling: RateLimit-Reset is delta-seconds until
 * the window resets, where X-RateLimit-Reset is a unix timestamp. Both are kept
 * so existing clients reading the legacy header do not break.
 */
function appWithLimiter() {
  const app = new Hono();
  app.use('*', rateLimitMiddleware());
  app.get('/v1/anything', (c) => c.json({ ok: true }));
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}

const ip = (v: string) => ({ headers: { 'x-real-ip': v } });

describe('rate limit headers', () => {
  it('emits the IETF RateLimit-Limit header on a limited route', async () => {
    const res = await appWithLimiter().request('/v1/anything', ip('203.0.113.10'));
    expect(res.headers.get('RateLimit-Limit')).toBe('100');
  });

  it('emits RateLimit-Remaining counting down with each request', async () => {
    const app = appWithLimiter();
    const first = await app.request('/v1/anything', ip('203.0.113.11'));
    const second = await app.request('/v1/anything', ip('203.0.113.11'));
    expect(first.headers.get('RateLimit-Remaining')).toBe('99');
    expect(second.headers.get('RateLimit-Remaining')).toBe('98');
  });

  it('expresses RateLimit-Reset as delta-seconds, not a unix timestamp', async () => {
    const res = await appWithLimiter().request('/v1/anything', ip('203.0.113.12'));
    const reset = Number(res.headers.get('RateLimit-Reset'));
    // The window is 60s, so the delta must fall inside it. A unix timestamp
    // would be ~1.7e9 and fail this outright.
    expect(reset).toBeGreaterThan(0);
    expect(reset).toBeLessThanOrEqual(60);
  });

  it('keeps the legacy X-RateLimit-* triple so existing clients do not break', async () => {
    const res = await appWithLimiter().request('/v1/anything', ip('203.0.113.13'));
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
    // Legacy reset stays a unix timestamp.
    expect(Number(res.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(1_600_000_000);
  });

  it('does not emit rate limit headers on exempt routes', async () => {
    const res = await appWithLimiter().request('/health', ip('203.0.113.14'));
    expect(res.headers.get('RateLimit-Limit')).toBeNull();
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
  });
});
