import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { getEntryCount } from '../lib/bic-lookup.js';
import { BANK_CODE_CHECK_SCHEMA , NEXT_STEPS_SCHEMA, OFFICIAL_IDENTITY_SCHEMA, POSTAL_ADDRESS_SCHEMA } from '../lib/bank-code-schema.js';
import { ADDRESS_SCHEMES, CBPR_NOTE } from '../lib/address-conformity.js';

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
      'Pre-payout screening for AI agents — check the bank behind a counterparty IBAN before you send funds. ' +
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
          'Validates an IBAN and returns parsed components including country, check digits, BBAN, and optional BIC lookup. Costs 0.005 USDC via x402. Pass an optional `reference` to add `reference_check`: the reference checksum verdict AND whether the reference may legally travel with this account under the Swiss Payment Standards (QRR requires a QR-IBAN, ISO 11649/SCOR forbids one).',
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
                  reference: {
                    type: 'string',
                    description:
                      'Optional structured payment reference. When present the response carries a `reference_check` block with the checksum verdict and, for CH/LI accounts, the QRR/SCOR pairing verdict. Free-standing checksum validation is available at no cost on GET /v1/reference/validate.',
                    example: '210000000003139471430009017',
                  },
                  reference_type: {
                    type: 'string',
                    description:
                      'Optional scheme hint for an ambiguous reference. `scor` and `rf` both mean ISO 11649.',
                    enum: ['rf', 'scor', 'qrr', 'ogm', 'vcs', 'viitenumero', 'kid', 'ocr'],
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
          'Validates an IBAN and returns everything from /v1/iban/validate PLUS a full compliance layer: sanctions screening (OFAC, EU, UN), FATF status, SEPA Instant reachability, VoP participant check, and a composite risk score (0-100). Costs $0.02 USDC via x402.',
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
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
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
    '/v1/address/check': {
      post: {
        operationId: 'checkPostalAddress',
        summary: 'Free ISO 20022 postal-address conformity check',
        description:
          'FREE rule check on a postal address YOU have already structured, for the November 2026 structured-address deadlines (SPS 2026 in force 14 Nov 2026, last SIC release accepting unstructured addresses 20 Nov 2026, Fedwire production 16 Nov 2026, T2 R2026.NOV). Pure rule evaluation — it reads no database, which is why it is free. Every finding names the document the rule comes from, with its date. ' +
          `Schemes: ${ADDRESS_SCHEMES.join(', ')}. ` +
          CBPR_NOTE +
          ' It does NOT parse or normalise a free-text address into a structured one — that needs national postal reference data we do not hold.',
        tags: ['Free'],
        // Explicitly no authentication, same statement as /v1/iban/format:
        // 'free', not 'the author forgot to say'.
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['scheme', 'address'],
                properties: {
                  scheme: {
                    type: 'string',
                    enum: [...ADDRESS_SCHEMES],
                    description:
                      "The payment scheme whose rules to apply. 'hvps+' is accepted as a spelling of 'hvps_plus'. 'cbpr+' is refused with an explanation rather than answered with a guess.",
                    example: 'sps',
                  },
                  address: {
                    type: 'object',
                    additionalProperties: false,
                    description:
                      'The ISO 20022 PostalAddress elements you intend to send, in ISO tag vocabulary. An unknown property is rejected rather than ignored, so a caller who writes `town` instead of `twn_nm` is told rather than handed a green verdict on an address nobody looked at.',
                    properties: {
                      twn_nm: { type: 'string', example: 'Zurich' },
                      ctry: { type: 'string', example: 'CH' },
                      pst_cd: { type: 'string', example: '8001' },
                      strt_nm: { type: 'string', example: 'Bahnhofstrasse' },
                      bldg_nb: { type: 'string', example: '45' },
                      adr_tp: { type: 'string', description: 'Address Type. Forbidden by SPS ("N — Must not be sent").' },
                      adr_line: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Conformity verdict. One finding per rule evaluated, passing or failing, so a caller can see what was checked and not only what broke.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['scheme', 'conforms', 'findings', 'note'],
                  properties: {
                    scheme: { type: 'string', enum: [...ADDRESS_SCHEMES] },
                    conforms: {
                      type: 'boolean',
                      description:
                        'True when no finding failed. Rules that did not apply do not count against it.',
                    },
                    findings: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['rule', 'verdict', 'detail', 'source'],
                        properties: {
                          rule: { type: 'string', example: 'adr_line_no_repeat' },
                          verdict: {
                            type: 'string',
                            enum: ['pass', 'fail', 'not_applicable'],
                            description:
                              'not_applicable marks a rule whose precondition is not met — an AdrLine rule on an address with no AdrLine. It is a real answer, not a polite pass.',
                          },
                          detail: { type: 'string' },
                          source: {
                            type: 'string',
                            description: 'The document the rule comes from, with its date.',
                          },
                        },
                      },
                    },
                    note: { type: 'string', description: 'Why no cbpr+ scheme is offered. Served on every answer.' },
                  },
                },
              },
            },
          },
          '400': {
            description:
              "Malformed body, unknown address element, unknown scheme, or scheme 'cbpr+' — which is refused with the reason.",
          },
        },
      },
    },
    '/v1/reference/validate': {
      get: {
        operationId: 'validatePaymentReference',
        summary: 'Free structured payment reference check',
        description:
          'FREE checksum validation for structured payment references: RF Creditor Reference (ISO 11649, "SCOR" in Swiss Payment Standards, mod 97-10), Swiss QR reference ("QRR", 27 digits, modulo 10 recursive), Belgian OGM/VCS (12 digits, modulo 97 with a remainder of 0 written 97) and Finnish viitenumero (4-20 digits, weights 7-3-1 from the right). Norwegian KID and Swedish OCR are RECOGNISED but answer `valid: null` with `status: unverifiable_without_creditor_config` — their modulus type and length are configured per creditor account by the beneficiary bank, so no generic checker can judge them and answering `false` would reject valid references. Every answer that names a scheme carries the document publishing the rule and its date. For the PAIRING verdict — whether a reference may legally travel with a given IBAN — use POST /v1/iban/validate with a `reference` field.',
        tags: ['Free'],
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
        parameters: [
          {
            name: 'reference',
            in: 'query',
            required: true,
            description: 'Reference as printed. Spaces, slashes and the Belgian +++…+++ wrapper are stripped.',
            schema: { type: 'string', minLength: 4, maxLength: 64, example: 'RF18539007547034' },
          },
          {
            name: 'reference_type',
            in: 'query',
            required: false,
            description:
              'Optional scheme hint, used when the string alone is ambiguous — a bare 12-digit string is both a Belgian OGM and a legal Finnish length. If it contradicts the string, the answer judges as asked and says so in `note`.',
            schema: {
              type: 'string',
              enum: ['rf', 'scor', 'qrr', 'ogm', 'vcs', 'viitenumero', 'kid', 'ocr'],
            },
          },
        ],
        responses: {
          '200': {
            description:
              'Reference verdict. `valid` is true, false, or null when the scheme cannot be checked without the creditor bank configuration.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentReferenceResult' },
              },
            },
          },
          '400': { description: 'Missing ?reference= query parameter, or shorter than 4 / longer than 64 characters' },
        },
      },
      post: {
        operationId: 'validatePaymentReferencePost',
        summary: 'Free structured payment reference check (JSON body)',
        description:
          'Same contract as the GET, with the reference in a JSON body — convenient for references carrying characters awkward to url-encode.',
        tags: ['Free'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reference'],
                properties: {
                  reference: { type: 'string', minLength: 4, maxLength: 64, example: '+++010/8068/17183+++' },
                  reference_type: {
                    type: 'string',
                    enum: ['rf', 'scor', 'qrr', 'ogm', 'vcs', 'viitenumero', 'kid', 'ocr'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Reference verdict',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentReferenceResult' },
              },
            },
          },
          '400': { description: 'Missing reference, or malformed JSON body' },
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
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
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
          '429': { description: 'Rate limit exceeded. Honour the Retry-After header; see https://api.ibanforge.com/rate-limits.yml' },
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
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
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
                      type: ['object', 'null'],
                      description: 'BBAN field positions, 0-indexed within the BBAN. null when no structure is declared for the country. charset uses SWIFT registry notation (n=digits, a=uppercase letters, c=alphanumeric, e.g. "5!n").',
                      properties: {
                        bank_code: {
                          type: 'object',
                          properties: { start: { type: 'integer' }, length: { type: 'integer' }, charset: { type: ['string', 'null'] } },
                        },
                        branch_code: {
                          type: 'object',
                          properties: { start: { type: 'integer' }, length: { type: 'integer' }, charset: { type: ['string', 'null'] } },
                        },
                        account_number: {
                          type: 'object',
                          properties: { start: { type: 'integer' }, length: { type: 'integer' }, charset: { type: ['string', 'null'] } },
                        },
                      },
                    },
                    bban_pattern: {
                      type: ['string', 'null'],
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
                    example_iban: { type: ['string', 'null'], example: 'CH9300762011623852957' },
                    example_iban_note: {
                      type: ['string', 'null'],
                      description:
                        "Says what example_iban is: an illustration from the SWIFT IBAN Registry whose bank code is not guaranteed to be allocated. 36 of the 89 come back bank_code_check.status not_in_register, which is the example being fictional rather than a gap in our data. LV uses the literal 'BANK', RO uses 'AAAA', and the Swiss one is proven unallocated by the SIX BankMaster.",
                    },
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
        // The mailbox-verification step (in force since 2026-08-18) is described
        // here because this document is how machines learn the endpoint. It used
        // to exist only in the HTTP MCP `instructions` field, so a client
        // generated from this spec could not send the code and did not expect the
        // 403: it looped or gave up on a step the product answers in one retry.
        description:
          'Generates a free API key with 200 requests/month quota (batch validation counts 1 request per IBAN). ' +
          'The first key issued to a network is instant. A repeat creation from the same network within 7 days ' +
          'must prove the mailbox is readable: that call answers 403 "verification_required" and mails a 6-digit ' +
          'code to the address supplied, and the SAME request is then repeated with a "code" field within 15 ' +
          'minutes. At most 3 keys per network per day. A caller that cannot receive mail does not need this ' +
          'endpoint at all: prepaid credits (POST /v1/credits/buy/1k) and x402 pay-per-call need no key.',
        tags: ['API Keys'],
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                // "code" is deliberately NOT in `required`: the first key of a
                // network never needs one, and every client generated against
                // this spec before 2026-08 posts {email} alone. Requiring it
                // would be a breaking change wearing an additive costume.
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email', description: 'Email address for key registration' },
                  code: {
                    type: 'string',
                    pattern: '^[0-9]{6}$',
                    example: '123456',
                    description:
                      'Optional. The 6-digit code mailed after a 403 "verification_required". Repeat the same ' +
                      'request with it within 15 minutes; omit it to be mailed a fresh one. The challenge locks ' +
                      'after 5 wrong attempts.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'API key generated (shown only once)' },
          '400': {
            description:
              'Body rejected before any key was considered. "error" is "invalid_json", "invalid_email", or ' +
              '"disposable_email" (the free tier needs a real, non-disposable mailbox).',
          },
          '403': {
            description:
              'The mailbox must be verified. "verification_required": a 6-digit code was just mailed, repeat this ' +
              'exact request with "code" within 15 minutes. "verification_failed": the code was wrong or expired, ' +
              'and "reason" says which ("wrong_code", "expired", "no_challenge", "too_many_attempts"); request ' +
              'again without "code" to be sent a fresh one.',
          },
          '429': {
            description:
              'Too many creations. "key_creation_limit": at most 3 free keys per network per day. ' +
              '"verification_rate_limited": too many codes were mailed to this address or from this network today. ' +
              '"rate_limited": one key per email per day. Existing keys keep working in every case.',
          },
          '503': {
            description:
              '"verification_unavailable": the verification mail could not be sent right now, so no key was ' +
              'issued and no code is pending. Retry in a few minutes.',
          },
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
    '/v1/keys/report': {
      get: {
        operationId: 'getApiKeyReport',
        summary: 'Read everything this key did',
        description:
          'Self-service report for the presented key: daily traffic, endpoints called, what failed with a plain-language cause and a suggested fix, and how many distinct networks the key was called from. Authentication is the key itself, and the report only ever covers that key. A human-readable version of the same data is at https://ibanforge.com/en/account. ' +
          'The footprint reports `unusual: null`, never false, for a key with no traffic: a key that has never been called has not passed a leak check, it has nothing to judge.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        parameters: [
          {
            name: 'days',
            in: 'query',
            required: false,
            description: 'Window in days, clamped to 1..365. Defaults to 30.',
            schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
          },
        ],
        responses: {
          '200': { description: 'Usage, traffic shape, failures with their cause, and network footprint' },
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
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
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
          '429': { description: 'Rate limit exceeded. Honour the Retry-After header; see https://api.ibanforge.com/rate-limits.yml' },
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
    '/v1/test-iban': {
      get: {
        operationId: 'getTestIban',
        summary: 'Generate test IBANs with REAL bank codes',
        description:
          'Free. Generates structurally valid test IBANs whose bank codes are drawn from the national registers we serve (CH, DE, AT, BE) — unlike the usual generators, whose checksum-valid IBANs carry arbitrary codes no register allocated. Account digits are random and belong to nobody. Each item ships with the proof: our own bank_code_check answer for that IBAN.',
        tags: ['Free'],
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
        parameters: [
          {
            name: 'country',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['CH', 'DE', 'AT', 'BE'] },
            description: 'Omit for a random supported country',
          },
          {
            name: 'count',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
          },
        ],
        responses: {
          '200': {
            description: 'Generated test IBANs, each with its register proof',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    test_ibans: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          iban: { type: 'string' },
                          formatted: { type: 'string' },
                          country: { type: 'string' },
                          proof: { type: 'object' },
                          note: { type: 'string' },
                        },
                      },
                    },
                    disclaimer: { type: 'string' },
                    cost_usdc: { type: 'number' },
                  },
                },
              },
            },
          },
          '400': { description: 'Unsupported country' },
        },
      },
    },
    '/v1/demo': {
      get: {
        operationId: 'getDemo',
        summary: 'Free demo results',
        description: 'Returns example IBAN and BIC validation results. No payment required.',
        tags: ['Free'],
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
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
          '500': { description: 'Internal error. Safe to retry: this endpoint is read-only and changes nothing.' },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check',
        description: 'Returns API health status, uptime, and basic statistics.',
        tags: ['Free'],
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
        responses: {
          '200': {
            description: 'Health status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
          '500': { description: 'Internal error. Safe to retry: this endpoint is read-only and changes nothing.' },
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
          'Model Context Protocol endpoint — Streamable HTTP transport, JSON-RPC 2.0 over POST. Exposes the same capabilities as this REST API as 7 MCP tools: validate_iban, batch_validate_iban, lookup_bic, check_compliance, lookup_ch_clearing, validate_payment_reference and check_postal_address (both free), plus send_feedback. Flow: POST an `initialize` request, then `tools/list` and `tools/call` (include the returned Mcp-Session-Id header on follow-up calls). Also available as a stdio server via `npx -y ibanforge-mcp`. This path speaks MCP, not the REST conventions documented elsewhere in this spec.',
        tags: ['MCP'],
        // Anonymous is a supported alternative here, not an oversight: the HTTP
        // MCP transport answers a daily free allowance with no credential.
        security: [{}, { apiKey: [] }],
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
        // A security scheme can only name one header, so it names the one we
        // announce. v1's X-Payment still settles and is documented below
        // rather than dropped, because clients written against it still work.
        name: 'PAYMENT-SIGNATURE',
        description:
          'x402 USDC micropayment signature (protocol v2). Clients holding v1 payment requirements may send the same signature as X-Payment; both are accepted.',
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
            type: ['object', 'null'],
            properties: {
              code: { type: 'string', example: 'NWBKGB2L' },
              bank_name: { type: ['string', 'null'] },
              city: {
                type: ['string', 'null'],
                description:
                  'Where the consulted register places THIS bank code. May differ from address.city, which is the legal seat — both true, different questions.',
              },
              source: { type: ['string', 'null'], description: 'Which dataset named this institution.' },
              as_of: { type: ['string', 'null'], description: 'Year-month that dataset was last refreshed.' },
              lei: {
                type: ['string', 'null'],
                example: '851WYGNLUQLFZBSYGB56',
                description:
                  'Legal Entity Identifier, read from the same directory row /v1/bic/:code serves. Null means GLEIF publishes no LEI for this BIC, never that the institution has none.',
              },
              lei_status: { type: ['string', 'null'], example: 'ACTIVE' },
              address: {
                type: ['object', 'null'],
                description:
                  'Registered / head-office address (GLEIF, CC0). Entity-level, not per-branch. Always dated by its own as_of, which is the entity last filing and is usually OLDER than the as_of above.',
                properties: {
                  type: { type: 'string', enum: ['registered'] },
                  street: { type: ['string', 'null'], example: 'Kaiserstraße 16' },
                  post_code: { type: ['string', 'null'], example: '60311' },
                  region: { type: ['string', 'null'], example: 'DE-HE' },
                  city: { type: ['string', 'null'], example: 'Frankfurt am Main' },
                  country: { type: 'string', example: 'DE' },
                  romanized: { type: ['string', 'null'] },
                  romanization: {
                    type: 'string',
                    enum: ['original_latin', 'gleif_english', 'unavailable'],
                    description:
                      'unavailable means the entity filed a non-Latin address and GLEIF ships no official Latin form. No transliteration is invented.',
                  },
                  source: { type: 'string', example: 'GLEIF' },
                  language: { type: ['string', 'null'], example: 'de' },
                  as_of: { type: ['string', 'null'], example: '2026-02-24' },
                },
              },
            },
            required: ['code', 'bank_name', 'city'],
          },
          formatted: { type: 'string', description: 'IBAN formatted in groups of 4', example: 'GB29 NWBK 6016 1331 9268 19' },
          // Shipped by the endpoint since 1.x but absent from this schema until
          // 2026-07-25: agents reading the spec could not see that validating a
          // CH/LI IBAN already returns the Swiss rail data, and paid a second
          // call to /v1/ch/clearing/{iid} for something they had.
          clearing: {
            type: ['object', 'null'],
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
                type: ['string', 'null'],
                description: 'QR-IID allocation for QR-bill reference, null when the institution has none',
              },
            },
          },
          error: {
            type: 'string',
            enum: ['invalid_format', 'unsupported_country', 'wrong_length', 'checksum_failed'],
          },
          error_detail: { type: 'string' },
          reference_check: {
            allOf: [{ $ref: '#/components/schemas/ReferenceCheckBlock' }],
            description: 'Present ONLY when the request carried a `reference` field.',
          },
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
              vop_participant: {
                type: ['boolean', 'null'],
                description:
                  'Bank-level VoP readiness: true when the resolved institution is listed as "ready" in the EPC Verification of Payee scheme register; false when it is not; null when no institution was resolved. Listing means the bank answers VoP requests — it does not run the name check for you.',
              },
            },
            required: ['member', 'schemes', 'vop_required'],
          },
          issuer: {
            type: 'object',
            description:
              'Issuer classification for the institution behind the IBAN. Useful for vIBAN detection and KYC enrichment. Present when the IBAN is valid and either the BIC resolved or an official register names the holder of the bank code (see psd_registration).',
            properties: {
              type: {
                type: ['string', 'null'],
                enum: ['bank', 'digital_bank', 'emi', 'payment_institution', null],
                description:
                  'Type of financial institution (bank = traditional bank, digital_bank = neobank/challenger, emi = Electronic Money Institution, payment_institution = licensed PI). Null when we hold no support for a type: falling back to bank would be an assertion, and a payee pre-flight must not be handed one.',
              },
              name: {
                type: 'string',
                description: 'Name of the institution holding this BIC',
              },
              classification: {
                type: 'string',
                enum: ['curated', 'register', 'default'],
                description:
                  "Whether the type was established or assumed. curated = the BIC8 is in the issuer set, so this is an identification. register = an official register names the holder of this bank code and says what it is; also an identification, and one that carries a date and an issuing authority in the psd_registration block beside it. It only ever replaces a default, never a curated verdict. default = nothing is on file and 'bank' is the fallback, which covers 42,195 of 43,199 distinct BIC8 (97.7%, recounted 29/07/2026; the count drifts at every monthly refresh). When sizing exposure to virtual IBANs, count curated and register, never default.",
              },
              iban_issuer: {
                type: 'string',
                enum: ['confirmed', 'not_listed'],
                description:
                  "Whether the country's own list of IBAN-issuing providers names the holder of this bank code. Present only where such a list exists, today NL. confirmed = the identifier belongs to a provider that issues IBANs. not_listed = it resolves to a BIC, but the holder is not among the known issuers, so the account may not exist: measured 29/07/2026, only 90 of our 815 Dutch codes are on that list and the rest resolve to corporate treasuries that hold a Dutch BIC for their own SWIFT traffic. NOT a denial, because the Dutch list is explicitly not exhaustive, which is also why NL keeps bank_code_check.authoritative false.",
              },
            },
            required: ['type', 'name', 'classification'],
          },
          psd_registration: {
            type: 'object',
            description:
              "The EBA's PSD2 register of payment and electronic money institutions naming the holder of this bank code. Joined on country + national reference code, and served ONLY for countries where that code was measured to be the one the IBAN actually carries — today Spain alone. The register carries no BIC and no LEI, and in 29 of its 30 countries it files authorisations under a company or tax number from an unrelated register (a Polish NIP, a French SIREN, a Dutch DNB reference), so joining those to a bank code would attach a real institution's authorisation to an unrelated bank. Absent on a miss: there is no negative form, because the register's own disclaimer states that an institution omitted from it is authorised all the same.",
            properties: {
              registered: {
                type: 'boolean',
                description: 'Always true. There is no negative form of this block.',
              },
              entity_type: {
                type: 'string',
                enum: ['payment_institution', 'emi', 'aisp', 'exempted_emi', 'exempted_payment_institution'],
                description:
                  "The register's own category. emi = electronic money institution, payment_institution = authorised PI, aisp = account information service provider (reads accounts, issues nothing), exempted_emi / exempted_payment_institution = small operators waived FROM authorisation, which is not a licence. Only emi and payment_institution move issuer.type.",
              },
              name: { type: 'string', description: 'Institution name as the register publishes it.' },
              country: { type: 'string', description: 'ISO country of residence, as the register publishes it.' },
              competent_authority: {
                type: 'string',
                description: "The national authority that filed the authorisation, e.g. 'ES_BE' for Banco de España.",
              },
              source: {
                type: 'string',
                description:
                  'Attribution required by the EBA legal notice ("Reproduction of all EBA material on this site is authorised, provided the source is acknowledged"). Always present.',
              },
              as_of: {
                type: 'string',
                description:
                  'Date of the golden copy this row came from (YYYY-MM-DD), read from the EBA manifest and never from a clock. Always present.',
              },
            },
            required: ['registered', 'entity_type', 'name', 'country', 'competent_authority', 'source', 'as_of'],
          },
          risk_indicators: {
            type: 'object',
            description:
              'AML/CFT risk indicators derived from the IBAN structure, issuer type, and country. Designed for compliance pre-screening and fraud prevention workflows. Only present when the IBAN is valid.',
            properties: {
              issuer_type: {
                type: ['string', 'null'],
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
          official_identity: OFFICIAL_IDENTITY_SCHEMA,
          modulus_check: {
            type: 'object',
            description:
              'UK modulus check on the sorting code and account number a GB IBAN carries — present for GB only, and included at no extra cost in the 0.005 USDC validation. ' +
              'A second checksum, independent of mod-97: the IBAN check digits prove the string was transcribed correctly, this proves the pair is one the owning institution could have issued. ' +
              'A GB IBAN can pass mod-97 and still name an account no bank could have opened, which is what this catches before a payout. ' +
              'passed false NEVER makes the IBAN invalid — read valid and modulus_check.passed as two separate facts. ' +
              'Checksum only: it does not say the account exists, name its holder, or resolve a bank from a sort code.',
            properties: {
              checked: {
                type: 'boolean',
                description:
                  'Whether the published table covers this sorting code. False means no check was possible, not a failed one — Vocalink instructs that such a pair be presumed valid.',
              },
              passed: {
                type: ['boolean', 'null'],
                description:
                  'True when the pair satisfies the checksum for that sorting code, false when it cannot be a real account, null when checked is false.',
              },
              source: { type: 'string', example: 'Vocalink modulus weight table (published for Pay.UK)' },
              table_fetched_on: {
                type: 'string',
                format: 'date',
                description:
                  'The day we fetched the reference table, so a stale server is visible. Not the day Vocalink published it, which is why it is not called as_of like the register dates elsewhere in this response.',
                example: '2026-08-14',
              },
            },
            required: ['checked', 'passed', 'source', 'table_fetched_on'],
          },
          next_steps: NEXT_STEPS_SCHEMA,
        },
      },
      PaymentReferenceResult: {
        type: 'object',
        required: ['reference', 'scheme', 'valid', 'status', 'source', 'note'],
        properties: {
          reference: {
            type: 'string',
            description: 'Normalized: uppercase, separators removed',
            example: 'RF18539007547034',
          },
          scheme: {
            type: 'string',
            nullable: true,
            enum: ['rf', 'qrr', 'ogm', 'viitenumero', 'kid', 'ocr'],
            description: 'Null when no supported scheme matches the string',
          },
          valid: {
            type: 'boolean',
            nullable: true,
            description:
              'null is a REAL answer, not a missing one: the scheme was recognised and cannot be checked without the creditor bank configuration (KID, OCR). Never present null to a user as invalid.',
          },
          status: {
            type: 'string',
            enum: ['checked', 'unverifiable_without_creditor_config', 'unrecognised'],
          },
          check_digit_expected: {
            type: 'string',
            description:
              'A STRING, so a two-digit value beginning with zero survives — an OGM remainder of 3 is "03", and a remainder of 0 is written "97".',
            example: '18',
          },
          also_valid_as: {
            type: 'object',
            description:
              'The second reading of an ambiguous string, with its own verdict. A bare 12-digit reference is both a Belgian OGM and a legal Finnish length.',
            properties: {
              scheme: { type: 'string', example: 'viitenumero' },
              valid: { type: 'boolean' },
              check_digit_expected: { type: 'string' },
            },
          },
          source: {
            type: 'string',
            nullable: true,
            description:
              'The document that publishes the rule. Null only when no scheme matched, so no rule was applied. Relay it: it is what makes the verdict auditable.',
          },
          as_of: {
            type: 'string',
            description: 'YYYY-MM of that document — the date it carries, never a future validity date',
            example: '2023-10',
          },
          note: { type: 'string', description: 'What was checked, and what was not' },
          pairing_verdict: {
            type: 'string',
            description: 'Pointer to POST /v1/iban/validate for the QRR/SCOR pairing verdict',
          },
        },
      },
      ReferenceCheckBlock: {
        type: 'object',
        description:
          'Served inside POST /v1/iban/validate when a `reference` was supplied. Carries TWO independent verdicts: `valid` (the reference checksum) and `pairing` (whether it may legally travel with this account). A reference can be arithmetically valid and still illegal on that IBAN, and the reverse. Each verdict names its own document.',
        required: ['reference', 'scheme', 'valid', 'status', 'source', 'pairing', 'note'],
        properties: {
          reference: { type: 'string', example: '210000000003139471430009017' },
          scheme: { type: 'string', nullable: true, enum: ['rf', 'qrr', 'ogm', 'viitenumero', 'kid', 'ocr'] },
          valid: { type: 'boolean', nullable: true },
          status: {
            type: 'string',
            enum: ['checked', 'unverifiable_without_creditor_config', 'unrecognised'],
          },
          check_digit_expected: { type: 'string' },
          also_valid_as: { type: 'object' },
          source: { type: 'string', nullable: true, description: 'Provenance of the CHECKSUM verdict' },
          as_of: { type: 'string', example: '2026-02' },
          pairing: {
            type: 'string',
            enum: ['ok', 'qrr_requires_qr_iban', 'scor_forbidden_with_qr_iban', 'not_applicable'],
            description:
              'Per the Swiss Implementation Guidelines a QRR reference may only be used with a QR-IBAN (institution identifier in the SIX range 30000-31999), and an ISO 11649 (SCOR) reference may not. `not_applicable` outside CH/LI, where there is no QR-IBAN to pair against — including for a valid RF reference, whose own checksum verdict is unaffected.',
          },
          pairing_source: {
            type: 'string',
            description: 'Provenance of the PAIRING verdict — a DIFFERENT document from `source`',
          },
          pairing_as_of: { type: 'string', example: '2026-02' },
          note: { type: 'string' },
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
          institution: { type: ['string', 'null'], example: 'UBS AG' },
          country: {
            type: 'object',
            required: ['code', 'name'],
            properties: {
              code: { type: 'string', example: 'CH' },
              name: { type: 'string', example: 'Switzerland' },
            },
          },
          city: { type: ['string', 'null'] },
          address: {
            type: 'object',
            description: 'Registered head-office address (present when available — GLEIF or directory sourced)',
            properties: {
              type: { type: 'string', example: 'registered' },
              street: { type: ['string', 'null'], example: 'Bahnhofstrasse 45' },
              post_code: { type: ['string', 'null'], example: '8001' },
              region: { type: ['string', 'null'], example: 'CH-ZH' },
              city: { type: ['string', 'null'], example: 'Zurich' },
              country: { type: 'string', example: 'CH' },
              romanized: { type: ['string', 'null'] },
              romanization: { type: 'string', example: 'original_latin' },
              source: { type: 'string', example: 'GLEIF' },
              language: { type: 'string', example: 'en' },
              as_of: { type: 'string', format: 'date' },
            },
          },
          address_available: { type: 'boolean' },
          postal_address: POSTAL_ADDRESS_SCHEMA,
          branch_code: { type: 'string', example: 'XXX' },
          branch_info: { type: ['string', 'null'] },
          lei: { type: ['string', 'null'] },
          lei_status: { type: ['string', 'null'] },
          is_test_bic: { type: 'boolean' },
          source: { type: ['string', 'null'] },
          official_identity: OFFICIAL_IDENTITY_SCHEMA,
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
              fatf_status: { type: 'string', enum: ['member', 'grey_list', 'black_list', 'suspended', 'non_member'] },
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
            type: ['integer', 'null'],
            minimum: 0,
            maximum: 100,
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
              headquarters_iid: { type: ['string', 'null'] },
            },
          },
          address: {
            type: 'object',
            properties: {
              street: { type: ['string', 'null'] },
              building_number: { type: ['string', 'null'] },
              post_code: { type: ['string', 'null'] },
              town: { type: ['string', 'null'] },
              country: { type: 'string', example: 'CH' },
            },
          },
          bic: { type: ['string', 'null'], example: 'UBSWCHZH80A' },
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
          sic_iid: { type: ['string', 'null'] },
          qr_iid: { type: ['string', 'null'], description: 'QR-IID for QR-bill payments' },
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

// buildSpec is exported for the contract linter (scripts/dump-openapi.ts).
// Governance is only worth something if it runs: the document is generated from
// code, so the only way it cannot drift from its own ruleset is for CI to
// regenerate it and lint the regenerated copy on every push.
export { openapi, buildSpec };
