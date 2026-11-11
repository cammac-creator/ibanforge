import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * The owner's notifier, simulated: the route must call it, never wait on it,
 * and never hand it the password, the cookie or the full address. Hoisted so
 * that the same mock survives `vi.resetModules()` in the ceiling suite below.
 * `networkHint` stays the real one.
 */
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn<(alert: unknown) => Promise<boolean>>(async () => true),
}));
vi.mock('@/lib/dashboard-login-alert', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dashboard-login-alert')>()),
  notifyDashboardOwner: notifyMock,
}));

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
  notifyMock.mockReset();
  notifyMock.mockResolvedValue(true);
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

/**
 * Adversarial review of 07/09/2026, M1: the limiter keyed on the FIRST
 * x-forwarded-for segment, the one the client writes, so a caller could
 * re-roll the window with a header. It now keys on what the platform sets.
 */
describe('POST /api/auth/login — limiter key', () => {
  function attemptWith(headers: Record<string, string>) {
    return POST(
      new NextRequest('http://site.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ password: 'wrong' }),
      }),
    );
  }

  it('ignores the client-written first segment and counts the platform-appended hop', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await attemptWith({ 'x-forwarded-for': `10.0.0.${i}, 203.0.113.77` });
      expect(res.status).toBe(401);
    }
    const sixth = await attemptWith({ 'x-forwarded-for': '10.0.0.99, 203.0.113.77' });
    expect(sixth.status).toBe(429);
  });

  it('ignores x-vercel-forwarded-for, which the client writes since the old host left (C24)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await attemptWith({
        'x-vercel-forwarded-for': `198.51.100.${i}`,
        'x-forwarded-for': `10.0.2.${i}, 203.0.113.79`,
      });
      expect(res.status).toBe(401);
    }
    const sixth = await attemptWith({
      'x-vercel-forwarded-for': '198.51.100.99',
      'x-forwarded-for': '10.0.2.99, 203.0.113.79',
    });
    expect(sixth.status).toBe(429);
  });

  it('prefers x-real-ip when the platform sets it', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await attemptWith({ 'x-real-ip': '203.0.113.78', 'x-forwarded-for': `10.0.1.${i}` });
      expect(res.status).toBe(401);
    }
    const sixth = await attemptWith({ 'x-real-ip': '203.0.113.78', 'x-forwarded-for': '10.0.1.99' });
    expect(sixth.status).toBe(429);
  });
});

/**
 * WEB-01 (audit 2026-11-10): an alert on every successful login, and a ceiling
 * on wrong passwords counted over every address together.
 *
 * Each test loads a FRESH copy of the route (`vi.resetModules()`): the ceiling
 * is module state, and a ceiling left reached under a simulated clock would
 * close the door on every test after it. Only Date is faked, as above: the
 * route's real 200 ms delay must still resolve, which is also why the failures
 * are sent together rather than one after the other.
 */
