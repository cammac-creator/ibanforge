import { Hono } from 'hono';

const openapi = new Hono();

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'IBANforge API',
    version: '1.1.0',
    description:
      'IBAN validation & BIC/SWIFT lookup API with x402 micropayments and MCP integration',
    contact: {
      url: 'https://ibanforge.com',
    },
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
        security: [{ x402Payment: [] }],
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
          'Validates a list of IBANs and returns results for each. Costs $0.002 USDC per IBAN (e.g. 10 IBANs = $0.020, 100 IBANs = $0.200).',
        tags: ['IBAN'],
        security: [{ x402Payment: [] }],
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
        security: [{ x402Payment: [] }],
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
          'Validates an IBAN and returns everything from /v1/iban/validate PLUS a full compliance layer: sanctions screening (OFAC/EU/UN), FATF status, SEPA Instant reachability, VoP participant check, and a composite risk score (0-100). Costs $0.02 USDC via x402.',
        tags: ['Compliance'],
        security: [{ x402Payment: [] }],
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
    '/v1/keys/generate': {
      post: {
        operationId: 'generateApiKey',
        summary: 'Generate a free API key',
        description: 'Generates a free API key with 200 requests/month quota. One key per email per day.',
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
        description: 'Returns detailed API usage statistics broken down by operation type.',
        tags: ['Free'],
        responses: {
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
        description: 'Returns per-day statistics for the requested period.',
        tags: ['Free'],
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
            },
            required: ['type', 'name'],
          },
          risk_indicators: {
            type: 'object',
            description:
              'AML/CFT risk indicators derived from the IBAN structure, issuer type, and country. Designed for compliance pre-screening and fraud prevention workflows. Only present when the IBAN is valid.',
            properties: {
              issuer_type: {
                type: 'string',
                enum: ['bank', 'digital_bank', 'emi', 'payment_institution'],
                description: 'Type of the issuing institution (mirrors issuer.type for convenience)',
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
                description: 'Whether the IBAN can receive SEPA Credit Transfers',
              },
              vop_coverage: {
                type: 'boolean',
                description:
                  'Whether the institution is covered by Verification of Payee, reducing payee impersonation risk',
              },
            },
            required: ['issuer_type', 'country_risk', 'test_bic', 'sepa_reachable', 'vop_coverage'],
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
              matched_lists: { type: 'array', items: { type: 'string' }, example: ['OFAC_SDN', 'EU_SANCTIONS'] },
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
          risk_score: { type: 'integer', minimum: 0, maximum: 100, description: 'Composite risk score (0 = no risk, 100 = critical)' },
          risk_level: { type: 'string', enum: ['low', 'medium', 'elevated', 'high', 'critical'] },
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
              type: { type: 'string', enum: ['bank', 'raiffeisen', 'cantonal_bank', 'private_bank', 'foreign_bank', 'securities_dealer', 'finance_company', 'postfinance', 'snb', 'other'] },
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
          version: { type: 'string', example: '1.0.0' },
          uptime_seconds: { type: 'number' },
          bic_database_entries: { type: 'integer', description: 'Number of BIC entries in the database', example: 121197 },
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
          total_revenue_usdc: { type: 'number' },
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
    { name: 'Free', description: 'Free endpoints — no payment required' },
  ],
};

openapi.get('/openapi.json', (c) => {
  return c.json(spec);
});

export { openapi };
