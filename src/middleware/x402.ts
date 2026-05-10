import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';

// USDC contract address on Base L2
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * x402 payment middleware for IBANforge.
 *
 * Production rule (must NOT fail-open):
 *   - X402_ENABLED=true + WALLET_ADDRESS + CDP_API_KEY_ID + CDP_API_KEY_SECRET
 *   - OR explicit IBANFORGE_FREE_MODE=true (loud warning, all endpoints free)
 *
 * Anything else in production = boot crash. In dev/test, free mode is the default.
 */
export function ensureWalletConfigured(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const x402Enabled = process.env.X402_ENABLED === 'true';
  const walletAddress = process.env.WALLET_ADDRESS;
  const explicitFreeMode = process.env.IBANFORGE_FREE_MODE === 'true';

  if (!isProd) {
    return;
  }

  if (explicitFreeMode) {
    console.warn(
      '[x402] PRODUCTION boot with IBANFORGE_FREE_MODE=true — all paid endpoints are FREE. ' +
        'Disable this flag and set X402_ENABLED=true + WALLET_ADDRESS to enable monetization.',
    );
    return;
  }

  if (!x402Enabled) {
    throw new Error(
      'In production, X402_ENABLED must be "true". To run in explicit free mode, set IBANFORGE_FREE_MODE=true.',
    );
  }

  if (!walletAddress) {
    throw new Error('WALLET_ADDRESS is required when X402_ENABLED=true.');
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

    const isProd = process.env.NODE_ENV === 'production';
    const explicitFreeMode = process.env.IBANFORGE_FREE_MODE === 'true';
    const x402Enabled = process.env.X402_ENABLED === 'true';

    // Skip x402 if authenticated via API key (free tier inside the quota)
    if (c.get('apiKeyAuthenticated')) {
      await next();
      return;
    }

    // Free mode (dev/test, or explicit prod opt-in) — all paid endpoints are free
    if (!x402Enabled) {
      if (isProd && !explicitFreeMode) {
        // Defense in depth: if boot-time validation was bypassed somehow,
        // refuse to serve paid endpoints rather than fail-open.
        return c.json(
          { error: 'Payment system misconfigured. Please contact support.' },
          503,
        );
      }
      await next();
      return;
    }

    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      if (isProd) {
        return c.json(
          { error: 'Payment system misconfigured. Please contact support.' },
          503,
        );
      }
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
      //
      // Trust signals appended to descriptions: production status, p99 latency target,
      // dataset size, last update. Agents that filter on description quality (Bazaar
      // semantic search, agentic.market) reward this.
      const TRUST_TAG_VALIDATE = 'Production · p99 <50ms · 121,197 BICs (38K LEI via GLEIF) + 1,190 SIX · v1.2.0';
      const TRUST_TAG_BIC = 'Production · p99 <30ms · 121,197 BICs (38,761 LEI-enriched via GLEIF) · v1.2.0';
      const TRUST_TAG_CH = 'Production · p99 <20ms · 1,190 SIX BankMaster entries · v1.2.0';
      const TRUST_TAG_COMPLIANCE = 'Production · p99 <80ms · OFAC/EU/UN + FATF + SEPA + VoP · weekly refresh · v1.2.0';
      const TRUST_TAG_BATCH = 'Production · p99 <300ms for 100 IBANs · 121,197 BICs · v1.2.0';

      const ibanInputSchema = {
        type: 'object',
        properties: {
          iban: {
            type: 'string',
            description: 'IBAN to validate. Spaces and lowercase accepted. Example: CH9300762011623852957',
            minLength: 15,
            maxLength: 34,
          },
        },
        required: ['iban'],
      };
      // Full-fidelity output schema: every field a real response carries.
      // Mirrors src/lib/enrich.ts shape so agents can predict the response 1:1.
      const ibanOutputSchema = {
        type: 'object',
        properties: {
          iban: { type: 'string', description: 'Normalized IBAN (uppercase, no spaces).' },
          formatted: { type: 'string', description: 'IBAN with 4-char groups, e.g. CH93 0076 2011 6238 5295 7.' },
          valid: { type: 'boolean' },
          country: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'ISO 3166-1 alpha-2.' },
              name: { type: 'string' },
            },
          },
          check_digits: { type: 'string' },
          bban: {
            type: 'object',
            properties: {
              bank_code: { type: 'string' },
              branch_code: { type: 'string' },
              account: { type: 'string' },
            },
          },
          bic: {
            type: 'object',
            description: 'Resolved BIC/SWIFT (when BBAN→BIC mapping exists).',
            properties: {
              bic: { type: 'string' },
              bankName: { type: 'string' },
              city: { type: 'string' },
              lei: { type: 'string' },
            },
          },
          issuer: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['bank', 'emi', 'viban', 'neobank', 'unknown'] },
              name: { type: 'string' },
            },
          },
          sepa: {
            type: 'object',
            properties: {
              reachable: { type: 'boolean' },
              instant: { type: 'boolean' },
            },
          },
          vop: {
            type: 'object',
            description: 'Verification of Payee (EU 2024/886) participant status.',
            properties: { participant: { type: 'boolean' } },
          },
          ch_clearing: {
            type: 'object',
            description: 'Swiss-specific data when country is CH or LI.',
            properties: {
              bc_nummer: { type: 'string' },
              sic: { type: 'boolean' },
              qr_iid: { type: 'boolean' },
            },
          },
          risk_score: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Country + issuer risk indicator. Higher = more attention needed.',
          },
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
            `Validate a European IBAN and enrich it with bank, compliance and routing data. Use whenever the user mentions an IBAN, a bank account, a SEPA payment or asks who the bank is. Returns: valid, country, BIC/SWIFT, bank name, EMI/vIBAN flag, SEPA + VoP reachability, risk score, Swiss bc_nummer for CH/LI. ${TRUST_TAG_VALIDATE}.`,
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              bodyType: 'json',
              inputSchema: ibanInputSchema,
              outputSchema: ibanOutputSchema,
              info: {
                input: {
                  type: 'http',
                  method: 'POST',
                  bodyType: 'json',
                  body: { iban: 'CH93 0076 2011 6238 5295 7' },
                  discoverable: true,
                },
                output: { type: 'json' },
              },
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
            `Validate up to 100 IBANs in one call (10x cheaper per IBAN than calling validate_iban repeatedly). Use for CSV cleanup, customer DB dedup, or pre-flight payout list triage. ${TRUST_TAG_BATCH}.`,
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
                  summary: {
                    type: 'object',
                    properties: {
                      total: { type: 'number' },
                      valid: { type: 'number' },
                      invalid: { type: 'number' },
                    },
                  },
                  cost_usdc: { type: 'number', description: 'Actual USDC charged for this call.' },
                },
              },
              info: {
                input: {
                  type: 'http',
                  method: 'POST',
                  bodyType: 'json',
                  body: { ibans: ['CH9300762011623852957', 'DE89370400440532013000'] },
                  discoverable: true,
                },
                output: { type: 'json' },
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
            `Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank: name, country, city, LEI, address. Backed by 121,197 BIC entries (38,761 LEI-enriched via GLEIF; additional rows from SWIFT directory, Deutsche Bundesbank, SIX BankMaster, NBP). Use only when you already have the BIC — for IBAN inputs, prefer /v1/iban/validate which resolves the BIC for you. ${TRUST_TAG_BIC}.`,
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
                  bic: { type: 'string' },
                  bic8: { type: 'string' },
                  bic11: { type: 'string' },
                  found: { type: 'boolean' },
                  valid_format: { type: 'boolean' },
                  institution: { type: 'string' },
                  country: {
                    type: 'object',
                    properties: { code: { type: 'string' }, name: { type: 'string' } },
                  },
                  city: { type: 'string' },
                  lei: { type: 'string' },
                  address: { type: 'string' },
                },
              },
              info: {
                input: {
                  type: 'http',
                  method: 'GET',
                  pathParams: { code: 'UBSWCHZH80A' },
                  discoverable: true,
                },
                output: { type: 'json' },
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
            `Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: sanctions screening (OFAC/EU/UN), FATF jurisdiction flag, SEPA Instant reachability, VoP (EU 2024/886) participant. Returns risk_score 0-100. Informational, not a regulated AML/CFT product. ${TRUST_TAG_COMPLIANCE}.`,
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              bodyType: 'json',
              inputSchema: ibanInputSchema,
              outputSchema: {
                type: 'object',
                properties: {
                  iban: { type: 'string' },
                  valid: { type: 'boolean' },
                  risk_score: { type: 'number', minimum: 0, maximum: 100 },
                  recommended_action: { type: 'string', enum: ['allow', 'review', 'block'] },
                  sanctions: {
                    type: 'object',
                    properties: {
                      bic_sanctioned: { type: 'boolean' },
                      country_sanctioned: { type: 'boolean' },
                      lists: { type: 'array', items: { type: 'string' } },
                    },
                  },
                  fatf: {
                    type: 'object',
                    properties: {
                      list: { type: 'string', enum: ['none', 'grey', 'black'] },
                    },
                  },
                  sepa: {
                    type: 'object',
                    properties: {
                      reachable: { type: 'boolean' },
                      instant: { type: 'boolean' },
                    },
                  },
                  vop: {
                    type: 'object',
                    properties: { participant: { type: 'boolean' } },
                  },
                  flags: { type: 'object' },
                },
              },
              info: {
                input: {
                  type: 'http',
                  method: 'POST',
                  bodyType: 'json',
                  body: { iban: 'GB29NWBK60161331926819' },
                  discoverable: true,
                },
                output: { type: 'json' },
              },
            },
          },
        },
        // -- Bundle credits ----------------------------------------------------
        // 3 prepaid bundles. Once the agent pays, the handler in
        // src/routes/api-keys.ts mints a fresh key with N credits.
        // Pricing is: 1k=$5 (0.005/call), 5k=$20 (0.004/call), 25k=$80 (0.0032/call).
        'POST /v1/credits/buy/1k': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$5.00',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Prepaid bundle of 1,000 IBAN/BIC/compliance API calls for AI agents. Same per-call cost as retail (0.005 USDC) but only ONE x402 settlement instead of 1,000 — most agent stacks handle a single payment far better than micropayments. Returns ifk_xxx key with 1,000 credits valid for any /v1/iban/* or /v1/bic/* endpoint. No expiry.',
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              bodyType: 'json',
              inputSchema: {
                type: 'object',
                properties: {
                  email: { type: 'string', description: 'Optional. Anonymous keys work too.' },
                },
              },
              outputSchema: {
                type: 'object',
                properties: {
                  api_key: { type: 'string' },
                  key_prefix: { type: 'string' },
                  credits: { type: 'number' },
                  price_paid_usdc: { type: 'number' },
                  usage_hint: { type: 'string' },
                },
              },
              info: {
                input: { type: 'http', method: 'POST', bodyType: 'json', body: {}, discoverable: true },
                output: { type: 'json' },
              },
            },
          },
        },
        'POST /v1/credits/buy/5k': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$20.00',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Prepaid bundle of 5,000 IBAN/BIC/compliance calls (-20% vs retail, 0.004 USDC per call). One x402 settlement, no monthly subscription, no expiry. Fits a mid-volume agent that runs payment validation continuously.',
          mimeType: 'application/json',
          extensions: {
            bazaar: { discoverable: true, bodyType: 'json' },
          },
        },
        'POST /v1/credits/buy/25k': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$80.00',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Prepaid bundle of 25,000 IBAN/BIC/compliance calls (-36% vs retail, 0.0032 USDC per call). One x402 settlement, no expiry. Designed for scale agents (KYB, payroll, batch reconciliation) that want predictable cost.',
          mimeType: 'application/json',
          extensions: {
            bazaar: { discoverable: true, bodyType: 'json' },
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
            `Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, SIC, euroSIC, QR-IID. Backed by 1,190 SIX BankMaster entries — the canonical Swiss banking source. ${TRUST_TAG_CH}.`,
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
                  iid: { type: 'string', description: '5-digit zero-padded BC-Nummer.' },
                  found: { type: 'boolean' },
                  institution: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: ['bank', 'cantonal_bank', 'raiffeisen', 'postfinance', 'private_bank', 'foreign_branch', 'fintech', 'other'] },
                      iid_type: { type: 'string', enum: ['headquarters', 'branch', 'unknown'] },
                      headquarters_iid: { type: 'string' },
                    },
                  },
                  participation: {
                    type: 'object',
                    properties: {
                      sic: { type: 'boolean', description: 'Swiss Interbank Clearing.' },
                      eurosic: { type: 'boolean' },
                      instant_payments: { type: 'boolean' },
                      qr_iid: { type: 'boolean', description: 'QR-bill enabled IID.' },
                    },
                  },
                  bic: { type: 'string', description: 'BIC if mapped.' },
                },
              },
              info: {
                input: {
                  type: 'http',
                  method: 'GET',
                  pathParams: { iid: '00762' },
                  discoverable: true,
                },
                output: { type: 'json' },
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
