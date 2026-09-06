import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { getEntryCount } from '../lib/bic-lookup.js';
import { BANK_CODE_CHECK_SCHEMA , NEXT_STEPS_SCHEMA, OFFICIAL_IDENTITY_SCHEMA, POSTAL_ADDRESS_SCHEMA } from '../lib/bank-code-schema.js';
import { ADDRESS_SCHEMES, CBPR_NOTE } from '../lib/address-conformity.js';
// Read from the route rather than retyped: the enum of error types and the
// flood cap are what the handler enforces, and a contract that quotes its own
// copy of them is a contract that will be wrong one refactor from now.
import { FEEDBACK_ERROR_TYPES, FEEDBACK_INSERTS_PER_SOURCE_HOUR } from './feedback.js';

const openapi = new Hono();

// Version is read from package.json so the spec can never drift from the
// deployed server again (the spec is fetched ~20k times/month by machines
// that code against it — it must tell the truth).
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

// Built lazily on first request (needs a DB read for live counts), then memoized.
const buildRawSpec = () => ({
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
          'Validates an IBAN and returns parsed components including country, check digits, BBAN, and optional BIC lookup. Costs 0.005 USDC via x402. **Keyless trial: the first 10 calls a day from one IP are served with no key and no payment** — send a real `iban` and the response carries a `trial` block with the count left and how to take a free key (200 requests/month). Past 10, the route answers 402 again with `cause.reason = "trial_exhausted"`. Pass an optional `reference` to add `reference_check`: the reference checksum verdict AND whether the reference may legally travel with this account under the Swiss Payment Standards (QRR requires a QR-IBAN, ISO 11649/SCOR forbids one).',
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
            description:
              'Validation result. Carries an optional `trial` block when the call was served by the keyless daily allowance (no key, no payment), and `cost_usdc: 0` with it — nobody was charged.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IBANValidationResult' },
              },
            },
          },
          '402': {
            description:
              'Payment required (x402). Also returned when the keyless daily trial is used up for this IP — `cause.reason = "trial_exhausted"`, with the count served today, the reset (midnight UTC) and the free-key route. An empty `{}` body always gets this 402, never a 400: that is the discovery probe x402 indexers send.',
          },
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
                    attribution: {
                      type: 'object',
                      description:
                        'Free tier only. When these results are shown to people, display `text` with a link to `url`; backend-only use owes nothing. Absent on paid plans and on x402 calls.',
                      required: ['required', 'text', 'url', 'note'],
                      properties: {
                        required: { type: 'boolean', enum: [true] },
                        text: { type: 'string', example: 'Powered by IBANforge' },
                        url: { type: 'string', format: 'uri' },
                        note: { type: 'string' },
                      },
                    },
                    count: { type: 'integer', description: 'Total IBANs processed' },
                    valid_count: { type: 'integer', description: 'Number of valid IBANs' },
                    cost_usdc: { type: 'number', description: 'Total cost in USDC' },
                    // Always served, and the `required` list above named four
                    // fields while omitting the fifth (audit 2026-09-01, DX-06).
                    processing_ms: {
                      type: 'number',
                      description: 'Server-side time spent on the whole batch, in milliseconds.',
                      example: 4.2,
                    },
                  },
                  required: ['results', 'count', 'valid_count', 'cost_usdc', 'processing_ms'],
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
                      required: ['compliance', 'meta'],
                      properties: {
                        compliance: { $ref: '#/components/schemas/ComplianceResult' },
                        // Served on every compliance answer and declared
                        // nowhere until the audit of 2026-09-01 (DX-06). It is
                        // the block that says what the verdict does NOT cover,
                        // which is the half a caller most needs to read.
                        meta: {
                          type: 'object',
                          description:
                            'Provenance and scope of the verdict. Read it before acting on `compliance`: it names what was screened and, more importantly, what was not.',
                          required: ['scope', 'disclaimer'],
                          properties: {
                            scope: {
                              type: 'string',
                              example: 'bank_bic_only',
                              description: 'What the screen covered. "bank_bic_only" means the holding institution, never the beneficiary name.',
                            },
                            disclaimer: {
                              type: 'string',
                              description: 'The limits of the answer in plain words. Informational triage, not a regulated AML/CFT product.',
                            },
                            sanctions_as_of: { type: 'string', description: 'When the sanctions data was last refreshed.' },
                            fatf_as_of: { type: 'string', example: '2026-06', description: 'The FATF plenary the jurisdiction flag comes from.' },
                            sources: { type: 'string', example: 'EU,OFAC,UN,FATF,EPC-SCT,EPC-SCT_INST,EPC-SDD', description: 'The lists and registers consulted.' },
                            country_risk_as_of: { type: 'string', example: '2026-07', description: 'Review date of the editorial country-risk axis.' },
                            country_risk_scope: {
                              type: 'string',
                              description:
                                'Why `risk_indicators.country_risk` and `compliance.sanctions.fatf_status` may disagree: they are two separate axes, each with its own review date, not two spellings of one.',
                            },
                          },
                        },
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
    '/v1/ch/qr-bill/check': {
      post: {
        operationId: 'checkSwissQrBill',
        summary: 'Free Swiss QR-bill payload check (structured vs combined address)',
        description:
          'FREE rule check of the text inside a Swiss QR-bill code (the Swiss Payments Code, 31 positional lines from SPC to EPD): header and version, creditor IBAN and QR-IBAN range (IID 30000-31999), QRR/SCOR/NON reference checksum and its pairing with the IBAN, amount, currency, ultimate creditor left empty, and whether the creditor and ultimate debtor addresses are structured (type S) or still combined (type K). Type K was removed from the standard on 21.11.2025; from 14.11.2026 banks no longer process standing orders and payment templates built on it. A combined address comes back with proposed_structured, the S-type fields derived from the combined lines. Pure rule evaluation, no database: the bank behind the IBAN is the job of POST /v1/iban/validate.',
        tags: ['Free'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['payload'],
                properties: {
                  payload: {
                    type: 'string',
                    maxLength: 4000,
                    description: 'The Swiss QR Code text with real line breaks (SPC ... EPD, then optional billing information and up to two alternative schemes).',
                  },
                },
              },
              example: {
                payload:
                  'SPC\n0200\n1\nCH4431999123000889012\nS\nRobert Schneider AG\nRue du Lac\n1268\n2501\nBiel\nCH\n\n\n\n\n\n\n\n1949.75\nCHF\nS\nPia Rutschmann\nMarktgasse\n28\n9400\nRorschach\nCH\nQRR\n210000000003139471430009017\nOrder 15.06.2026\nEPD',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The verdict: valid, ready_for_2026_11_14, creditor_iban, creditor, ultimate_debtor, reference, findings (code, severity, field, detail, source), next_steps, source.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    ready_for_2026_11_14: { type: 'boolean', description: 'valid and every present address is structured (type S).' },
                    creditor_iban: { type: 'object', additionalProperties: true },
                    creditor: { type: 'object', additionalProperties: true },
                    ultimate_debtor: { type: 'object', additionalProperties: true },
                    reference: { type: 'object', additionalProperties: true },
                    findings: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          code: { type: 'string' },
                          severity: { type: 'string', enum: ['error', 'warning'] },
                          field: { type: 'string' },
                          detail: { type: 'string' },
                          source: { type: 'string' },
                        },
                      },
                    },
                    next_steps: { type: 'array', items: { type: 'string' } },
                    source: { type: 'string' },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { description: 'invalid_json or invalid_payload, with an example payload in the body.' },
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
              'Body rejected before any key was considered. "error" is "invalid_json", "invalid_email", ' +
              '"disposable_email" (the free tier needs a real, non-disposable mailbox), or "undeliverable_email" ' +
              '(the mail server for that domain refused the address, so no verification code could be delivered).',
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
              '"verification_unavailable": the mail relay is down or misconfigured on our side, so no key was ' +
              'issued and no code is pending. Retry in a few minutes. An address the mail server refuses ' +
              'answers 400 "undeliverable_email" instead.',
          },
        },
      },
    },
    '/v1/keys/usage': {
      get: {
        operationId: 'getApiKeyUsage',
        summary: 'Check API key usage',
        description:
          'Returns current month usage and remaining quota for the provided API key. ' +
          '`basis` says which ceiling actually governs the key: "monthly" for a free or subscription key, ' +
          '"credits" for a prepaid bundle. On a bundle key, `used` counts the calls billed this month for ' +
          'information only — nothing is enforced against `limit`/`remaining`, and the balance that can turn a ' +
          'call away is served alongside as `credits_remaining` / `credits_total`.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description:
              'Usage for the current month: used, limit, remaining, month, key_prefix, basis — plus ' +
              'credits_remaining, credits_total and an explanatory note when basis is "credits"',
          },
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
          'The footprint reports `unusual: null`, never false, for a key with no traffic: a key that has never been called has not passed a leak check, it has nothing to judge. ' +
          'Its `usage` block is the one GET /v1/keys/usage serves, `basis` included.',
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
    // The self-service lifecycle of a key. All three authenticate with the KEY
    // ITSELF as a bearer token, never with the admin secret — the handlers say
    // so in as many words ("Self-service rotation. Auth is the (still valid)
    // key itself.") — so they are public routes and their absence from this
    // document was a hole, not a deliberate omission (audit 2026-09-01,
    // DX-05). The cost of that hole is specific: a developer who leaks a key
    // and reads only the contract cannot find out that they can kill it
    // themselves, in one call, without contacting anyone.
    '/v1/keys/revoke': {
      post: {
        operationId: 'revokeApiKey',
        summary: 'Revoke the presented API key',
        description:
          'Permanently deactivates the key sent in the Authorization header. Authentication is the key itself: whoever holds it may kill it, which is what makes this usable the minute a key leaks. There is no body and no way to revoke a key other than the one presented. Irreversible — use POST /v1/keys/rotate instead if you want a working replacement.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description: 'Key deactivated. Returns revoked: true and key_prefix.',
          },
          '401': { description: 'No Authorization: Bearer ifk_… header ("missing_key")' },
          '404': { description: 'Key not found or already revoked ("invalid_key")' },
        },
      },
    },
    '/v1/keys/rotate': {
      post: {
        operationId: 'rotateApiKey',
        summary: 'Replace the presented API key with a fresh one',
        description:
          'Mints a new key inheriting the same plan and the same remaining credits, and revokes the presented one in the same operation. Authentication is the (still valid) key itself. The new key is returned once and never shown again: store it before doing anything else.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        responses: {
          '201': {
            description:
              'New key issued and the old one revoked. Returns api_key (once), key_prefix, monthly_limit and credits_remaining.',
          },
          '401': { description: 'No Authorization: Bearer ifk_… header ("missing_key")' },
          '404': { description: 'Key not found or inactive ("invalid_key")' },
        },
      },
    },
    '/v1/credits/balance': {
      get: {
        operationId: 'getCreditBalance',
        summary: 'Read the remaining credits of the presented key',
        description:
          'For a prepaid bundle key: credits_remaining, credits_total, credits_used and the top-up endpoints. For a monthly subscription key the answer is type: "subscription" with a pointer to GET /v1/keys/usage, because a subscription has no balance to report. Authentication is the key itself.',
        tags: ['Credits'],
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description:
              'type ("credit_bundle" or "subscription"), key_prefix, and — for a bundle — credits_remaining, credits_total, credits_used, topup_endpoints.',
          },
          '401': { description: 'Missing or invalid API key ("missing_key" / "invalid_key")' },
        },
      },
    },
    '/v1/feedback': {
      post: {
        operationId: 'submitFeedback',
        summary: 'Report incorrect data or claim an x402 refund',
        description:
          'Free, no key and no payment. Report a wrong or stale answer, a missing entry, or a latency problem; passing the `tx_hash` of an x402 call is what turns a report into a refund claim. A human reads every report. Also exposed as the `send_feedback` MCP tool.',
        tags: ['Free'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error_type: {
                    type: 'string',
                    enum: [...FEEDBACK_ERROR_TYPES],
                    default: 'other',
                    description: 'What kind of problem is being reported.',
                  },
                  endpoint: { type: 'string', description: 'The endpoint that answered wrongly, e.g. /v1/bic/UBSWCHZH80A' },
                  tx_hash: { type: 'string', description: 'The x402 transaction hash, when claiming a refund.' },
                  expected: { type: 'string', description: 'What the answer should have been.' },
                  got: { type: 'string', description: 'What the answer actually was.' },
                  notes: { type: 'string', description: 'Anything else that helps reproduce it.' },
                  contact: { type: 'string', description: 'Where to reply, if a reply is wanted.' },
                  agent: { type: 'string', description: 'The agent or client that found it.' },
                },
                // At least one of endpoint / tx_hash / notes is required. That is a
                // cross-field rule the handler enforces ("insufficient_detail") and
                // that no JSON Schema `required` list can express, so it is stated
                // here rather than mis-stated in the schema.
                description:
                  'Provide at least one of endpoint, tx_hash or notes — a report with none of the three is refused with "insufficient_detail".',
              },
            },
          },
        },
        responses: {
          '201': {
            description:
              'Report recorded. Returns ok, id, status ("open") and next_steps.check_status pointing at GET /v1/feedback/{id}.',
          },
          '400': {
            description:
              'Refused before recording. "invalid_json", "invalid_request", "invalid_error_type" (see the enum) or "insufficient_detail".',
          },
          '429': {
            description: `At most ${FEEDBACK_INSERTS_PER_SOURCE_HOUR} reports per hour per source ("feedback_rate_limited").`,
          },
        },
      },
    },
    '/v1/feedback/{id}': {
      get: {
        operationId: 'getFeedbackStatus',
        summary: 'Check the status of a report',
        description:
          'Free, no key. Returns the minimal public view of one report: id, created_at, endpoint, error_type and status. The notes, expected and got fields stay private.',
        tags: ['Free'],
        security: [],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The numeric id returned by POST /v1/feedback.',
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        responses: {
          '200': { description: 'id, created_at, endpoint, error_type, status' },
          '400': { description: 'The id is not numeric ("invalid_id")' },
          '404': { description: 'No report with that id ("not_found")' },
        },
      },
    },
    '/v1/credits/bundles': {
      get: {
        operationId: 'listCreditBundles',
        summary: 'List prepaid credit bundles (free)',
        description:
          'Lists the available prepaid credit bundles with prices. Buy a bundle once via x402 (POST /v1/credits/buy/{bundle}) and receive an API key preloaded with N credits (1 credit = 1 validation/lookup; batch validation debits 1 credit per IBAN) — credits never expire. Card checkout is also available at https://ibanforge.com/pricing. The `subscription` object lists the flat monthly alternative (Pro: 10,000 requests/month by card).',
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
                    subscription: {
                      type: 'object',
                      description:
                        'The recurring alternative to packs: a flat monthly plan paid by card, key delivered by e-mail after checkout.',
                      properties: {
                        plan: { type: 'string', example: 'pro' },
                        monthly_requests: { type: 'integer', example: 10000 },
                        price_usd_per_month: { type: 'number', example: 29 },
                        checkout: { type: 'string', format: 'uri' },
                        payment_method: { type: 'string', example: 'card (Stripe)' },
                      },
                    },
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
          '400': { $ref: '#/components/responses/UnknownParameterOrWindow' },
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
                      // Percentiles and not a mean: one slow outlier moves a
                      // mean and moves nobody's experience. SERVED requests
                      // only — a 402 the paywall refused in a millisecond is
                      // not evidence of speed, and counting refusals would
                      // improve the figure every time a key farm knocks.
                      p50_ms: {
                        type: ['integer', 'null'],
                        description:
                          'Median served latency for the day, in milliseconds. Null below 20 measured requests: a percentile over a handful of samples is noise, and a gap is more honest than a made-up figure.',
                      },
                      p95_ms: {
                        type: ['integer', 'null'],
                        description: '95th percentile of served latency. Same 20-sample floor as p50_ms.',
                      },
                      p99_ms: {
                        type: ['integer', 'null'],
                        description:
                          'The tail: 99th percentile of served latency, which is what a caller making thousands of requests is exposed to and what a timeout budget should be set from. ' +
                          'Its floor is 100 measured requests, not 20, and that is arithmetic rather than caution: the rank n*0.99 lands on the same row as n*0.95 at 20 samples, so a lower floor would publish the p95 twice under two names. Null below it.',
                      },
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
    responses: {
      UnknownParameterOrWindow: {
        description: 'Unknown query parameter, or a window past 90 days (audit 2026-09-01, PERF-13).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
    },
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
      /**
       * The shape EVERY failure already has, finally written down.
       *
       * The audit of 2026-09-01 (DX-02) sampled 17 probes on 14 routes and
       * found the served errors perfectly regular — `{"error": "<snake_case
       * token>", "message": "<sentence>"}` — while all 31 declared 4xx/5xx
       * responses in this document carried a description and nothing else. So
       * a generated client (openapi-generator, Kiota, and the Custom GPT that
       * `integrations/openai/custom-gpt-setup.md` builds by pasting this very
       * document) could type every success and no failure, for a server whose
       * failures were the easy part.
       *
       * `error` is the field to branch on: it is a stable token, whereas
       * `message` is prose that may be reworded. `additionalProperties` stays
       * open because several routes add contextual help next to those two
       * (`example`, `expected`, `schemes`, `endpoints`, `countries_endpoint`,
       * `upgrade_to_full_validation`), and a closed schema would make a
       * generated client drop exactly the field that says how to recover.
       */
      ApiError: {
        type: 'object',
        required: ['error', 'message'],
        additionalProperties: true,
        properties: {
          error: {
            type: 'string',
            description:
              'Stable machine-readable token in snake_case, e.g. "invalid_iban", "payment_required", "payload_too_large", "rate_limited". Branch on this, never on `message`.',
            example: 'invalid_iban',
          },
          message: {
            type: 'string',
            description: 'Human-readable sentence explaining the failure. Wording may change; the token above will not.',
            example: 'IBAN failed the mod-97 checksum.',
          },
        },
      },
      IBANValidationResult: {
        type: 'object',
        required: ['iban', 'valid', 'cost_usdc'],
        properties: {
          trial: {
            type: 'object',
            description:
              'Present ONLY on a call served by the keyless daily trial: POST /v1/iban/validate with a real `iban` and no API key is served 10 times a day per IP, with no payment. Says how many calls are left today and how to take a free key. Absent with a key, with an x402 payment, and on every other endpoint.',
            required: [
              'calls_used_today',
              'calls_left_today',
              'daily_limit',
              'resets',
              'free_key',
              'docs',
            ],
            properties: {
              calls_used_today: { type: 'integer', example: 1 },
              calls_left_today: { type: 'integer', example: 9 },
              daily_limit: { type: 'integer', example: 10 },
              resets: { type: 'string', example: 'midnight UTC' },
              free_key: {
                type: 'string',
                description: 'The request that ends the trial in your favour: a free key, 200 requests a month.',
              },
              docs: { type: 'string', format: 'uri' },
            },
          },
          attribution: {
            type: 'object',
            description:
              'Free tier only. When these results are shown to people, display `text` with a link to `url`; backend-only use owes nothing. Absent on paid plans and on x402 calls.',
            required: ['required', 'text', 'url', 'note'],
            properties: {
              required: { type: 'boolean', enum: [true] },
              text: { type: 'string', example: 'Powered by IBANforge' },
              url: { type: 'string', format: 'uri' },
              note: { type: 'string' },
            },
          },
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
              basis: {
                type: 'string',
                enum: ['national_register', 'curated_map', 'directory_prefix'],
                description:
                  'WHERE the bank code to BIC pairing came from, and therefore what may be done with the BIC. ' +
                  'national_register: the country\'s own register publishes this BIC for this bank code — today Germany, Austria, Belgium and Bulgaria; the German Bankleitzahlendatei carries the exact 11-character BIC per BLZ. ' +
                  'curated_map: our maintained bank-code map made the pairing on an exact key. Usually right, and not an allocation record. ' +
                  'directory_prefix: the bic8 LIKE fallback, which can match several institutions at once — read bank_code_check.candidates. ' +
                  'Answers the settlement question directly: only national_register is settlement-grade, so outside those registers a derived BIC is advisory and should be confirmed with the beneficiary or your bank before it becomes a stored routing instruction.',
              },
              authoritative: {
                type: 'boolean',
                description:
                  'Whether this BIC may be stored and settled against. Derived from `basis` by a single table, so the two cannot disagree. ' +
                  'NOT the same claim as bank_code_check.authoritative, which is about the BANK CODE — whether a national register was consulted about its existence. Switzerland is where they visibly differ: the SIX BankMaster answers authoritatively that an IID is allocated, while the BIC beside it still comes from our curated map.',
              },
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
          // Seven fields of this schema are conditional, and until the audit of
          // 2026-09-01 (DX-08) nothing said so: a generated client typed them
          // as optionals with no rule for when to expect them, which is how a
          // caller ends up branching on a field that is simply never there on
          // the answers it gets. Each now states its own condition.
          error: {
            type: 'string',
            enum: ['invalid_format', 'unsupported_country', 'wrong_length', 'checksum_failed'],
            description: 'Present ONLY when `valid` is false. Absent on every successful validation.',
          },
          error_detail: {
            type: 'string',
            description: 'Present ONLY when `error` is, and explains it in one sentence (e.g. "Modulo 97 check returned 28, expected 1.").',
          },
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
                  'SEPA schemes available for this account. When the resolved institution has rows in the EPC scheme registers these are ITS schemes (basis = "epc_register"); otherwise the country-level schemes (basis = "country_default"). SCT = Credit Transfer, SDD = Direct Debit, SCT_INST = Instant Credit Transfer.',
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
              basis: {
                type: 'string',
                enum: ['country_default', 'epc_register'],
                description:
                  'Where `schemes` comes from: "epc_register" when the resolved BIC has rows in the embedded EPC scheme registers (bank grain), "country_default" otherwise. Absent when enrichment stopped early. Audit 2026-09-01 (DATA-02).',
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
          official_identity: {
            ...OFFICIAL_IDENTITY_SCHEMA,
            description:
              'Present ONLY when a central bank publishes the holder of the code we resolved: reached by LEI on any BIC lookup, and by the national bank code for FR and ES. Absent rather than negative on a miss, and never able to change `valid` or `bank_code_check` — the publishers relay codes, they do not allocate them.',
          },
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
          attribution: {
            type: 'object',
            description:
              'Free tier only. When these results are shown to people, display `text` with a link to `url`; backend-only use owes nothing. Absent on paid plans and on x402 calls.',
            required: ['required', 'text', 'url', 'note'],
            properties: {
              required: { type: 'boolean', enum: [true] },
              text: { type: 'string', example: 'Powered by IBANforge' },
              url: { type: 'string', format: 'uri' },
              note: { type: 'string' },
            },
          },
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
          official_identity: {
            ...OFFICIAL_IDENTITY_SCHEMA,
            description:
              'Present ONLY when a central bank publishes the holder of the code we resolved: reached by LEI on any BIC lookup, and by the national bank code for FR and ES. Absent rather than negative on a miss, and never able to change `valid` or `bank_code_check` — the publishers relay codes, they do not allocate them.',
          },
          note: {
            type: 'string',
            description:
              'Present only when the lookup has something to qualify, typically that coverage may be partial for an unresolved code. Absent on a plain hit.',
          },
          // Served on EVERY answer since 2026-08-21, found and not found alike,
          // and declared nowhere until the audit of 2026-09-01 (DX-06). It is
          // the one compliance signal on the cheap lookup: a reader of the
          // contract alone could not know a sanctions screen had run at all.
          sanctions: {
            type: 'object',
            description:
              'Bank-level sanctions screen, run on every answer including a "found: false" one. `listed` is null, never false, when the database could not be read: a check that did not happen must not look like a check that passed. Screens the institution behind the BIC8, never a beneficiary name.',
            required: ['screened', 'listed'],
            properties: {
              screened: { type: 'boolean', description: 'Whether the screen ran.' },
              listed: {
                type: ['boolean', 'null'],
                description: 'true when the institution appears on a screened list, false when it does not, null when the screen could not run.',
              },
              // On one line, like its twin in ComplianceResult: the
              // sanctions-claims guard exempts a `matched_lists` declaration
              // from the "name every list you screen" rule, and it matches on
              // the line, so splitting the field would make an example of one
              // authority read as a coverage claim of one authority.
              matched_lists: { type: 'array', items: { type: 'string' }, example: ['OFAC'], description: 'The lists that matched. Empty when none did.' },
            },
          },
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
          attribution: {
            type: 'object',
            description:
              'Free tier only. When these results are shown to people, display `text` with a link to `url`; backend-only use owes nothing. Absent on paid plans and on x402 calls.',
            required: ['required', 'text', 'url', 'note'],
            properties: {
              required: { type: 'boolean', enum: [true] },
              text: { type: 'string', example: 'Powered by IBANforge' },
              url: { type: 'string', format: 'uri' },
              note: { type: 'string' },
            },
          },
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
          // Both served, neither declared until the audit of 2026-09-01
          // (DX-06). They are what makes qr_iid usable: without the source an
          // integrator cannot tell a registered allocation from an inference,
          // and without the list an institution holding several QR-IIDs looks
          // like it holds one.
          qr_iid_source: {
            type: ['string', 'null'],
            example: 'register',
            description:
              'Where `qr_iid` comes from: "register" when the SIX register allocates it to this institution, otherwise the basis used. Null when there is no QR-IID.',
          },
          qr_iids: {
            type: 'array',
            items: { type: 'string' },
            example: ['30005', '30308'],
            description:
              'Every QR-IID allocated to this institution, in register order. `qr_iid` is the first of them; an institution may legitimately hold several.',
          },
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

/** The minimum structure the error pass needs to see. Cast through `unknown`
 * because `paths` is a literal whose entries carry `get` or `post` depending
 * on the route, so it does not structurally match a uniform record. */
interface OperationLike {
  requestBody?: unknown;
  responses?: Record<string, { description?: string; content?: unknown }>;
}

const ERROR_CONTENT = {
  'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
} as const;

/** Two failures every route can answer and none of them declared. */
const RATE_LIMIT_RESPONSE = {
  description:
    'Rate limit exceeded. Applied globally by the server, so any operation can answer it. Honour the Retry-After header; see https://api.ibanforge.com/rate-limits.yml',
  content: ERROR_CONTENT,
};
const PAYLOAD_TOO_LARGE_RESPONSE = {
  description:
    'Request body exceeds 256 KB. Applied globally to every operation that takes a body, before routing and before payment, so nothing is charged. Split the input (batch validation accepts up to 100 IBANs per call).',
  content: ERROR_CONTENT,
};

/**
 * Give every failure a schema, and declare the two global ones.
 *
 * Done as a pass over the finished document rather than by editing 31
 * `responses` blocks by hand, because the property being defended is
 * completeness: a route added tomorrow gets the contract for free, and no one
 * has to remember. Audit 2026-09-01, DX-02.
 *
 * `429` goes on every operation because `rateLimitMiddleware()` is mounted on
 * `*` (`src/app.ts`). `413` goes only on operations that take a body: the
 * `bodyLimit` middleware is mounted on `*` too, but declaring that `GET
 * /health` can answer 413 would be noise dressed as rigour.
 *
 * Existing hand-written 4xx/5xx descriptions are kept: they name the `error`
 * tokens a caller branches on, which no generic sentence could replace.
 */
function withErrorContract<T>(spec: T): T {
  const paths = (spec as unknown as { paths: Record<string, Record<string, OperationLike>> }).paths;
  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem)) {
      const responses = operation.responses;
      if (!responses) continue;
      responses['429'] ??= { ...RATE_LIMIT_RESPONSE };
      if (operation.requestBody) responses['413'] ??= { ...PAYLOAD_TOO_LARGE_RESPONSE };
      for (const [status, response] of Object.entries(responses)) {
        if (!/^[45]/.test(status)) continue;
        if (!response.content) response.content = ERROR_CONTENT;
      }
    }
  }
  return spec;
}

const buildSpec = () => withErrorContract(buildRawSpec());

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