describe('POST /api/auth/login — alert and global ceiling (WEB-01)', () => {
  type Route = typeof import('./route');
  let route: Route;

  /** 10/11/2026 at 14:00 UTC. */
  const T0 = Date.UTC(2026, 10, 10, 14, 0, 0);

  beforeEach(async () => {
    vi.resetModules();
    route = await import('./route');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  function send(ip: string, password: string) {
    return route.POST(
      new NextRequest('http://site.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
        body: JSON.stringify({ password }),
      }),
    );
  }

  /**
   * `count` wrong passwords spread over as many documentation addresses as the
   * per-address limiter needs (five each), so that none of them is throttled
   * by it: what is measured is the total.
   */
  async function spray(count: number, net = '198.51.100') {
    const statuses = await Promise.all(
      Array.from({ length: count }, (_, i) => send(`${net}.${Math.floor(i / 5) + 1}`, 'wrong')),
    ).then((all) => all.map((r) => r.status));
    return statuses;
  }

  const sprayAddresses = (count: number) => Math.ceil(count / 5);

  /** Everything the simulated notifier received, as one string to search. */
  const sentToNotifier = () => JSON.stringify(notifyMock.mock.calls);

  it('lets an owner who mistypes three times in', async () => {
    const ip = '203.0.113.40';
    for (let i = 0; i < 3; i++) expect((await send(ip, 'wrong')).status).toBe(401);
    expect((await send(ip, PASSWORD)).status).toBe(200);
  });

  it('answers 429 to a new address after the ceiling of failures from different addresses, right password included', async () => {
    const statuses = await spray(route.GLOBAL_MAX_FAILURES);
    // Every one of them was a refused password, none was throttled by its own address.
    expect(statuses.every((s) => s === 401)).toBe(true);

    const fresh = await timed(() => send('203.0.113.41', 'wrong'));
    expect(fresh.res.status).toBe(429);
    // Same delay as every other answer (FRT-05): no timing tells the ceiling apart.
    expect(fresh.ms).toBeGreaterThanOrEqual(DELAY_FLOOR_MS);
    // The ceiling is not an oracle: the right password is refused too while it holds.
    const owner = await send('203.0.113.42', PASSWORD);
    expect(owner.status).toBe(429);
    expect(owner.cookies.get('ibanforge_session')).toBeUndefined();
  });

  it('holds against a parallel burst: no more password comparisons than the ceiling', async () => {
    // Every request of the burst is let in before any of them is counted; the
    // check made right before the comparison is what stops the surplus.
    const burst = route.GLOBAL_MAX_FAILURES + 25;
    const statuses = await spray(burst);
    const compared = statuses.filter((s) => s === 401).length;
    // Exactly the ceiling: never more (the surplus is not compared), never fewer.
    expect(compared).toBe(route.GLOBAL_MAX_FAILURES);
    expect(statuses.filter((s) => s === 429)).toHaveLength(burst - compared);

    const ceilingAlerts = notifyMock.mock.calls.filter(
      ([a]) => (a as { event: string }).event === 'global_cap',
    );
    expect(ceilingAlerts).toHaveLength(1);
    expect(ceilingAlerts[0][0]).toMatchObject({ failures: route.GLOBAL_MAX_FAILURES });

    // And the right password stays refused for as long as the window runs.
    vi.setSystemTime(T0 + route.GLOBAL_WINDOW_MS - 1000);
    expect((await send('203.0.113.60', PASSWORD)).status).toBe(429);
  });

  it('does not keep an address out past the reopening for retrying while the ceiling holds', async () => {
    await spray(route.GLOBAL_MAX_FAILURES);
    // Ten minutes before the reopening, the owner tries again and again: more
    // than the five attempts the per-address limiter allows in its quarter-hour.
    const owner = '203.0.113.61';
    vi.setSystemTime(T0 + route.GLOBAL_WINDOW_MS - 10 * 60 * 1000);
    const retries = await Promise.all(Array.from({ length: 8 }, () => send(owner, PASSWORD)));
    expect(retries.every((r) => r.status === 429)).toBe(true);

    // At the reopening, that same address gets in at once.
    vi.setSystemTime(T0 + route.GLOBAL_WINDOW_MS);
    expect((await send(owner, PASSWORD)).status).toBe(200);
  });

  it('does not count what is not a wrong password', async () => {
    // A malformed body is not a password check. (Refused requests are not
    // counted either: the next test shows they cannot keep the door closed.)
    await Promise.all(
      Array.from({ length: route.GLOBAL_MAX_FAILURES }, (_, i) =>
        route.POST(
          new NextRequest('http://site.test/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-real-ip': `198.51.100.${Math.floor(i / 5) + 1}`,
            },
            body: 'not json',
          }),
        ),
      ),
    );
    expect((await send('203.0.113.43', PASSWORD)).status).toBe(200);
  });

  it('alerts once per episode, with counts and the reopening time, never an address', async () => {
    await spray(route.GLOBAL_MAX_FAILURES);
    // More attempts while the ceiling holds: no second alert.
    await Promise.all([send('203.0.113.44', 'wrong'), send('203.0.113.45', PASSWORD)]);

    const ceilingAlerts = notifyMock.mock.calls.filter(
      ([a]) => (a as { event: string }).event === 'global_cap',
    );
    expect(ceilingAlerts).toHaveLength(1);
    expect(ceilingAlerts[0][0]).toEqual({
      event: 'global_cap',
      at: new Date(T0).toISOString(),
      until: new Date(T0 + route.GLOBAL_WINDOW_MS).toISOString(),
      failures: route.GLOBAL_MAX_FAILURES,
      addresses: sprayAddresses(route.GLOBAL_MAX_FAILURES),
    });
    expect(sentToNotifier()).not.toContain('198.51.100.');
    expect(sentToNotifier()).not.toContain('wrong');
    expect(sentToNotifier()).not.toContain(PASSWORD);
  });

  it('lifts the ceiling by itself one hour after the window opened, and re-arms its alert', async () => {
    await spray(route.GLOBAL_MAX_FAILURES);
    expect((await send('203.0.113.46', PASSWORD)).status).toBe(429);

    // One second short of the hour: still closed.
    vi.setSystemTime(T0 + route.GLOBAL_WINDOW_MS - 1000);
    expect((await send('203.0.113.47', PASSWORD)).status).toBe(429);

    // The hour has passed: open again, for a wrong password as for the right one.
    vi.setSystemTime(T0 + route.GLOBAL_WINDOW_MS);
    expect((await send('203.0.113.48', 'wrong')).status).toBe(401);
    expect((await send('203.0.113.49', PASSWORD)).status).toBe(200);

    // A new episode alerts again, once (from other addresses, for clarity).
    vi.setSystemTime(T0 + route.GLOBAL_WINDOW_MS + 20 * 60 * 1000);
    await spray(route.GLOBAL_MAX_FAILURES, '192.0.2');
    expect((await send('203.0.113.50', PASSWORD)).status).toBe(429);
    const episodes = notifyMock.mock.calls.filter(
      ([a]) => (a as { event: string }).event === 'global_cap',
    );
    expect(episodes).toHaveLength(2);
  });

  it('calls the notifier on a successful login with the masked network and the time, never the password', async () => {
    const res = await send('203.0.113.51', PASSWORD);
    expect(res.status).toBe(200);
    const cookie = res.cookies.get('ibanforge_session')?.value;
    expect(cookie).toBeTruthy();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      event: 'login_ok',
      at: new Date(T0).toISOString(),
      network: '203.0.x.x',
    });
    expect(sentToNotifier()).not.toContain(PASSWORD);
    expect(sentToNotifier()).not.toContain('203.0.113.51');
    expect(sentToNotifier()).not.toContain(cookie as string);
  });

  it('masks an IPv6 address to its prefix', async () => {
    expect((await send('2001:db8:85a3::8a2e:370:7334', PASSWORD)).status).toBe(200);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_ok', network: '2001:db8::/32' }),
    );
    expect(sentToNotifier()).not.toContain('7334');
  });

  it('sends no alert for a wrong password below the ceiling', async () => {
    expect((await send('203.0.113.52', 'wrong')).status).toBe(401);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('neither fails nor waits when the notifier hangs or fails', async () => {
    notifyMock.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const hanging = await timed(() => send('203.0.113.53', PASSWORD));
    expect(hanging.res.status).toBe(200);
    // The notifier above never resolves: that the login answered at all shows
    // it is not waited on. The bound is loose on purpose (a shared machine),
    // and still far below the notifier's own timeout.
    expect(hanging.ms).toBeLessThan(1000);

    notifyMock.mockImplementationOnce(() => Promise.reject(new Error('notifier down')));
    expect((await send('203.0.113.54', PASSWORD)).status).toBe(200);
  });
});
