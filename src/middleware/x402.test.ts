import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MAX_RESOURCE_DESCRIPTION,
  buildRouteTable,
  capDescription,
  ensureWalletConfigured,
  isSellingRoute,
  batchQuoteFor,
  canonicalPaidPath,
  withFacilitatorTimeout,
} from './x402.js';

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

/**
 * We announce x402 v2 and tell the world, in /.well-known/x402, that a v1
 * payment still settles (`accepts_legacy_v1_payments: true`). That promise is
 * not ours to keep — it belongs to @x402/hono, which reads the v2
 * `PAYMENT-SIGNATURE` header and falls back to v1's `X-PAYMENT`.
 *
 * It is the fact that makes the migration safe: a client holding v1
 * requirements from before 17/08/2026 can still pay. So it is checked here
 * rather than assumed, because the day an SDK bump drops the fallback we
 * should learn it from a red build and not from a payer who cannot pay.
 */
describe('the promise that a v1 payment still settles', () => {
  it('is kept by the installed @x402/hono, which reads both payment headers', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@x402/hono');
    const source = readFileSync(entry, 'utf8');

    expect(source, 'v2 payment header').toContain('payment-signature');
    expect(source, 'v1 payment header — dropping this locks out older clients').toContain('x-payment');
  });
});

/**
 * The defect this guards against did not look like a bug. Every route was
 * announced, correctly priced, discoverable and documented — and one of them
 * could not be paid, because its description ran to 616 characters and
 * Coinbase's facilitator rejects a payment payload that carries one longer
 * than 512. The error names no field: `'paymentPayload' is invalid`.
 *
 * /v1/bic/:code was in that state for months. Settlement campaigns, an
 * escalation to the CDP Discord and a GitHub issue all went past it, because
 * the route table lived inside a closure no test could reach.
 */
describe('every priced route stays payable', () => {
  const TABLE = () => buildRouteTable('0x0000000000000000000000000000000000000001', 'GET', '/v1/bic/COBADEFFXXX');

  it('describes itself within the facilitator payload limit', () => {
    for (const [route, config] of Object.entries(TABLE())) {
      const { description } = config as { description?: string };
      expect(typeof description, route).toBe('string');
      expect(description!.length, `${route} description is ${description!.length} chars`)
        .toBeLessThanOrEqual(MAX_RESOURCE_DESCRIPTION);
    }
  });

  it('finds routes to check, so an empty table cannot pass silently', () => {
    expect(Object.keys(TABLE()).length).toBeGreaterThanOrEqual(5);
  });

  it('caps a description that grows past the limit rather than losing the sale', () => {
    const long = 'x'.repeat(MAX_RESOURCE_DESCRIPTION + 200);
    expect(capDescription(long).length).toBeLessThanOrEqual(MAX_RESOURCE_DESCRIPTION);
    expect(capDescription('short')).toBe('short');
  });

  it('announces the requested URL over https, never the :code template', () => {
    const bic = TABLE()['GET /v1/bic/:code'] as { resource: string };
    expect(bic.resource).toBe('https://api.ibanforge.com/v1/bic/COBADEFFXXX');
    for (const [route, config] of Object.entries(TABLE())) {
      const { resource } = config as { resource: string };
      expect(resource.startsWith('https://'), route).toBe(true);
    }
  });

  it('keeps serviceName and tags inside the schema the SDK enforces', () => {
    // zod rejects past these bounds, and a rejected schema means no 402 at all.
    for (const [route, config] of Object.entries(TABLE())) {
      const { serviceName, tags } = config as { serviceName: string; tags: string[] };
      expect(serviceName.length, route).toBeLessThanOrEqual(32);
      expect(/^[\x20-\x7e]+$/.test(serviceName), route).toBe(true);
      expect(tags.length, route).toBeLessThanOrEqual(5);
      for (const tag of tags) expect(tag.length, `${route} tag ${tag}`).toBeLessThanOrEqual(32);
    }
  });
});

/**
 * Piste A — the "universal 402". Trust registries (Aegis & co) probe a resource
 * with a bare GET; on our POST routes that fell through to Hono's 405, which
 * they read as "does not speak x402" → "treat with caution". A mismatched-method
 * probe on a payable route must instead be quoted a 402 that announces the real
 * method. Verified end-to-end by external curl after deploy (x402 is free-mode
 * in tests, so the HTTP status can't be asserted here — only the route table).
 */
