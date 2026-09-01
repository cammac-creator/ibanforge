import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * FRT-05 (audit 2026-09-01). Two things are checked here that reading the file
 * cannot settle: that a throttled caller waits as long as a rejected one (the
 * 429 used to return immediately, which told an attacker by response time alone
 * which of the two had happened), and that the counter forgets an address once
 * its window has passed.
 *
 * Each test uses its own IP: the counter is a module-level map, shared by every
 * test in this file.
 */

const PASSWORD = 'test-dashboard-password';

/** The route waits 200 ms on every answer; the floor leaves room for timer slack. */
const DELAY_FLOOR_MS = 150;

function attempt(ip: string, password: string) {
  return POST(
    new NextRequest('http://site.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ password }),
    }),
  );
}

async function timed(fn: () => Promise<Response>): Promise<{ res: Response; ms: number }> {
  const start = performance.now();
  const res = await fn();
  return { res, ms: performance.now() - start };
}

beforeEach(() => {
  vi.stubEnv('DASHBOARD_PASSWORD', PASSWORD);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('POST /api/auth/login', () => {
  it('accepts the right password and issues the session cookie', async () => {
    const res = await attempt('203.0.113.10', PASSWORD);
    expect(res.status).toBe(200);
    const cookie = res.cookies.get('ibanforge_session');
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
  });

  it('refuses a wrong password after the constant-time delay', async () => {
    const { res, ms } = await timed(() => attempt('203.0.113.11', 'wrong'));
    expect(res.status).toBe(401);
    expect(ms).toBeGreaterThanOrEqual(DELAY_FLOOR_MS);
  });

  it('answers 429 past five attempts, and pays the same delay as a refusal', async () => {
    const ip = '203.0.113.12';
    for (let i = 0; i < 5; i++) {
      expect((await attempt(ip, 'wrong')).status).toBe(401);
    }
    const { res, ms } = await timed(() => attempt(ip, 'wrong'));
    expect(res.status).toBe(429);
    // The regression this guards: a 429 returned in ~0 ms while every other
    // answer took ~200 ms leaked "you are throttled" through timing alone.
    expect(ms).toBeGreaterThanOrEqual(DELAY_FLOOR_MS);
  });

  it('throttles even the right password, so a hit inside the window is not a way in', async () => {
    const ip = '203.0.113.13';
    for (let i = 0; i < 5; i++) await attempt(ip, 'wrong');
    expect((await attempt(ip, PASSWORD)).status).toBe(429);
  });

  it('forgets an address once its window has passed', async () => {
    // Only Date is faked: the route's real setTimeout must still resolve, and
    // the sweep that keeps the map bounded is driven by Date.now().
    vi.useFakeTimers({ toFake: ['Date'] });
    const ip = '203.0.113.14';
    for (let i = 0; i < 5; i++) await attempt(ip, 'wrong');
    expect((await attempt(ip, 'wrong')).status).toBe(429);

    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    expect((await attempt(ip, 'wrong')).status).toBe(401);
  });

  it('answers 400 on a malformed body, still after the delay', async () => {
    const { res, ms } = await timed(() =>
      POST(
        new NextRequest('http://site.test/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.15' },
          body: 'not json',
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(ms).toBeGreaterThanOrEqual(DELAY_FLOOR_MS);
  });

  it('answers 500 when DASHBOARD_PASSWORD is unset, without saying so quickly', async () => {
    vi.stubEnv('DASHBOARD_PASSWORD', '');
    const { res, ms } = await timed(() => attempt('203.0.113.16', 'anything'));
    expect(res.status).toBe(500);
    expect(ms).toBeGreaterThanOrEqual(DELAY_FLOOR_MS);
  });
});
