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
  COUNTRY_NAMES,
  getSepaInfo,
} from '../lib/countries.js';

const ibanStructure = new Hono();

// One canonical example per country code — used by agents to copy-paste a
// known-valid IBAN and try it immediately. Picked from public/test data only.
const EXAMPLE_IBANS: Record<string, string> = {
  AD: 'AD1200012030200359100100',
  AT: 'AT611904300234573201',
  BE: 'BE68539007547034',
  CH: 'CH9300762011623852957',
  CZ: 'CZ6508000000192000145399',
  DE: 'DE89370400440532013000',
  DK: 'DK5000400440116243',
  ES: 'ES9121000418450200051332',
  FI: 'FI2112345600000785',
  FR: 'FR1420041010050500013M02606',
  GB: 'GB29NWBK60161331926819',
  GR: 'GR1601101250000000012300695',
  HR: 'HR1210010051863000160',
  HU: 'HU42117730161111101800000000',
  IE: 'IE29AIBK93115212345678',
  IT: 'IT60X0542811101000000123456',
  LI: 'LI21088100002324013AA',
  LU: 'LU280019400644750000',
  MC: 'MC5811222000010123456789030',
  NL: 'NL91ABNA0417164300',
  NO: 'NO9386011117947',
  PL: 'PL61109010140000071219812874',
  PT: 'PT50000201231234567890154',
  SE: 'SE4550000000058398257466',
  SI: 'SI56263300012039086',
  SK: 'SK3112000000198742637541',
};

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
          bank_code: { start: bban.bankCode[0], length: bban.bankCode[1] },
          ...(bban.branchCode ? { branch_code: { start: bban.branchCode[0], length: bban.branchCode[1] } } : {}),
          account_number: { start: bban.accountNumber[0], length: bban.accountNumber[1] },
        }
      : null,
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
