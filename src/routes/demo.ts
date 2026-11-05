import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { validateBIC } from '../lib/bic-validator.js';
import { lookup } from '../lib/bic-lookup.js';
import { servedAt } from '../lib/served-at.js';
import { COUNTRY_NAMES, EXAMPLE_IBANS } from '../lib/countries.js';

const demo = new Hono();

/**
 * The IBANs this page validates, live, on every request.
 *
 * The Swiss label used to read "Credit Suisse" while the answer said UBS: the
 * SIX register redirects the retired IID 04835 to UBS Switzerland AG (IID
 * 00230), and `bic.redirected_from` carries the old code. The label now says
 * what the answer shows (review of 24/09/2026).
 */
export const DEMO_IBANS = [
  { iban: 'GB29NWBK60161331926819', label: 'UK — NatWest' },
  { iban: 'DE89370400440532013000', label: 'Germany — Commerzbank' },
  {
    iban: 'CH5604835012345678009',
    label:
      'Switzerland — former Credit Suisse IID 04835, redirected by the SIX register to UBS Switzerland AG (IID 00230)',
  },
  { iban: 'FR7630006000011234567890189', label: 'France — Credit Agricole' },
];

/**
 * The official example IBANs of three countries whose national register we
 * read in full.
 *
 * They pass mod-97 and appear in countless tutorials, and on 24/09/2026 each of
 * them came back `not_in_register`, `reason: "not_allocated"`,
 * `authoritative: true`: the register allocates the bank code to nobody. That
 * is the one thing a checksum cannot see and the check exists for, and until
 * this list the free demo never showed it: an assistant that can only read
 * pages, and found this one, saw four banks that exist.
 *
 * The labels name the PROVENANCE, never the verdict: the answer below each
 * label is computed on the request, from the register as it stands that month.
 * demo.test.ts asserts the shape of the demo on invented Austrian and Belgian
 * registers (those two registers leave the public repository, decision of
 * 24/09/2026). The rule "the example leaves this list the day its register
 * allocates the code" is checked against the real registers by
 * demo-examples-real-data.test.ts, which fails rather than skips when a
 * register is missing: it moves to the private quality gate with the registers.
 */
export const OFFICIAL_EXAMPLE_IBANS = [
  {
    iban: 'CH9300762011623852957',
    label: 'Switzerland — official example IBAN of the ISO 13616 registry (IID 00762)',
  },
  {
    iban: 'BE68539007547034',
    label: 'Belgium — official example IBAN of the ISO 13616 registry (bank code 539)',
  },
  {
    iban: 'AT611904300234573201',
    label: 'Austria — official example IBAN of the ISO 13616 registry (bank code 19043)',
  },
];

const DEMO_BICS = [
  { bic: 'UBSWCHZH', label: 'UBS — Switzerland' },
  { bic: 'BNPAFRPP', label: 'BNP Paribas — France' },
];

/**
 * How to read this page, for the reader that cannot call the API.
 *
 * Deliberately free of any verdict and of any figure: the answers below say
 * both, and they are computed on the request.
 */
const HOW_TO_READ =
  'Everything below is computed on this request, and served_at gives the instant. ' +
  'Each item of iban_examples is the answer of the same validation as POST /v1/iban/validate, without the ' +
  'fields that depend on the caller (trial, attribution, processing_ms); compliance_example is assembled like ' +
  'POST /v1/iban/compliance; bic_examples is a summary of the directory row, not the full answer of GET /v1/bic. ' +
  'Read bank_code_check: authoritative: true means the national register itself answered, and ' +
  'reason: "not_allocated" beside it means that register allocates the bank code to nobody, although the IBAN ' +
  'passes mod-97 (valid: true). If you cannot call the API yourself, quote these answers with their served_at ' +
  'instead of simulating one.';

/**
 * One fixed example IBAN per country, for GET /v1/demo/:country.
 *
 * Three public sources already in this repository, in this order of priority:
 * the demo list above, the official examples above, then the examples of the
 * IBAN registry carried by the `iban-core` package (`EXAMPLE_IBANS`). Nothing
 * is invented here: a country with no example in any of them has no entry, and
 * the route answers 404 for it.
 *
 * The route never takes an IBAN from the caller. A real number put in a GET
 * address would end up in every journal that keeps a path.
 */
export interface CountryExample {
  iban: string;
  label: string;
  /** Where the example comes from. Never a verdict: the answer computes that. */
  provenance: string;
}

const PROVENANCE_DEMO = 'Example IBAN of the IBANforge public demo list (GET /v1/demo).';
const PROVENANCE_OFFICIAL = 'Official example IBAN of the ISO 13616 registry.';
const PROVENANCE_REGISTRY =
  'Example IBAN of the ISO 13616 registry, as carried by the open-source iban-core package.';

function buildCountryExamples(): ReadonlyMap<string, CountryExample> {
  const map = new Map<string, CountryExample>();
  for (const { iban, label } of DEMO_IBANS)
    map.set(iban.slice(0, 2), { iban, label, provenance: PROVENANCE_DEMO });
  for (const { iban, label } of OFFICIAL_EXAMPLE_IBANS) {
    const cc = iban.slice(0, 2);
    if (!map.has(cc)) map.set(cc, { iban, label, provenance: PROVENANCE_OFFICIAL });
  }
  for (const [cc, iban] of Object.entries(EXAMPLE_IBANS)) {
    if (map.has(cc)) continue;
    const name = COUNTRY_NAMES[cc] ?? cc;
    map.set(cc, {
      iban,
      label: `${name} — example IBAN of the ISO 13616 registry`,
      provenance: PROVENANCE_REGISTRY,
    });
  }
  return new Map([...map].sort(([a], [b]) => a.localeCompare(b)));
}

