import type { MiddlewareHandler } from 'hono';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * x402 payment middleware for IBANforge.
 *
 * SECURITY: In production, if WALLET_ADDRESS is not set, the server refuses
 * to start. This middleware must NEVER fail-open — serving paid routes for
 * free is not acceptable.
 *
 * Dev bypass: set NODE_ENV=development and send X-Dev-Skip: true header.
 */
export function ensureWalletConfigured(): void {
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.WALLET_ADDRESS
  ) {
    throw new Error(
      'WALLET_ADDRESS environment variable is required in production. ' +
        'IBANforge cannot start without it — paid routes would be served for free.',
    );
  }
}

export function createX402Middleware(): MiddlewareHandler {
  return async (c, next) => {
    // Dev bypass
    if (
      process.env.NODE_ENV === 'development' &&
      c.req.header('X-Dev-Skip') === 'true'
    ) {
      await next();
      return;
    }

    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      // No wallet in non-production (dev/test) — pass through
      await next();
      return;
    }

    try {
      const { paymentMiddlewareFromConfig } = await import('@x402/hono');
      const { HTTPFacilitatorClient } = await import('@x402/core/server');

      const facilitatorUrl = process.env.FACILITATOR_URL;

      const routes: Record<string, unknown> = {
        'POST /v1/iban/validate': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: { amount: '2000', asset: USDC_BASE },
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'IBAN validation + BIC lookup',
        },
        'POST /v1/iban/batch': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: { amount: '15000', asset: USDC_BASE },
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'Batch IBAN validation (up to 10)',
        },
        'GET /v1/bic/:code': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: { amount: '1000', asset: USDC_BASE },
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'BIC/SWIFT code lookup with LEI enrichment',
        },
      };

      const facilitatorClient = facilitatorUrl
        ? new HTTPFacilitatorClient({ url: facilitatorUrl })
        : undefined;

      const middleware = paymentMiddlewareFromConfig(
        routes as Parameters<typeof paymentMiddlewareFromConfig>[0],
        facilitatorClient,
      );
      return middleware(c, next);
    } catch {
      // x402 package not available — only acceptable in dev/test
      if (process.env.NODE_ENV === 'production') {
        return c.json(
          { error: 'Payment system unavailable. Please try again later.' },
          503,
        );
      }
      await next();
    }
  };
}
