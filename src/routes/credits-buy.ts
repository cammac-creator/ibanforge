/**
 * /v1/credits/buy/:bundle — paid endpoint that mints a credit-based key
 * after a successful x402 settlement. MUST be mounted AFTER the x402
 * middleware in src/index.ts so the payment gate runs first; if mounted
 * before, the handler executes without payment validation.
 *
 * Pricing for each bundle is enforced in src/middleware/x402.ts (route
 * `POST /v1/credits/buy/:bundle`). When the agent paid, x402 lets the
 * request through, this handler runs, and we mint a fresh key.
 */
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import type { HonoEnv } from '../types.js';
import { findCreditKeyByPaymentRef, generateCreditKey } from '../lib/api-keys.js';
import { recordCreditsPurchase } from '../lib/stats.js';

const BUNDLES: Record<string, { credits: number; price_usdc: number }> = {
  '1k': { credits: 1000, price_usdc: 5 },
  '5k': { credits: 5000, price_usdc: 20 },
  '25k': { credits: 25000, price_usdc: 80 },
};

/**
 * A stable handle on THIS settlement, derived from the payment the buyer
 * signed and sent.
 *
 * It has to be something the buyer can recompute without us: if the response
 * carrying their key is lost, the only thing they still hold is the request
 * they made. So the reference is the SHA-256 of the payment header itself —
 * no dialect parsing (v1 `X-PAYMENT` and v2 `PAYMENT-SIGNATURE` both work),
 * nothing to agree on beyond "hash what you sent".
 *
 * Truncated to 32 hex characters: still 128 bits, and short enough to travel
 * in a URL without wrapping. The header itself is never stored — only this
 * digest — so the signed authorization never lands in the database.
 */
export function settlementRef(c: Context<HonoEnv>): string | null {
  const header = c.req.header('payment-signature') ?? c.req.header('x-payment');
  if (!header) return null;
  return createHash('sha256').update(header).digest('hex').slice(0, 32);
}

const creditsBuy = new Hono<HonoEnv>();

creditsBuy.post('/v1/credits/buy/:bundle', async (c) => {
  const slug = c.req.param('bundle');
  const bundle = BUNDLES[slug];
  if (!bundle) {
    return c.json({
      error: 'unknown_bundle',
      message: `Bundle "${slug}" not found. Choose: ${Object.keys(BUNDLES).join(', ')}.`,
      bundles: Object.keys(BUNDLES),
    }, 404);
  }

  // Optional email — anonymous keys are fully functional too.
  let email: string | null = null;
  try {
    const body = await c.req.json<{ email?: unknown }>().catch(() => ({}));
    if (body && typeof body === 'object' && 'email' in body && typeof body.email === 'string' && body.email.includes('@')) {
      email = body.email.trim().toLowerCase();
    }
  } catch {
    // No body, no email — fine.
  }

  const ref = settlementRef(c);

  // A settlement we have already minted for. Nothing is minted again — that
  // would be two packs for one payment — and the buyer is pointed at the
  // one-time recovery, which is the whole reason the raw key was kept.
  const already = ref ? findCreditKeyByPaymentRef(ref) : null;
  if (already) {
    return c.json({
      key_prefix: already.key_prefix,
      credits: bundle.credits,
      bundle: slug,
      idempotent: true,
      message:
        'This settlement already minted a key — it was not minted again. ' +
        'If you never received it, fetch it once at the recovery URL below.',
      recovery_url: `https://api.ibanforge.com/v1/credits/recover/${ref}`,
    }, 200);
  }

  const result = generateCreditKey(email, bundle.credits, ref);

  // The purchase itself, booked as revenue. Consumption endpoints have always
  // recorded what they collected; the routes that SELL recorded nothing, so
  // every prepaid pack bought with USDC was invisible in daily_stats and the
  // dashboard read a service that sold nothing while it was being paid.
  recordCreditsPurchase(slug, bundle.price_usdc, ref !== null);

  return c.json({
    api_key: result.api_key,
    key_prefix: result.key_prefix,
    credits: result.credits,
    bundle: slug,
    price_paid_usdc: bundle.price_usdc,
    price_per_call_usdc: Math.round((bundle.price_usdc / bundle.credits) * 1_000_000) / 1_000_000,
    usage_hint: 'Send Authorization: Bearer ' + result.key_prefix + '... on subsequent /v1/iban/* and /v1/bic/* calls.',
    balance_endpoint: 'GET /v1/credits/balance',
    // How to get this key back exactly once if you lose this response. The
    // reference is sha256(your payment header) truncated to 32 hex chars, so
    // you can recompute it from the request you sent even if this body never
    // reached you.
    recovery_url: ref ? `https://api.ibanforge.com/v1/credits/recover/${ref}` : undefined,
    recovery_note: ref
      ? 'Lost this response? GET the recovery_url once — it works a single time, then the key is gone from our side too (we store only its hash).'
      : undefined,
    message: 'Save this key — it will not be shown again.',
  }, 201);
});

export { creditsBuy };
