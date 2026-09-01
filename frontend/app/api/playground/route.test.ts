import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, __resetRateLimitForTests } from './route';

/**
 * FRT-01 (audit 2026-09-01). This relay carries the owner's paid API key, so
 * the two guards are checked on behaviour, not on reading the source: an
 * unknown origin must never reach `fetch`, and a caller must not be able to
 * loop past the window. `fetch` is stubbed and its call count is the proof.
 */

let upstreamCalls: { url: string; init?: RequestInit }[] = [];

beforeEach(() => {
  __resetRateLimitForTests();
  upstreamCalls = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    upstreamCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(headers: Record<string, string>, body: unknown = { type: 'iban', value: 'CH93' }) {
  return new NextRequest('http://site.test/api/playground', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/playground — origin guard', () => {
  it('serves a request coming from ibanforge.com', async () => {
    const res = await POST(request({ origin: 'https://ibanforge.com' }));
    expect(res.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].url).toMatch(/\/v1\/iban\/validate$/);
  });

  it('serves a request coming from www.ibanforge.com', async () => {
    const res = await POST(request({ origin: 'https://www.ibanforge.com' }));
    expect(res.status).toBe(200);
  });

  it('refuses a foreign origin without touching the upstream API', async () => {
    // The exact audit probe: Origin: https://evil.example answered 200 before.
    const res = await POST(request({ origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden_origin');
    // The page shows `message` when it has no translation for the code, so an
    // untranslated raw token never reaches a visitor.
    expect(typeof body.message).toBe('string');
    expect(upstreamCalls).toHaveLength(0);
  });

  it('refuses a request with neither Origin nor Referer', async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('falls back to Referer when Origin is absent', async () => {
    const res = await POST(request({ referer: 'https://ibanforge.com/en/playground' }));
    expect(res.status).toBe(200);
  });

  it('refuses a foreign Referer', async () => {
    const res = await POST(request({ referer: 'https://evil.example/page' }));
    expect(res.status).toBe(403);
  });

  it('refuses a malformed Origin instead of throwing', async () => {
    const res = await POST(request({ origin: 'not a url' }));
    expect(res.status).toBe(403);
  });

  it('accepts a preview deployment only when the origin is the host being served', async () => {
    const ok = await POST(
      request({ origin: 'https://ibanforge-preview.vercel.app', host: 'ibanforge-preview.vercel.app' }),
    );
    expect(ok.status).toBe(200);

    const foreign = await POST(
      request({ origin: 'https://someone-else.vercel.app', host: 'ibanforge-preview.vercel.app' }),
    );
    expect(foreign.status).toBe(403);
  });

  it('accepts localhost outside production only', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect((await POST(request({ origin: 'http://localhost:3000' }))).status).toBe(200);

    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request({ origin: 'http://localhost:3000' }))).status).toBe(403);
  });
});

describe('POST /api/playground — per-IP window', () => {
  const from = (ip: string) => request({ origin: 'https://ibanforge.com', 'x-forwarded-for': ip });

  const LIMIT = 30;

  it(`lets ${LIMIT} calls through and refuses the next one`, async () => {
    for (let i = 0; i < LIMIT; i++) {
      expect((await POST(from('203.0.113.7'))).status).toBe(200);
    }
    const blocked = await POST(from('203.0.113.7'));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toBe('rate_limited');
    expect(typeof body.message).toBe('string');
    expect(upstreamCalls).toHaveLength(LIMIT);
  });

  it('counts per IP, so one abuser does not lock out another visitor', async () => {
    for (let i = 0; i < LIMIT; i++) await POST(from('203.0.113.7'));
    expect((await POST(from('203.0.113.7'))).status).toBe(429);
    expect((await POST(from('198.51.100.4'))).status).toBe(200);
  });

  it('forgets calls older than the window', async () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < LIMIT; i++) await POST(from('203.0.113.7'));
      expect((await POST(from('203.0.113.7'))).status).toBe(429);
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      expect((await POST(from('203.0.113.7'))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('POST /api/playground — upstream call', () => {
  it('hands the visitor IP to the backend in an informative header', async () => {
    await POST(request({ origin: 'https://ibanforge.com', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(new Headers(upstreamCalls[0].init?.headers).get('X-Playground-Client-Ip')).toBe('203.0.113.7');
  });

  it('answers 400 on a malformed body without calling the backend', async () => {
    const req = new NextRequest('http://site.test/api/playground', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://ibanforge.com' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('answers 400 on an unknown type', async () => {
    const res = await POST(request({ origin: 'https://ibanforge.com' }, { type: 'nope', value: 'x' }));
    expect(res.status).toBe(400);
    expect(upstreamCalls).toHaveLength(0);
  });
});
