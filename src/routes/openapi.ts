import { Hono } from 'hono';

const openapi = new Hono();

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'IBANforge API',
    version: '1.0.0',
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
          'Validates a list of IBANs and returns results for each. Costs 0.020 USDC via x402.',
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
      HealthResponse: {
        type: 'object',
        required: ['status', 'version', 'uptime_seconds', 'stats'],
        properties: {
          status: { type: 'string', enum: ['ok'] },
          version: { type: 'string', example: '1.0.0' },
          uptime_seconds: { type: 'number' },
          stats: {
            type: 'object',
            required: ['total_operations', 'iban_validations', 'bic_lookups', 'success_rate'],
            properties: {
              total_operations: { type: 'integer' },
              iban_validations: { type: 'integer' },
              bic_lookups: { type: 'integer' },
              success_rate: { type: 'number' },
            },
          },
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
    { name: 'Free', description: 'Free endpoints — no payment required' },
  ],
};

openapi.get('/openapi.json', (c) => {
  return c.json(spec);
});

export { openapi };
