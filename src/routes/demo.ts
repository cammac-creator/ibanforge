import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { lookupByCountryBank } from '../lib/bic-lookup.js';

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
    if (result.valid && result.bban?.bank_code) {
      result.bic = lookupByCountryBank(result.country!.code, result.bban.bank_code);
    }
    return { label, ...result };
  });

  return c.json({
    message:
      'Demo — these results are free. Use POST /v1/iban/validate, POST /v1/iban/batch, or GET /v1/bic/:code for your own queries.',
    iban_examples: ibanResults,
    bic_examples: DEMO_BICS.map(({ bic, label }) => ({ label, bic, endpoint: `/v1/bic/${bic}` })),
  });
});

export { demo };
