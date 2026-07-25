import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureWalletConfigured, isSellingRoute } from './x402.js';

/**
 * Security audit 2026-07-25, finding 1: the x402 middleware skipped the paywall
 * for any API-key-authenticated request, including the routes that SELL credit
 * packs. One unit of free quota bought a $80 bundle, so a single free key
 * (200 req/month) minted up to $16,000 of credits — and each minted key could
 * start over. Selling routes must never be covered by an allowance.
 */
describe('isSellingRoute', () => {
  it('matches the credit-pack purchase routes', () => {
    for (const bundle of ['1k', '5k', '25k']) {
      expect(isSellingRoute('POST', `/v1/credits/buy/${bundle}`)).toBe(true);
    }
  });

  it('ignores the trailing slash variant', () => {
    expect(isSellingRoute('POST', '/v1/credits/buy/1k/')).toBe(true);
  });

  it('does not match the consumption endpoints an allowance legitimately covers', () => {
    const consumption = [
      ['POST', '/v1/iban/validate'],
      ['POST', '/v1/iban/batch'],
      ['POST', '/v1/iban/compliance'],
      ['GET', '/v1/bic/UBSWCHZH80A'],
      ['GET', '/v1/ch/clearing/230'],
      ['GET', '/v1/credits/bundles'],
    ] as const;
    for (const [method, path] of consumption) {
      expect(isSellingRoute(method, path)).toBe(false);
    }
  });

  it('does not match a GET on the purchase path (only POST buys)', () => {
    expect(isSellingRoute('GET', '/v1/credits/buy/1k')).toBe(false);
  });
});

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.NODE_ENV;
  delete process.env.X402_ENABLED;
  delete process.env.WALLET_ADDRESS;
  delete process.env.IBANFORGE_FREE_MODE;
}

describe('ensureWalletConfigured', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not throw in development regardless of x402 config', () => {
    process.env.NODE_ENV = 'development';
    expect(() => ensureWalletConfigured()).not.toThrow();

    process.env.X402_ENABLED = 'true';
    expect(() => ensureWalletConfigured()).not.toThrow();
  });

  it('does not throw in test environment', () => {
    process.env.NODE_ENV = 'test';
    expect(() => ensureWalletConfigured()).not.toThrow();
  });

  it('FAIL-CLOSES in production when X402_ENABLED is missing', () => {
    process.env.NODE_ENV = 'production';
    expect(() => ensureWalletConfigured()).toThrow(/X402_ENABLED/);
  });

  it('FAIL-CLOSES in production when X402_ENABLED is not "true"', () => {
    process.env.NODE_ENV = 'production';
    process.env.X402_ENABLED = 'false';
    expect(() => ensureWalletConfigured()).toThrow(/X402_ENABLED/);
  });

  it('FAIL-CLOSES in production when WALLET_ADDRESS is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.X402_ENABLED = 'true';
    expect(() => ensureWalletConfigured()).toThrow(/WALLET_ADDRESS/);
  });

  it('passes in production when X402_ENABLED=true and WALLET_ADDRESS is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.X402_ENABLED = 'true';
    process.env.WALLET_ADDRESS = '0xD13bD0A4120BA301125290e5cc0c7EFD4CB40a55';
    expect(() => ensureWalletConfigured()).not.toThrow();
  });

  it('allows explicit IBANFORGE_FREE_MODE=true in production with a loud warning', () => {
    process.env.NODE_ENV = 'production';
    process.env.IBANFORGE_FREE_MODE = 'true';
    // No X402_ENABLED, no WALLET_ADDRESS — but free mode is explicit so it boots
    expect(() => ensureWalletConfigured()).not.toThrow();
  });

  it('IBANFORGE_FREE_MODE wins over missing X402_ENABLED', () => {
    process.env.NODE_ENV = 'production';
    process.env.IBANFORGE_FREE_MODE = 'true';
    process.env.X402_ENABLED = 'false';
    expect(() => ensureWalletConfigured()).not.toThrow();
  });
});
