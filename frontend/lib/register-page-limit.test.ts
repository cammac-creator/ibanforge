import { beforeEach, describe, expect, it } from 'vitest';
import {
  REGISTER_PAGE_LIMIT,
  __resetRegisterPageLimitForTests,
  checkRegisterPageLimit,
  clientAddress,
  isCountedPath,
} from './register-page-limit';

const SELF_HOSTED: Record<string, string | undefined> = {};
const T0 = 1_791_000_000_000;

function hit(pathname: string, ip: string | null, now: number, extra: Partial<{ ua: string; env: Record<string, string | undefined> }> = {}) {
  return checkRegisterPageLimit({ pathname, ip, userAgent: extra.ua ?? 'Mozilla/5.0', now, env: extra.env ?? SELF_HOSTED });
}

describe('the register page cap of the self-hosted site', () => {
  beforeEach(() => __resetRegisterPageLimitForTests());

  it('uses the numbers of the Vercel firewall rule: 60 pages per 10 minutes', () => {
    expect(REGISTER_PAGE_LIMIT).toEqual({ windowSeconds: 600, limit: 60 });
  });

  it('counts the code pages of the three live registers, in every language, and nothing else', () => {
    for (const p of ['/at/20111', '/fr/be/001', '/de/sm/03225', '/en/at/12000/', '/be/abc']) {
      expect(isCountedPath(p)).toBe(true);
    }
    for (const p of ['/at', '/fr/be', '/de/blz/10010010', '/fr/iid/09000', '/pricing', '/fr/at/20111/x']) {
      expect(isCountedPath(p)).toBe(false);
    }
  });

  it('lets 60 pages through, refuses the 61st with a Retry-After, and reopens when the window closes', () => {
    for (let i = 0; i < 60; i++) expect(hit('/at/20111', '203.0.113.7', T0 + i).limited).toBe(false);
    const refused = hit('/fr/be/001', '203.0.113.7', T0 + 1_000);
    expect(refused.limited).toBe(true);
    expect(refused.retryAfter).toBe(599);
    expect(hit('/at/20111', '203.0.113.7', T0 + 600_000).limited).toBe(false);
  });

  it('counts each address on its own', () => {
    for (let i = 0; i < 60; i++) hit('/at/20111', '203.0.113.7', T0);
    expect(hit('/at/20111', '203.0.113.7', T0).limited).toBe(true);
    expect(hit('/at/20111', '203.0.113.8', T0).limited).toBe(false);
  });

  it('never counts the search engines the live rule exempts', () => {
    for (let i = 0; i < 100; i++) {
      expect(hit('/at/20111', '66.249.66.1', T0, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }).limited).toBe(false);
    }
  });

  it('does nothing on Vercel, where the firewall rule holds the cap', () => {
    for (let i = 0; i < 100; i++) {
      expect(hit('/at/20111', '203.0.113.7', T0, { env: { VERCEL: '1' } }).limited).toBe(false);
    }
  });

  it('puts every request without an address in one shared bucket rather than letting it through', () => {
    for (let i = 0; i < 60; i++) hit('/at/20111', null, T0);
    expect(hit('/sm/03225', null, T0).limited).toBe(true);
  });

  it('reads the address the reverse proxy sets, X-Real-IP first', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.7');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientAddress(new Headers())).toBeNull();
  });
});
