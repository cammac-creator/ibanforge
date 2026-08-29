/**
 * Bundle credits feature — end-to-end tests.
 *
 * Validates the prepaid-bundle flow:
 *  - Anonymous and email-attached key minting
 *  - Credit decrement per call
 *  - Refund on 4xx
 *  - Fall-through to x402 when balance reaches 0
 *  - /v1/credits/balance reflects state correctly
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { creditsBuy } from './credits-buy.js';
import { apiKeys } from './api-keys.js';
import { ibanValidate } from './iban-validate.js';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import { stripeRetrieve } from './stripe-retrieve.js';
import { generateApiKey, generateCreditKey, validateApiKey, decrementCredits, refundCredit } from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { CREDITS_PURCHASE_TYPE, getStats } from '../lib/stats.js';
import { createHash } from 'node:crypto';
import type { HonoEnv } from '../types.js';

afterAll(() => {
  closeAll();
});

function makeAppWithCredits() {
  const app = new Hono<HonoEnv>();
  app.route('/', apiKeys);
  app.use('/v1/*', apiKeyMiddleware());
  app.route('/', creditsBuy);
  app.route('/', ibanValidate);
  return app;
}

describe('generateCreditKey', () => {
  it('mints an anonymous key with the requested credits', () => {
    const k = generateCreditKey(null, 1000);
    expect(k.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(k.credits).toBe(1000);
    expect(k.key_prefix).toMatch(/^ifk_[a-f0-9]{8}$/);
  });

  it('mints an email-attached key when an email is provided', () => {
    const k = generateCreditKey('agent@example.com', 5000);
    const v = validateApiKey(k.api_key);
    expect(v.valid).toBe(true);
    expect(v.email).toBe('agent@example.com');
    expect(v.creditsRemaining).toBe(5000);
    expect(v.creditsTotal).toBe(5000);
  });

  it('does not impose the daily-rate-limit (unlike /v1/keys/generate)', () => {
    // Two keys for the same email back-to-back should both succeed.
    const a = generateCreditKey('rapid@example.com', 1000);
    const b = generateCreditKey('rapid@example.com', 1000);
    expect(a.api_key).not.toBe(b.api_key);
  });
});

describe('decrementCredits / refundCredit', () => {
  it('atomically decrements and returns the new balance', () => {
    const k = generateCreditKey(null, 10);
    const v = validateApiKey(k.api_key);
    expect(decrementCredits(v.keyHash)).toEqual({ ok: true, remaining: 9 });
    expect(decrementCredits(v.keyHash)).toEqual({ ok: true, remaining: 8 });
  });

  it('refuses when credits are exhausted (caller falls through to x402)', () => {
    const k = generateCreditKey(null, 2);
    const v = validateApiKey(k.api_key);
    expect(decrementCredits(v.keyHash)).toEqual({ ok: true, remaining: 1 });
    expect(decrementCredits(v.keyHash)).toEqual({ ok: true, remaining: 0 });
    expect(decrementCredits(v.keyHash)).toEqual({ ok: false, remaining: 0 });
    // Subsequent decrements keep refusing — the balance never goes negative.
    expect(decrementCredits(v.keyHash)).toEqual({ ok: false, remaining: 0 });
  });

  it('multi-unit decrement (batch billing) is all-or-nothing', () => {
    const k = generateCreditKey(null, 10);
    const v = validateApiKey(k.api_key);
    expect(decrementCredits(v.keyHash, 4)).toEqual({ ok: true, remaining: 6 });
    // 7 > 6 → refused, and the 6 remaining credits are untouched.
    expect(decrementCredits(v.keyHash, 7)).toEqual({ ok: false, remaining: 6 });
    // A batch that exactly fits still passes.
    expect(decrementCredits(v.keyHash, 6)).toEqual({ ok: true, remaining: 0 });
  });

  it('refundCredit re-credits a previously consumed call', () => {
    const k = generateCreditKey(null, 10);
    const v = validateApiKey(k.api_key);
    decrementCredits(v.keyHash);
    decrementCredits(v.keyHash);
    refundCredit(v.keyHash);
    const v2 = validateApiKey(k.api_key);
    expect(v2.creditsRemaining).toBe(9);
  });

  it('refundCredit restores multi-unit debits, clamped at credits_total', () => {
    const k = generateCreditKey(null, 10);
    const v = validateApiKey(k.api_key);
    decrementCredits(v.keyHash, 5);
    refundCredit(v.keyHash, 5);
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(10);
    // A stray extra refund cannot inflate the balance above what was bought.
    refundCredit(v.keyHash, 3);
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(10);
  });

  it('refundCredit is a no-op for monthly-quota keys (credits_remaining IS NULL)', () => {
    // Keys minted via generateApiKey have credits_remaining=NULL; refund should
    // not bump them (they don't track credits).
    const k = generateApiKey('monthly-' + Date.now() + '@example.com');
    expect(k).not.toBeNull();
    const v = validateApiKey(k!.api_key);
    refundCredit(v.keyHash);
    const v2 = validateApiKey(k!.api_key);
    expect(v2.creditsRemaining).toBeUndefined();
  });
});

describe('GET /v1/credits/bundles', () => {
  it('returns the 3 bundles with their pricing', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const res = await app.request('/v1/credits/bundles');
    expect(res.status).toBe(200);
    const body = await res.json() as { bundles: Array<{ slug: string; credits: number; price_usdc: number; price_per_call_usdc: number }> };
    expect(body.bundles).toHaveLength(3);
    const slugs = body.bundles.map((b) => b.slug);
    expect(slugs).toContain('1k');
    expect(slugs).toContain('5k');
    expect(slugs).toContain('25k');
    const oneK = body.bundles.find((b) => b.slug === '1k')!;
    expect(oneK.credits).toBe(1000);
    expect(oneK.price_usdc).toBe(5);
    expect(oneK.price_per_call_usdc).toBe(0.005);
  });
});

describe('GET /v1/credits/balance', () => {
  it('returns 401 when no API key is provided', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const res = await app.request('/v1/credits/balance');
    expect(res.status).toBe(401);
  });

  it('returns the credit balance for a credit-bundle key', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const k = generateCreditKey(null, 1000);
    const res = await app.request('/v1/credits/balance', {
      headers: { Authorization: `Bearer ${k.api_key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { type: string; credits_remaining: number; credits_total: number; credits_used: number };
    expect(body.type).toBe('credit_bundle');
    expect(body.credits_remaining).toBe(1000);
    expect(body.credits_total).toBe(1000);
    expect(body.credits_used).toBe(0);
  });

  it('flags monthly-subscription keys distinctly from credit bundles', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const k = generateApiKey('subscriber-' + Date.now() + '@example.com');
    expect(k).not.toBeNull();
    const res = await app.request('/v1/credits/balance', {
      headers: { Authorization: `Bearer ${k!.api_key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { type: string };
    expect(body.type).toBe('subscription');
  });
});

describe('apiKeyMiddleware — credit-bundle path', () => {
  it('decrements credits on a successful 200 response', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 100);
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${k.api_key}`,
      },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-credits-remaining')).toBe('99');
    expect(res.headers.get('x-credits-total')).toBe('100');
  });

  it('refunds the credit when the handler returns 4xx (bad input)', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 50);
    // Send malformed body — handler returns 400, middleware should refund.
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${k.api_key}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    // Middleware decremented to 49, then refunded to 50. We assert via DB.
    const v = validateApiKey(k.api_key);
    expect(v.creditsRemaining).toBe(50);
  });

  it('falls through to x402 (no apiKeyAuthenticated) when credits are exhausted', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 1);
    // Burn the only credit
    const res1 = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-credits-remaining')).toBe('0');

    // Next call: balance is 0 — middleware sets X-Credits-Exhausted and falls
    // through. Without x402 middleware in this test app, the request is
    // served free (which is fine — we're testing the fall-through behavior,
    // not the x402 gate which is tested elsewhere).
    const res2 = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    expect(res2.headers.get('x-credits-exhausted')).toBe('true');
    expect(res2.headers.get('x-credits-topup-hint')).toContain('1k');
  });
});

/**
 * The blind spot this closes: the credits branch touched credits_remaining and
 * nothing else, so `api_usage` — the ledger every monthly aggregate reads — held
 * NOTHING for a prepaid customer. months_by_key, the CRM sparkline and any
 * "what did they consume in July" understated exactly the customers who pay.
 *
 * It is an OBSERVATION counter. Nothing is enforced against it, and nothing is
 * billed twice: the debit remains the single decrementCredits call.
 */
