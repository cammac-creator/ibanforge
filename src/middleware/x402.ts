import type { MiddlewareHandler } from 'hono';

// USDC contract address on Base L2
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * x402 payment middleware for IBANforge.
 *
 * To enable payments: set X402_ENABLED=true + WALLET_ADDRESS + CDP_API_KEY_ID + CDP_API_KEY_SECRET in env.
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

    // Skip x402 if authenticated via API key
    if (c.get('apiKeyAuthenticated')) {
      await next();
      return;
    }

    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      await next();
      return;
    }

    try {
      const { paymentMiddleware } = await import('@x402/hono');
      const { x402ResourceServer, HTTPFacilitatorClient } = await import('@x402/core/server');
      const { ExactEvmScheme } = await import('@x402/evm/exact/server');

      const routes: Record<string, unknown> = {
        'POST /v1/iban/validate': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.005',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'IBAN validation + BIC lookup',
        },
        'POST /v1/iban/batch': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.20',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'Batch IBAN validation (up to 100 IBANs)',
        },
        'GET /v1/bic/:code': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.003',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'BIC/SWIFT code lookup with LEI enrichment',
        },
        'POST /v1/iban/compliance': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.02',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'IBAN compliance check: validation + sanctions + SEPA reachability + VoP + risk score',
        },
        'GET /v1/ch/clearing/:iid': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.003',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description: 'Swiss BC-Nummer / IID clearing lookup',
        },
      };

      // Create CDP facilitator client
      const cdpKeyId = process.env.CDP_API_KEY_ID;
      const cdpKeySecret = process.env.CDP_API_KEY_SECRET;

      let facilitatorClient: InstanceType<typeof HTTPFacilitatorClient>;

      if (cdpKeyId && cdpKeySecret) {
        const { createFacilitatorConfig } = await import('@coinbase/x402');
        const config = createFacilitatorConfig(cdpKeyId, cdpKeySecret);
        facilitatorClient = new HTTPFacilitatorClient(config);
      } else {
        facilitatorClient = new HTTPFacilitatorClient({
          url: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
        });
      }

      // Build x402 resource server with EVM scheme (like official example)
      const x402Server = new x402ResourceServer(facilitatorClient);
      x402Server.register('eip155:*', new ExactEvmScheme());

      const middleware = paymentMiddleware(
        routes as Parameters<typeof paymentMiddleware>[0],
        x402Server,
      );
      return middleware(c, next);
    } catch (err) {
      console.error('[x402] Middleware error:', err);
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
