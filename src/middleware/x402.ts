import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';

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

export function createX402Middleware(): MiddlewareHandler<HonoEnv> {
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
      const { bazaarResourceServerExtension } = await import('@x402/extensions');

      // Bazaar discoverability blocks per route — let x402 facilitators (Coinbase CDP, x402.org)
      // index our endpoints in their public catalog so AI agents discover IBANforge automatically.
      const ibanInputSchema = {
        type: 'object',
        properties: {
          iban: { type: 'string', description: 'IBAN to validate. Spaces and lowercase accepted.' },
        },
        required: ['iban'],
      };
      const ibanOutputSchema = {
        type: 'object',
        properties: {
          valid: { type: 'boolean' },
          country: { type: 'string' },
          country_name: { type: 'string' },
          bic_resolved: { type: 'string' },
          bank_name: { type: 'string' },
          issuer_class: { type: 'string', enum: ['bank', 'emi', 'viban', 'unknown'] },
          sepa: { type: 'object' },
          vop_status: { type: 'string' },
          risk_score: { type: 'number' },
        },
      };

      const routes: Record<string, unknown> = {
        'POST /v1/iban/validate': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.005',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Validate a European IBAN and enrich it with bank, compliance and routing data. Use whenever the user mentions an IBAN, a bank account, a SEPA payment or asks who the bank is. Returns: valid, country, BIC/SWIFT, bank name, EMI/vIBAN flag, SEPA + VoP reachability, risk score, Swiss bc_nummer for CH/LI.',
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              bodyType: 'json',
              inputSchema: ibanInputSchema,
              outputSchema: ibanOutputSchema,
            },
          },
        },
        'POST /v1/iban/batch': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.20',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Validate up to 100 IBANs in one call (10x cheaper per IBAN than calling validate_iban repeatedly). Use for CSV cleanup, customer DB dedup, or pre-flight payout list triage.',
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              bodyType: 'json',
              inputSchema: {
                type: 'object',
                properties: {
                  ibans: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 100,
                    description: 'Array of 1 to 100 IBAN strings.',
                  },
                },
                required: ['ibans'],
              },
              outputSchema: {
                type: 'object',
                properties: {
                  results: { type: 'array', items: ibanOutputSchema },
                  summary: { type: 'object' },
                },
              },
            },
          },
        },
        'GET /v1/bic/:code': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.003',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank: name, country, city, LEI, address. Backed by 121,197 GLEIF entries with LEI enrichment. Use only when you already have the BIC — for IBAN inputs, prefer /v1/iban/validate which resolves the BIC for you.',
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              pathParams: {
                code: { type: 'string', description: 'BIC/SWIFT code (8 or 11 alphanumeric).' },
              },
              outputSchema: {
                type: 'object',
                properties: {
                  bank_name: { type: 'string' },
                  country: { type: 'string' },
                  city: { type: 'string' },
                  lei: { type: 'string' },
                  address: { type: 'string' },
                },
              },
            },
          },
        },
        'POST /v1/iban/compliance': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.02',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: sanctions screening (OFAC/EU/UN), FATF jurisdiction flag, SEPA Instant reachability, VoP (EU 2024/886) participant. Returns risk_score 0-100. Informational, not a regulated AML/CFT product.',
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              bodyType: 'json',
              inputSchema: ibanInputSchema,
              outputSchema: {
                type: 'object',
                properties: {
                  risk_score: { type: 'number', minimum: 0, maximum: 100 },
                  flags: { type: 'object' },
                  recommended_action: { type: 'string' },
                },
              },
            },
          },
        },
        'GET /v1/ch/clearing/:iid': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$0.003',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, SIC, euroSIC, QR-IID. The only API that exposes this data — alternatives (iban.com, OpenIBAN, payeer, sepa.com) do not cover it. Backed by 1,190 SIX BankMaster entries.',
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              pathParams: {
                iid: { type: 'string', description: 'Swiss IID / BC-Nummer (1-5 digits).' },
              },
              outputSchema: {
                type: 'object',
                properties: {
                  institution_name: { type: 'string' },
                  institution_type: { type: 'string' },
                  sic_participant: { type: 'boolean' },
                  eurosic_participant: { type: 'boolean' },
                  instant_payments: { type: 'boolean' },
                  qr_iid: { type: 'string' },
                },
              },
            },
          },
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
      // Register the Bazaar discovery extension so each route ships its
      // inputSchema/outputSchema to facilitator catalogs (Coinbase CDP, x402.org)
      // and AI agents can find IBANforge automatically.
      x402Server.registerExtension(bazaarResourceServerExtension);

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