describe('a credit key is counted in its month, and never capped by it', () => {
  const month = () => new Date().toISOString().slice(0, 7);
  const monthCount = (rawKey: string): number => {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const row = getStatsDB()
      .prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?')
      .get(hash, month()) as { count: number } | undefined;
    return row?.count ?? 0;
  };

  it('records what it consumed in the month it consumed it', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 100);
    expect(monthCount(k.api_key)).toBe(0);

    for (let i = 0; i < 3; i++) {
      const res = await app.request('/v1/iban/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
        body: JSON.stringify({ iban: 'CH9300762011623852957' }),
      });
      expect(res.status).toBe(200);
    }

    expect(monthCount(k.api_key)).toBe(3);
    // The debit stayed single: three calls, three credits, not six.
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(97);
  });

  it('gives the month back when the call is refunded on a 4xx', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 50);
    const res = await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(monthCount(k.api_key)).toBe(0);
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(50);
  });

  // The hazard the read-side patch was written to avoid, now that the write
  // happens: monthly_limit is NULL on a credit key, which falls back to 200. If
  // this counter were ever consulted as a ceiling, a 5,000-credit pack would be
  // cut off after 200 calls a month. It is not — the balance is the only wall.
  it('serves far past the default monthly allowance without ever refusing', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 400);
    for (let i = 0; i < 250; i++) {
      const res = await app.request('/v1/iban/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
        body: JSON.stringify({ iban: 'CH9300762011623852957' }),
      });
      expect(res.status).toBe(200);
      // Never the monthly-quota refusal, at any point past the 200th call.
      expect(res.headers.get('x-quota-exhausted')).toBeNull();
    }
    expect(monthCount(k.api_key)).toBe(250);
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(150);
  });

  it('tells its holder that the monthly figures govern nothing', async () => {
    const app = makeAppWithCredits();
    const k = generateCreditKey(null, 5000);
    await app.request('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    const res = await app.request('/v1/keys/usage', {
      headers: { Authorization: `Bearer ${k.api_key}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.used).toBe(1);
    expect(body.basis).toBe('credits');
    expect(body.credits_remaining).toBe(4999);
  });
});

/**
 * Audit A2 — a $5-to-$80 key that existed only in one HTTP response.
 *
 * The card rail has always written the raw key to `raw_key_one_time_view` and
 * keyed it on the checkout session, so a buyer whose success page never loaded
 * can still fetch it once. The x402 rail stored nothing: settle succeeds, the
 * connection drops, and the buyer has paid for a key nobody can hand back —
 * we keep only its hash. Both rails now behave the same way.
 */
describe('a credit pack bought with USDC survives a lost response', () => {
  function appWithRecovery() {
    const app = new Hono<HonoEnv>();
    app.route('/', stripeRetrieve);
    app.route('/', creditsBuy);
    return app;
  }

  // A payment header the way a v2 client sends it, and the reference the buyer
  // can recompute from it without us.
  function payment(seed: string): { header: string; ref: string } {
    const header = Buffer.from(`payment-payload-${seed}`).toString('base64');
    return { header, ref: createHash('sha256').update(header).digest('hex').slice(0, 32) };
  }

  it('hands the key back exactly once to whoever made the payment', async () => {
    const { header, ref } = payment(`recover-${Date.now()}`);
    const app = appWithRecovery();

    const bought = (await (
      await app.request('/v1/credits/buy/5k', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'payment-signature': header },
        body: '{}',
      })
    ).json()) as { api_key: string; recovery_url: string };
    expect(bought.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(bought.recovery_url).toContain(`/v1/credits/recover/${ref}`);

    // The buyer never saw that body. They hash the request they sent and ask.
    const first = await app.request(`/v1/credits/recover/${ref}`);
    expect(first.status).toBe(200);
    const recovered = (await first.json()) as { api_key: string; credits_total: number };
    expect(recovered.api_key).toBe(bought.api_key);
    expect(recovered.credits_total).toBe(5000);
    // …and the key it recovers actually works.
    expect(validateApiKey(recovered.api_key).creditsRemaining).toBe(5000);

    // Exactly once: the window closes behind them.
    expect((await app.request(`/v1/credits/recover/${ref}`)).status).toBe(404);
  });

  /**
   * The other half of the same loss: a buyer who retries the request whose
   * response they lost must not be handed a SECOND pack for one payment.
   */
  it('never mints twice for one settlement', async () => {
    const { header, ref } = payment(`once-${Date.now()}`);
    const app = appWithRecovery();
    const opts = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'payment-signature': header },
      body: '{}',
    };

    const first = (await (await app.request('/v1/credits/buy/25k', opts)).json()) as {
      api_key: string;
      key_prefix: string;
    };
    const replay = await app.request('/v1/credits/buy/25k', opts);
    const second = (await replay.json()) as { api_key?: string; key_prefix: string; idempotent: boolean };

    expect(second.idempotent).toBe(true);
    expect(second.api_key).toBeUndefined();
    expect(second.key_prefix).toBe(first.key_prefix);
    expect(
      (getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys WHERE x402_payment_ref = ?').get(ref) as { n: number }).n,
    ).toBe(1);
  });

  it('refuses a reference that is not one of ours', async () => {
    const app = appWithRecovery();
    expect((await app.request('/v1/credits/recover/not-a-hash')).status).toBe(400);
    expect((await app.request(`/v1/credits/recover/${'a'.repeat(32)}`)).status).toBe(404);
  });

  /**
   * No payment header means nothing was paid (free mode, dev bypass). A key is
   * still issued — but nothing recoverable is stored, because storing a raw key
   * for a payment that never happened would be a plaintext key with no owner.
   */
  it('stores nothing recoverable when nothing was paid', () => {
    const k = generateCreditKey(null, 1000);
    const row = getStatsDB()
      .prepare('SELECT raw_key_one_time_view, x402_payment_ref FROM api_keys WHERE key_prefix = ?')
      .get(k.key_prefix) as { raw_key_one_time_view: string | null; x402_payment_ref: string | null };
    expect(row.raw_key_one_time_view).toBeNull();
    expect(row.x402_payment_ref).toBeNull();
  });
});

/**
 * Audit B2 — the sale itself was invisible. Consumption endpoints have always
 * recorded what they collected; the routes that SELL recorded nothing, so the
 * largest ticket on the USDC rail left no trace in daily_stats and every
 * revenue reading understated the business by exactly the amount that mattered.
 */
describe('a pack sale is booked as revenue', () => {
  function revenueToday(): number {
    const row = getStatsDB()
      .prepare("SELECT COALESCE(SUM(revenue_usdc), 0) AS r FROM daily_stats WHERE date = date('now') AND operation_type = ?")
      .get(CREDITS_PURCHASE_TYPE) as { r: number };
    return row.r;
  }

  it('records what was actually collected when the pack was paid for', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', creditsBuy);
    const before = revenueToday();
    const header = Buffer.from(`paid-${Date.now()}`).toString('base64');
    await app.request('/v1/credits/buy/25k', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'payment-signature': header },
      body: '{}',
    });
    expect(revenueToday() - before).toBeCloseTo(80, 6);
  });

  it('records zero when the pack was handed over for free', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', creditsBuy);
    const before = revenueToday();
    // No payment header: explicit free mode or the dev bypass. The pack exists,
    // no money moved, and a dashboard must never show money that did not move.
    await app.request('/v1/credits/buy/1k', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(revenueToday()).toBeCloseTo(before, 6);
  });

  /**
   * A purchase is not a validation. `getStats()` builds total_operations and
   * by_type from the three named types in the `operations` table, so booking
   * revenue here must not move a single usage counter.
   */
  it('adds revenue without inflating any usage counter', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', creditsBuy);
    const opsBefore = getStats().total_operations;
    const revenueBefore = getStats().total_revenue_usdc;
    await app.request('/v1/credits/buy/5k', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'payment-signature': Buffer.from(`ops-${Date.now()}`).toString('base64') },
      body: '{}',
    });
    expect(getStats().total_operations).toBe(opsBefore);
    expect(getStats().total_revenue_usdc - revenueBefore).toBeCloseTo(20, 6);
  });
});
