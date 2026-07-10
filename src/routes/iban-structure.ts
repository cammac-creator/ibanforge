/**
 * GET /v1/iban/structure/:country — FREE pure-metadata endpoint
 *
 * Returns the IBAN structural template for a country: total IBAN length,
 * BBAN field positions (bank code / branch code / account number), SEPA
 * membership and VoP obligation, plus an example IBAN.
 *
 * Why this exists:
 *   - Discovery scanners (Decixa, x402scan, Smithery healthcheck) probe our
 *     paid endpoints and uniformly receive HTTP 402, which counts as a
 *     "non-200 result" in some scoring rubrics. A free metadata endpoint
 *     with a 200 result lets those scanners check a green box and pushes us
 *     up their indexing rank.
 *   - LLM agents preparing an IBAN-related task often need the structure
 *     before crafting their first call (length, expected fields). Today they
 *     scrape Wikipedia / IBAN.com — we can serve it cleanly at $0.
 *   - It complements GET /v1/iban/format (which validates a *given* IBAN
 *     against the structure) by exposing the structure itself.
 *
 * No DB hit, no payment, no auth.
 */
import { Hono } from 'hono';
import {
  IBAN_LENGTHS,
  BBAN_STRUCTURE,
  BBAN_SPECS,
  EXAMPLE_IBANS,
  COUNTRY_NAMES,
  getSepaInfo,
  getBBANFieldSpec,
} from '../lib/countries.js';

const ibanStructure = new Hono();

ibanStructure.get('/v1/iban/structure/:country', (c) => {
  const raw = c.req.param('country').toUpperCase();

  // Catch the OpenAPI placeholder mistake — same pattern as /v1/bic/:code.
  if (raw === '{COUNTRY}' || /^\{.*\}$/.test(raw)) {
    return c.json({
      error: 'placeholder_literal',
      message: "You sent the literal OpenAPI placeholder. Substitute with a real ISO 3166-1 alpha-2 country code.",
      example: 'GET /v1/iban/structure/CH',
      schema: 'https://api.ibanforge.com/openapi.json',
    }, 400);
  }

  if (!/^[A-Z]{2}$/.test(raw)) {
    return c.json({
      error: 'invalid_country_code',
      message: 'Country code must be 2 uppercase ISO 3166-1 alpha-2 letters.',
      example: 'GET /v1/iban/structure/CH',
    }, 400);
  }

  const length = IBAN_LENGTHS[raw];
  if (!length) {
    return c.json({
      error: 'unsupported_country',
      message: `'${raw}' is not a recognised IBAN country. We cover 89 countries — see /v1/iban/structure for the full list.`,
      countries_endpoint: 'GET /v1/iban/structure (list)',
    }, 404);
  }

  const bban = BBAN_STRUCTURE[raw];
  const sepa = getSepaInfo(raw);
  const example = EXAMPLE_IBANS[raw];

  return c.json({
    country: { code: raw, name: COUNTRY_NAMES[raw] ?? raw },
    iban_length: length,
    bban_length: length - 4,
    bban: bban
      ? {
          // `charset` uses SWIFT registry notation per field: n=digits,
          // a=uppercase letters, c=alphanumeric (e.g. '8!n', '4!a2!n').
          bank_code: {
            start: bban.bankCode[0],
            length: bban.bankCode[1],
            charset: getBBANFieldSpec(raw, bban.bankCode[0], bban.bankCode[1]),
          },
          ...(bban.branchCode
            ? {
                branch_code: {
                  start: bban.branchCode[0],
                  length: bban.branchCode[1],
                  charset: getBBANFieldSpec(raw, bban.branchCode[0], bban.branchCode[1]),
                },
              }
            : {}),
          account_number: {
            start: bban.accountNumber[0],
            length: bban.accountNumber[1],
            charset: getBBANFieldSpec(raw, bban.accountNumber[0], bban.accountNumber[1]),
          },
        }
      : null,
    // Full BBAN pattern in SWIFT IBAN Registry notation — what /v1/iban/validate
    // enforces structurally on top of length + mod-97.
    bban_pattern: BBAN_SPECS[raw] ?? null,
    sepa: {
      member: sepa.member,
      schemes: sepa.schemes,
      vop_required: sepa.vop_required,
    },
    example_iban: example ?? null,
    notes: bban
      ? 'BBAN positions are 0-indexed within the BBAN portion of the IBAN (after country code + check digits).'
      : 'BBAN structure not declared for this country — we still validate the IBAN length and mod-97 checksum, but cannot break the BBAN into fields.',
    upgrade_hint: example
      ? `Try the canonical example: GET /v1/iban/format?iban=${example}  or  POST /v1/iban/validate (with full enrichment, $0.005)`
      : undefined,
    cost_usdc: 0,
  });
});

// List all supported countries (also a free endpoint, useful for agents
// building a country picker or doing capability discovery).
ibanStructure.get('/v1/iban/structure', (c) => {
  const countries = Object.keys(IBAN_LENGTHS)
    .sort()
    .map((code) => ({
      code,
      name: COUNTRY_NAMES[code] ?? code,
      iban_length: IBAN_LENGTHS[code],
      sepa_member: getSepaInfo(code).member,
      has_bban_structure: code in BBAN_STRUCTURE,
      has_example: code in EXAMPLE_IBANS,
    }));
  return c.json({
    total: countries.length,
    countries,
    endpoint_per_country: 'GET /v1/iban/structure/:country',
    cost_usdc: 0,
  });
});

export { ibanStructure };
