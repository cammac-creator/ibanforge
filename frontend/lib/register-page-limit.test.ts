import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routing } from '@/i18n/routing';
import {
  REGISTER_PAGE_LIMIT,
  __resetRegisterPageLimitForTests,
  checkRegisterPageLimit,
  clientAddress,
  isCountedPath,
} from './register-page-limit';

const T0 = 1_791_000_000_000;

function hit(pathname: string, ip: string | null, now: number, extra: Partial<{ ua: string }> = {}) {
  return checkRegisterPageLimit({ pathname, ip, userAgent: extra.ua ?? 'Mozilla/5.0', now });
}

describe('the register page cap of the self-hosted site', () => {
  beforeEach(() => __resetRegisterPageLimitForTests());
  afterEach(() => vi.unstubAllEnvs());

  it('uses the numbers of the rule: 60 pages per 10 minutes', () => {
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

  it('never counts the search engines the rule exempts', () => {
    for (let i = 0; i < 100; i++) {
      expect(hit('/at/20111', '66.249.66.1', T0, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }).limited).toBe(false);
    }
  });

  it('holds even when a VERCEL variable is set: the old host is gone, its switch with it (C24)', () => {
    vi.stubEnv('VERCEL', '1');
    for (let i = 0; i < 60; i++) hit('/at/20111', '203.0.113.7', T0);
    expect(hit('/at/20111', '203.0.113.7', T0).limited).toBe(true);
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

/**
 * What the cap promises, read from the module the middleware runs (audit of
 * 29/09/2026): which paths it counts, and what its numbers mean for a visitor,
 * for a copier and for the API behind the site.
 */
const FRONTEND = resolve(__dirname, '..');
const { windowSeconds, limit } = REGISTER_PAGE_LIMIT;

/** The countries whose code pages read a register from the API at request time. */
function liveRegisterPages(): Array<{ dir: string; country: string }> {
  const localeDir = resolve(FRONTEND, 'app/[locale]');
  const pages: Array<{ dir: string; country: string }> = [];
  for (const dir of readdirSync(localeDir)) {
    const page = resolve(localeDir, dir, '[code]/page.tsx');
    if (!existsSync(page)) continue;
    const match = readFileSync(page, 'utf8').match(/fetchLiveRegisterEntry\(\s*"([A-Z]{2})"/);
    if (match) pages.push({ dir, country: match[1]! });
  }
  return pages;
}

describe('what the register page cap promises', () => {
  it('counts every code page that reads a register live, in every language, with or without its prefix', () => {
    const pages = liveRegisterPages();
    expect(pages.map((p) => p.country).sort()).toEqual(['AT', 'BE', 'SM']);
    const samples: Record<string, string> = { AT: '19981', BE: '990', SM: '09991' };
    for (const { dir, country } of pages) {
      const code = samples[country]!;
      expect(isCountedPath(`/${dir}/${code}`)).toBe(true);
      expect(isCountedPath(`/${dir}/${code}/`)).toBe(true);
      for (const locale of routing.locales) expect(isCountedPath(`/${locale}/${dir}/${code}`)).toBe(true);
    }
    // A malformed code is still a page request (it answers 404 without calling
    // the API, but a sweep would try them too).
    expect(isCountedPath('/be/abc')).toBe(true);
  });

  it('counts nothing else: not the index pages, not the other registers, not the playground', () => {
    const untouched = [
      '/',
      '/at',
      '/be/',
      '/fr/sm',
      '/de/at',
      '/playground',
      '/api/playground',
      '/blz/10070000',
      '/de/blz/10070000',
      '/it/03069',
      '/sk/0900',
      '/iid/00762',
      '/fr/blog/at-registre',
      '/at/19981/extra',
      '/xx/at/19981',
    ];
    for (const path of untouched) expect(isCountedPath(path), path).toBe(false);
  });

  it('leaves an honest reader room, prefetch included', () => {
    // Opening a code page from a link can cost two requests (the prefetch and
    // the page). Twenty pages read in one window is far above what a person
    // looking up a bank does.
    expect(limit / 2).toBeGreaterThanOrEqual(20);
  });

  it('makes a copy of the Belgian register from one address take hours, not minutes', () => {
    // Belgian codes have three digits: the whole space is a thousand pages.
    const secondsForAllBelgianCodes = Math.ceil(1000 / limit) * windowSeconds;
    expect(secondsForAllBelgianCodes).toBeGreaterThanOrEqual(2 * 3600);
  });

  it("keeps one address well under the API's own per-address limit", () => {
    // The site reads the API from its own server: a sweep of never-read codes
    // turns page views into API calls, one for one at worst. The API allows 100
    // calls a minute per address (RATE_LIMIT in src/middleware/rate-limit.ts).
    // Even if one window's whole allowance fell into a single minute, one
    // visitor could not reach it alone.
    expect(limit).toBeLessThan(100);
  });
});