describe('mismatched-method probe still gets quoted (piste A)', () => {
  const wallet = '0x0000000000000000000000000000000000000001';

  it('exposes a payable synthetic entry for a GET probe on a POST route', () => {
    const table = buildRouteTable(wallet, 'GET', '/v1/iban/validate');
    expect(table['POST /v1/iban/validate'], 'canonical POST entry stays').toBeDefined();
    const synth = table['GET /v1/iban/validate'] as { accepts?: unknown; resource?: string } | undefined;
    expect(synth, 'synthetic GET entry makes requiresPayment() true').toBeDefined();
    expect(synth!.accepts, 'probe entry is payable').toBeDefined();
    expect(synth!.resource).toBe('https://api.ibanforge.com/v1/iban/validate');
  });

  it('covers batch and compliance the same way', () => {
    for (const p of ['/v1/iban/batch', '/v1/iban/compliance']) {
      expect(buildRouteTable(wallet, 'GET', p)[`GET ${p}`], p).toBeDefined();
    }
  });

  it('never quotes the credit-sale route to a probe (selling routes excluded)', () => {
    expect(buildRouteTable(wallet, 'GET', '/v1/credits/buy/1k')['GET /v1/credits/buy/1k']).toBeUndefined();
  });

  it('adds nothing when the method already matches', () => {
    const table = buildRouteTable(wallet, 'POST', '/v1/iban/validate');
    const posts = Object.keys(table).filter((k) => k === 'POST /v1/iban/validate');
    expect(posts.length).toBe(1);
  });
});

/**
 * Audit C2, R1 — the only place where our own offer makes a solvent, willing
 * buyer fail.
 *
 * `/v1/iban/batch` was quoted 200 000 atomic units ($0.20) at the door while
 * every catalog announced the per-IBAN rate ($0.002). A bounded-budget agent
 * (AgentCore) compares the two and refuses; Coinbase's `discover_x402_services`
 * filters on the catalog price and then gets billed 50× it; Aegis scores
 * exactly this gap as `price_honest`. None of them tells us — they just leave.
 */
describe('the batch quote says what the catalog says', () => {
  const IBAN = 'CH1000230000000012345';

  it('quotes the 1-IBAN minimum to a probe that sends no batch', () => {
    // A bare discovery probe: no body at all, or an empty one. This used to
    // fall through to `count = 100` and quote the $0.20 cap.
    expect(batchQuoteFor(undefined)).toBe('$0.002');
    expect(batchQuoteFor({})).toBe('$0.002');
    expect(batchQuoteFor({ ibans: [] })).toBe('$0.002');
  });

  it('matches the amount published in the discovery document', () => {
    // src/routes/discovery.ts publishes price_usdc 0.002 for this route, i.e.
    // 2 000 atomic USDC units. The door must ask for the same number.
    const atomic = Math.round(Number(batchQuoteFor({}).slice(1)) * 1_000_000);
    expect(atomic).toBe(2000);
  });

  /**
   * 🚨 The guard that must not be dropped. The old code read `body.ibans`
   * verbatim while the handler reads it through `getIbansArray`, which is
   * case-insensitive because agents uppercase acronyms. That mismatch was
   * harmless only while an unrecognised body meant "charge the cap"; the
   * moment the quote drops to the minimum it becomes a 100× under-charge —
   * 100 IBANs validated for the price of one.
   */
  it('counts the batch the same way the handler will', () => {
    expect(batchQuoteFor({ IBANS: [IBAN, IBAN] })).toBe('$0.004');
    expect(batchQuoteFor({ Iban_List: [IBAN, IBAN, IBAN] })).toBe('$0.006');
    expect(batchQuoteFor({ ibans: Array(100).fill(IBAN) })).toBe('$0.200');
  });

  it('charges per IBAN, at the rate decided 11/07', () => {
    for (const n of [1, 2, 7, 50, 100]) {
      expect(batchQuoteFor({ ibans: Array(n).fill(IBAN) })).toBe('$' + (n * 0.002).toFixed(3));
    }
  });

  it('never quotes above the cap, whatever the caller claims to be sending', () => {
    expect(batchQuoteFor({ ibans: Array(5000).fill(IBAN) })).toBe('$0.200');
  });
});

