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
  facilitatorTimeoutMs,
  unconfirmedSettlementBody,
  FacilitatorTimeoutError,
  boundFacilitator,
  runInSettlementSlot,
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
    expect(source, 'v1 payment header — dropping this locks out older clients').toContain(
      'x-payment',
    );
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
  const TABLE = () =>
    buildRouteTable('0x0000000000000000000000000000000000000001', 'GET', '/v1/bic/COBADEFFXXX');

  it('describes itself within the facilitator payload limit', () => {
    for (const [route, config] of Object.entries(TABLE())) {
      const { description } = config as { description?: string };
      expect(typeof description, route).toBe('string');
      expect(
        description!.length,
        `${route} description is ${description!.length} chars`,
      ).toBeLessThanOrEqual(MAX_RESOURCE_DESCRIPTION);
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
    const synth = table['GET /v1/iban/validate'] as
      | { accepts?: unknown; resource?: string }
      | undefined;
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
    expect(
      buildRouteTable(wallet, 'GET', '/v1/credits/buy/1k')['GET /v1/credits/buy/1k'],
    ).toBeUndefined();
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
    for (const path of [
      '/v1/iban/format/',
      '/v1/iban/structure/CH/',
      '/v1/credits/bundles/',
      '/health/',
      '/',
    ]) {
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
    ['verify', 5_000],
    ['supported', 5_000],
    ['settle', 6_000],
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
      void outcome.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatch(/did not answer within/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is transparent when the facilitator answers in time', async () => {
    await expect(withFacilitatorTimeout(Promise.resolve('supported'), 'supported')).resolves.toBe(
      'supported',
    );
    await expect(
      withFacilitatorTimeout(Promise.reject(new Error('402 boom')), 'verify'),
    ).rejects.toThrow('402 boom');
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
      const late = new Promise<never>((_, rej) => {
        rejectLate = rej;
      });
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

/**
 * A budget only bounds a hang while the process is alive to enforce it.
 *
 * `gracefulShutdown` drains in-flight requests for DRAIN_TIMEOUT_MS = 8_000
 * (`src/index.ts:111`) and then severs what is left, so a facilitator budget
 * above the drain is unreachable at exactly the moment it matters: the buyer
 * gets a dropped connection instead of an answer. The 8_000 is duplicated as a
 * literal here on purpose: it is module-local in `src/index.ts`, and importing
 * that file to read it would boot the server and every radar with it.
 */
describe('the facilitator budget outlives no shutdown', () => {
  const OPERATIONS = ['supported', 'verify', 'settle'] as const;
  const DRAIN_TIMEOUT_MS = 8_000;

  it.each(OPERATIONS)('leaves the drain room to flush the %s failure', (operation) => {
    expect(facilitatorTimeoutMs(operation)).toBeLessThan(DRAIN_TIMEOUT_MS);
  });

  it('still gives settle the most room of the three', () => {
    // The reason the old 30 s existed survives the tightening: giving up on a
    // settle the facilitator is still processing may charge the buyer for an
    // answer we cannot confirm, so settle must never be the first to fold.
    expect(facilitatorTimeoutMs('settle')).toBeGreaterThan(facilitatorTimeoutMs('verify'));
    expect(facilitatorTimeoutMs('settle')).toBeGreaterThan(facilitatorTimeoutMs('supported'));
  });

  it('starts with no configuration at all', () => {
    vi.stubEnv('X402_SETTLE_TIMEOUT_MS', undefined as unknown as string);
    vi.stubEnv('X402_VERIFY_TIMEOUT_MS', undefined as unknown as string);
    try {
      expect(facilitatorTimeoutMs('settle')).toBe(6_000);
      expect(facilitatorTimeoutMs('verify')).toBe(5_000);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('lets an operator who would rather wait raise the ceiling', () => {
    vi.stubEnv('X402_SETTLE_TIMEOUT_MS', '25000');
    try {
      expect(facilitatorTimeoutMs('settle')).toBe(25_000);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  /**
   * 🚨 `setTimeout(NaN)` fires IMMEDIATELY. A typo in a Railway variable would
   * turn every settlement into an instant timeout, the exact failure this
   * whole mechanism exists to prevent, introduced by its own configuration.
   */
  it.each(['abc', '', '   ', '0', '-1', 'NaN', '10s'])(
    'refuses %o rather than turning every settle into an instant timeout',
    (bad) => {
      vi.stubEnv('X402_SETTLE_TIMEOUT_MS', bad);
      try {
        expect(facilitatorTimeoutMs('settle')).toBe(6_000);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});

/**
 * The doctrine, applied to money: a settlement whose outcome never came back is
 * UNKNOWN, not refused. `screenBicSanctions` answers `listed: null` rather than
 * `listed: false` when the database could not be read; a settle we stopped
 * waiting on gets the same treatment, because the payment may well be on-chain.
 */
describe('an unconfirmed settlement never reads as a refusal', () => {
  const body = unconfirmedSettlementBody(new FacilitatorTimeoutError('settle', 6_000), 6_000);

  it('claims nothing about whether the buyer paid', () => {
    // `false` here would assert the money did not move. We do not know that.
    expect(body.settlement.paid).toBeNull();
    expect(body.settlement.paid).not.toBe(false);
    expect(body.settlement.confirmation_received).toBe(false);
    expect(body.settlement.authoritative).toBe(false);
  });

  it('never dresses a timeout up as a receipt', () => {
    expect(JSON.stringify(body)).not.toMatch(/"(success|settled|paid)":\s*true/);
    expect(body.error).toBe('settlement_unconfirmed');
  });

  /**
   * 🚨 The whole reason this is not a 402. An x402 client reads 402 as "attach
   * a payment and retry", so answering 402 to a buyer who may already have been
   * charged is an invitation to pay twice.
   */
  it('warns against re-sending rather than asking for payment', () => {
    expect(body.message).toMatch(/do not re-send/i);
    expect(body.message).toMatch(/twice/i);
    expect(body.message).not.toMatch(/payment required/i);
  });

  /**
   * 🚨 On a route that SELLS a pack the handler minted the key BEFORE settle
   * ran, and its response carried the one-time recovery URL. This 502 replaces
   * that response, so omitting the URL here would destroy the recovery path in
   * the exact case where the buyer may already have paid for the key.
   */
  it('hands back the recovery URL its own 502 replaced', () => {
    const sold = unconfirmedSettlementBody(
      new FacilitatorTimeoutError('settle', 6_000),
      6_000,
      'deadbeef',
    );
    expect(sold.recovery_url).toBe('https://api.ibanforge.com/v1/credits/recover/deadbeef');
    expect(sold.recovery_note).toMatch(/once/i);
  });

  it('offers no recovery URL when nothing was minted to recover', () => {
    // A per-call paid route creates nothing; a recovery link would be a dead end.
    expect(
      unconfirmedSettlementBody(new FacilitatorTimeoutError('settle', 6_000), 6_000, null),
    ).not.toHaveProperty('recovery_url');
    expect(body).not.toHaveProperty('recovery_url');
  });
});

/**
 * The wiring, not the pieces.
 *
 * Everything above tests `withFacilitatorTimeout` and `unconfirmedSettlementBody`
 * in isolation, and all of it stays green even if the two never meet. What makes
 * the 502 reachable is that the AsyncLocalStorage context survives from the
 * middleware's `run()`, through the SDK's awaits, into the settle wrapper. If it
 * does not, `getStore()` is undefined, the flag never sets, and the buyer
 * silently gets the SDK's bare 402 back.
 */
describe('a timed-out settle reaches the response builder', () => {
  function fakeClient(settleImpl: () => Promise<unknown>) {
    return boundFacilitator({
      verify: async () => 'verified',
      settle: settleImpl,
      getSupported: async () => 'supported',
    });
  }

  it('marks the request slot when settle times out', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient(() => new Promise(() => {}));
      const { slot, out } = runInSettlementSlot(() =>
        (client.settle as () => Promise<unknown>)().catch((e: unknown) => e),
      );
      await vi.advanceTimersByTimeAsync(facilitatorTimeoutMs('settle'));
      await out;

      expect(slot.unconfirmed).toBeInstanceOf(FacilitatorTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the slot clean when the facilitator answers', async () => {
    const client = fakeClient(async () => ({ success: true }));
    const { slot, out } = runInSettlementSlot(() => (client.settle as () => Promise<unknown>)());
    await out;
    // A settlement that came back is not an unknown one.
    expect(slot.unconfirmed).toBeNull();
  });

  it('leaves the slot clean when the facilitator REFUSES', async () => {
    const client = fakeClient(() => Promise.reject(new Error('insufficient funds')));
    const { slot, out } = runInSettlementSlot(() =>
      (client.settle as () => Promise<unknown>)().catch((e: unknown) => e),
    );
    await out;
    // A refusal is a known outcome: the SDK's 402 is the honest answer there,
    // and dressing it as "unknown" would be the mirror-image lie.
    expect(slot.unconfirmed).toBeNull();
  });
});
