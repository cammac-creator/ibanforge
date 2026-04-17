import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeRevenue, getIban, getIbansArray } from './request-helpers.js';
import type { Context } from 'hono';
import type { HonoEnv } from '../types.js';

// Minimal mock Context — enough for computeRevenue's needs.
function mockContext(opts: {
  apiKey?: boolean;
  devSkip?: boolean;
}): Context<HonoEnv> {
  const vars: Record<string, unknown> = {
    apiKeyAuthenticated: opts.apiKey ?? false,
  };
  return {
    get: (k: string) => vars[k],
    req: {
      header: (name: string) =>
        name === 'X-Dev-Skip' && opts.devSkip ? 'true' : undefined,
    },
  } as unknown as Context<HonoEnv>;
}

describe('computeRevenue', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.X402_ENABLED;
    delete process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 0 when x402 is disabled (default)', () => {
    expect(computeRevenue(mockContext({}), 0.005)).toBe(0);
  });

  it('returns 0 when caller is API-key authenticated, even with x402 enabled', () => {
    process.env.X402_ENABLED = 'true';
    expect(computeRevenue(mockContext({ apiKey: true }), 0.005)).toBe(0);
  });

  it('returns 0 when dev skip header is set in development', () => {
    process.env.X402_ENABLED = 'true';
    process.env.NODE_ENV = 'development';
    expect(computeRevenue(mockContext({ devSkip: true }), 0.005)).toBe(0);
  });

  it('returns the posted price when x402 is enabled and no API key', () => {
    process.env.X402_ENABLED = 'true';
    expect(computeRevenue(mockContext({}), 0.005)).toBe(0.005);
  });

  it('regression — phantom revenue: API-key + x402 disabled MUST be 0', () => {
    // This is the exact combination that previously generated fake revenue
    // on /v1/bic and /v1/ch/clearing routes.
    expect(computeRevenue(mockContext({ apiKey: true }), 0.003)).toBe(0);
  });
});

describe('getIban / getIbansArray case-insensitive', () => {
  it('picks lowercase iban', () => {
    expect(getIban({ iban: 'DE89' })).toBe('DE89');
  });
  it('picks uppercase IBAN', () => {
    expect(getIban({ IBAN: 'DE89' })).toBe('DE89');
  });
  it('picks mixed-case Iban', () => {
    expect(getIban({ Iban: 'DE89' })).toBe('DE89');
  });
  it('returns undefined on missing', () => {
    expect(getIban({})).toBeUndefined();
  });

  it('picks ibans array', () => {
    expect(getIbansArray({ ibans: ['A', 'B'] })).toEqual(['A', 'B']);
  });
  it('picks iban_list alias', () => {
    expect(getIbansArray({ iban_list: ['A'] })).toEqual(['A']);
  });
  it('picks list alias case-insensitively', () => {
    expect(getIbansArray({ LIST: ['A'] })).toEqual(['A']);
  });
});
