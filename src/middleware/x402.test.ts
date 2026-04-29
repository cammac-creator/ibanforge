import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureWalletConfigured } from './x402.js';

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
