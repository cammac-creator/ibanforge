import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { validateBIC } from '../lib/bic-validator.js';
import { lookup } from '../lib/bic-lookup.js';

const demo = new Hono();

const DEMO_IBANS = [
  { iban: 'GB29NWBK60161331926819', label: 'UK — NatWest' },
  { iban: 'DE89370400440532013000', label: 'Germany — Commerzbank' },
  { iban: 'CH5604835012345678009', label: 'Switzerland — Credit Suisse' },
  { iban: 'FR7630006000011234567890189', label: 'France — Credit Agricole' },
];

const DEMO_BICS = [
  { bic: 'UBSWCHZH', label: 'UBS — Switzerland' },
  { bic: 'BNPAFRPP', label: 'BNP Paribas — France' },
];

demo.get('/v1/demo', (c) => {
  const ibanResults = DEMO_IBANS.map(({ iban, label }) => {
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
