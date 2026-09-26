import { Hono } from 'hono';
import { createRequire } from 'node:module';
import { getEntryCount } from '../lib/bic-lookup.js';
import { BANK_CODE_CHECK_SCHEMA , NEXT_STEPS_SCHEMA, OFFICIAL_IDENTITY_SCHEMA, POSTAL_ADDRESS_SCHEMA } from '../lib/bank-code-schema.js';
import {
  BANK_CODE_HOLDER_NOTE,
  BANK_REACHABILITY_NOTE,
  BIC_SOURCE_AS_OF_NOTE,
  CHECKS_NOTE,
  LISTED_IN_CURRENT_SOURCE_NOTE,
  NATIONAL_CHECK_DIGITS_NOTE,
  VOP_REGISTER_STATUS_NOTE,
} from '../lib/field-notes.js';
import { BANK_CODE_HOLDERS, CHECK_KEYS, CHECK_VALUES } from '../lib/checks.js';
import {
  NATIONAL_CHECK_COUNTRIES,
  NATIONAL_CHECK_SCHEME_NAMES,
  NATIONAL_CHECK_STATUSES,
} from '../lib/national-check/index.js';
import { frozenSources } from '../lib/source-vintage.js';
import { ADDRESS_SCHEMES, CBPR_NOTE } from '../lib/address-conformity.js';
// Read from the route rather than retyped: the enum of error types and the
// flood cap are what the handler enforces, and a contract that quotes its own
// copy of them is a contract that will be wrong one refactor from now.
import { FEEDBACK_ERROR_TYPES, FEEDBACK_INSERTS_PER_SOURCE_HOUR } from './feedback.js';
// Même motif que la ligne ci-dessus : le contrat cite le plafond que le
// middleware applique, jamais une copie retapée. 🚨 Y compris `example`, qui
// est un NOMBRE et qu'aucune garde de prose ne voit passer.
import { REST_TRIAL_WEEKLY_LIMIT, TRIAL_RESET, trialResetsAt } from '../lib/trial.js';
import { MCP_WEEKLY_LIMIT } from '../lib/mcp-limits.js';
import { ALLOWANCE_EXEMPT_TOOLS, MCP_TOOLS } from '../mcp/inventory.js';
import { RATE_LIMIT } from '../middleware/rate-limit.js';
import type { IBANValidationResult } from '../types.js';
import { isFcaRegisterConfigured } from '../lib/fca-register.js';
// The first paragraph and the prices it quotes: read, never retyped (24/09/2026).
import { NOT_WHAT_IT_IS, frozenBicShare, packSummary, positioningLong } from '../lib/positioning.js';
import { nationalRegisterBicNames } from '../lib/register-lists.js';
import { BUNDLES } from './api-keys.js';
import { PRO_PRICE_USD } from '../lib/payment-links.js';
// Même raison : les deux plafonds de palier sont ce que le code applique, et un
// contrat qui recopie son propre chiffre sera faux au prochain réglage.
import {
  ANONYMOUS_MONTHLY_LIMIT,
  CLAIM_MIN_PAID_USD,
  FREE_TIER_MONTHLY_LIMIT,
  KEY_CLAIM_URL,
} from '../lib/tiers.js';
import {
  CLAIM_SUCCESS_PER_SOURCE_DAY,
  DAILY_KEY_CREATION_LIMIT,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_TTL_MINUTES,
  VERIFY_WINDOW_DAYS,
} from '../lib/key-creation-guard.js';
// Même motif encore : les échéances et les plafonds du device grant sont ceux
// que le module applique. 🚨 `DEVICE_USER_CODE_LENGTH` et les secondes sont des
// NOMBRES, qu'aucune garde de prose ne voit passer.
import {
  DEVICE_APPROVAL_TOKEN_TTL_SECONDS,
  DEVICE_CODES_PER_IP_HOUR,
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_COLLECT_WINDOW_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_SLOW_DOWN_INCREMENT_SECONDS,
  DEVICE_USER_CODE_LENGTH,
  DEVICE_VERIFICATION_URI,
} from '../lib/device-grant.js';
// La page du compte (lot C3, 25.09.2026) : le nom du cookie, la durée de la
// session, la taille d'une page et la fenêtre du rapport sont ceux que le module
// du compte applique, lus et non recopiés. L'interdit du consentement est la
// constante partagée : une route qui poste un code à une adresse le porte.
import {
  ACCOUNT_COOKIE,
  ACCOUNT_REPORT_MAX_DAYS,
  ACCOUNT_SESSION_DAYS,
  OVERVIEW_PAGE_SIZE,
} from '../lib/account.js';
import { ACCOUNT_PAGE } from '../lib/first-call.js';
import { CONSENT_BOUNDARY } from '../lib/consent.js';

const openapi = new Hono();

// Version is read from package.json so the spec can never drift from the
// deployed server again (the spec is fetched by machines
// that code against it — it must tell the truth).
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

/**
 * Every `error` code a validation can put next to `valid: false`.
 *
 * Until 24/09/2026 the contract listed four of the six the library emits, and
 * a client switching on the published enum fell into its default branch on
 * `invalid_check_digits` and `invalid_bban_structure`. The two type checks
 * below refuse to compile if the list and `IBANValidationResult['error']`
 * (the library's own union) ever disagree, in either direction.
 */
type IbanErrorCode = NonNullable<IBANValidationResult['error']>;
const IBAN_ERROR_CODES = [
  'invalid_format',
  'unsupported_country',
  'wrong_length',
  'invalid_check_digits',
  'checksum_failed',
  'invalid_bban_structure',
] as const satisfies readonly IbanErrorCode[];
const IBAN_ERROR_CODES_COMPLETE: Exclude<IbanErrorCode, (typeof IBAN_ERROR_CODES)[number]> extends never
  ? true
  : never = true;
void IBAN_ERROR_CODES_COMPLETE;

/**
 * A valid and an invalid answer of POST /v1/iban/validate, as the route serves
 * them to an x402 payer (no `trial` block, no `attribution`). Copied from a
 * local call on 24/09/2026; the bank data are public register entries.
 *
 * Depuis le 25/09/2026 (relecture de la PR 254, R10), les valeurs que seuls les
 * registres EPC donnent (famille sous conditions, src/lib/restricted-family.ts)
 * sont celles d'un déploiement SANS ces registres : `vop_participant: null`,
 * `basis: 'country_default'`, grain de la banque à `null`. Les schémas restent
 * ceux du pays, que donne la bibliothèque. Aucune valeur tirée des registres
 * sous conditions dans un exemple du dépôt public.
 *
 * Why here at all: the second DeepSeek test of 24/09/2026 read this document,
 * found no example and concluded that the error handling was undocumented. The
 * invalid example is the point: a 200, not a 4xx.
 */
const VALIDATE_EXAMPLES = {
  valid: {
    summary: 'A valid German IBAN, its bank code checked in the Bundesbank register',
    value: {
      iban: 'DE89370400440532013000',
      valid: true,
      bank_code_holder: 'confirmed',
      checks: {
        iban_structure: 'pass',
        iban_checksum: 'pass',
        bank_code: 'pass',
        bic: 'pass',
        sepa_reachability: 'unknown',
        national_check_digits: 'not_checked',
        account_exists: 'not_checked',
        payee_name: 'not_checked',
        institution_sanctions: 'not_checked',
        country_sanctions: 'not_checked',
        payee_sanctions: 'not_checked',
      },
      country: { code: 'DE', name: 'Germany' },
      check_digits: '89',
      bban: { bank_code: '37040044', account_number: '0532013000' },
      sepa: {
        member: true,
        schemes: ['SCT', 'SDD', 'SCT_INST'],
        vop_required: true,
        vop_participant: null,
        basis: 'country_default',
        bank_reachability: null,
        bank_schemes: null,
        vop_register_status: null,
      },
      formatted: 'DE89 3704 0044 0532 0130 00',
      cost_usdc: 0.005,
      bic: {
        code: 'COBADEFFXXX',
        bank_name: 'Commerzbank',
        city: 'Köln',
        source: 'Deutsche Bundesbank Bankleitzahlendatei',
        as_of: '2026-09',
        basis: 'national_register',
        authoritative: true,
        lei: '851WYGNLUQLFZBSYGB56',
        lei_status: 'ACTIVE',
        bic8: 'COBADEFF',
        listed_in_current_source: true,
      },
      issuer: { type: 'bank', name: 'Commerzbank', classification: 'default' },
      risk_indicators: {
        issuer_type: 'bank',
        country_risk: 'standard',
        test_bic: false,
        sepa_reachable: true,
        sepa_reachable_scope: 'country',
        vop_coverage: true,
      },
      bank_code_check: {
        value: '37040044',
        status: 'verified',
        match: 'register',
        register: 'Deutsche Bundesbank Bankleitzahlendatei',
        authoritative: true,
        institution: { name: 'Commerzbank', street: null, post_code: '50447', town: 'Köln', country: 'DE' },
        as_of: '2026-09',
      },
    },
  },
  invalid: {
    summary: 'An invalid IBAN: still HTTP 200, with valid false, error and error_detail',
    value: {
      iban: 'DE89370400440532013001',
      valid: false,
      error: 'checksum_failed',
      error_detail: 'Modulo 97 check returned 28, expected 1.',
      cost_usdc: 0.005,
    },
  },
};

