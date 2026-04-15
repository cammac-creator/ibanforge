import type { MiddlewareHandler } from 'hono';

export function enrich402Middleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    if (c.res.status !== 402) return;

    const cloned = c.res.clone();
    const text = await cloned.text();

    if (text && text !== '{}') return;

    const body = {
      error: 'payment_required',
      message:
        'Authentication required. Get a free API key (200 req/month) or pay per call via x402.',
      free_tier: {
        description: '200 requests/month — no credit card, no subscription',
        signup: 'POST /v1/keys/generate with body {"email":"you@example.com"}',
        usage: 'Add header: Authorization: Bearer ifk_your_key_here',
      },
      x402: {
        description: 'Pay per call with USDC on Base L2 (machine-to-machine)',
        docs: 'https://x402.org',
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
