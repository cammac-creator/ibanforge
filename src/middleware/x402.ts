import type { MiddlewareHandler } from 'hono';
import { createRequire } from 'node:module';
import type { HonoEnv } from '../types.js';
import { datasetFacts } from '../lib/dataset-facts.js';
import { BANK_CODE_CHECK_SCHEMA as BANK_CODE_CHECK_OPENAPI , NEXT_STEPS_SCHEMA as NEXT_STEPS_OPENAPI } from '../lib/bank-code-schema.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

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

/**
 * Routes that sell something rather than serve something. They must always go
 * through the payment gate: an allowance covers consumption, never purchase.
 * Kept as a function (not a bare regex) so the intent survives future routes.
 */
export function isSellingRoute(method: string, path: string): boolean {
  return method === 'POST' && /^\/v1\/credits\/buy\/[^/]+\/?$/.test(path);
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

    // Skip x402 if authenticated via API key (free tier inside the quota) —
    // EXCEPT on the routes that SELL credits. An API key is a way to spend an
    // allowance, never a way to acquire one: without this guard a free key
    // (200 req/month) buys 200 bundles, i.e. up to $16,000 of credits for one
    // unit of quota, and each minted key can start over.
    // Security audit 2026-07-25, finding 1.
    if (c.get('apiKeyAuthenticated') && !isSellingRoute(c.req.method, new URL(c.req.url).pathname)) {
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
      // Trust signals appended to descriptions: production status, latency,
      // dataset size, last update. Agents that filter on description quality (Bazaar
      // semantic search, agentic.market) reward this.
      //
      // Two things were wrong here until 28/07/2026 and both are fixed by
      // construction rather than by editing numbers again:
      //
      //  1. The dataset figures were string literals, and they had drifted. The
      //     Swiss table holds 1,165 rows; three of these tags said "~1,200" and
      //     one said "1190+". They now come from datasetFacts(), rounded DOWN,
      //     so they stay true across a monthly refresh. CLAUDE.md forbids
      //     hardcoding them in a served surface; this is that rule applied.
      //  2. The latency claim said "p99 <50ms" with nothing saying what was
      //     measured. Server-side processing is 0.55 ms median (max 1.26 over 20
      //     production calls), but a client in Zurich observes p50 132 ms once
      //     the network is counted: the number was true of the handler and
      //     unobservable for any buyer. It now names the boundary it measures.
      //     One uniform bound replaces five per-endpoint ones that were never
      //     grounded in anything — a local benchmark puts the heaviest path
      //     (validate + enrich + compliance) at p99 0.184 ms.
      const V = `v${pkg.version}`;
      const F = datasetFacts();
      const PERF = 'server processing <5ms (network excluded — measure your own round trip on GET /ping)';
      const TRUST_TAG_VALIDATE = `Production · ${PERF} · ${F.claim.bic} BICs (${F.claim.lei} LEI via GLEIF) + ${F.claim.chClearing} SIX · ${V}`;
      const TRUST_TAG_BIC = `Production · ${PERF} · ${F.claim.bic} BICs (${F.claim.lei} LEI-enriched via GLEIF, refreshed monthly) · ${V}`;
      const TRUST_TAG_CH = `Production · ${PERF} · ${F.claim.chClearing} SIX BankMaster entries, refreshed monthly · ${V}`;
      const TRUST_TAG_COMPLIANCE = `Production · ${PERF} · OFAC + FATF + SEPA + VoP · weekly refresh · ${V}`;
      const TRUST_TAG_BATCH = `Production · ${PERF} for a 100-IBAN batch · ${F.claim.bic} BICs · ${V}`;

      const ibanInputSchema = {
        type: 'object',
        properties: {
          iban: {
            type: 'string',
            description: 'IBAN to validate. Spaces and lowercase accepted. Example: CH1000230000000012345',
            minLength: 15,
            maxLength: 34,
          },
        },
        required: ['iban'],
      };
      // Full-fidelity output schema: every field a real response carries.
      // Mirrors the real /v1/iban/validate response (verified against prod)
      // so agents can predict the response 1:1.
      const ibanOutputSchema = {
        type: 'object',
        properties: {
          iban: { type: 'string', description: 'Normalized IBAN (uppercase, no spaces).' },
          formatted: { type: 'string', description: 'IBAN with 4-char groups, e.g. CH10 0023 0000 0000 1234 5.' },
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
              account_number: { type: 'string' },
            },
          },
          bic: {
            type: 'object',
            description: 'Resolved BIC/SWIFT (when BBAN→BIC mapping exists). Null when unresolved.',
            properties: {
              code: { type: 'string' },
              bank_name: { type: 'string' },
              city: { type: 'string' },
            },
          },
          issuer: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['bank', 'digital_bank', 'emi', 'payment_institution'] },
              name: { type: 'string' },
              classification: {
                type: 'string',
                enum: ['curated', 'default'],
                description: "curated = identified from the issuer set; default = 'bank' fallback, 97.9% of BIC8.",
              },
            },
          },
          sepa: {
            type: 'object',
            properties: {
              member: { type: 'boolean' },
              schemes: { type: 'array', items: { type: 'string', enum: ['SCT', 'SDD', 'SCT_INST'] } },
              vop_required: {
                type: 'boolean',
                description: 'Verification of Payee (EU 2024/886) obligation for this country.',
              },
            },
          },
          risk_indicators: {
            type: 'object',
            description: 'AML/CFT pre-screening indicators.',
            properties: {
              issuer_type: {
                type: 'string',
                nullable: true,
                enum: ['bank', 'digital_bank', 'emi', 'payment_institution', null],
                description: 'Null when no institution resolved. It no longer defaults to "bank" for an institution we did not find.',
              },
              country_risk: { type: 'string', enum: ['standard', 'elevated', 'high'] },
              test_bic: { type: 'boolean' },
              sepa_reachable: { type: 'boolean' },
              sepa_reachable_scope: {
                type: 'string',
                enum: ['country'],
                description: 'Scope sepa_reachable holds at. Derived from the country, never from the account.',
              },
              vop_coverage: { type: 'boolean' },
            },
          },
          bank_code_check: BANK_CODE_CHECK_OPENAPI,
          next_steps: NEXT_STEPS_OPENAPI,
          clearing: {
            type: 'object',
            description: 'Swiss clearing data when country is CH or LI and the IID is in the SIX BankMaster. Null otherwise.',
            properties: {
              iid: { type: 'string', description: '5-digit zero-padded BC-Nummer.' },
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'],
              },
              town: { type: 'string' },
              sic: { type: 'boolean' },
              instant_payments_chf: { type: 'boolean' },
              eurosic: { type: 'boolean' },
              qr_iid: { type: 'string', description: 'QR-IID allocation, null when none.' },
            },
          },
          cost_usdc: { type: 'number' },
          processing_ms: { type: 'number' },
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
                  body: { iban: 'CH10 0023 0000 0000 1234 5' },
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
            // Dynamic price: $0.002 per IBAN, so a 1-IBAN call settles $0.002
            // (not the old flat $0.20 = 100× overcharge). x402 awaits this
            // function with the request context; we read the batch size from
            // the parsed body. Fail-safe: if the body can't be read, fall back
            // to the $0.20 cap rather than under-charging.
            price: async (context: { adapter?: { getBody?: () => unknown } }): Promise<string> => {
              try {
                const body = (await context.adapter?.getBody?.()) as Record<string, unknown> | undefined;
                const arr = (body?.ibans ?? body?.iban_list ?? body?.list) as unknown;
                const n = Array.isArray(arr) ? arr.length : 0;
                // Clamp to [1, 100]; 0/unknown → cap so we never under-charge.
                const count = n >= 1 && n <= 100 ? n : 100;
                return '$' + (count * 0.002).toFixed(3);
              } catch {
                return '$0.20';
              }
            },
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            `Validate up to 100 IBANs in one call at $0.002 per IBAN (2.5x cheaper per IBAN than single calls at $0.005, and one settlement instead of N). Use for CSV cleanup, customer DB dedup, or pre-flight payout list triage. ${TRUST_TAG_BATCH}.`,
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
                  count: { type: 'number', description: 'Total IBANs processed.' },
                  valid_count: { type: 'number', description: 'Number of valid IBANs.' },
                  cost_usdc: { type: 'number', description: 'Actual USDC charged for this call.' },
                },
              },
              info: {
                input: {
                  type: 'http',
                  method: 'POST',
                  bodyType: 'json',
                  body: { ibans: ['CH1000230000000012345', 'DE89370400440532013000'] },
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
            `Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank: name, country, city, LEI, and registered head-office address (where available). Backed by ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF; additional rows from SWIFT directory, Deutsche Bundesbank, SIX BankMaster, NBP, EBA Step2 SCT), refreshed monthly. Use only when you already have the BIC — for IBAN inputs, prefer /v1/iban/validate which resolves the BIC for you. ${TRUST_TAG_BIC}.`,
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
                  address: {
                    type: 'object',
                    description:
                      'Registered/head-office address (GLEIF, CC0). Entity-level, not per-branch; null for branch or non-LEI BICs. Non-Latin addresses (Chinese, Arabic, Greek…) carry an official Latin reading in `romanized` only when GLEIF provides one; otherwise `romanization` is "unavailable" and we never fabricate a transliteration.',
                    properties: {
                      street: { type: 'string' },
                      post_code: { type: 'string' },
                      region: { type: 'string' },
                      city: { type: 'string' },
                      country: { type: 'string' },
                      romanized: {
                        type: 'string',
                        description:
                          "Latin reading: GLEIF's official English address for non-Latin entities, or the address itself when already Latin. Null when no official Latin form exists (never fabricated).",
                      },
                      romanization: {
                        type: 'string',
                        enum: ['original_latin', 'gleif_english', 'unavailable'],
                        description:
                          'Provenance of the Latin reading: original_latin | gleif_english | unavailable (non-Latin entity with no official Latin form — not transliterated).',
                      },
                      source: { type: 'string' },
                    },
                  },
                  address_available: { type: 'boolean' },
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
            `Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: sanctions screening (OFAC), FATF jurisdiction flag, SEPA Instant reachability, VoP (EU 2024/886) participant. Returns risk_score 0-100. Informational, not a regulated AML/CFT product. ${TRUST_TAG_COMPLIANCE}.`,
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              bodyType: 'json',
              inputSchema: ibanInputSchema,
              // Real response = full /v1/iban/validate enrichment + a nested
              // `compliance` object + `meta` provenance block (verified against prod).
              outputSchema: {
                type: 'object',
                properties: {
                  iban: { type: 'string' },
                  valid: { type: 'boolean' },
                  country: {
                    type: 'object',
                    properties: { code: { type: 'string' }, name: { type: 'string' } },
                  },
                  bic: {
                    type: 'object',
                    properties: { code: { type: 'string' }, bank_name: { type: 'string' }, city: { type: 'string' } },
                  },
                  compliance: {
                    type: 'object',
                    properties: {
                      sanctions: {
                        type: 'object',
                        properties: {
                          country_sanctioned: { type: 'boolean' },
                          bank_sanctioned: { type: 'boolean' },
                          matched_lists: { type: 'array', items: { type: 'string' } },
                          fatf_status: { type: 'string', enum: ['member', 'grey_list', 'black_list', 'non_member'] },
                        },
                      },
                      reachability: {
                        type: 'object',
                        properties: {
                          sepa_instant: { type: 'boolean' },
                          sct: { type: 'boolean' },
                          sdd: { type: 'boolean' },
                        },
                      },
                      vop: {
                        type: 'object',
                        properties: {
                          participant: { type: 'boolean' },
                          status: { type: 'string', enum: ['active', 'pending', 'inactive', 'not_found'] },
                        },
                      },
                      risk_score: {
                        type: ['number', 'null'],
                        minimum: 0,
                        maximum: 100,
                        description: 'null when the IBAN did not validate: there was nothing to score.',
                      },
                      risk_level: {
                        type: 'string',
                        enum: ['low', 'medium', 'elevated', 'high', 'critical', 'unassessable'],
                        description:
                          'unassessable = the IBAN failed validation, no screening was possible. Never treat it as low.',
                      },
                      flags: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                          'Risk flags, e.g. sanctioned_country, sanctioned_bank, fatf_grey_list, emi_issuer, test_bic, no_sepa_instant, no_vop.',
                      },
                    },
                  },
                  meta: {
                    type: 'object',
                    properties: {
                      scope: { type: 'string' },
                      disclaimer: { type: 'string' },
                      sanctions_as_of: { type: 'string' },
                      fatf_as_of: { type: 'string' },
                      country_risk_as_of: {
                        type: 'string',
                        description:
                          'Year-month the editorial country-risk axis was last reviewed. risk_indicators.country_risk is a SEPARATE axis layered on top of fatf_status, not a restatement of it: the two can disagree on a country by design.',
                      },
                      country_risk_scope: { type: 'string' },
                      sources: { type: 'string' },
                    },
                  },
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
        // Pricing is: 1k=$5 (0.005/credit), 5k=$20 (0.004/credit), 25k=$80 (0.0032/credit).
        'POST /v1/credits/buy/1k': {
          accepts: {
            scheme: 'exact',
            network: 'eip155:8453' as const,
            price: '$5.00',
            payTo: walletAddress,
            maxTimeoutSeconds: 60,
          },
          description:
            'Prepaid bundle of 1,000 credits for AI agents — 1 credit = 1 validation/lookup, batch validation debits 1 credit per IBAN. Same per-credit cost as retail (0.005 USDC) but only ONE x402 settlement instead of 1,000 — most agent stacks handle a single payment far better than micropayments. Returns ifk_xxx key with 1,000 credits valid for any /v1/iban/* or /v1/bic/* endpoint. No expiry.',
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
            'Prepaid bundle of 5,000 credits (-20% vs retail, 0.004 USDC per credit; batch validation debits 1 credit per IBAN). One x402 settlement, no monthly subscription, no expiry. Fits a mid-volume agent that runs payment validation continuously.',
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
            'Prepaid bundle of 25,000 credits (-36% vs retail, 0.0032 USDC per credit; batch validation debits 1 credit per IBAN). One x402 settlement, no expiry. Designed for scale agents (KYB, payroll, batch reconciliation) that want predictable cost.',
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
            `Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, address, BIC, the full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) and the QR-IID allocation. Backed by ${F.claim.chClearing} SIX BankMaster entries (refreshed monthly) — the canonical Swiss banking source. ${TRUST_TAG_CH}.`,
          mimeType: 'application/json',
          extensions: {
            bazaar: {
              discoverable: true,
              pathParams: {
                iid: { type: 'string', description: 'Swiss IID / BC-Nummer (1-5 digits).' },
              },
              // Mirrors the real /v1/ch/clearing/:iid response (verified against prod).
              outputSchema: {
                type: 'object',
                properties: {
                  iid: { type: 'string', description: '5-digit zero-padded BC-Nummer.' },
                  found: { type: 'boolean' },
                  institution: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'] },
                      iid_type: { type: 'string', enum: ['headquarters', 'branch', 'other'] },
                      headquarters_iid: { type: 'string' },
                    },
                  },
                  address: {
                    type: 'object',
                    properties: {
                      street: { type: 'string' },
                      building_number: { type: 'string' },
                      post_code: { type: 'string' },
                      town: { type: 'string' },
                      country: { type: 'string' },
                    },
                  },
                  bic: { type: 'string', description: 'BIC if mapped.' },
                  payment_services: {
                    type: 'object',
                    properties: {
                      sic: { type: 'boolean', description: 'Swiss Interbank Clearing.' },
                      rtgs_chf: { type: 'boolean' },
                      instant_payments_chf: { type: 'boolean' },
                      eurosic: { type: 'boolean' },
                      lsv_bdd_chf: { type: 'boolean' },
                      lsv_bdd_eur: { type: 'boolean' },
                    },
                  },
                  sic_iid: { type: 'string' },
                  qr_iid: { type: 'string', description: 'QR-IID allocation, null when none.' },
                  valid_on: { type: 'string' },
                },
              },
              info: {
                input: {
                  type: 'http',
                  method: 'GET',
                  pathParams: { iid: '00230' },
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
