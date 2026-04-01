import type { MiddlewareHandler } from 'hono';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * x402 payment middleware for IBANforge.
 *
 * To enable payments: set X402_ENABLED=true + WALLET_ADDRESS in env.
 * When disabled (default), all endpoints are free — useful for launch phase.
 */
export function ensureWalletConfigured(): void {
  if (process.env.X402_ENABLED === 'true' && !process.env.WALLET_ADDRESS) {
    throw new Error(
      'WALLET_ADDRESS is required when X402_ENABLED=true. ' +
        'Either set WALLET_ADDRESS or remove X402_ENABLED to run in free mode.',
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

    // x402 disabled — all endpoints are free
    if (process.env.X402_ENABLED !== 'true') {
      await next();
      return;
    }

    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
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
            price: { amount: '5000', asset: USDC_BASE },
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'IBAN validation + BIC lookup',
        },
        'POST /v1/iban/batch': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: { amount: '20000', asset: USDC_BASE },
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'Batch IBAN validation (up to 10)',
        },
        'GET /v1/bic/:code': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: { amount: '3000', asset: USDC_BASE },
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
