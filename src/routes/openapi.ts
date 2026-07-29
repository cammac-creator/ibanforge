import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { getEntryCount } from '../lib/bic-lookup.js';
import { BANK_CODE_CHECK_SCHEMA } from '../lib/bank-code-schema.js';

const openapi = new Hono();

// Version is read from package.json so the spec can never drift from the
// deployed server again (the spec is fetched ~20k times/month by machines
// that code against it — it must tell the truth).
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

// Built lazily on first request (needs a DB read for live counts), then memoized.
const buildSpec = () => ({
  openapi: '3.1.0',
  info: {
    title: 'IBANforge API',
    version: PKG_VERSION,
    // This string is the first thing every agent reads about the product, on
    // the surface machines fetch ~20k times/month. Kept in sync with the
    // positioning already served by llms.txt and the MCP descriptors — a
    // generic "IBAN + BIC API" line commoditises the two differentiators
    // (Swiss SIX clearing depth, sanctions screening) for free.
    description:
      'Pre-payout screening for AI agents — vet a counterparty IBAN before you send funds. ' +
      'IBAN validation, BIC/SWIFT lookup, Swiss clearing (BC-Nummer / QR-IID / SIX BankMaster — ' +
      'full payment-rail participation, the deepest Swiss clearing data in any public API), ' +
      'EMI/vIBAN classification, SEPA Instant + VoP reachability, and sanctions + risk scoring. ' +
      'Three ways to pay, no dead-ends: a free API key (200 req/month), prepaid credit packs ' +
      '(card or USDC), or pay-per-call via x402 micropayments (USDC on Base L2, no signup).',
    contact: {
      url: 'https://ibanforge.com',
    },
  },
  externalDocs: {
    description: 'Agent-oriented overview (llms.txt) with copy-paste examples',
    url: 'https://api.ibanforge.com/llms.txt',
  },
  servers: [
    { url: 'https://api.ibanforge.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  paths: {
    '/v1/iban/validate': {
      post: {
        operationId: 'validateIBAN',
        summary: 'Validate a single IBAN',
        description:
          'Validates an IBAN and returns parsed components including country, check digits, BBAN, and optional BIC lookup. Costs 0.005 USDC via x402.',
        tags: ['IBAN'],
        security: [{ x402Payment: [] }, { apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['iban'],
                properties: {
                  iban: {
                    type: 'string',
                    description: 'IBAN to validate (spaces allowed, will be normalized)',
                    example: 'GB29NWBK60161331926819',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Validation result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IBANValidationResult' },
              },
            },
          },
          '402': { description: 'Payment required (x402)' },
          '400': { description: 'Missing or malformed request body' },
        },
      },
    },
    '/v1/iban/batch': {
      post: {
        operationId: 'batchValidateIBAN',
        summary: 'Validate up to 100 IBANs in one request',
        description:
          'Validates a list of IBANs and returns results for each. Costs $0.002 USDC per IBAN via x402 (e.g. 10 IBANs = $0.020, 100 IBANs = $0.200). On API keys, a batch debits 1 request/credit per IBAN — free tier and prepaid packs alike.',
        tags: ['IBAN'],
        security: [{ x402Payment: [] }, { apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ibans'],
                properties: {
                  ibans: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 100,
                    description: 'List of IBANs to validate',
                    example: ['GB29NWBK60161331926819', 'DE89370400440532013000'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Batch validation results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/IBANValidationResult' },
                    },
                    count: { type: 'integer', description: 'Total IBANs processed' },
                    valid_count: { type: 'integer', description: 'Number of valid IBANs' },
                    cost_usdc: { type: 'number', description: 'Total cost in USDC' },
                  },
                  required: ['results', 'count', 'valid_count', 'cost_usdc'],
                },
              },
            },
          },
          '402': { description: 'Payment required (x402)' },
          '400': { description: 'Missing or malformed request body' },
        },
      },
    },
    '/v1/bic/{code}': {
      get: {
        operationId: 'lookupBIC',
        summary: 'Lookup a BIC/SWIFT code',
        description:
          'Returns institution details for a BIC/SWIFT code (8 or 11 characters). Costs 0.003 USDC via x402.',
        tags: ['BIC'],
        security: [{ x402Payment: [] }, { apiKey: [] }],
        parameters: [
          {
            name: 'code',
            in: 'path',
            required: true,
            description: 'BIC/SWIFT code (8 or 11 characters)',
            schema: {
              type: 'string',
              minLength: 8,
              maxLength: 11,
              example: 'UBSWCHZH',
            },
          },
        ],
        responses: {
          '200': {
            description: 'BIC lookup result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BICLookupResult' },
              },
            },
          },
          '402': { description: 'Payment required (x402)' },
          '400': { description: 'Invalid BIC format' },
        },
      },
    },
    '/v1/iban/compliance': {
      post: {
        operationId: 'complianceCheck',
        summary: 'Full IBAN compliance check',
        description:
          'Validates an IBAN and returns everything from /v1/iban/validate PLUS a full compliance layer: sanctions screening (OFAC), FATF status, SEPA Instant reachability, VoP participant check, and a composite risk score (0-100). Costs $0.02 USDC via x402.',
        tags: ['Compliance'],
        security: [{ x402Payment: [] }, { apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['iban'],
                properties: {
                  iban: {
                    type: 'string',
                    description: 'IBAN to check',
                    example: 'DE89370400440532013000',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Compliance check result (includes full IBAN validation + compliance layer)',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/IBANValidationResult' },
                    {
                      type: 'object',
                      properties: {
                        compliance: { $ref: '#/components/schemas/ComplianceResult' },
                      },
                    },
                  ],
                },
              },
            },
          },
          '402': { description: 'Payment required (x402) — $0.02 USDC' },
          '400': { description: 'Missing or malformed request body' },
        },
      },
    },
    '/v1/ch/clearing/{iid}': {
      get: {
        operationId: 'lookupChClearing',
        summary: 'Swiss BC-Nummer / IID clearing lookup',
        description:
          'Returns institution details, payment service participation (SIC, euroSIC, Instant Payments CHF), and QR-IID allocation for a Swiss BC-Nummer (IID). Costs 0.003 USDC via x402.',
        tags: ['Swiss Clearing'],
        security: [{ x402Payment: [] }, { apiKey: [] }],
        parameters: [
          {
            name: 'iid',
            in: 'path',
            required: true,
            description: 'Swiss BC-Nummer / IID (1-5 digits, zero-padded to 5)',
            schema: {
              type: 'string',
              pattern: '^\\d{1,5}$',
              example: '230',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Clearing lookup result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChClearingResult' },
              },
            },
          },
          '402': { description: 'Payment required (x402)' },
          '400': { description: 'Invalid IID format' },
        },
      },
    },
    '/v1/iban/format': {
      get: {
        operationId: 'formatCheckIBAN',
        summary: 'Free IBAN format check (mod-97 + structure)',
        description:
          'FREE pure-format IBAN check: ISO 13616 mod-97 checksum, country-specific length, and BBAN parsing. No payment, no API key, no quota (global rate limit only). Does NOT touch the BIC, SEPA, VoP, sanctions, or Swiss clearing databases — use POST /v1/iban/validate ($0.005) when you need the full enrichment. Ideal for pre-filtering malformed IBANs before paying for validation.',
        tags: ['Free'],
        parameters: [
          {
            name: 'iban',
            in: 'query',
            required: true,
            description: 'IBAN to check (spaces allowed, will be normalized)',
            schema: {
              type: 'string',
              minLength: 15,
              maxLength: 34,
              example: 'CH1000230000000012345',
            },
          },
        ],
        responses: {
          '200': {
            description:
              'Format check result. valid=true includes parsed components; valid=false includes error + error_detail. Both include an upgrade_to_full_validation hint.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IBANFormatResult' },
              },
            },
          },
          '400': { description: 'Missing ?iban= query parameter, or IBAN shorter than 15 / longer than 34 characters' },
        },
      },
    },
    '/v1/iban/structure': {
      get: {
        operationId: 'listIBANStructures',
        summary: 'List all supported IBAN countries (free)',
        description:
          'FREE metadata endpoint: lists every supported IBAN country with its IBAN length, SEPA membership, and whether a BBAN structure breakdown and example IBAN are available. Use GET /v1/iban/structure/{country} for the full per-country template.',
        tags: ['Free'],
        responses: {
          '200': {
            description: 'List of supported countries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['total', 'countries'],
                  properties: {
                    total: { type: 'integer', description: 'Number of supported IBAN countries' },
                    countries: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          code: { type: 'string', example: 'CH' },
                          name: { type: 'string', example: 'Switzerland' },
                          iban_length: { type: 'integer', example: 21 },
                          sepa_member: { type: 'boolean' },
                          has_bban_structure: { type: 'boolean' },
                          has_example: { type: 'boolean' },
                        },
                      },
                    },
                    endpoint_per_country: { type: 'string', example: 'GET /v1/iban/structure/:country' },
                    cost_usdc: { type: 'number', example: 0 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/iban/structure/{country}': {
      get: {
        operationId: 'getIBANStructure',
        summary: 'IBAN structure template for a country (free)',
        description:
          'FREE metadata endpoint: returns the IBAN structural template for a country — total IBAN length, BBAN field positions (bank code / branch code / account number, 0-indexed within the BBAN), SEPA membership + schemes + VoP obligation, and a canonical example IBAN to copy-paste. Use it when an agent needs to know the IBAN format for a country before crafting a validation call.',
        tags: ['Free'],
        parameters: [
          {
            name: 'country',
            in: 'path',
            required: true,
            description: 'ISO 3166-1 alpha-2 country code (case-insensitive)',
            schema: { type: 'string', pattern: '^[A-Za-z]{2}$', example: 'CH' },
          },
        ],
        responses: {
          '200': {
            description: 'IBAN structure template',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['country', 'iban_length', 'bban_length', 'sepa', 'cost_usdc'],
                  properties: {
                    country: {
                      type: 'object',
                      properties: {
                        code: { type: 'string', example: 'CH' },
                        name: { type: 'string', example: 'Switzerland' },
                      },
                    },
                    iban_length: { type: 'integer', example: 21 },
                    bban_length: { type: 'integer', example: 17 },
                    bban: {
                      type: 'object',
                      nullable: true,
                      description: 'BBAN field positions, 0-indexed within the BBAN. null when no structure is declared for the country. charset uses SWIFT registry notation (n=digits, a=uppercase letters, c=alphanumeric, e.g. "5!n").',
                      properties: {
                        bank_code: {
                          type: 'object',
                          properties: { start: { type: 'integer' }, length: { type: 'integer' }, charset: { type: 'string', nullable: true } },
                        },
                        branch_code: {
                          type: 'object',
                          properties: { start: { type: 'integer' }, length: { type: 'integer' }, charset: { type: 'string', nullable: true } },
                        },
                        account_number: {
                          type: 'object',
                          properties: { start: { type: 'integer' }, length: { type: 'integer' }, charset: { type: 'string', nullable: true } },
                        },
                      },
                    },
                    bban_pattern: {
                      type: 'string',
                      nullable: true,
                      description: 'Full BBAN pattern in SWIFT IBAN Registry notation (e.g. "5!n12!c") — what /v1/iban/validate enforces structurally on top of length + mod-97.',
                      example: '5!n12!c',
                    },
                    sepa: {
                      type: 'object',
                      properties: {
                        member: { type: 'boolean' },
                        schemes: { type: 'array', items: { type: 'string', enum: ['SCT', 'SDD', 'SCT_INST'] } },
                        vop_required: { type: 'boolean' },
                      },
                    },
                    example_iban: { type: 'string', nullable: true, example: 'CH9300762011623852957' },
                    notes: { type: 'string' },
                    upgrade_hint: { type: 'string' },
                    cost_usdc: { type: 'number', example: 0 },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid country code (must be 2 letters), or literal {country} placeholder sent unsubstituted' },
          '404': { description: 'Country not covered — see GET /v1/iban/structure for the full list' },
        },
      },
    },
    '/v1/keys/generate': {
      post: {
        operationId: 'generateApiKey',
        summary: 'Generate a free API key',
        description: 'Generates a free API key with 200 requests/month quota (batch validation counts 1 request per IBAN). One key per email per day.',
        tags: ['API Keys'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email', description: 'Email address for key registration' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'API key generated (shown only once)' },
          '429': { description: 'Rate limited — one key per email per day' },
          '400': { description: 'Invalid email' },
        },
      },
    },
    '/v1/keys/usage': {
      get: {
        operationId: 'getApiKeyUsage',
        summary: 'Check API key usage',
        description: 'Returns current month usage and remaining quota for the provided API key.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        responses: {
          '200': { description: 'Usage statistics for the current month' },
          '401': { description: 'Missing or invalid API key' },
        },
      },
    },
    '/v1/credits/bundles': {
      get: {
        operationId: 'listCreditBundles',
        summary: 'List prepaid credit bundles (free)',
        description:
          'Lists the available prepaid credit bundles with prices. Buy a bundle once via x402 (POST /v1/credits/buy/{bundle}) and receive an API key preloaded with N credits (1 credit = 1 validation/lookup; batch validation debits 1 credit per IBAN) — credits never expire. Card checkout is also available at https://ibanforge.com/pricing.',
        tags: ['Credits'],
        responses: {
          '200': {
            description: 'Available bundles',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['bundles'],
                  properties: {
                    bundles: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          slug: { type: 'string', enum: ['1k', '5k', '25k'] },
                          credits: { type: 'integer', example: 1000 },
                          price_usdc: { type: 'number', example: 5 },
                          price_per_call_usdc: { type: 'number', example: 0.005 },
                          buy_endpoint: { type: 'string', example: 'POST /v1/credits/buy/1k' },
                        },
                      },
                    },
                    payment_method: { type: 'string', example: 'x402 USDC on Base mainnet' },
                    documentation: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/credits/buy/{bundle}': {
      post: {
        operationId: 'buyCreditBundle',
        summary: 'Buy a prepaid credit bundle (x402, USDC)',
        description:
          'Pay once via x402 (USDC on Base) and receive a fresh API key preloaded with the bundle credits. Bundles: 1k = $5, 5k = $20, 25k = $80. Credits never expire. Optionally pass {"email": "..."} in the body to attach the key to an email — anonymous keys are fully functional too. Check the balance with GET /v1/credits/balance.',
        tags: ['Credits'],
        security: [{ x402Payment: [] }],
        parameters: [
          {
            name: 'bundle',
            in: 'path',
            required: true,
            description: 'Bundle slug',
            schema: { type: 'string', enum: ['1k', '5k', '25k'], example: '1k' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', description: 'Optional — attach the key to an email address' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Credit key minted (shown only once — save it)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['api_key', 'credits', 'bundle'],
                  properties: {
                    api_key: { type: 'string', description: 'Full API key — shown only once' },
                    key_prefix: { type: 'string' },
                    credits: { type: 'integer', example: 1000 },
                    bundle: { type: 'string', example: '1k' },
                    price_paid_usdc: { type: 'number', example: 5 },
                    price_per_call_usdc: { type: 'number', example: 0.005 },
                    usage_hint: { type: 'string' },
                    balance_endpoint: { type: 'string', example: 'GET /v1/credits/balance' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '402': { description: 'Payment required (x402) — bundle price in USDC' },
          '404': { description: 'Unknown bundle slug — choose 1k, 5k or 25k' },
        },
      },
    },
    '/v1/demo': {
      get: {
        operationId: 'getDemo',
        summary: 'Free demo results',
        description: 'Returns example IBAN and BIC validation results. No payment required.',
        tags: ['Free'],
        responses: {
          '200': {
            description: 'Demo results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    iban_examples: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/IBANValidationResult' },
                    },
                    bic_examples: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          label: { type: 'string' },
                          bic: { type: 'string' },
                          endpoint: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check',
        description: 'Returns API health status, uptime, and basic statistics.',
        tags: ['Free'],
        responses: {
          '200': {
            description: 'Health status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
        },
      },
    },
    '/stats': {
      get: {
        operationId: 'getStats',
        summary: 'Detailed statistics',
        description:
          'Returns detailed API usage statistics broken down by operation type. ' +
          'Requires authentication — these figures include revenue and are not public.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        responses: {
          '403': { description: 'Authentication required — send Authorization: Bearer ifk_...' },
          '200': {
            description: 'Statistics overview',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatsOverview' },
              },
            },
          },
        },
      },
    },
    '/stats/history': {
      get: {
        operationId: 'getStatsHistory',
        summary: 'Historical statistics',
        description:
          'Returns per-day statistics for the requested period. ' +
          'Requires authentication — these figures include revenue and are not public.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: 'period',
            in: 'query',
            required: false,
            description: 'Number of days to retrieve (1–90, default 7)',
            schema: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
          },
        ],
        responses: {
          '403': { description: 'Authentication required — send Authorization: Bearer ifk_...' },
          '200': {
            description: 'Historical stats array',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string', format: 'date' },
                      total: { type: 'integer' },
                      revenue: { type: 'number' },
                    },
                    required: ['date', 'total', 'revenue'],
                  },
                },
              },
            },
          },
        },
      },
    },
    '/mcp': {
      post: {
        operationId: 'mcpStreamableHttp',
        summary: 'MCP endpoint for AI agents (Streamable HTTP)',
        description:
          'Model Context Protocol endpoint — Streamable HTTP transport, JSON-RPC 2.0 over POST. Exposes the same capabilities as this REST API as 5 MCP tools: validate_iban, batch_validate_iban, lookup_bic, check_compliance, lookup_ch_clearing. Flow: POST an `initialize` request, then `tools/list` and `tools/call` (include the returned Mcp-Session-Id header on follow-up calls). Also available as a stdio server via `npx -y ibanforge-mcp`. This path speaks MCP, not the REST conventions documented elsewhere in this spec.',
        tags: ['MCP'],
        externalDocs: {
          description: 'MCP setup guide (Claude Desktop, Cursor, HTTP transport)',
          url: 'https://ibanforge.com/docs/mcp',
        },
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'JSON-RPC 2.0 request (initialize, tools/list, tools/call, ...) per the MCP specification',
                required: ['jsonrpc', 'method'],
                properties: {
                  jsonrpc: { type: 'string', enum: ['2.0'] },
                  id: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
                  method: { type: 'string', example: 'tools/list' },
                  params: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'JSON-RPC 2.0 response (application/json or text/event-stream, depending on Accept header)' },
          '400': { description: 'Malformed JSON-RPC request' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      x402Payment: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Payment',
        description: 'x402 USDC micropayment token',
      },
      apiKey: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key (Bearer ifk_xxx) — 200 free requests/month, or custom quota for paid keys',
      },
    },
    schemas: {
      IBANValidationResult: {
        type: 'object',
        required: ['iban', 'valid', 'cost_usdc'],
        properties: {
          iban: { type: 'string', description: 'The IBAN as provided (normalized)' },
          valid: { type: 'boolean' },
          country: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'GB' },
              name: { type: 'string', example: 'United Kingdom' },
            },
            required: ['code', 'name'],
          },
          check_digits: { type: 'string', example: '29' },
          bban: {
            type: 'object',
            properties: {
              bank_code: { type: 'string' },
              branch_code: { type: 'string' },
              account_number: { type: 'string' },
            },
            required: ['bank_code', 'account_number'],
          },
          bic: {
            type: 'object',
            nullable: true,
            properties: {
              code: { type: 'string', example: 'NWBKGB2L' },
              bank_name: { type: 'string', nullable: true },
              city: { type: 'string', nullable: true },
            },
            required: ['code', 'bank_name', 'city'],
          },
          formatted: { type: 'string', description: 'IBAN formatted in groups of 4', example: 'GB29 NWBK 6016 1331 9268 19' },
          // Shipped by the endpoint since 1.x but absent from this schema until
          // 2026-07-25: agents reading the spec could not see that validating a
          // CH/LI IBAN already returns the Swiss rail data, and paid a second
          // call to /v1/ch/clearing/{iid} for something they had.
          clearing: {
            type: 'object',
            nullable: true,
            description:
              'Swiss clearing enrichment from the SIX BankMaster directory — present for CH and LI IBANs only, ' +
              'and included at no extra cost in the 0.005 USDC validation. Full rail participation, not just a name lookup.',
            properties: {
              iid: { type: 'string', description: 'Zero-padded 5-digit IID / BC-Nummer', example: '00230' },
              name: { type: 'string', example: 'UBS Switzerland AG' },
              type: {
                type: 'string',
                enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'],
              },
              town: { type: 'string', example: 'Zürich' },
              sic: { type: 'boolean', description: 'SIC (Swiss Interbank Clearing) participation' },
              instant_payments_chf: { type: 'boolean', description: 'Instant Payments CHF participation' },
              eurosic: { type: 'boolean', description: 'euroSIC participation' },
              qr_iid: {
                type: 'string',
                nullable: true,
                description: 'QR-IID allocation for QR-bill reference, null when the institution has none',
              },
            },
          },
          error: {
            type: 'string',
            enum: ['invalid_format', 'unsupported_country', 'wrong_length', 'checksum_failed'],
          },
          error_detail: { type: 'string' },
          cost_usdc: { type: 'number', example: 0.005 },
          processing_ms: { type: 'number' },
          sepa: {
            type: 'object',
            description:
              'SEPA compliance details. Only present when the IBAN is valid and the country participates in SEPA.',
            properties: {
              member: {
                type: 'boolean',
                description: 'Whether the IBAN country is a SEPA member',
              },
              schemes: {
                type: 'array',
                description:
                  'SEPA schemes the institution supports (SCT = Credit Transfer, SDD = Direct Debit, SCT_INST = Instant Credit Transfer)',
                items: {
                  type: 'string',
                  enum: ['SCT', 'SDD', 'SCT_INST'],
                },
              },
              vop_required: {
                type: 'boolean',
                description:
                  'Whether Verification of Payee (VoP) is required under EU Instant Payments Regulation for this institution',
              },
            },
            required: ['member', 'schemes', 'vop_required'],
          },
          issuer: {
            type: 'object',
            description:
              'Issuer classification for the institution behind the IBAN. Useful for vIBAN detection and KYC enrichment. Only present when the IBAN is valid and the BIC is resolved.',
            properties: {
              type: {
                type: 'string',
                enum: ['bank', 'digital_bank', 'emi', 'payment_institution'],
                description:
                  'Type of financial institution (bank = traditional bank, digital_bank = neobank/challenger, emi = Electronic Money Institution, payment_institution = licensed PI)',
              },
              name: {
                type: 'string',
                description: 'Name of the issuing institution',
              },
              classification: {
                type: 'string',
                enum: ['curated', 'default'],
                description:
                  "Whether the type was established or assumed. curated = the BIC8 is in the issuer set, so this is an identification. default = nothing is on file and 'bank' is the fallback, which covers 47,356 of 48,386 distinct BIC8 (97.9%, measured 29/07/2026). When sizing exposure to virtual IBANs, count only curated.",
              },
            },
            required: ['type', 'name', 'classification'],
          },
          risk_indicators: {
            type: 'object',
            description:
              'AML/CFT risk indicators derived from the IBAN structure, issuer type, and country. Designed for compliance pre-screening and fraud prevention workflows. Only present when the IBAN is valid.',
            properties: {
              issuer_type: {
                type: 'string',
                nullable: true,
                enum: ['bank', 'digital_bank', 'emi', 'payment_institution', null],
                description:
                  'Type of the issuing institution (mirrors issuer.type for convenience). Null when the bank code resolved no institution — it used to default to "bank", which typed an institution that had not been found. Read bank_code_check to tell an unresolved code from a genuine bank.',
              },
              country_risk: {
                type: 'string',
                enum: ['standard', 'elevated', 'high'],
                description:
                  'Country-level risk classification based on FATF grey/black lists and EU high-risk third countries',
              },
              test_bic: {
                type: 'boolean',
                description: 'Whether the resolved BIC is a test/sandbox code (position 8 = 0)',
              },
              sepa_reachable: {
                type: 'boolean',
                description:
                  'Whether SEPA Credit Transfers reach this COUNTRY. Derived from the country, not from the account: it stays true on an IBAN whose bank code resolved nothing. See sepa_reachable_scope.',
              },
              sepa_reachable_scope: {
                type: 'string',
                enum: ['country'],
                description:
                  'The scope sepa_reachable holds at. Present so the field cannot be read as an account-level assertion.',
              },
              vop_coverage: {
                type: 'boolean',
                description:
                  'Whether the institution is covered by Verification of Payee, reducing payee impersonation risk',
              },
            },
            required: ['issuer_type', 'country_risk', 'test_bic', 'sepa_reachable', 'sepa_reachable_scope', 'vop_coverage'],
          },
          bank_code_check: BANK_CODE_CHECK_SCHEMA,
        },
      },
      IBANFormatResult: {
        type: 'object',
        required: ['iban', 'valid', 'upgrade_to_full_validation'],
        properties: {
          iban: { type: 'string', description: 'The IBAN as provided (normalized)', example: 'CH1000230000000012345' },
          valid: { type: 'boolean', description: 'mod-97 checksum + country structure result' },
          formatted: { type: 'string', description: 'IBAN formatted in groups of 4 (only when valid)', example: 'CH10 0023 0000 0000 1234 5' },
          country: {
            type: 'object',
            description: 'Only present when valid',
            properties: {
              code: { type: 'string', example: 'CH' },
              name: { type: 'string', example: 'Switzerland' },
            },
          },
          check_digits: { type: 'string', example: '10' },
          bban: {
            type: 'object',
            description: 'Parsed BBAN components (only when valid and the country declares a structure)',
            properties: {
              bank_code: { type: 'string', example: '00230' },
              branch_code: { type: 'string' },
              account_number: { type: 'string', example: '000000012345' },
            },
          },
          error: {
            type: 'string',
            description: 'Only when valid=false',
            enum: ['invalid_format', 'unsupported_country', 'wrong_length', 'checksum_failed'],
          },
          error_detail: { type: 'string', description: 'Only when valid=false' },
          upgrade_to_full_validation: {
            type: 'string',
            description: 'Pointer to POST /v1/iban/validate for BIC, SEPA, VoP, sanctions and Swiss clearing enrichment',
          },
        },
      },
      BICLookupResult: {
        type: 'object',
        required: ['bic', 'bic8', 'bic11', 'found', 'valid_format', 'institution', 'country', 'city', 'branch_code', 'branch_info', 'lei', 'lei_status', 'is_test_bic', 'source', 'cost_usdc'],
        properties: {
          bic: { type: 'string', example: 'UBSWCHZH' },
          bic8: { type: 'string', example: 'UBSWCHZH' },
          bic11: { type: 'string', example: 'UBSWCHZHXXX' },
          found: { type: 'boolean' },
          valid_format: { type: 'boolean' },
          institution: { type: 'string', nullable: true, example: 'UBS AG' },
          country: {
            type: 'object',
            required: ['code', 'name'],
            properties: {
              code: { type: 'string', example: 'CH' },
              name: { type: 'string', example: 'Switzerland' },
            },
          },
          city: { type: 'string', nullable: true },
          address: {
            type: 'object',
            description: 'Registered head-office address (present when available — GLEIF or directory sourced)',
            properties: {
              type: { type: 'string', example: 'registered' },
              street: { type: 'string', nullable: true, example: 'Bahnhofstrasse 45' },
              post_code: { type: 'string', nullable: true, example: '8001' },
              region: { type: 'string', nullable: true, example: 'CH-ZH' },
              city: { type: 'string', nullable: true, example: 'Zurich' },
              country: { type: 'string', example: 'CH' },
              romanized: { type: 'string', nullable: true },
              romanization: { type: 'string', example: 'original_latin' },
              source: { type: 'string', example: 'GLEIF' },
              language: { type: 'string', example: 'en' },
              as_of: { type: 'string', format: 'date' },
            },
          },
          address_available: { type: 'boolean' },
          branch_code: { type: 'string', example: 'XXX' },
          branch_info: { type: 'string', nullable: true },
          lei: { type: 'string', nullable: true },
          lei_status: { type: 'string', nullable: true },
          is_test_bic: { type: 'boolean' },
          source: { type: 'string', nullable: true },
          note: { type: 'string' },
          cost_usdc: { type: 'number', example: 0.003 },
          processing_ms: { type: 'number' },
        },
      },
      ComplianceResult: {
        type: 'object',
        required: ['sanctions', 'reachability', 'vop', 'risk_score', 'risk_level', 'flags'],
        properties: {
          sanctions: {
            type: 'object',
            properties: {
              country_sanctioned: { type: 'boolean' },
              bank_sanctioned: { type: 'boolean' },
              matched_lists: { type: 'array', items: { type: 'string' }, example: ['OFAC'] },
              fatf_status: { type: 'string', enum: ['member', 'grey_list', 'black_list', 'non_member'] },
            },
          },
          reachability: {
            type: 'object',
            properties: {
              sepa_instant: { type: 'boolean', description: 'Whether the bank supports SEPA Instant Credit Transfer' },
              sct: { type: 'boolean', description: 'SEPA Credit Transfer participant' },
              sdd: { type: 'boolean', description: 'SEPA Direct Debit participant' },
            },
          },
          vop: {
            type: 'object',
            properties: {
              participant: { type: 'boolean', description: 'Whether the bank participates in Verification of Payee' },
              status: { type: 'string', enum: ['active', 'pending', 'inactive', 'not_found'] },
            },
          },
          risk_score: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            nullable: true,
            description:
              'Composite risk score (0 = no risk, 100 = critical). null when the IBAN did not validate: there was nothing to score.',
          },
          risk_level: {
            type: 'string',
            enum: ['low', 'medium', 'elevated', 'high', 'critical', 'unassessable'],
            description:
              'unassessable means the IBAN itself failed validation, so no screening was possible. It is the absence of a verdict, never a favourable one: do not treat it as low.',
          },
          flags: { type: 'array', items: { type: 'string' }, description: 'List of specific risk flags detected', example: ['fatf_grey_list', 'emi_issuer', 'no_vop'] },
        },
      },
      ChClearingResult: {
        type: 'object',
        required: ['iid', 'found'],
        properties: {
          iid: { type: 'string', example: '00230', description: 'Zero-padded 5-digit IID' },
          found: { type: 'boolean' },
          institution: {
            type: 'object',
            properties: {
              name: { type: 'string', example: 'UBS Switzerland AG' },
              type: { type: 'string', enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'] },
              iid_type: { type: 'string', enum: ['headquarters', 'branch', 'other'] },
              headquarters_iid: { type: 'string', nullable: true },
            },
          },
          address: {
            type: 'object',
            properties: {
              street: { type: 'string', nullable: true },
              building_number: { type: 'string', nullable: true },
              post_code: { type: 'string', nullable: true },
              town: { type: 'string', nullable: true },
              country: { type: 'string', example: 'CH' },
            },
          },
          bic: { type: 'string', nullable: true, example: 'UBSWCHZH80A' },
          payment_services: {
            type: 'object',
            properties: {
              sic: { type: 'boolean', description: 'SIC (Swiss Interbank Clearing) participation' },
              rtgs_chf: { type: 'boolean', description: 'Real-Time Gross Settlement CHF' },
              instant_payments_chf: { type: 'boolean', description: 'Instant Payments CHF' },
              eurosic: { type: 'boolean', description: 'euroSIC participation' },
              lsv_bdd_chf: { type: 'boolean', description: 'LSV/BDD CHF direct debit' },
              lsv_bdd_eur: { type: 'boolean', description: 'LSV/BDD EUR direct debit' },
            },
          },
          sic_iid: { type: 'string', nullable: true },
          qr_iid: { type: 'string', nullable: true, description: 'QR-IID for QR-bill payments' },
          valid_on: { type: 'string', format: 'date' },
          cost_usdc: { type: 'number', example: 0.003 },
          processing_ms: { type: 'number' },
        },
      },
      HealthResponse: {
        type: 'object',
        required: ['status', 'version', 'uptime_seconds', 'bic_database_entries'],
        properties: {
          status: { type: 'string', enum: ['ok'] },
          version: { type: 'string', example: PKG_VERSION },
          uptime_seconds: { type: 'number' },
          bic_database_entries: {
            type: 'integer',
            description: 'Number of BIC entries currently loaded (refreshed monthly from public sources)',
            example: getEntryCount(),
          },
          bic_data_last_updated: { type: 'string', description: 'Last update timestamp of BIC data' },
        },
      },
      StatsOverview: {
        type: 'object',
        required: ['total_operations', 'by_type', 'total_revenue_usdc', 'top_countries', 'last_7_days'],
        properties: {
          total_operations: { type: 'integer' },
          by_type: {
            type: 'object',
            properties: {
              iban_validate: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  valid_count: { type: 'integer' },
                  success_rate: { type: 'number' },
                },
              },
              iban_batch: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  valid_count: { type: 'integer' },
                  success_rate: { type: 'number' },
                },
              },
              bic_lookup: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  found_count: { type: 'integer' },
                  hit_rate: { type: 'number' },
                },
              },
            },
          },
          total_revenue_usdc: {
            type: 'number',
            deprecated: true,
            description: 'Deprecated alias for total_revenue_attempted_usdc. Use /admin/revenue for on-chain settled USDC.',
          },
          total_revenue_attempted_usdc: {
            type: 'number',
            description: 'SUM of revenue_usdc in daily_stats. Reflects x402 calls that PASSED the payment middleware verify step, NOT a confirmation of on-chain settlement. For settled USDC see /admin/revenue.',
          },
          revenue_note: { type: 'string' },
          top_countries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                country: { type: 'string' },
                count: { type: 'integer' },
              },
            },
          },
          last_7_days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', format: 'date' },
                total: { type: 'integer' },
                revenue: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
  tags: [
    { name: 'IBAN', description: 'IBAN validation endpoints (paid via x402)' },
    { name: 'BIC', description: 'BIC/SWIFT lookup endpoints (paid via x402)' },
    { name: 'Compliance', description: 'Compliance check endpoint — IBAN validation + sanctions + SEPA + VoP + risk score (paid via x402)' },
    { name: 'Swiss Clearing', description: 'Swiss BC-Nummer / IID clearing lookup (paid via x402)' },
    { name: 'API Keys', description: 'API key management — generate free keys and check usage' },
    { name: 'Credits', description: 'Prepaid credit bundles — pay once in USDC (x402), get an API key with N credits; batch validation debits 1 credit per IBAN' },
    { name: 'MCP', description: 'Model Context Protocol endpoint for AI agents (Streamable HTTP)' },
    { name: 'Free', description: 'Free endpoints — no payment required' },
  ],
});

let specCache: ReturnType<typeof buildSpec> | null = null;

openapi.get('/openapi.json', (c) => {
  if (!specCache) specCache = buildSpec();
  return c.json(specCache);
});

export { openapi };
