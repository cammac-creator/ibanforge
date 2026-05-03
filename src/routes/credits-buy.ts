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
import { generateCreditKey } from '../lib/api-keys.js';

const BUNDLES: Record<string, { credits: number; price_usdc: number }> = {
  '1k': { credits: 1000, price_usdc: 5 },
  '5k': { credits: 5000, price_usdc: 20 },
  '25k': { credits: 25000, price_usdc: 80 },
};

const creditsBuy = new Hono();

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

  const result = generateCreditKey(email, bundle.credits);

  return c.json({
    api_key: result.api_key,
    key_prefix: result.key_prefix,
    credits: result.credits,
    bundle: slug,
    price_paid_usdc: bundle.price_usdc,
    price_per_call_usdc: Math.round((bundle.price_usdc / bundle.credits) * 1_000_000) / 1_000_000,
    usage_hint: 'Send Authorization: Bearer ' + result.key_prefix + '... on subsequent /v1/iban/* and /v1/bic/* calls.',
    balance_endpoint: 'GET /v1/credits/balance',
    message: 'Save this key — it will not be shown again.',
  }, 201);
});

export { creditsBuy };
