import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATCHED = [4, 6, 6];

function atLeastPatched(version: string): boolean {
  const parts = version.split('.').map(Number);
  for (let i = 0; i < PATCHED.length; i++) {
    if (parts[i] !== PATCHED[i]) return parts[i] > PATCHED[i];
  }
  return true;
}

// GHSA-mrhx-c7xc-m3w5 (high): zod before 4.6.6 piles up one issue per failing
// array element, with no cap, until the process runs out of memory. Every 3.x is
// in range and no 3.x fix exists, while the payment SDK (@x402/core, /evm,
// /extensions, @coinbase/x402, @coinbase/cdp-sdk) still declares zod ^3. The
// root override hands them our 4.x copy; side by side on 25/10/2026, the SDK
// accepted and refused the same payloads and facilitator answers under both.
describe('zod, held at or above the patched 4.6.6', () => {
  const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    overrides?: Record<string, unknown>;
  };

  it('is overridden at the root, so a nested ^3 range cannot bring 3.x back', () => {
    expect(pkg.overrides?.zod).toBe('$zod');
  });

  it('has no copy below 4.6.6 anywhere in the lockfile', () => {
    const copies = Object.entries(lock.packages).filter(
      ([path]) => path === 'node_modules/zod' || path.endsWith('/node_modules/zod'),
    );
    expect(copies.map(([path]) => path)).toEqual(['node_modules/zod']);
    for (const [path, { version }] of copies) {
      expect(atLeastPatched(version ?? ''), `${path} ${version}`).toBe(true);
    }
  });

  it('is the copy the payment SDK loads, and it still reads an x402 v2 payment', () => {
    const rootRequire = createRequire(resolve(ROOT, 'package.json'));
    const coreRequire = createRequire(resolve(ROOT, 'node_modules/@x402/core/package.json'));
    expect(coreRequire.resolve('zod')).toBe(rootRequire.resolve('zod'));

    const schemas = rootRequire('@x402/core/schemas') as {
      parsePaymentPayload: (v: unknown) => { success: boolean };
    };
    const accepted = {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '4000000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: '0x2222222222222222222222222222222222222222',
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' },
    };
    const payment = { x402Version: 2, accepted, payload: { signature: '0x00' } };
    expect(schemas.parsePaymentPayload(payment).success).toBe(true);
    expect(
      schemas.parsePaymentPayload({ ...payment, accepted: { ...accepted, network: 'base' } })
        .success,
    ).toBe(false);
  });
});