// Built lazily on first request (needs a DB read for live counts), then memoized.
const buildRawSpec = () => ({
  openapi: '3.1.0',
  info: {
    title: 'IBANforge API',
    version: PKG_VERSION,
    // This string is the first thing every agent reads about the product, on
    // the surface machines fetch the most. Until 24/09/2026 it opened
    // on "Pre-payout screening for AI agents" and Swiss clearing, and the
    // assistants that read it filed IBANforge as a Swiss tool for agents with
    // a sanctions screening of the payee. The paragraph now comes from
    // src/lib/positioning.ts, the same one llms.txt serves, with the register
    // countries read from the code. Card before x402: the brief of that day.
    description:
      positioningLong() +
      ' ' +
      NOT_WHAT_IT_IS +
      ' Also: Swiss clearing with payment-rail participation (SIX BankMaster), the UK modulus check, and the official identity of the bank from central-bank lists (France, Spain). ' +
      'Ways to pay, none a dead-end: prepaid credit packs by card or USDC, no expiry, ' +
      packSummary(BUNDLES) +
      '; a Pro subscription by card ($' +
      PRO_PRICE_USD +
      ' a month); or pay-per-call via x402 micropayments (USDC on Base L2, no signup). ' +
      'Before paying, a free API key needs no email address: it reaches ' +
      FREE_TIER_MONTHLY_LIMIT +
      ' requests a month once claimed, and taken with an empty body it starts at ' +
      ANONYMOUS_MONTHLY_LIMIT +
      ' a month. ' +
      'An invalid IBAN is not an HTTP error: validation answers 200 with `valid: false`. ' +
      'A refused request (4xx) answers JSON with `error`, a stable token, and on the public routes a `message` sentence (`{"error": "<token>", "message": "<sentence>"}`); an unexpected 500 is the plain text `Internal Server Error`, with no JSON; ' +
      'rate limit ' +
      RATE_LIMIT +
      ' requests a minute per address, with Retry-After on the 429 (https://api.ibanforge.com/rate-limits.yml). ' +
      'Support: support@ibanforge.com, or GitHub Issues.',
    // Audit of 24/09/2026: an assistant reading this document found no way to
    // reach a person. The URL alone sent it to the home page.
    contact: {
      name: 'IBANforge support',
      url: 'https://github.com/cammac-creator/ibanforge/issues',
      email: 'support@ibanforge.com',
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
          'Validates an IBAN and returns parsed components including country, check digits, BBAN, and optional BIC lookup. Costs 0.005 USDC via x402. **Keyless trial: the first ' +
          REST_TRIAL_WEEKLY_LIMIT +
          ' calls a week from one source address are served with no key and no payment** (IPv6 counted per /64; the week is the ISO week in UTC and resets on ' +
          TRIAL_RESET +
          '): send a real `iban` and the response carries a `trial` block with the count left this week, the reset instant, and how to take a key that needs no email at all. The trial covers this route only. The key that needs no email is another door: every endpoint, and ' +
          FREE_TIER_MONTHLY_LIMIT +
          ' requests a month once claimed (POST /v1/keys/claim with a 6-digit code mailed to an address you read); taken with an empty body it starts at ' +
          ANONYMOUS_MONTHLY_LIMIT +
          ' a month. Past ' +
          REST_TRIAL_WEEKLY_LIMIT +
          ' in the week, the route answers 402 again with `cause.reason = "trial_exhausted"` until the reset. **An invalid IBAN is not an HTTP error: the answer is HTTP 200 with `valid: false`, an `error` code and an `error_detail` sentence** (codes: `invalid_format`, `unsupported_country`, `wrong_length`, `invalid_check_digits`, `checksum_failed`, `invalid_bban_structure`). Only the request itself changes the status: 400 for malformed JSON or a missing `iban`, 402 for payment or an exhausted allowance, 413 for a body over 256 KB, 429 past the rate limit. Pass an optional `reference` to add `reference_check`: the reference checksum verdict AND whether the reference may legally travel with this account under the Swiss Payment Standards (QRR requires a QR-IBAN, ISO 11649/SCOR forbids one).',
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
              'Validation result, for a valid AND for an invalid IBAN: an invalid IBAN is HTTP 200 with `valid: false`, `error` and `error_detail`, never a 4xx. Carries an optional `trial` block when the call was served by the keyless weekly trial (no key, no payment), and `cost_usdc: 0` with it — nobody was charged.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IBANValidationResult' },
                examples: VALIDATE_EXAMPLES,
              },
            },
          },
          '402': {
            description:
              'Payment required (x402). Also returned when the keyless weekly trial is used up for this source address — `cause.reason = "trial_exhausted"`, with the count served this week, the reset (' + TRIAL_RESET + ') and the free-key route — and when a key has used its allowance (`monthly_quota_exhausted`, `credits_exhausted`). Without a key, an empty `{}` body gets this 402 and spends nothing of the trial: that is the discovery probe x402 indexers send. With a key, the same empty body is a 400.',
          },
          '400': {
            description:
              '`invalid_json` (the body is not JSON) or `invalid_request` (no `iban` string). An invalid IBAN is never a 400: it is a 200 with `valid: false`.',
          },
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
    '/v1/gb/firm/{frn}': {
      get: {
        operationId: 'lookupGbFirm',
        summary: 'Look up a UK-regulated firm by FRN in the FCA Financial Services Register',
        description:
          'One firm per request, by Firm Reference Number (6 or 7 digits), served from the FCA Register API under its written permission: name, register status and its effective date, business type, Companies House number, client-money permission, PSD/EMD and MLR statuses, register notices. Every answer names the source, carries the retrieval date, the FCA disclaimer and the cache state; entries are cached one day. Use it to confirm the regulatory status of a UK payment, e-money or deposit-taking firm before paying it — never to build a list of firms. A reference number the register does not hold answers 200 with `found: false`. Costs 0.003 USDC via x402, or one request of an API key. On a deployment without a Register API credential the route answers 503 `not_configured` before any credential is read, so nothing is charged.',
        tags: ['UK register'],
        security: [{ x402Payment: [] }, { apiKey: [] }],
        parameters: [
          {
            name: 'frn',
            in: 'path',
            required: true,
            description: 'Firm Reference Number, 6 or 7 digits, as printed on the Financial Services Register.',
            schema: { type: 'string', pattern: '^[0-9]{6,7}$', example: '123456' },
          },
        ],
        responses: {
          '200': {
            description:
              'The firm as the register publishes it, or `found: false` with the same credit and date when no firm carries the number.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GbFirmResult' },
              },
            },
          },
          '400': {
            description:
              'Malformed reference (`invalid_frn_format`), the OpenAPI placeholder sent literally (`placeholder_literal`), or a number the register itself refuses (`invalid_frn`). Never charged.',
          },
          '402': { description: 'Payment required (x402)' },
          '502': {
            description:
              'The register did not answer and no copy of the entry under thirty hours old is held (`upstream`; `upstream_status` carries the status the register gave).',
          },
          '503': {
            description:
              'This deployment holds no Register API credential (`not_configured`). Answered before any key or payment is read: nothing is charged.',
          },
        },
      },
    },
    '/v1/iban/compliance': {
      post: {
        operationId: 'complianceCheck',
        summary: 'Bank-level compliance triage for an IBAN',
        description:
          // The list of authorities is spelled out on this line rather than
          // read from BANK_LEVEL_SANCTIONS: this file is a coverage surface of
          // sanctions-claims.test.ts, which reads the source line by line.
          "Validates an IBAN and returns everything from /v1/iban/validate PLUS a pre-payment triage layer: sanctions lists (OFAC, EU, UN) matched on the payee's bank (BIC8), the country checked against a fixed list of sanctioned jurisdictions, never the payee's name; FATF status; SEPA Instant reachability; whether the EPC Verification of Payee register lists the bank as ready (VoP readiness); and a composite risk score (0-100). Costs $0.02 USDC via x402.",
        tags: ['Compliance'],
        security: [{ x402Payment: [] }, { apiKey: [] }],
        // La forme BIC, servie depuis l'été et jamais déclarée (relecture de la
        // PR 254, R4) : un client généré ne pouvait ni l'envoyer ni la lire,
        // alors que GET /v1/bic y renvoie. Exactement un des deux champs, comme
        // la route (iban-compliance.ts refuse les deux ensemble).
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Send exactly one of `iban` or `bic`. The `bic` form screens a bank directly, for the banks no IBAN can reach; it answers BicComplianceResponse.',
                oneOf: [{ required: ['iban'] }, { required: ['bic'] }],
                properties: {
                  iban: {
                    type: 'string',
                    description: 'IBAN to check',
                    example: 'DE89370400440532013000',
                  },
                  bic: {
                    type: 'string',
                    description: 'BIC8 or BIC11 of the bank to screen, instead of an IBAN.',
                    example: 'COBADEFF',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Compliance check result: on an `iban`, the full IBAN validation plus the compliance layer; on a `bic`, BicComplianceResponse.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                  {
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
                  { $ref: '#/components/schemas/BicComplianceResponse' },
                  ],
                },
              },
            },
          },
          '402': { description: 'Payment required (x402) — $0.02 USDC' },
          '400': { description: 'Missing or malformed request body, a malformed BIC, or both `iban` and `bic` in one body' },
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
          'FREE pure-format IBAN check: ISO 13616 mod-97 checksum, country-specific length, and BBAN parsing. No payment, no API key, no quota (global rate limit only). `valid: true` here means well formed and nothing more: this route does NOT touch the BIC, SEPA, VoP or Swiss clearing data, and does not say whether the bank code is allocated. Use POST /v1/iban/validate ($0.005) for that. Spaces and hyphens are removed before the length is measured, so an IBAN written in groups of four is accepted as printed. Also answers POST with the JSON body `{"iban": "..."}`. Ideal for pre-filtering malformed IBANs before paying for validation.',
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
            description:
              'IBAN to check. Spaces and hyphens are allowed and removed before the length is measured (15 to 34 characters once removed; at most 64 as sent).',
            schema: {
              type: 'string',
              minLength: 15,
              maxLength: 64,
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
          '400': {
            description:
              '`missing_iban` (no ?iban= query parameter), or `invalid_iban_length` (fewer than 15 or more than 34 characters once spaces and hyphens are removed, or more than 64 as sent)',
          },
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
          'Generates a free API key. NO BODY AT ALL is the shortest form and it works: an empty request returns ' +
          `an anonymous key with ${ANONYMOUS_MONTHLY_LIMIT} requests/month, no email and no card, and a ` +
          '"claim_url". The response of an anonymous key carries no "email" field. ' +
          `Supply {"email": "..."} instead and the key is issued at ${FREE_TIER_MONTHLY_LIMIT} requests/month ` +
          'on the historical path (batch validation counts 1 request per IBAN): the first key issued to a network ' +
          `is instant, while a repeat creation from the same network within ${VERIFY_WINDOW_DAYS} days must prove ` +
          'the mailbox is readable — that call answers 403 "verification_required" and mails a 6-digit code to the ' +
          `address supplied, and the SAME request is then repeated with a "code" field within ${VERIFICATION_TTL_MINUTES} ` +
          `minutes. A body that is not empty and not valid JSON keeps its 400. At most ${DAILY_KEY_CREATION_LIMIT} ` +
          'keys per network per day, on both paths. An anonymous key is raised later with ' +
          `POST /v1/keys/claim — same key, nothing to replace. A caller that cannot receive mail needs neither ` +
          'path: prepaid credits (POST /v1/credits/buy/1k) and x402 pay-per-call need no key.',
        tags: ['API Keys'],
        // Explicitly no authentication, which is a different statement from
        // omitting the field: an agent reading the contract can tell 'free' from
        // 'the author forgot to say'.
        security: [],
        requestBody: {
          // Facultatif depuis le palier anonyme : la commande la plus courte
          // qu'un agent puisse émettre est un POST sans corps, et un client
          // généré depuis ce document doit pouvoir l'écrire.
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                // AUCUN champ requis. "email" est sorti de `required` (son
                // absence est désormais un cas servi, pas une erreur) et
                // "code" n'y a jamais été : le premier clé d'un réseau n'en a
                // pas besoin, et l'y mettre aurait été une rupture déguisée en
                // ajout.
                properties: {
                  email: {
                    type: 'string',
                    format: 'email',
                    description:
                      'Optional. Supply it for the historical path (' +
                      `${FREE_TIER_MONTHLY_LIMIT} requests/month). Omit it, send an empty body, or send null for ` +
                      `an anonymous key at ${ANONYMOUS_MONTHLY_LIMIT} requests/month.`,
                  },
                  anonymous: {
                    type: 'boolean',
                    example: true,
                    description:
                      'Optional and never required: an explicit way to say what an empty body already says. ' +
                      'Accepted so documentation and SDKs have a form to show.',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[0-9]{6}$',
                    example: '123456',
                    description:
                      'Optional. The 6-digit code mailed after a 403 "verification_required". Repeat the same ' +
                      `request with it within ${VERIFICATION_TTL_MINUTES} minutes; omit it to be mailed a fresh ` +
                      `one. The challenge locks after ${VERIFICATION_MAX_ATTEMPTS} wrong attempts.`,
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description:
              'API key generated (shown only once). An anonymous key answers api_key, key_prefix, tier, ' +
              'monthly_limit, claim_url, message and terms_url — and NO "email" field. A key created with an ' +
              'address answers the historical body plus "tier".',
          },
          '400': {
            description:
              'Body rejected before any key was considered, and every one of these applies only when an ' +
              '"email" field was supplied — an empty body cannot be refused for its address. "error" is ' +
              '"invalid_json", "invalid_email", "disposable_email" (an address on that path must be a real, ' +
              'non-disposable mailbox), or "undeliverable_email" (the mail server for that domain refused the ' +
              'address, so no verification code could be delivered).',
          },
          '403': {
            description:
              'The mailbox must be verified. "verification_required": a 6-digit code was just mailed, repeat this ' +
              'exact request with "code" within 15 minutes. "verification_failed": the code was wrong or expired, ' +
              'and "reason" says which ("wrong_code", "expired", "no_challenge", "too_many_attempts"); request ' +
              'again without "code" to be sent a fresh one.',
          },
          '409': {
            description:
              '"verification_in_flight": a verification code for that address was issued moments ago for a ' +
              'DIFFERENT key (a claim on POST /v1/keys/claim), and it is not overwritten while its recipient is ' +
              'still copying it. Use that code, or repeat this request in a couple of minutes.',
          },
          '429': {
            description:
              'Too many creations. "key_creation_limit": at most ' +
              DAILY_KEY_CREATION_LIMIT +
              ' free keys per network per day. "verification_rate_limited": too many codes were mailed to this ' +
              'address or from this network today. "rate_limited": one key per email per day. Existing keys keep ' +
              'working in every case. A separate global shield may reduce the allowance of a key minted during a ' +
              'burst; it never refuses one, and claiming that key lifts it straight away.',
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
    // ── Device grant (RFC 8628) ─────────────────────────────────────────────
    // Five public routes, no key and no payment. Two belong to the AGENT path
    // (open a request, collect the key); three belong to the HUMAN who
    // approves it on a web page. Documented here because this document is how
    // machines learn an endpoint: an agent that cannot read the flow from the
    // contract will invent one, and the one it invents opens a browser.
    '/v1/keys/device': {
      post: {
        operationId: 'openDeviceGrant',
        summary: 'Open a device authorization request (RFC 8628)',
        description:
          'Opens a device authorization request and returns a short code plus an address. Show BOTH to a ' +
          'human — the ready-made link to click, and the plain address with the code to type on a phone — ' +
          'and never open the link yourself. Then poll POST /v1/keys/device/token with the device_code. ' +
          `The request lives ${DEVICE_CODE_TTL_SECONDS} seconds. Approving it hands the agent an anonymous ` +
          `key (${ANONYMOUS_MONTHLY_LIMIT} requests/month, no address of any kind); the human may instead ` +
          `verify a mailbox on the page and the key is issued at ${FREE_TIER_MONTHLY_LIMIT} requests/month. ` +
          'Nothing personal passes through the model: it relays a code and waits. ' +
          `Every request opened counts against the same allowance as POST /v1/keys/generate — ${DAILY_KEY_CREATION_LIMIT} ` +
          'per network per day, requests still awaiting approval included, because a pending request is a ' +
          'promised key. The two doors share that allowance, they do not each get one.',
        tags: ['API Keys'],
        security: [],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  client_name: {
                    type: 'string',
                    maxLength: 60,
                    example: 'Claude Code',
                    description:
                      'Optional. Who is asking, shown to the human on the approval page. Truncated and ' +
                      'stripped of control characters and URLs; a value that survives none of that is ' +
                      'displayed as a fallback label instead of being refused.',
                  },
                  reason: {
                    type: 'string',
                    maxLength: 200,
                    example: 'validate supplier IBANs before payout',
                    description:
                      'Optional. What the key is for, shown to the human on the approval page. Same cleaning.',
                  },
                  source: {
                    type: 'string',
                    pattern: '^[a-z0-9_-]{1,40}$',
                    example: 'mcp-device',
                    description:
                      'Optional attribution label, same rule as POST /v1/keys/generate. Telemetry only: the ' +
                      'per-network allowance is counted on the caller network, so changing this value on ' +
                      'every call changes nothing.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description:
              'Request opened. Answers device_code (the secret the agent keeps), user_code (what the human ' +
              `types, ${DEVICE_USER_CODE_LENGTH} letters with no vowel and no digit, so nothing to misread), ` +
              `verification_uri (${DEVICE_VERIFICATION_URI}), verification_uri_complete (the same with the ` +
              `code pre-filled), expires_in, interval (${DEVICE_POLL_INTERVAL_SECONDS} seconds), message, ` +
              'and display_to_human: a ready-made block of text to show a human VERBATIM, carrying the code ' +
              'and the link. It is built here so that every surface shows the same words; do not paraphrase ' +
              'it, and note that it deliberately contains no device_code.',
          },
          '400': { description: '"invalid_json": the body was present and is not a JSON object.' },
          '429': {
            description:
              '"device_rate_limited": this network has taken its free keys for today, counting the requests ' +
              `still awaiting approval, or it opened more than ${DEVICE_CODES_PER_IP_HOUR} requests in the ` +
              'last hour. Existing keys keep working, the keyless trial needs nothing, and x402 needs no key.',
          },
          '503': {
            description:
              '"device_unavailable": the request could not be opened. Validation is unaffected; retry in a minute.',
          },
        },
      },
    },
    '/v1/keys/device/token': {
      post: {
        operationId: 'collectDeviceGrantKey',
        summary: 'Collect the key once a human has approved (long-polling)',
        description:
          'RFC 8628 §3.4. Accepts application/json and application/x-www-form-urlencoded, so an existing ' +
          'OAuth client works unchanged. grant_type is OPTIONAL; when present it must be ' +
          '"urn:ietf:params:oauth:grant-type:device_code". The server holds the request open for up to ' +
          'thirty seconds and answers as soon as the state changes, so a conforming client makes one or two ' +
          `calls a minute. Wait for "interval" between calls: closer than ${DEVICE_POLL_INTERVAL_SECONDS} ` +
          'seconds answers "slow_down" immediately. The key is handed over EXACTLY ONCE — store it before ' +
          'doing anything else. The answer also carries config_line, the command to hand the human so they ' +
          'can register the key with their MCP client; this endpoint never edits any configuration file. ' +
          `An approval opens a collection window of at least ${DEVICE_COLLECT_WINDOW_SECONDS} seconds even ` +
          'when the original request was about to expire, so an approval at the last minute is still ' +
          'collectable. Requests are never held open for a browser: a call carrying Origin or ' +
          'Sec-Fetch-Mode is answered at once, which costs a conforming client nothing.',
        tags: ['API Keys'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['device_code'],
                properties: {
                  device_code: {
                    type: 'string',
                    example: 'ifd_1a2b3c',
                    description: 'The secret returned by POST /v1/keys/device.',
                  },
                  grant_type: {
                    type: 'string',
                    enum: ['urn:ietf:params:oauth:grant-type:device_code'],
                    description: 'Optional. Any other value is refused as "unsupported_grant_type".',
                  },
                },
              },
            },
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['device_code'],
                properties: {
                  device_code: { type: 'string' },
                  grant_type: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The key, once and only once: api_key, key_prefix, tier ("anonymous" or "email"), ' +
              'monthly_limit, message, terms_url and config_line. There is NO "email" field on an ' +
              'anonymous key — not null and not a placeholder; the field appears only when a mailbox was ' +
              'verified during approval.',
          },
          '400': {
            description:
              'Every wait and every failure of this endpoint, as RFC 6749 §5.2 requires. ' +
              '"authorization_pending": nobody has approved yet — wait for "interval" and call again, ' +
              'nothing is wrong (the body carries expires_in and interval). ' +
              `"slow_down": you are calling faster than the interval — add ${DEVICE_SLOW_DOWN_INCREMENT_SECONDS} ` +
              'seconds to it. "access_denied": somebody refused the request — tell your human and ask ' +
              'whether to try again; open at most one more request. "expired_token": nobody approved in ' +
              'time — ask for a new request at most once, then fall back to the keyless allowance or to ' +
              'x402. "invalid_grant": unknown device_code, or the key was already collected, or the secret ' +
              'belongs to another flow — stop. "unsupported_grant_type": grant_type was present and wrong. ' +
              '"invalid_json": the body is neither valid JSON nor form-encoded.',
          },
          '429': {
            description:
              'The per-address request limiter of the whole API, which this endpoint does not bypass: ' +
              'wait retry_after seconds. A client that polls once or twice a minute never meets it.',
          },
        },
      },
    },
    '/v1/keys/device/lookup': {
      post: {
        operationId: 'lookupDeviceGrant',
        summary: 'Read a pending device request, and take its approval token',
        description:
          'Read by the approval page so it can show what it is about to approve. POST and not GET on ' +
          'purpose: a code in a query string enters the browser history, the access logs of whoever serves ' +
          'the page, and leaks as a Referer to any third-party resource that page loads. The answer carries ' +
          'an approval_token that POST /v1/keys/device/approve and POST /v1/keys/device/deny both require: ' +
          'they are state-changing writes, and without a token they would be reachable from any web page ' +
          'with no prior request. One live token per request — a later lookup replaces it, and it lasts ' +
          `${DEVICE_APPROVAL_TOKEN_TTL_SECONDS} seconds, so a tab left open must be reloaded before it can ` +
          'approve. Unknown, expired and already-decided codes all answer the SAME 404 body after the SAME ' +
          'delay: telling them apart would hand a guesser an oracle.',
        tags: ['API Keys'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_code'],
                properties: {
                  user_code: {
                    type: 'string',
                    example: 'WDJB-MJHT',
                    description:
                      'The code the human typed. Case, spaces and dashes are normalised away before lookup.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'user_code, client_name, reason, expires_in, status, anonymous_monthly_limit, ' +
              'claimed_monthly_limit and approval_token. client_name and reason are written by an agent: ' +
              'escape them before display and never render them as markup.',
          },
          '400': { description: '"invalid_json": the body is not a JSON object.' },
          '404': {
            description:
              '"invalid_or_expired": unknown, expired, or already approved or refused. One body and one ' +
              'status for all four, on purpose.',
          },
        },
      },
    },
    '/v1/keys/device/approve': {
      post: {
        operationId: 'approveDeviceGrant',
        summary: 'Approve a device request and mint the key',
        description:
          'Called by the human, from the approval page. Requires the approval_token from POST ' +
          '/v1/keys/device/lookup, and requires Content-Type: application/json — which is what forces a ' +
          'CORS preflight, so the origin check actually applies. Origin is checked when the header is ' +
          'present and never when it is absent, so command-line use keeps working. Three branches: ' +
          `user_code plus token mints an anonymous key at ${ANONYMOUS_MONTHLY_LIMIT} requests/month; adding ` +
          '"email" mails a 6-digit code instead and answers 202 while the request stays pending; adding ' +
          `"email" and "code" verifies the mailbox and mints at ${FREE_TIER_MONTHLY_LIMIT} requests/month. ` +
          'The mail branch extends the deadline ONCE, because the code starts its own clock when the human ' +
          'arrives and not when the request was opened. ' +
          'The key is NEVER returned here. It goes only to the agent, through POST ' +
          '/v1/keys/device/token; this answer says what was granted, and the page tells the human to go ' +
          'back to their agent.',
        tags: ['API Keys'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_code', 'approval_token'],
                properties: {
                  user_code: { type: 'string', example: 'WDJB-MJHT' },
                  approval_token: {
                    type: 'string',
                    example: 'ifa_1a2b3c',
                    description: 'From the most recent POST /v1/keys/device/lookup on this code.',
                  },
                  email: {
                    type: 'string',
                    format: 'email',
                    description:
                      `Optional. Supply it to raise the key to ${FREE_TIER_MONTHLY_LIMIT} requests/month ` +
                      'by proving the mailbox. Omit it and a key is issued with no address at all.',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[0-9]{6}$',
                    example: '123456',
                    description:
                      'Optional. The code mailed by the previous call, submitted within ' +
                      `${VERIFICATION_TTL_MINUTES} minutes. The challenge locks after ` +
                      `${VERIFICATION_MAX_ATTEMPTS} wrong attempts.`,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Approved and minted: ok, tier ("anonymous" or "email"), monthly_limit, "email" when a ' +
              'mailbox was verified, and "notice" when a global shield reduced the allowance. NO field of ' +
              'this answer ever contains the key.',
          },
          '202': {
            description:
              '"code_sent": a 6-digit code was mailed to the address supplied. The request is STILL pending ' +
              'and its expires_in is renewed once; submit the code with the same user_code and token.',
          },
          '400': {
            description:
              '"invalid_json"; "invalid_email"; "disposable_email" (an address supplied here must be a ' +
              'real, non-disposable mailbox — or approve with no address at all); "undeliverable_email" ' +
              '(the mail server for that domain refused the address).',
          },
          '403': {
            description:
              '"approval_token_required": the token is absent, unknown, expired, or superseded by a later ' +
              'lookup — reload the page. "verification_failed": the 6-digit code was wrong or expired, and ' +
              '"reason" says which. "forbidden_origin": the Origin header was present and is not allowed.',
          },
          '404': {
            description:
              '"invalid_or_expired": unknown, expired, or already decided. Same body and same delay as the ' +
              'lookup 404.',
          },
          '409': {
            description:
              '"verification_in_flight": a code for that address was issued moments ago for a different ' +
              'purpose and is not overwritten while its recipient is still copying it.',
          },
          '415': {
            description: '"unsupported_media_type": send this request as application/json.',
          },
          '429': {
            description:
              '"verification_rate_limited": too many codes were mailed to this address, to this domain, or ' +
              'from this network today. "key_rate_limited": a key was already issued to that address in ' +
              'the last day — the request stays pending, so the same button still works to take a key with ' +
              'no address, or come back tomorrow.',
          },
          '503': {
            description:
              '"verification_unavailable": the mail relay is down on our side, so no code is pending and ' +
              'no key was issued.',
          },
        },
      },
    },
    '/v1/keys/device/deny': {
      post: {
        operationId: 'denyDeviceGrant',
        summary: 'Refuse a device request',
        description:
          'Called by the human from the approval page when the request is not theirs. Same guards as ' +
          'approve: the approval_token is mandatory, Content-Type must be application/json, and Origin is ' +
          'checked when present. The token matters MORE here than on approve: a cross-site refusal creates ' +
          'nothing, it destroys. The next POST /v1/keys/device/token answers "access_denied", and the agent ' +
          'is allowed to ask its human whether to open one more request — a refusal obtained by somebody ' +
          'else does not end the attempt for good.',
        tags: ['API Keys'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_code', 'approval_token'],
                properties: {
                  user_code: { type: 'string', example: 'WDJB-MJHT' },
                  approval_token: { type: 'string', example: 'ifa_1a2b3c' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Refused: { "ok": true }. No key exists and none will.' },
          '400': { description: '"invalid_json": the body is not a JSON object.' },
          '403': {
            description:
              '"approval_token_required": the token is absent, unknown, expired, or superseded by a later ' +
              'lookup. "forbidden_origin": the Origin header was present and is not allowed.',
          },
          '404': {
            description:
              '"invalid_or_expired": unknown, expired, or already decided. Same body and same delay as the lookup 404.',
          },
          '415': { description: '"unsupported_media_type": send this request as application/json.' },
        },
      },
    },
    '/v1/keys/usage': {
      get: {
        operationId: 'getApiKeyUsage',
        summary: 'Check API key usage',
        description:
          'Returns current month usage and remaining quota for the provided API key. ' +
          '`tier` names the key\'s tier ("anonymous", "email", "claimed" or "paid"). ' +
          '`basis` says which ceiling actually governs the key: "monthly" for a free or subscription key, ' +
          '"credits" for a prepaid bundle, "lifetime" when the allowance does NOT start over on the 1st (a key ' +
          'raised by payment, or one born under a protective limit) — on that basis `used` and `remaining` count ' +
          'every month the key has ever served and `month` is only the current calendar month. On a bundle key, ' +
          '`used` counts the calls billed this month for ' +
          'information only — nothing is enforced against `limit`/`remaining`, and the balance that can turn a ' +
          `call away is served alongside as \`credits_remaining\` / \`credits_total\`. An anonymous key also ` +
          `carries a "claim" block: where to raise it (${KEY_CLAIM_URL}), to what, by which methods, how much has ` +
          'been settled on it so far and how much is needed. ' +
          'A key that holds an allowance AND prepaid credits (a free key recharged) keeps the basis of its ' +
          'allowance and also carries credits_remaining, credits_total and billing_order: "allowance_then_credits": ' +
          'each call draws on the allowance first, then on the credits, and every billed response says which one ' +
          'paid it in X-Charged-From ("allowance", "credits" or "allowance+credits"). credits_total is everything ' +
          'ever bought on the key, recharges included. `topup` carries the card links that recharge THIS key ' +
          '(they name it by a recharge reference, never by the key) and the USDC route to call with the key presented; ' +
          'on a key without a subscription, `topup.pro` is the Pro link that puts the subscription on THIS key.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description:
              'Usage for the current month: used, limit, remaining, month, key_prefix, basis, tier, topup, plus ' +
              'credits_remaining, credits_total and an explanatory note when basis is "credits", the same with ' +
              'billing_order on a key that holds an allowance and credits, a note when basis is "lifetime", and a ' +
              '"claim" block on an anonymous key',
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
          'Self-service report for the presented key: daily traffic, endpoints called, what failed with a plain-language cause and a suggested fix, and how many distinct networks the key was called from. Authentication is the key itself, and the report only ever covers that key. ' +
          `A person reads the same data on the account page, ${ACCOUNT_PAGE}, by signing in with the e-mail address of the key or by pasting the key (see GET /v1/account/keys/report). ` +
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
    // La sortie du palier anonyme. Documentée ici parce que c'est le seul
    // endroit où une machine peut l'apprendre : un agent qui lit ce contrat
    // doit pouvoir écrire les deux temps sans les deviner, et surtout
    // découvrir la condition d'entrée (la clé doit avoir servi), qui est la
    // surprise la plus probable pour un lecteur des docs.
    '/v1/keys/claim': {
      post: {
        operationId: 'claimApiKey',
        summary: 'Raise the presented anonymous key to the free tier',
        description:
          `Raises the presented anonymous key from ${ANONYMOUS_MONTHLY_LIMIT} to ${FREE_TIER_MONTHLY_LIMIT} ` +
          'requests a month. THE KEY DOES NOT CHANGE: same key, same prefix, same history, nothing to replace. ' +
          'Authentication is the key itself, in any of the three accepted dialects — never in the body. ' +
          'Two steps on the free rail: POST {"email": "..."} answers 202 and mails a 6-digit code, then the SAME ' +
          `request repeated with "code" within ${VERIFICATION_TTL_MINUTES} minutes answers 200. ` +
          'PRECONDITION: the key must have served at least one call, otherwise the answer is 403 "unused_key" — ' +
          'a key that has never been used has nothing to raise. ' +
          'A verified mailbox is the only rail that grants the allowance EVERY month. There is also an implicit ' +
          `paid rail with no call to make here: once ${CLAIM_MIN_PAID_USD} USD of x402 settlements or a credit ` +
          `pack have been settled while presenting the key, it is raised to ${FREE_TIER_MONTHLY_LIMIT} requests ` +
          'ONCE, with no monthly renewal. GET /v1/keys/usage serves the counter as a "claim" block. ' +
          'A key that the cohort radar cut inside a burst of automated signups (the API answers 402 ' +
          '"key_revoked_burst" to it) is the one inactive key this route accepts: a successful claim restores ' +
          'it, active, and raises it in the same step ("restored": true in the answer).',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: {
                    type: 'string',
                    format: 'email',
                    description:
                      'A mailbox you can read. The free tier is attached to the person, not to the address: an ' +
                      'address that already holds an active free-tier key, or claimed one in the last 24 hours, ' +
                      'answers 409 "already_claimed_elsewhere".',
                  },
                  code: {
                    type: 'string',
                    pattern: '^[0-9]{6}$',
                    example: '123456',
                    description:
                      'The 6-digit code mailed by the first call. Omit it to be mailed one; repeat the request ' +
                      `with it within ${VERIFICATION_TTL_MINUTES} minutes. The challenge locks after ` +
                      `${VERIFICATION_MAX_ATTEMPTS} wrong attempts, and a code issued for one key is refused ` +
                      'for another.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Claimed. Returns claimed: true, key_prefix, tier ("claimed"), claim_method ("email_code"), ' +
              'monthly_limit, basis ("monthly"), previous_monthly_limit and claimed_at.',
          },
          '202': {
            description:
              'Code sent. Returns status "code_sent", key_prefix and expires_in_minutes. Repeat the same request ' +
              'with "code" to finish.',
          },
          '400': {
            description:
              '"invalid_json" (a non-empty body that is not a JSON object), "invalid_email", "disposable_email" ' +
              '(claiming needs a real mailbox), or "undeliverable_email" (the mail server for that domain refused ' +
              'the address).',
          },
          '401': {
            description:
              '"missing_key": no key was presented — it goes in the header, never in the body. "invalid_key": the ' +
              'key is unknown or inactive (a key cut for a signup burst is NOT refused here: it is restored by a ' +
              'successful claim).',
          },
          '403': {
            description:
              '"unused_key": the key has never served a call. "verification_failed": the code was wrong, expired, ' +
              'absent, locked, or issued for a different key; "reason" says which ("wrong_code", "expired", ' +
              '"no_challenge", "too_many_attempts", "wrong_target").',
          },
          '409': {
            description:
              '"already_claimed": the key is already past the anonymous tier. "already_claimed_elsewhere": that ' +
              'address already holds an active free-tier key or claimed one in the last 24 hours — reuse that key, ' +
              'or keep this one at its anonymous allowance. "verification_in_flight": a code for that address was ' +
              'issued moments ago for a different key.',
          },
          '429': {
            description:
              `"claim_rate_limited": at most ${CLAIM_SUCCESS_PER_SOURCE_DAY} keys raised per network per day, the ` +
              'same cap key creation applies. "verification_rate_limited": too many codes were requested for this ' +
              'address or from this network today. Existing keys keep working in both cases.',
          },
          '503': {
            description:
              '"verification_unavailable": the mail relay is down or misconfigured on our side, so no code is ' +
              'pending and the key was not raised. Retry in a few minutes.',
          },
        },
      },
    },
    '/v1/keys/rotate': {
      post: {
        operationId: 'rotateApiKey',
        summary: 'Replace the presented API key with a fresh one',
        description:
          'Mints a new key inheriting the same plan and the same remaining credits, and revokes the presented one in the same operation. Authentication is the (still valid) key itself. The new key is returned once and never shown again: store it before doing anything else. ' +
          'The TIER survives too: an anonymous key rotates to an anonymous key, a claimed key stays claimed, and the response carries "tier" and "basis" so the holder can see it. Rotation is not a quota reset — the usage ledger moves to the new key.',
        tags: ['API Keys'],
        security: [{ apiKey: [] }],
        responses: {
          '201': {
            description:
              'New key issued and the old one revoked. Returns api_key (once), key_prefix, monthly_limit, credits_remaining, tier and basis.',
          },
          '401': { description: 'No Authorization: Bearer ifk_… header ("missing_key")' },
          '404': { description: 'Key not found or inactive ("invalid_key")' },
        },
      },
    },
    // La page du compte (lots C1 à C3, 25.09.2026). Cinq routes publiques,
    // faites pour une PERSONNE dans un navigateur sur la page du compte : une
    // adresse reçoit un code à 6 chiffres, le code ouvre une session en cookie,
    // la session LIT les clés de cette adresse et n'en change aucune. Source de
    // vérité : `src/routes/account.ts` (le test `openapi.account.test.ts` lit
    // ses statuts et ses codes d'erreur). La route d'administration qui coupe
    // les sessions d'une adresse n'est pas publique et ne figure pas ici.
    '/v1/account/code': {
      post: {
        operationId: 'requestAccountSignInCode',
        summary: 'Mail a 6-digit sign-in code for the account page',
        description:
          `First step of signing in to the account page, ${ACCOUNT_PAGE}. Made for a person in a browser: the address receives a 6-digit code, and POST /v1/account/session exchanges it for a read-only session. ` +
          `The code is valid ${VERIFICATION_TTL_MINUTES} minutes and allows ${VERIFICATION_MAX_ATTEMPTS} tries; a new code replaces the previous one. ` +
          'The same 202 answers, and the same mail leaves, whether or not the address carries keys: this route never tells whether an address holds a key. ' +
          'The code is mailed to the normalized form of the address: a "+tag" is dropped, and at Gmail the dots too. ' +
          'The codes mailed to one address, one domain and one network are capped per day, in one budget shared with POST /v1/keys/generate and POST /v1/keys/claim. ' +
          'Send the request as application/json; a browser Origin that is not the site is refused. ' +
          `An agent holding a key reads the same figures with GET /v1/keys/usage and GET /v1/keys/report, and has no reason to call this route. ${CONSENT_BOUNDARY}`,
        tags: ['Account'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: {
                    type: 'string',
                    format: 'email',
                    maxLength: 254,
                    example: 'you@example.com',
                    description: 'One plain address: no list, no display name, no quotes.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'A code left for this address. The same body answers for every address.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status', 'expires_in'],
                  properties: {
                    status: { type: 'string', enum: ['code_sent'] },
                    expires_in: { type: 'integer', example: VERIFICATION_TTL_MINUTES * 60, description: 'Seconds the code stays valid.' },
                  },
                },
              },
            },
          },
          '400': {
            description:
              '"invalid_json": the body is not a JSON object. "invalid_email": not one plain address, or its normalized form is not one. "disposable_email": a throwaway or placeholder domain. "undeliverable_email": the domain has no mail server, or the mail server refused the address.',
          },
          '401': { description: '"signed_out": the request carried the account cookie twice. The cookie is cleared.' },
          '403': { description: '"forbidden_origin": the browser Origin is not allowed.' },
          '415': { description: '"unsupported_media_type": send the request as application/json.' },
          '429': {
            description:
              '"code_rate_limited": too many codes today for this address, its domain or this network. Try again tomorrow, or paste an API key on the account page.',
          },
          '503': {
            description:
              '"code_unavailable": sign-in codes cannot be sent right now (the mail relay is down, or the hourly ceiling of sign-in codes is reached). Try again later, or paste an API key on the account page.',
          },
        },
      },
    },
    '/v1/account/session': {
      post: {
        operationId: 'openAccountSession',
        summary: 'Exchange the sign-in code for a session cookie',
        description:
          `Second step of signing in to the account page. A right code opens a session: the answer sets the cookie ${ACCOUNT_COOKIE} (HttpOnly, Secure, SameSite=Strict, Path=/v1/account, ${ACCOUNT_SESSION_DAYS} days from sign-in) and never carries the session token in its body. ` +
          'Every code that cannot be used (wrong, expired, tried too many times, never asked for, or not six digits) gets the same 400 "invalid_code": ask for a new code. An entry that is not six digits does not count as a try. ' +
          'A right code opens a session whether or not the address carries keys; GET /v1/account/overview then says what it holds. The session reads and never writes: it cannot rotate, revoke, claim or top up a key, and it opens no paid route. ' +
          'Same write rules as POST /v1/account/code: application/json, and the browser Origin is checked.',
        tags: ['Account'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'code'],
                properties: {
                  email: {
                    type: 'string',
                    format: 'email',
                    maxLength: 254,
                    example: 'you@example.com',
                    description: 'The address the code was asked for, written as the person typed it.',
                  },
                  code: { type: 'string', pattern: '^[0-9]{6}$', example: '123456', description: 'The 6-digit code of the most recent mail.' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Signed in. Set-Cookie carries the session; the body only says so, with the end of the session.',
            headers: {
              'Set-Cookie': {
                description: `${ACCOUNT_COOKIE}=…; Max-Age=${ACCOUNT_SESSION_DAYS * 24 * 60 * 60}; Path=/v1/account; HttpOnly; Secure; SameSite=Strict`,
                schema: { type: 'string' },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['signed_in', 'expires_at'],
                  properties: {
                    signed_in: { type: 'boolean', enum: [true] },
                    expires_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '400': {
            description:
              '"invalid_json", "invalid_email", or "invalid_code": one answer for every code that cannot be used. Ask for a new code with POST /v1/account/code.',
          },
          '401': { description: '"signed_out": the request carried the account cookie twice. The cookie is cleared.' },
          '403': { description: '"forbidden_origin": the browser Origin is not allowed.' },
          '415': { description: '"unsupported_media_type": send the request as application/json.' },
        },
      },
    },
    '/v1/account/overview': {
      get: {
        operationId: 'getAccountOverview',
        summary: 'Every active key of the signed-in address',
        description:
          `Read-only view of the account page: the active keys whose address normalizes to the signed-in one, ${OVERVIEW_PAGE_SIZE} per page, the most recently called first. ` +
          'For each key: its prefix (never the key itself), its plan, its monthly allowance (the figures of GET /v1/keys/usage) or its credit balance, the calls of this month, the last call, the alerts mailed, and the link that manages a Pro or Editor subscription. `inactive_keys` counts the deactivated keys of the address, without detail. ' +
          'Authentication is the session cookie set by POST /v1/account/session; a browser sends it with credentials: "include". Never cached (Cache-Control: no-store).',
        tags: ['Account'],
        security: [{ accountSession: [] }],
        parameters: [
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Page number, from 1.',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
        ],
        responses: {
          '200': {
            description: 'The overview of the signed-in address.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AccountOverview' } } },
          },
          '401': {
            description:
              '"signed_out": no session, an expired or revoked one, or the account cookie sent twice. A cookie that leads to no live session is cleared.',
          },
        },
      },
    },
    '/v1/account/keys/report': {
      get: {
        operationId: 'getAccountKeyReport',
        summary: 'The report of one key of the signed-in address',
        description:
          'The same body as GET /v1/keys/report (key_prefix, usage, report), for one key of the signed-in address named by its prefix, without the key itself. ' +
          `The prefix travels as a query parameter, never in the path. The window is capped at ${ACCOUNT_REPORT_MAX_DAYS} days here, and report.window_days says the window served. ` +
          'A prefix that is unknown, deactivated or attached to another address gets the same 404. Never cached (Cache-Control: no-store).',
        tags: ['Account'],
        security: [{ accountSession: [] }],
        parameters: [
          {
            name: 'prefix',
            in: 'query',
            required: true,
            description: 'The key_prefix of the key, as the overview lists it.',
            schema: { type: 'string', maxLength: 64, example: 'ifk_3f9c1a7e' },
          },
          {
            name: 'days',
            in: 'query',
            required: false,
            description: `Window in days, clamped to 1..${ACCOUNT_REPORT_MAX_DAYS}. Defaults to 30.`,
            schema: { type: 'integer', minimum: 1, maximum: ACCOUNT_REPORT_MAX_DAYS, default: 30 },
          },
        ],
        responses: {
          '200': { description: 'key_prefix, usage (as GET /v1/keys/usage serves it) and report (as GET /v1/keys/report serves it).' },
          '401': { description: '"signed_out": no live session, or the account cookie sent twice.' },
          '404': {
            description:
              '"not_found": no such key in this account. The same answer for an unknown prefix and for the prefix of another address.',
          },
        },
      },
    },
    '/v1/account/logout': {
      post: {
        operationId: 'closeAccountSession',
        summary: 'Sign out of the account page, here or everywhere',
        description:
          'Ends the session of this browser and clears its cookie. With {"all": true}, ends every session of the signed-in address (sign out everywhere). ' +
          'Signing out with no live session is not an error: 204 all the same. Same write rules as POST /v1/account/code: application/json, and the browser Origin is checked.',
        tags: ['Account'],
        security: [{ accountSession: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  all: { type: 'boolean', default: false, description: 'true ends every session of the address, in every browser.' },
                },
              },
            },
          },
        },
        responses: {
          '204': { description: 'Signed out. The cookie is cleared.' },
          '400': { description: '"invalid_json": the body is present and is not a JSON object.' },
          '401': { description: '"signed_out": the request carried the account cookie twice. The cookie is cleared and nothing is revoked.' },
          '403': { description: '"forbidden_origin": the browser Origin is not allowed.' },
          '415': { description: '"unsupported_media_type": send the request as application/json.' },
        },
      },
    },
    '/v1/credits/balance': {
      get: {
        operationId: 'getCreditBalance',
        summary: 'Read the remaining credits of the presented key',
        description:
          'For a key with prepaid credits: credits_remaining, credits_total (everything ever bought on the key, recharges included), credits_used and the top-up endpoints. For a key without credits the answer is type: "subscription" with a pointer to GET /v1/keys/usage. On every key, `allowance` gives the allowance of the key (null on a key born of a purchase, which has none), `billing_order` is "allowance_then_credits" on a key that holds both, and `topup` carries the card links that recharge THIS key (and, on a key without a subscription, `topup.pro`: the Pro link that puts the subscription on it). When the credits of a key born of a purchase run out, billed routes answer 402 with cause.reason "credits_exhausted", the same links, and X-Credits-Topup-Url (the 1,000-credit one). Authentication is the key itself, in any of the three places every billed route accepts: Authorization: Bearer, X-API-Key, or ?api_key=.',
        tags: ['Credits'],
        security: [{ apiKey: [] }],
        responses: {
          '200': {
            description:
              'type ("credit_bundle" or "subscription"), key_prefix, allowance, topup, and, for a key with credits, credits_remaining, credits_total, credits_used, topup_endpoints and, when it also holds an allowance, billing_order.',
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
          'Pay once via x402 (USDC on Base). Present the API key you already hold (as on any billed route) and the credits land on THAT key: the answer carries same_key: true, api_key echoes the key you presented, and nothing changes in your integration; presenting the key costs no request, and a purchase never grants a free allowance. Without a key (or with an invalid one), you receive a fresh API key preloaded with the bundle credits, recoverable once at recovery_url if the response is lost. Nothing is credited or activated before the payment settles. Bundles: 1k = $4, 5k = $20, 25k = $80. Credits never expire. Optionally pass {"email": "..."} in the body: it becomes the contact of a NEW key; on a recharge it is only kept as the payer\'s contact, never attached to the key. Check the balance with GET /v1/credits/balance.',
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
            description:
              'The key you presented was recharged (same_key: true), or a new credit key was minted (shown only once: save it)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['api_key', 'credits', 'bundle'],
                  properties: {
                    api_key: {
                      type: 'string',
                      description:
                        'Full API key: the key you presented on a recharge, echoed as sent; a new key otherwise, shown only once',
                    },
                    same_key: { type: 'boolean', description: 'true when the credits landed on the key you presented' },
                    recharged: { type: 'boolean' },
                    key_prefix: { type: 'string' },
                    credits: { type: 'integer', example: 1000, description: 'The credits of this bundle' },
                    credits_added: { type: 'integer', example: 1000, description: 'On a recharge: the credits added to the key' },
                    bundle: { type: 'string', example: '1k' },
                    price_paid_usdc: { type: 'number', example: 4 },
                    price_per_call_usdc: { type: 'number', example: 0.004 },
                    first_call: { type: 'string', description: 'On a new key: a curl command that works with it' },
                    usage_hint: { type: 'string' },
                    balance_endpoint: { type: 'string', example: 'GET /v1/credits/balance' },
                    recovery_url: { type: 'string', format: 'uri', description: 'On a new key: fetch it once if this response is lost' },
                    recovery_note: { type: 'string' },
                    note: { type: 'string', description: 'Present when the key you sent was invalid or revoked: the pack is on a NEW key' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          '200': { description: 'This payment was already recorded and its purchase was credited or minted (a replayed request): idempotent: true, nothing credited or minted twice. recovery_url only while the key it minted is active and still recoverable' },
          '402': { description: 'Payment required (x402): bundle price in USDC. A settlement the facilitator REFUSED ends here too (an explicit reason, nothing broadcast), and nothing is credited' },
          '404': { description: 'Unknown bundle slug — choose 1k, 5k or 25k' },
          '409': { description: 'This payment was already seen and its purchase was not credited: "payment_pending" (its settlement is not confirmed yet: do NOT pay again), "payment_refused" (refused when it was settled: sign a new payment), "payment_reversed" (refunded or disputed) or "payment_already_used". Nothing is settled again' },
          '502': { description: 'settlement_unconfirmed: the outcome of the settlement is unknown (settlement.cause: "timeout", "settlement_pending" when the transfer was broadcast but not confirmed yet, or "facilitator_error" for a network error or a 5xx). The payment may have settled: do NOT pay again. The purchase stays pending and is reconciled by hand once the transfer is confirmed on-chain; settlement.transaction carries the transaction hash when the facilitator returned one' },
        },
      },
    },
    '/v1/test-iban': {
      get: {
        operationId: 'getTestIban',
        summary: 'Generate test IBANs with REAL bank codes',
        description:
          'Free. Generates structurally valid test IBANs whose bank codes are drawn from the national registers we serve (CH, DE, AT, BE, SK) — unlike the usual generators, whose checksum-valid IBANs carry arbitrary codes no register allocated. Account digits are random and belong to nobody. Each item ships with the proof: our own bank_code_check answer for that IBAN.',
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
            schema: { type: 'string', enum: ['CH', 'DE', 'AT', 'BE', 'SK'] },
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
        description:
          'Returns example results computed on the request: IBAN validations (the same validation as POST /v1/iban/validate), one compliance check (assembled like POST /v1/iban/compliance) and a summary of two BIC directory rows. No payment required, and readable with a plain GET: the official example IBANs of Switzerland, Belgium and Austria show the verdict of their national register on a bank code a checksum cannot judge. `served_at` dates the answer.',
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
                    served_at: {
                      type: 'string',
                      format: 'date-time',
                      description:
                        'When this answer was computed, ISO 8601 in UTC, to the second. Added on 24/09/2026, so that a copy of this page quoted later dates itself.',
                    },
                    how_to_read: {
                      type: 'string',
                      description:
                        'How to read the verdict on the bank code, for a reader that cannot call the API itself.',
                    },
                    iban_examples: {
                      type: 'array',
                      description:
                        'One validation result per example, computed on the request, each with a `label` that names the example (its bank, or its provenance for an official example IBAN).',
                      // Review of 24/09/2026 (D7): `label` and
                      // `compliance_example` were served and declared nowhere,
                      // and `endpoint` was declared and never served.
                      items: {
                        allOf: [
                          { $ref: '#/components/schemas/IBANValidationResult' },
                          {
                            type: 'object',
                            required: ['label'],
                            properties: {
                              label: {
                                type: 'string',
                                description: 'Names the example: its bank, or its provenance for an official example IBAN.',
                              },
                            },
                          },
                        ],
                      },
                    },
                    bic_examples: {
                      type: 'array',
                      description: 'A summary of the directory row of two BICs, not the full answer of GET /v1/bic/{code}.',
                      items: {
                        type: 'object',
                        properties: {
                          label: { type: 'string' },
                          bic: { type: 'string' },
                          bic8: { type: 'string' },
                          bic11: { type: 'string' },
                          found: { type: 'boolean' },
                          institution: { type: ['string', 'null'] },
                          country: {
                            type: 'object',
                            properties: { code: { type: 'string' }, name: { type: ['string', 'null'] } },
                          },
                          city: { type: ['string', 'null'] },
                          lei: { type: ['string', 'null'] },
                          cost_usdc: { type: 'number', description: 'The list price of a BIC lookup; the demo itself is free.' },
                        },
                      },
                    },
                    compliance_example: {
                      type: 'object',
                      description: 'One compliance check, assembled like the answer of POST /v1/iban/compliance.',
                      required: ['description', 'endpoint', 'cost', 'result'],
                      properties: {
                        description: { type: 'string' },
                        endpoint: { type: 'string', example: 'POST /v1/iban/compliance' },
                        cost: { type: 'string' },
                        result: {
                          oneOf: [
                            {
                              allOf: [
                                { $ref: '#/components/schemas/IBANValidationResult' },
                                {
                                  type: 'object',
                                  required: ['compliance', 'meta'],
                                  properties: {
                                    compliance: { $ref: '#/components/schemas/ComplianceResult' },
                                    meta: {
                                      type: 'object',
                                      description: 'Provenance and scope of the verdict, as in POST /v1/iban/compliance.',
                                    },
                                  },
                                },
                              ],
                            },
                            {
                              type: 'object',
                              required: ['error'],
                              properties: { error: { type: 'string', example: 'Compliance data unavailable' } },
                            },
                          ],
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
          // The tool list is read from the inventory (review of 24/09/2026,
          // D6/D10/D17): "7 MCP tools" was typed here while the transport
          // served eleven, three of them absent from the sentence.
          'Model Context Protocol endpoint — Streamable HTTP transport, JSON-RPC 2.0 over POST. Exposes ' +
          MCP_TOOLS.length +
          ' MCP tools: ' +
          MCP_TOOLS.map((t) => t.name).join(', ') +
          '. With no USDC price: ' +
          MCP_TOOLS.filter((t) => t.price === 'free')
            .map((t) => t.name)
            .join(', ') +
          '. Outside the keyless allowance below (they cost no unit and keep answering once it is spent): ' +
          MCP_TOOLS.filter((t) => ALLOWANCE_EXEMPT_TOOLS.has(t.name))
            .map((t) => t.name)
            .join(', ') +
          '; request_api_key and poll_api_key are the way to a key. Flow: POST an `initialize` request, then `tools/list` and `tools/call` (include the returned Mcp-Session-Id header on follow-up calls). Also available as a stdio server via `npx -y ibanforge-mcp`. This path speaks MCP, not the REST conventions documented elsewhere in this spec. With no credential it answers up to ' +
          MCP_WEEKLY_LIMIT +
          ' tool units a week per source address (one per tool call, one per IBAN in batch_validate_iban; the week is the ISO week in UTC and resets on ' +
          TRIAL_RESET +
          '), an allowance separate from the keyless REST trial.',
        tags: ['MCP'],
        // Anonymous only, and said so (review of 24/09/2026, D8): the HTTP MCP
        // transport answers a weekly free allowance with no credential, and it
        // reads no key at all (the key middleware is mounted on /v1/* only).
        // Declaring `apiKey` here told a client a key would lift that allowance.
        security: [{}],
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
        description:
          'API key (Bearer ifk_xxx) — ' +
          ANONYMOUS_MONTHLY_LIMIT +
          ' free requests/month without an email address, ' +
          FREE_TIER_MONTHLY_LIMIT +
          ' a month once claimed, or a custom quota for paid keys',
      },
      // Le cookie de la page du compte (lot C3). Il ne vaut que sur
      // /v1/account/* : aucune autre route du service ne lit de cookie.
      accountSession: {
        type: 'apiKey',
        in: 'cookie',
        name: ACCOUNT_COOKIE,
        description:
          `Session of the account page, set by POST /v1/account/session: HttpOnly, Secure, SameSite=Strict, Path=/v1/account, ${ACCOUNT_SESSION_DAYS} days from sign-in. ` +
          'Read-only: it opens no paid route and no route that acts on a key.',
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
              'Stable machine-readable token in snake_case, e.g. "invalid_json", "invalid_request", "batch_too_large", "payment_required", "payload_too_large", "rate_limit_exceeded". Branch on this, never on `message`. An invalid IBAN is not an ApiError: validation answers 200 with `valid: false`.',
            example: 'batch_too_large',
          },
          message: {
            type: 'string',
            description: 'Human-readable sentence explaining the failure. Wording may change; the token above will not.',
            example: 'Maximum 100 IBANs per batch request',
          },
        },
      },
      // La vue du compte (GET /v1/account/overview), telle que `buildOverview`
      // la construit dans `src/lib/account.ts`. Jamais servis : la clé brute,
      // son empreinte, sa lignée, une empreinte d'adresse IP.
      AccountOverview: {
        type: 'object',
        required: ['email', 'session_expires_at', 'month', 'page', 'pages', 'keys', 'inactive_keys'],
        properties: {
          email: { type: 'string', description: 'The address typed at sign-in, in lower case.', example: 'you@example.com' },
          session_expires_at: { type: 'string', format: 'date-time', description: 'When the session ends; sign in again after it.' },
          month: { type: 'string', example: '2026-09', description: 'The calendar month (UTC) that calls_this_month counts.' },
          page: { type: 'integer', minimum: 1 },
          pages: { type: 'integer', minimum: 1 },
          keys: { type: 'array', items: { $ref: '#/components/schemas/AccountKey' } },
          inactive_keys: { type: 'integer', description: 'Deactivated keys of the address (revoked or rotated), counted without detail.' },
        },
      },
      AccountKey: {
        type: 'object',
        required: ['key_prefix', 'created_at', 'plan', 'allowance', 'credits', 'subscription', 'calls_this_month', 'last_call_at', 'alerts', 'address_proven', 'actions'],
        properties: {
          key_prefix: { type: 'string', example: 'ifk_3f9c1a7e', description: 'The prefix of the key. The key itself is never served.' },
          created_at: { type: ['string', 'null'], format: 'date-time' },
          plan: {
            type: 'string',
            enum: ['free', 'custom', 'pack', 'none', 'pro', 'editor', 'free+pack', 'custom+pack', 'pro+pack', 'editor+pack'],
            description: 'A key that holds an allowance AND prepaid credits carries both parts, such as free+pack: the allowance is drawn first, then the credits.',
          },
          allowance: {
            type: ['object', 'null'],
            description: 'The allowance, with the figures of GET /v1/keys/usage. null on a key born of a purchase, which has no allowance of its own and whose balance is in credits.',
            properties: {
              basis: { type: 'string', enum: ['monthly', 'lifetime'] },
              limit: { type: 'integer' },
              used: { type: 'integer' },
              remaining: { type: 'integer' },
            },
          },
          credits: {
            type: ['object', 'null'],
            description: 'The prepaid balance of a key that holds credits, alone or beside an allowance. purchased_total is the total ever bought on the key, recharges included. null on a key without credits.',
            properties: { remaining: { type: 'integer' }, purchased_total: { type: 'integer' } },
          },
          subscription: {
            type: ['object', 'null'],
            properties: {
              plan: { type: 'string', enum: ['pro', 'editor'] },
              status: { type: 'string', enum: ['active'] },
              manage_url: { type: 'string', format: 'uri', description: 'The customer portal: card, invoices, cancellation.' },
            },
          },
          calls_this_month: { type: 'integer', description: 'Calls billed to the key this month, credit calls included.' },
          last_call_at: { type: ['string', 'null'], format: 'date-time' },
          alerts: {
            type: 'array',
            description: 'The alerts mailed for this key, the most recent first.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['quota_80', 'credits_low'] },
                sent_at: { type: ['string', 'null'], format: 'date-time' },
              },
            },
          },
          address_proven: {
            type: 'boolean',
            description: 'True when the address of this key was proven by a code (created or claimed with a 6-digit code). An address typed at a checkout, or given to a first key without a code, is not: the page then asks you to recognise the key before recharging it.',
          },
          actions: {
            type: 'object',
            description: 'Links the page may offer. topup recharges THIS key by card (the links carry its recharge reference, never the key); subscribe_pro is the Pro link that puts the subscription on THIS key, null on a key that already carries one; manage_subscription is the portal of a subscribed key.',
            properties: {
              topup: {
                type: ['object', 'null'],
                properties: {
                  '1k': { type: 'string', format: 'uri' },
                  '5k': { type: 'string', format: 'uri' },
                  '25k': { type: 'string', format: 'uri' },
                },
              },
              subscribe_pro: { type: ['string', 'null'] },
              manage_subscription: { type: ['string', 'null'] },
            },
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
              'Present ONLY on a call served by the keyless weekly trial: POST /v1/iban/validate with a real `iban` and no API key is served ' +
              REST_TRIAL_WEEKLY_LIMIT +
              ' times a week per source address (IPv6 counted per /64; ISO week in UTC, reset on ' +
              TRIAL_RESET +
              '), with no payment. Says how many calls are left this week, when the count resets, and how to take a free key. Absent with a key, with an x402 payment, and on every other endpoint. Until 24 September 2026 the trial was daily and this block carried `calls_used_today`, `calls_left_today` and `daily_limit`; they were replaced, not kept, because they would have carried weekly counts under daily names.',
            required: [
              'calls_used_this_week',
              'calls_left_this_week',
              'weekly_limit',
              'resets',
              'resets_at',
              'free_key',
              'docs',
            ],
            properties: {
              calls_used_this_week: { type: 'integer', example: 1 },
              calls_left_this_week: { type: 'integer', example: REST_TRIAL_WEEKLY_LIMIT - 1 },
              weekly_limit: { type: 'integer', example: REST_TRIAL_WEEKLY_LIMIT },
              resets: { type: 'string', example: TRIAL_RESET },
              resets_at: {
                type: 'string',
                format: 'date-time',
                description: 'Next Monday 00:00:00 UTC: the instant the weekly count goes back to zero.',
                example: trialResetsAt(new Date('2026-09-24T12:00:00Z')),
              },
              free_key: {
                type: 'string',
                description:
                  'The request that ends the trial in your favour: a key that needs no email address, on every endpoint, ' +
                  FREE_TIER_MONTHLY_LIMIT +
                  ' requests a month once claimed (' +
                  ANONYMOUS_MONTHLY_LIMIT +
                  ' a month before that).',
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
          valid: {
            type: 'boolean',
            description:
              'ISO 13616 only: structure and mod-97. It says nothing about the bank: read bank_code_holder and checks before a payment.',
          },
          // Ajoutés le 25/09/2026 à côté de `valid`, qui ne change pas.
          bank_code_holder: {
            type: 'string',
            enum: [...BANK_CODE_HOLDERS],
            description: `${BANK_CODE_HOLDER_NOTE} Present ONLY when valid is true and the bank code was read from the BBAN.`,
          },
          checks: {
            type: 'object',
            description: CHECKS_NOTE,
            required: [...CHECK_KEYS],
            properties: Object.fromEntries(
              CHECK_KEYS.map((k) => [k, { type: 'string', enum: [...CHECK_VALUES[k]] }]),
            ),
          },
          // Ajouté le 25/09/2026 : la preuve de checks.national_check_digits hors du
          // Royaume-Uni. `country` et `scheme` restent des chaînes (pas d'enum) :
          // l'Allemagne en ajoutera, et un enum fermé casserait les clients générés.
          national_check_digits: {
            type: 'object',
            description: NATIONAL_CHECK_DIGITS_NOTE,
            required: ['country', 'scheme', 'status'],
            properties: {
              country: {
                type: 'string',
                example: NATIONAL_CHECK_COUNTRIES[0],
                description: `The IBAN country: MC stays MC, SM stays SM. Today: ${NATIONAL_CHECK_COUNTRIES.join(', ')}.`,
              },
              scheme: {
                type: 'string',
                example: NATIONAL_CHECK_SCHEME_NAMES[0],
                description: `The algorithm applied, a stable snake_case name. Today: ${NATIONAL_CHECK_SCHEME_NAMES.join(', ')}.`,
              },
              status: { type: 'string', enum: [...NATIONAL_CHECK_STATUSES] },
              detail: {
                type: 'string',
                description:
                  'Present on fail and not_applicable only: one sentence saying which digits disagree. It never gives the expected key.',
              },
            },
          },
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
              code: {
                type: 'string',
                example: 'UBSWCHZH56B',
                description:
                  'The BIC as the consulted source publishes it: 8 or 11 characters. Do NOT compare a supplied BIC against this field — compare on bic8 and read the branch code separately.',
              },
              bic8: {
                type: 'string',
                example: 'UBSWCHZH',
                description:
                  'The eight characters of the institution, and the field to compare a supplied BIC against. The branch code (the last three characters of `code`) is informational: in a cooperative network it names the LOCAL bank while the first eight name its clearing institution, so an equality test on the full code turns a correct BIC into a mismatch.',
              },
              redirected_from: {
                type: 'string',
                example: '04835',
                description:
                  'The bank code you asked about, when the register answered for the one that took over its clearing. CH and LI only today: SIX marks an IID concatenated and publishes its successor. The IBAN stays valid and the account payable — a redirect is not a retirement.',
              },
              bank_name: { type: ['string', 'null'], description: 'Null, never an empty string, when no source names the institution.' },
              city: {
                type: ['string', 'null'],
                description:
                  'Where the consulted register places THIS bank code. May differ from address.city, which is the legal seat — both true, different questions. Null, never an empty string, when the source leaves the town blank.',
              },
              source: { type: ['string', 'null'], description: 'Which dataset named this institution.' },
              as_of: { type: ['string', 'null'], description: 'Year-month that dataset was last refreshed. This dates the IMPORT, which for one source is not the date of the data — see source_as_of.' },
              source_as_of: {
                type: 'string',
                description: BIC_SOURCE_AS_OF_NOTE,
              },
              listed_in_current_source: {
                type: ['boolean', 'null'],
                description: LISTED_IN_CURRENT_SOURCE_NOTE,
              },
              basis: {
                type: 'string',
                enum: ['national_register', 'curated_map', 'directory_prefix'],
                description:
                  'WHERE the bank code to BIC pairing came from, and therefore what may be done with the BIC. ' +
                  `national_register: the country's own register publishes this BIC for this bank code — today ${nationalRegisterBicNames()}; the SIX BankMaster carries the exact 11-character BIC per IID and the German Bankleitzahlendatei per BLZ. ` +
                  'curated_map: our maintained bank-code map made the pairing on an exact key. Usually right, and not an allocation record. ' +
                  'directory_prefix: the bic8 LIKE fallback, which can match several institutions at once — read bank_code_check.candidates. ' +
                  'Answers the settlement question directly: only national_register is settlement-grade, so outside those registers a derived BIC is advisory and should be confirmed with the beneficiary or your bank before it becomes a stored routing instruction.',
              },
              authoritative: {
                type: 'boolean',
                description:
                  'Whether this BIC may be stored and settled against. Derived from `basis` by a single table, so the two cannot disagree. ' +
                  'NOT the same claim as bank_code_check.authoritative, which is about the BANK CODE — whether a national register was consulted about its existence. San Marino is where they part: the pairing is the supervisor\'s, while the code space is not its to settle.',
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
              // Served by this endpoint since the ISO 20022 work of 2026-08 and
              // declared only on /v1/bic/{code} until now: the same block, from
              // the same builder, was invisible here to anyone coding against
              // the contract.
              postal_address: POSTAL_ADDRESS_SCHEMA,
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
            enum: IBAN_ERROR_CODES,
            description:
              'Present ONLY when `valid` is false, on an HTTP 200: an invalid IBAN is not an HTTP error. Absent on every successful validation.',
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
                  'SEPA schemes available for this account. When the resolved institution has rows in the EPC scheme registers these are ITS schemes (basis = "epc_register"); otherwise the country-level schemes (basis = "country_default"), even for a bank code nobody holds: for the bank itself, read bank_schemes and bank_reachability. SCT = Credit Transfer, SDD = Direct Debit, SCT_INST = Instant Credit Transfer.',
                items: {
                  type: 'string',
                  enum: ['SCT', 'SDD', 'SCT_INST'],
                },
              },
              vop_required: {
                type: 'boolean',
                description:
                  "Whether Verification of Payee (VoP) is required under the EU Instant Payments Regulation in this COUNTRY. It says nothing about the bank: read vop_register_status for the payee's bank.",
              },
              vop_participant: {
                type: ['boolean', 'null'],
                description:
                  'Bank-level VoP readiness: true when the resolved institution is listed as "ready" in the EPC Verification of Payee scheme register; false when it is not; null when no institution was resolved or when the VoP register is not loaded on this deployment (not consulted, which is not a "no"); a resolved bank outside the SEPA area is answered false from the country either way. Listing means the bank answers VoP requests — it does not run the name check for you. The same as vop_register_status === "active"; vop_register_status also says pending.',
              },
              bank_reachability: {
                type: ['string', 'null'],
                enum: ['listed', 'not_listed', 'no_bank', 'bank_code_not_allocated', null],
                description: BANK_REACHABILITY_NOTE,
              },
              bank_schemes: {
                type: ['array', 'null'],
                items: { type: 'string', enum: ['SCT', 'SDD', 'SCT_INST'] },
                description:
                  "The bank's own schemes from the EPC registers when bank_reachability is listed; [] for a bank code nobody holds; null otherwise. Absent outside SEPA.",
              },
              vop_register_status: {
                type: ['string', 'null'],
                enum: ['active', 'pending', 'inactive', 'not_listed', null],
                description: `${VOP_REGISTER_STATUS_NOTE} Absent outside SEPA.`,
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
                  "The COUNTRY's Verification of Payee obligation, identical to sepa.vop_required. It says nothing about the institution: for the payee's bank, read sepa.vop_register_status.",
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
            enum: IBAN_ERROR_CODES,
          },
          error_detail: { type: 'string', description: 'Only when valid=false' },
          upgrade_to_full_validation: {
            type: 'string',
            description:
              'Says what `valid: true` means on this route (well formed, nothing more) and what POST /v1/iban/validate adds: the bank and its BIC with their source, SEPA and VoP readiness, and, where the national register is read, whether the bank code is allocated at all',
          },
        },
      },
      GbFirmResult: {
        type: 'object',
        description:
          'One entry of the FCA Financial Services Register. Field values are the register’s own strings, never folded into an enum: the FCA adds statuses without notice. Strings are null when the register publishes nothing under that key.',
        required: ['frn', 'found', 'source', 'source_url', 'retrieved_at', 'cache', 'disclaimer', 'cost_usdc'],
        properties: {
          frn: { type: 'string', example: '123456' },
          found: {
            type: 'boolean',
            description: 'False when no firm carries the number: an absence in the register, not a finding about anyone.',
          },
          name: { type: ['string', 'null'], example: 'Alpha Bank Example Ltd' },
          status: {
            type: ['string', 'null'],
            description: 'Register status verbatim, e.g. "Authorised", "No longer authorised", "Appointed representative", "Registered".',
            example: 'Authorised',
          },
          status_effective_date: {
            type: ['string', 'null'],
            description: 'YYYY-MM-DD when the register’s dd/mm/yyyy could be read; the register’s own string otherwise.',
            example: '2004-09-01',
          },
          business_type: { type: ['string', 'null'], example: 'Regulated' },
          companies_house_number: { type: ['string', 'null'] },
          client_money_permission: { type: ['string', 'null'] },
          sub_status: { type: ['string', 'null'] },
          sub_status_effective_from: { type: ['string', 'null'] },
          mlrs_status: { type: ['string', 'null'], description: 'Money Laundering Regulations registration status.' },
          mlrs_status_effective_date: { type: ['string', 'null'] },
          psd_emd_status: { type: ['string', 'null'], description: 'Payment Services / E-Money Regulations status.' },
          psd_emd_effective_date: { type: ['string', 'null'] },
          psd_agent_status: { type: ['string', 'null'] },
          e_money_agent_status: { type: ['string', 'null'] },
          mutual_society_number: { type: ['string', 'null'] },
          notices: {
            type: 'array',
            description: 'The register’s "exceptional information" notices on the firm, verbatim.',
            items: {
              type: 'object',
              required: ['title', 'body'],
              properties: { title: { type: 'string' }, body: { type: 'string' } },
            },
          },
          register_timestamp: {
            type: ['string', 'null'],
            description: 'When the FCA last touched the entry, in the register’s local time (no zone published, none invented).',
          },
          source: { type: 'string', enum: ['FCA Financial Services Register'] },
          source_url: { type: 'string', format: 'uri', description: 'The firm on the public register (a search by FRN).' },
          retrieved_at: { type: 'string', format: 'date-time', description: 'When the register was asked, UTC.' },
          cache: {
            type: 'object',
            required: ['hit', 'stale', 'expires_at'],
            properties: {
              hit: { type: 'boolean', description: 'Served from the one-day cache.' },
              stale: {
                type: 'boolean',
                description: 'True when the register was down and an expired copy (under thirty hours old) was served.',
              },
              expires_at: { type: 'string', format: 'date-time' },
            },
          },
          disclaimer: { type: 'string', description: 'The FCA’s exclusion of liability; the register prevails.' },
          note: { type: 'string', description: 'Present on a miss only.' },
          attribution: {
            type: 'object',
            description: 'Free tier only: display `text` with a link to `url` when the result is shown to people.',
            properties: {
              required: { type: 'boolean', enum: [true] },
              text: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              note: { type: 'string' },
            },
          },
          cost_usdc: { type: 'number', example: 0.003 },
          processing_ms: { type: 'number' },
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
          found: {
            type: 'boolean',
            description: 'True only when the directory row names an institution: a record is complete or not found.',
          },
          valid_format: { type: 'boolean' },
          institution: { type: ['string', 'null'], example: 'UBS AG' },
          country: {
            type: 'object',
            required: ['code', 'name'],
            properties: {
              code: { type: 'string', example: 'CH', description: 'Always characters 5-6 of the BIC.' },
              name: {
                type: 'string',
                example: 'Switzerland',
                description:
                  "The row's country name, then the ISO name, and the code only when neither exists. Named on a BIC we do not hold as well.",
              },
            },
          },
          city: { type: ['string', 'null'], description: 'Null, never an empty string, when the source leaves the town blank.' },
          address: {
            // Nullable depuis le 25/09/2026 (relecture de la PR 254, R5) : la
            // route sert toujours la clé, à `null` sans adresse enregistrée,
            // trouvé ou non. Le bloc jumeau de la validation l'était déjà.
            type: ['object', 'null'],
            description: 'Registered head-office address (present when available, GLEIF or directory sourced). null when no registered address is on file, found or not; address_available says the same.',
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
          source: { type: ['string', 'null'], description: 'Code of the dataset this row comes from; source_name spells it out.' },
          source_name: {
            type: ['string', 'null'],
            example: 'GLEIF LEI-to-BIC mapping',
            description: 'Human name of the dataset this row comes from. Null when nothing was found.',
          },
          source_as_of: {
            type: 'string',
            example: frozenSources()[0]?.as_of,
            description:
              "Year-month the source DATA is from, present ONLY when the row's dataset is a frozen public copy re-imported unchanged. Absent means no gap has been established, never 'this is current'.",
          },
          listed_in_current_source: {
            type: ['boolean', 'null'],
            description:
              'Whether the BIC8 asked about still appears in a list refreshed this cycle (GLEIF, the directory sources that carry no vintage, a national register, the EPC scheme registers), on every answer of valid format, found or not: a BIC absent from the directory can still be listed by an EPC register. true when one of them carries it; null when it was not found in what could be read in full (never false by default). It answers true or null today: the EBA STEP2 and NBP lists are only read through our deduplicated directory, so an absence is not proven. It does not prove the bank still exists under this name.',
          },
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
                description: 'true when the institution appears on a screened list, false when it does not, null when the screen could not run, or when nothing matched while one of the lists this service names is not loaded on this deployment (see unscreened_lists): a no on the lists read is not a no on the missing one.',
              },
              unscreened_lists: {
                type: 'array',
                items: { type: 'string' },
                description: 'Present only when one of the lists this service names is not loaded on this deployment: those lists were not consulted. Absent when every named list was read.',
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
      // La réponse de la forme BIC de POST /v1/iban/compliance (relecture de la
      // PR 254, R4), même forme que BicComplianceResponse dans src/types.ts.
      BicComplianceResponse: {
        type: 'object',
        description:
          'The answer to POST /v1/iban/compliance with a `bic`: the bank screened directly, without an IBAN. `found` says whether our directory names the institution, independently of the screen: found false with bank_sanctioned true is a real combination.',
        required: ['bic', 'bic8', 'valid_format', 'found', 'institution', 'country', 'compliance', 'meta', 'cost_usdc'],
        properties: {
          bic: { type: 'string', example: 'COBADEFF' },
          bic8: { type: 'string', example: 'COBADEFF' },
          valid_format: { type: 'boolean' },
          found: {
            type: 'boolean',
            description: 'True only when the directory row names an institution.',
          },
          institution: { type: ['string', 'null'] },
          country: {
            type: 'object',
            required: ['code', 'name'],
            properties: {
              code: { type: 'string', description: 'Always characters 5-6 of the BIC.' },
              name: { type: 'string', description: "The row's country name, then the ISO name, and the code only when neither exists." },
            },
          },
          compliance: { $ref: '#/components/schemas/ComplianceResult' },
          meta: {
            type: 'object',
            description: 'The same provenance and scope block as on the IBAN form (scope, disclaimer, sanctions_as_of, fatf_as_of, sources).',
            required: ['scope', 'disclaimer'],
          },
          cost_usdc: { type: 'number' },
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
              bank_sanctioned: {
                type: 'boolean',
                description: 'False also when no bank was screened (bank_screened false): read institution_listed, which is null then.',
              },
              matched_lists: { type: 'array', items: { type: 'string' }, example: ['OFAC'] },
              fatf_status: { type: 'string', enum: ['member', 'grey_list', 'black_list', 'suspended', 'non_member'] },
              bank_screened: {
                type: 'boolean',
                description: 'Whether a bank was screened at all. When false, bank_sanctioned and matched_lists carry no information.',
              },
              institution_listed: {
                type: ['boolean', 'null'],
                description:
                  "Whether the payee's BANK is on a sanctions list: bank_sanctioned when a bank was screened against every list this service names; null when no bank was screened, or when nothing matched while one of those lists is not loaded on this deployment. Never false without a screen.",
              },
              payee_screened: {
                type: 'boolean',
                enum: [false],
                description: 'Always false: the payee (the account holder) is never screened here, only the bank and the country.',
              },
            },
          },
          reachability: {
            type: 'object',
            properties: {
              sepa_instant: { type: 'boolean', description: 'Whether the bank supports SEPA Instant Credit Transfer' },
              sct: { type: 'boolean', description: 'SEPA Credit Transfer participant' },
              sdd: { type: 'boolean', description: 'SEPA Direct Debit participant' },
              screened: {
                type: 'boolean',
                description:
                  'False when the EPC scheme registers were not consulted: no bank resolved, or the registers are not loaded on this deployment. The three booleans above are then defaults, not findings, and carry no risk weight (flag sepa_register_unavailable when a bank was resolved). Outside the SEPA area the country answers instead of the registers: screened stays true.',
              },
              listed_in_epc_registers: {
                type: ['boolean', 'null'],
                description:
                  'Whether at least one of the three scheme registers lists the bank; null when the registers were not consulted (screened false). For a bank resolved in the SEPA area, true matches sepa.bank_reachability listed and false matches not_listed; null also when no bank was resolved or the bank code is not allocated (the validation then says no_bank or bank_code_not_allocated). Outside the SEPA area the validation carries no bank_reachability: this field is false there for a resolved bank (the country answers, screened true) and null when no bank was resolved.',
              },
            },
          },
          vop: {
            type: 'object',
            properties: {
              participant: { type: 'boolean', description: 'Whether the bank participates in Verification of Payee' },
              status: { type: 'string', enum: ['active', 'pending', 'inactive', 'not_found'] },
              screened: {
                type: 'boolean',
                description:
                  'False when the EPC VoP register was not consulted: no bank resolved, or the register is not loaded on this deployment. `status: not_found` then describes the absence of a query, not of a registration (flag vop_register_unavailable when a bank was resolved). Outside the SEPA area the country answers instead of the register: screened stays true.',
              },
              register_status: {
                type: ['string', 'null'],
                enum: ['active', 'pending', 'inactive', 'not_listed', null],
                description: `status under its own name (not_found becomes not_listed); null when the register was not consulted (screened false). ${VOP_REGISTER_STATUS_NOTE}`,
              },
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
          flags: { type: 'array', items: { type: 'string' }, description: 'List of specific risk flags detected. bank_code_inferred carries no weight: the bank named is our inference from a source that does not settle the bank code (bank_code_holder inferred), and no score moves for it. Some flags carry no weight and name a check that did not happen: no_bank_resolved, sepa_register_unavailable, vop_register_unavailable, and sanctions_list_unavailable_<list> (one per named sanctions list not loaded on this deployment, for example sanctions_list_unavailable_un: the bank was screened against the other lists, so bank_sanctioned false says nothing about that one). sanctions_lists_unavailable (a bank was resolved but no sanctions list is loaded on this deployment) holds the score at 50 at least.', example: ['fatf_grey_list', 'emi_issuer', 'no_vop'] },
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
          served_at: {
            type: 'string',
            format: 'date-time',
            description:
              'When this answer left the server, ISO 8601 in UTC, to the second. Added on 24/09/2026: a copy of this endpoint quoted from an index or a cache now carries its own date.',
          },
          uptime_seconds: { type: 'number' },
          bic_database_entries: {
            type: 'integer',
            description: `Number of BIC entries currently loaded: GLEIF and national registers are refreshed monthly; the SwiftCodes rows are a public copy of the SWIFT directory frozen in ${frozenBicShare().month ?? 'an earlier year'}, re-imported unchanged. Each source's own data date is its source_as_of in bic_sources.`,
            example: getEntryCount(),
          },
          bic_data_last_updated: { type: 'string', description: 'Last update timestamp of BIC data' },
          // Served since 01/09/2026 and declared only now (25/09/2026), with
          // its new neighbour below.
          bic_sources: {
            type: 'array',
            description:
              'Per-source freshness of the BIC directory. last_updated dates the IMPORT; source_as_of dates the upstream DATA where the two differ (a frozen public copy), null when no gap has been established. stale is true when the import is overdue or the source itself is frozen, and stale_reason says which.',
            items: {
              type: 'object',
              required: ['source', 'entries', 'last_updated', 'source_as_of', 'stale', 'stale_reason'],
              properties: {
                source: { type: 'string' },
                entries: { type: 'integer' },
                last_updated: { type: ['string', 'null'] },
                source_as_of: { type: ['string', 'null'] },
                stale: { type: 'boolean' },
                stale_reason: { type: ['string', 'null'], enum: ['import_overdue', 'source_frozen', null] },
              },
            },
          },
          frozen_bic_sources: {
            type: 'array',
            description:
              'One entry per frozen source (the ones bic_sources dates with a source_as_of): its rows and BIC8, and how many of them no source refreshed this cycle still carries (GLEIF and the other directory sources without a vintage, the national registers, the EPC scheme registers). Recomputed at each deployment. When a trace source could not be read in full, complete is false and the two *_without_current_trace counts are null rather than guessed; that is the case today, because the EBA STEP2 and NBP lists are only read through our deduplicated directory. An empty array means the figures could not be computed; it never turns this endpoint red.',
            items: {
              type: 'object',
              required: [
                'source',
                'source_as_of',
                'rows',
                'bic8',
                'rows_without_current_trace',
                'bic8_without_current_trace',
                'complete',
              ],
              properties: {
                source: { type: 'string' },
                source_as_of: { type: 'string', description: 'Year-month the source DATA is from.' },
                rows: { type: 'integer' },
                bic8: { type: 'integer' },
                rows_without_current_trace: { type: ['integer', 'null'] },
                bic8_without_current_trace: { type: ['integer', 'null'] },
                complete: { type: 'boolean' },
              },
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
    {
      name: 'UK register',
      description:
        'One UK-regulated firm per request from the FCA Financial Services Register, under its written permission (paid via x402 or an API key)',
    },
    { name: 'Compliance', description: 'Compliance check endpoint — IBAN validation + sanctions + SEPA + VoP + risk score (paid via x402)' },
    { name: 'Swiss Clearing', description: 'Swiss BC-Nummer / IID clearing lookup (paid via x402)' },
    {
      name: 'API Keys',
      description:
        'API key management — mint a key with or without an email address, claim it, rotate it, check its usage',
    },
    {
      name: 'Account',
      description: `The account page, ${ACCOUNT_PAGE}, for a person in a browser: a 6-digit code mailed to the address of the keys, then a read-only session cookie that shows every key of that address. Rotating or revoking a key still takes the key itself.`,
    },
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

const buildSpec = () => {
  const spec = withErrorContract(buildRawSpec());
  // The UK firm lookup answers 503 `not_configured` on a deployment without the
  // FCA Register credential — which production is. A contract must not promise
  // a route that answers 503 to everyone: agents read it and try it as written
  // (production audit of 16/09/2026, I2: 31 such calls in two weeks). The path
  // comes back the day the credential is set.
  if (!isFcaRegisterConfigured()) {
    delete (spec.paths as Record<string, unknown>)['/v1/gb/firm/{frn}'];
  }
  return spec;
};

let specCache: ReturnType<typeof buildSpec> | null = null;

openapi.get('/openapi.json', (c) => {
  if (!specCache) specCache = buildSpec();
  // 137 KB served without a key and exempt from the rate limiter: let caches
  // and proxies keep it an hour (audit of 16/09/2026, constat 8).
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(specCache);
});

// buildSpec is exported for the contract linter (scripts/dump-openapi.ts).
// Governance is only worth something if it runs: the document is generated from
// code, so the only way it cannot drift from its own ruleset is for CI to
// regenerate it and lint the regenerated copy on every push.
export { openapi, buildSpec };