/** Country code → its fixed example. Sorted by code. */
export const COUNTRY_EXAMPLES = buildCountryExamples();

/** The same real validation as an element of `iban_examples`, run on the request. */
function validateExample(iban: string, label: string) {
  const result = validateIBAN(iban);
  enrichResult(result);
  return { label, ...result };
}

const HOW_TO_READ_COUNTRY =
  'This is the answer of the same validation as POST /v1/iban/validate, run on this request on a fixed ' +
  'example IBAN, without the fields that depend on the caller (trial, attribution, processing_ms). ' +
  'served_at gives the instant. Read bank_code_check: authoritative: true means the national register itself ' +
  'answered. If you cannot send a POST, open this address and quote its answer with its served_at instead of ' +
  'simulating one.';

const VALIDATE_YOUR_OWN = {
  post: 'POST https://api.ibanforge.com/v1/iban/validate with the body {"iban":"<your IBAN>"}',
  structure_only:
    'GET https://api.ibanforge.com/v1/iban/format?iban=<your IBAN> reads the structure and the checksum only; valid: true there says nothing about the bank.',
  details: 'https://api.ibanforge.com/v1',
  note: 'This address never takes an IBAN: it answers on the fixed example of a country.',
} as const;

demo.get('/v1/demo/:country', (c) => {
  // The caller's value is only ever used as a key, never echoed: an IBAN pasted
  // here by mistake must not come back in the answer.
  const code = c.req.param('country').toUpperCase();
  const example = /^[A-Z]{2}$/.test(code) ? COUNTRY_EXAMPLES.get(code) : undefined;
  c.header('Cache-Control', 'no-store');
  if (!example) {
    return c.json(
      {
        error: 'not_found',
        message:
          'No example for this value. This address takes a two-letter country code only, never an IBAN. ' +
          'To validate an IBAN of your own, see validate_your_own.',
        served_at: servedAt(),
        usage: 'GET https://api.ibanforge.com/v1/demo/DE',
        available_countries: [...COUNTRY_EXAMPLES.keys()],
        validate_your_own: VALIDATE_YOUR_OWN,
      },
      404,
    );
  }
  return c.json({
    country: code,
    served_at: servedAt(),
    how_to_read: HOW_TO_READ_COUNTRY,
    provenance: example.provenance,
    iban_example: validateExample(example.iban, example.label),
    validate_your_own: VALIDATE_YOUR_OWN,
    other_countries: 'GET https://api.ibanforge.com/v1/demo/{country}, a two-letter code',
  });
});

demo.get('/v1/demo', (c) => {
  const ibanResults = [...DEMO_IBANS, ...OFFICIAL_EXAMPLE_IBANS].map(({ iban, label }) =>
    validateExample(iban, label),
  );

  // Compliance demo: show a full compliance check for one IBAN.
  // Same shared assembly as the paid route, so the demo can never advertise a
  // shape the real endpoint does not return. It also gains `meta`, the
  // bank_bic_only disclaimer this route silently omitted.
  let complianceDemo;
  try {
    complianceDemo = { ...buildComplianceResponse('DE89370400440532013000'), cost_usdc: 0.02 };
  } catch {
    complianceDemo = { error: 'Compliance data unavailable' };
  }

  return c.json({
    message:
      'Demo — these results are free. Use POST /v1/iban/validate, POST /v1/iban/batch, GET /v1/bic/:code, or POST /v1/iban/compliance for your own queries.',
    // ADDED 24/09/2026, nothing renamed: the instant this answer was computed,
    // so that a copy quoted from an index or a cache dates itself.
    served_at: servedAt(),
    how_to_read: HOW_TO_READ,
    iban_examples: ibanResults,
    // ADDED 05/11/2026, nothing renamed: one address per country, for a reader
    // that can only open a page and not pick an example out of this list.
    country_examples: {
      how: 'GET https://api.ibanforge.com/v1/demo/{country}, a two-letter country code: the same real validation on a fixed example IBAN of that country, dated by served_at. It never takes an IBAN.',
      example: 'https://api.ibanforge.com/v1/demo/DE',
      countries: [...COUNTRY_EXAMPLES.keys()],
    },
    bic_examples: DEMO_BICS.map(({ bic, label }) => {
      const validation = validateBIC(bic);
      const row = validation.valid ? lookup(validation.bic11!) : null;
      return {
        label,
        bic: validation.bic,
        bic8: validation.bic8,
        bic11: validation.bic11,
        found: !!row,
        institution: row?.institution ?? null,
        country: { code: validation.country_code, name: row?.country_name ?? null },
        city: row?.city ?? null,
        lei: row?.lei ?? null,
        cost_usdc: 0.003,
      };
    }),
    compliance_example: {
      description: 'Full compliance check for DE89370400440532013000 (Commerzbank, Germany)',
      endpoint: 'POST /v1/iban/compliance',
      cost: '$0.02 USDC per call',
      result: complianceDemo,
    },
  });
});

export { demo };