/**
 * Audit C2, R2 — the trailing slash. `/v1/iban/validate/` answered 404 (POST)
 * or 405 (bare GET): a mute wall where the price should be.
 */
describe('paid routes reached with a trailing slash have a canonical form', () => {
  it.each([
    ['POST', '/v1/iban/validate/', '/v1/iban/validate'],
    ['GET', '/v1/iban/validate/', '/v1/iban/validate'],
    ['POST', '/v1/iban/batch/', '/v1/iban/batch'],
    ['POST', '/v1/iban/compliance/', '/v1/iban/compliance'],
    ['GET', '/v1/bic/UBSWCHZH80A/', '/v1/bic/UBSWCHZH80A'],
    ['GET', '/v1/ch/clearing/230/', '/v1/ch/clearing/230'],
    ['POST', '/v1/credits/buy/25k/', '/v1/credits/buy/25k'],
  ])('%s %s → %s', (method, path, expected) => {
    expect(canonicalPaidPath(method, path)).toBe(expected);
  });

  it('leaves a canonical path alone', () => {
    for (const path of ['/v1/iban/validate', '/v1/bic/UBSWCHZH80A', '/v1/credits/buy/1k']) {
      expect(canonicalPaidPath('POST', path)).toBeNull();
    }
  });

  it('ignores paths that sell nothing — this is not a global routing change', () => {
    for (const path of ['/v1/iban/format/', '/v1/iban/structure/CH/', '/v1/credits/bundles/', '/health/', '/']) {
      expect(canonicalPaidPath('GET', path), path).toBeNull();
    }
  });

  it('never walks a bare GET into the purchase flow', () => {
    expect(canonicalPaidPath('GET', '/v1/credits/buy/1k/')).toBeNull();
  });
});

/**
 * Audit A2 §C1.2 — `HTTPFacilitatorClient` issues verify/settle/supported with
 * a bare `fetch`: no signal, no timeout, and no way to pass one. The effective
 * ceiling is undici's ~300 s, and the v2 settle blocks before the response
 * leaves, so a facilitator that accepts the connection and then says nothing
 * makes a PAID request hang for minutes.
 */
describe('a silent facilitator cannot hold a paid request for minutes', () => {
  it.each([
    ['verify', 10_000],
    ['supported', 10_000],
    ['settle', 30_000],
  ] as const)('gives up on %s after %dms instead of undici’s ~300 s', async (operation, budget) => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const bounded = withFacilitatorTimeout(never, operation);
      const outcome = bounded.then(
        () => 'answered',
        (e: Error) => e.message,
      );

      // One millisecond short of the budget: still waiting, as it must be —
      // abandoning a settle the facilitator is still working on charges the
      // buyer and delivers nothing.
      await vi.advanceTimersByTimeAsync(budget - 1);
      let settled = false;
      void outcome.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatch(/did not answer within/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is transparent when the facilitator answers in time', async () => {
    await expect(withFacilitatorTimeout(Promise.resolve('supported'), 'supported')).resolves.toBe('supported');
    await expect(withFacilitatorTimeout(Promise.reject(new Error('402 boom')), 'verify')).rejects.toThrow('402 boom');
  });

  /**
   * 🚨 The detail that decides whether this fix is worth anything. A promise we
   * stopped waiting on still rejects later; an unobserved rejection is exactly
   * what killed the process on 20/08 and burned Railway's three restarts. A
   * cure for a hang that reintroduces the crash is a net loss.
   */
  it('keeps a handler on the call it abandoned', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      let rejectLate: (e: Error) => void = () => {};
      const late = new Promise<never>((_, rej) => { rejectLate = rej; });
      const bounded = withFacilitatorTimeout(late, 'verify');
      // Stop waiting on it, then let the underlying call fail afterwards.
      const raced = bounded.catch(() => 'timed out');
      rejectLate(new Error('facilitator died after we gave up'));
      await raced;
      // Two turns of the microtask + macrotask queues is where Node reports one.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
