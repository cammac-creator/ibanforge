import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

/**
 * FRT-11 (audit 2026-09-01): the surface that decides who gets into the
 * dashboard had no test at all, while 37 test files covered CRM formatting.
 * This file closes that gap on the part that matters — a token nobody signed,
 * a token past its life, a token from another generation, and the flags of the
 * cookie that carries it.
 *
 * The mocked `next/headers` is what lets isAuthenticated() run outside a Next
 * request scope: the real cookies() throws there, which would hide a genuine
 * failure behind an environment error.
 */
const state = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'ibanforge_session' && state.token !== undefined ? { value: state.token } : undefined,
  }),
}));

import { isAuthenticated, getSessionCookieConfig, passwordsMatch } from './auth';

const TEST_SECRET = 'test-only-secret-of-at-least-32-characters';

/** Signs an arbitrary payload the way lib/auth does, so tokens can be crafted. */
function craft(payload: unknown, secret = TEST_SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest().toString('base64url');
  return `${body}.${mac}`;
}

async function accepts(token: string | undefined): Promise<boolean> {
  state.token = token;
  return isAuthenticated();
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', TEST_SECRET);
  state.token = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('isAuthenticated', () => {
  it('accepts the cookie it just issued', async () => {
    expect(await accepts(getSessionCookieConfig().value)).toBe(true);
  });

  it('refuses when no cookie is present', async () => {
    expect(await accepts(undefined)).toBe(false);
  });

  it('refuses a forged token signed with another secret', async () => {
    expect(await accepts(craft({ iat: nowSeconds(), v: 1 }, 'another-secret-of-at-least-32-characters'))).toBe(false);
  });

  it('refuses a token whose payload was edited under a valid-looking MAC', async () => {
    const valid = getSessionCookieConfig().value;
    const [, mac] = valid.split('.');
    const tampered = Buffer.from(JSON.stringify({ iat: nowSeconds(), v: 1, admin: true })).toString('base64url');
    expect(await accepts(`${tampered}.${mac}`)).toBe(false);
  });

  it('refuses a truncated MAC', async () => {
    const [body, mac] = getSessionCookieConfig().value.split('.');
    expect(await accepts(`${body}.${mac.slice(0, -4)}`)).toBe(false);
  });

  it('refuses a token with no MAC at all', async () => {
    const [body] = getSessionCookieConfig().value.split('.');
    expect(await accepts(body)).toBe(false);
    expect(await accepts(`${body}.`)).toBe(false);
    expect(await accepts(`${body}.a.b`)).toBe(false);
  });

  it('refuses an expired token', async () => {
    const eightDaysAgo = nowSeconds() - 60 * 60 * 24 * 8;
    expect(await accepts(craft({ iat: eightDaysAgo, v: 1 }))).toBe(false);
  });

  it('accepts a token just inside the seven-day window', async () => {
    const almostSevenDays = nowSeconds() - (60 * 60 * 24 * 7 - 60);
    expect(await accepts(craft({ iat: almostSevenDays, v: 1 }))).toBe(true);
  });

  it('refuses a token dated in the future', async () => {
    // A clock-skew forgery: without this check, a far-future iat never expires.
    expect(await accepts(craft({ iat: nowSeconds() + 3600, v: 1 }))).toBe(false);
  });

  it('refuses a payload with no iat', async () => {
    expect(await accepts(craft({ v: 1 }))).toBe(false);
    expect(await accepts(craft({ iat: 'yesterday', v: 1 }))).toBe(false);
  });

  it('refuses a token from another session generation', async () => {
    expect(await accepts(craft({ iat: nowSeconds(), v: 2 }))).toBe(false);
  });

  it('refuses the pre-FRT-03 payload that carried no version', async () => {
    expect(await accepts(craft({ iat: nowSeconds() }))).toBe(false);
  });

  it('lets SESSION_VERSION revoke every live session at once', async () => {
    const issued = getSessionCookieConfig().value;
    expect(await accepts(issued)).toBe(true);
    vi.stubEnv('SESSION_VERSION', '2');
    expect(await accepts(issued)).toBe(false);
    // and a token minted under the new generation works again
    expect(await accepts(getSessionCookieConfig().value)).toBe(true);
  });

  it('falls back to generation 1 on a nonsense SESSION_VERSION', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SESSION_VERSION', 'not-a-number');
    expect(await accepts(craft({ iat: nowSeconds(), v: 1 }))).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('refuses garbage that is not a token', async () => {
    expect(await accepts('')).toBe(false);
    expect(await accepts('....')).toBe(false);
    expect(await accepts('%%%.%%%')).toBe(false);
  });
});

describe('getSessionCookieConfig', () => {
  it('carries the flags that keep the cookie out of scripts and off other sites', () => {
    const config = getSessionCookieConfig();
    expect(config.name).toBe('ibanforge_session');
    expect(config.httpOnly).toBe(true);
    expect(config.sameSite).toBe('lax');
    expect(config.path).toBe('/');
    expect(config.maxAge).toBe(60 * 60 * 24 * 7);
  });

  it('is Secure in production and only there', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(getSessionCookieConfig().secure).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    expect(getSessionCookieConfig().secure).toBe(false);
  });
});

describe('passwordsMatch', () => {
  it('accepts an exact match and nothing else', () => {
    expect(passwordsMatch('correct horse', 'correct horse')).toBe(true);
    expect(passwordsMatch('correct horse', 'correct horsE')).toBe(false);
    expect(passwordsMatch('short', 'much longer value')).toBe(false);
    expect(passwordsMatch('', '')).toBe(true);
  });

  it('refuses non-strings rather than coercing them', () => {
    expect(passwordsMatch(undefined as unknown as string, 'x')).toBe(false);
    expect(passwordsMatch('x', null as unknown as string)).toBe(false);
  });
});
