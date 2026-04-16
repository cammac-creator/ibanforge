import type { MiddlewareHandler } from 'hono';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'base';

interface EndpointPricing {
  match: (method: string, path: string) => boolean;
  price_usdc: number;
  description: string;
}

const PRICING: EndpointPricing[] = [
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/validate',
    price_usdc: 0.005,
    description: 'IBAN validation + BIC lookup',
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/batch',
    price_usdc: 0.2,
    description: 'Batch IBAN validation (up to 100 IBANs)',
  },
  {
    match: (m, p) => m === 'GET' && p.startsWith('/v1/bic/'),
    price_usdc: 0.003,
    description: 'BIC/SWIFT code lookup with LEI enrichment',
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/compliance',
    price_usdc: 0.02,
    description: 'IBAN compliance check: validation + sanctions + SEPA + VoP + risk score',
  },
  {
    match: (m, p) => m === 'GET' && p.startsWith('/v1/ch/clearing/'),
    price_usdc: 0.003,
    description: 'Swiss BC-Nummer / IID clearing lookup',
  },
];

function findPricing(method: string, path: string): EndpointPricing | undefined {
  return PRICING.find((p) => p.match(method, path));
}

/**
 * Enriches HTTP 402 responses to be both machine-readable (x402 v0.1 spec compliant)
 * AND human-readable. Agents need the `accepts` array to automate payment;
 * humans need the message + free_tier instructions.
 *
 * This middleware runs AFTER the x402 SDK and only acts if the body is empty/{}
 * or missing the `accepts` field. Never overrides a properly-formed x402 response.
 */
export function enrich402Middleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    if (c.res.status !== 402) return;

    const cloned = c.res.clone();
    const text = await cloned.text();

    // Only enrich empty bodies or `{}` — never override existing 402 responses
    // (whether they're proper x402 with `accepts` or a custom error from the route).
    if (text && text.trim() !== '{}') return;

    const url = new URL(c.req.url);
    const pricing = findPricing(c.req.method, url.pathname);
    const walletAddress = process.env.WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000';

    const accepts = pricing
      ? [
          {
            scheme: 'exact',
            network: NETWORK,
            maxAmountRequired: Math.round(pricing.price_usdc * 1_000_000).toString(),
            resource: `https://api.ibanforge.com${url.pathname}`,
            description: pricing.description,
            mimeType: 'application/json',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
            asset: USDC_BASE,
            extra: { name: 'USDC', version: '2' },
          },
        ]
      : [];

    const body = {
      x402Version: 1,
      error: 'payment_required',
      message:
        'Authentication required. Get a free API key (200 req/month) or pay per call via x402.',
      accepts,
      free_tier: {
        description: '200 requests/month — no credit card, no subscription',
        signup: 'POST /v1/keys/generate with body {"email":"you@example.com"}',
        usage: 'Add header: Authorization: Bearer ifk_your_key_here',
      },
      x402: {
        description: 'Pay per call with USDC on Base L2 (machine-to-machine)',
        protocol_docs: 'https://x402.org',
        discovery: 'https://api.ibanforge.com/.well-known/x402',
      },
      documentation: 'https://ibanforge.com/docs',
    };

    c.res = new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: c.res.headers,
    });
    c.res.headers.set('Content-Type', 'application/json');
  };
}
