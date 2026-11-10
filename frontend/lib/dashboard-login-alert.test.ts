import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import {
  LOGIN_ALERT_TIMEOUT_MS,
  UNKNOWN_NETWORK,
  networkHint,
  notifyDashboardOwner,
  type DashboardLoginAlert,
} from './dashboard-login-alert';

/**
 * WEB-01 (audit 2026-11-10). The two halves of the dashboard's login alert on
 * the site's side: the mask, which must never let a full address through, and
 * the one call to the API, which must never throw, never log what it sends,
 * and do nothing when it is not configured. Documentation addresses only
 * (RFC 5737, RFC 3849).
 */

describe('networkHint', () => {
  it.each([
    ['203.0.113.7', '203.0.x.x'],
    [' 198.51.100.250 ', '198.51.x.x'],
    ['0.0.0.0', '0.0.x.x'],
    ['2001:db8::1', '2001:db8::/32'],
    ['2001:0DB8:85a3:0000:0000:8a2e:0370:7334', '2001:db8::/32'],
    ['[2001:db8:1:2::5]', '2001:db8::/32'],
    ['fe80::1%eth0', 'fe80:0::/32'],
    ['::1', '0:0::/32'],
    // IPv4 carried in IPv6 is read as the IPv4 it carries: its tail is the address.
    ['::ffff:192.0.2.33', '192.0.x.x'],
    ['::FFFF:c000:221', '192.0.x.x'],
  ])('masks %j as %j', (address, hint) => {
    expect(networkHint(address)).toBe(hint);
  });

  it.each([
    'unknown',
    '',
    '203.0.113.7:51234',
    '256.0.113.7',
    '203.0.113',
    '2001:db8::1::2',
    '2001:db8:1:2:3:4:5:6:7',
    '::ffff:192.0.2.333',
    'gggg::1',
    '203.0.113.7, 198.51.100.8',
  ])('answers "inconnu" for %j, never the value itself', (address) => {
    expect(networkHint(address)).toBe(UNKNOWN_NETWORK);
  });

  it('never returns more than the first two octets or the first two groups', () => {
    for (const address of ['203.0.113.7', '2001:db8:aaaa:bbbb::1', '::ffff:198.51.100.9']) {
      const hint = networkHint(address);
      expect(hint).not.toContain('113');
      expect(hint).not.toContain('aaaa');
      expect(hint).not.toContain('.9');
    }
  });
});

describe('notifyDashboardOwner', () => {
  const LOGIN: DashboardLoginAlert = {
    event: 'login_ok',
    at: '2026-11-10T14:00:00.000Z',
    network: '203.0.x.x',
  };
  type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
  const answer: Fetch = async () => new Response('{"sent":true}', { status: 200 });
  let fetchMock: Mock<Fetch>;
  let errors: MockInstance<typeof console.error>;
  let warnings: MockInstance<typeof console.warn>;

  beforeEach(() => {
    vi.stubEnv('API_URL', 'http://backend.invalid');
    vi.stubEnv('ADMIN_SECRET', 'test-admin-secret');
    fetchMock = vi.fn(answer);
    vi.stubGlobal('fetch', fetchMock);
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Everything written to the logs, as one string to search. */
  const logged = () => JSON.stringify([...errors.mock.calls, ...warnings.mock.calls]);

  it('posts the alert to the API route with the admin secret and a timeout', async () => {
    expect(await notifyDashboardOwner(LOGIN)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init = {}] = fetchMock.mock.calls[0];
    expect(url).toBe('http://backend.invalid/v1/admin/dashboard-login-alert');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Admin-Secret']).toBe('test-admin-secret');
    expect(JSON.parse(String(init.body))).toEqual(LOGIN);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(LOGIN_ALERT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it.each(['API_URL', 'ADMIN_SECRET'])('does nothing without %s, and says so', async (name) => {
    vi.stubEnv(name, '');
    if (name === 'API_URL') vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    expect(await notifyDashboardOwner(LOGIN)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalledTimes(1);
  });

  it('swallows a network failure, and logs neither the network nor the time', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(notifyDashboardOwner(LOGIN)).resolves.toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('login_ok');
    expect(logged()).not.toContain('203.0');
    expect(logged()).not.toContain('2026-11-10');
    expect(logged()).not.toContain('test-admin-secret');
  });

  it('swallows a refusal from the API', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"network_not_masked"}', { status: 400 }));
    await expect(notifyDashboardOwner(LOGIN)).resolves.toBe(false);
    expect(logged()).toContain('400');
    expect(logged()).not.toContain('203.0');
  });
});
