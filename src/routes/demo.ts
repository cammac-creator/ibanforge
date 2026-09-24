import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { validateBIC } from '../lib/bic-validator.js';
import { lookup } from '../lib/bic-lookup.js';
import { servedAt } from '../lib/served-at.js';

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
 * demo.test.ts asserts the verdict on the committed data. If a register leaves
 * the repository, give the tests a synthetic register (fictitious codes, see the
 * data-removal plan) rather than dropping the example: production still reads
 * the register. Only if the register starts allocating one of these codes does
 * the example leave this list.
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

demo.get('/v1/demo', (c) => {
  const ibanResults = [...DEMO_IBANS, ...OFFICIAL_EXAMPLE_IBANS].map(({ iban, label }) => {
    const result = validateIBAN(iban);
    enrichResult(result);
    return { label, ...result };
  });

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
