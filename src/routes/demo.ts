import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { buildComplianceResult } from '../lib/compliance.js';

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

  // Compliance demo: show a full compliance check for one IBAN
  const complianceIban = 'DE89370400440532013000';
  const complianceResult = validateIBAN(complianceIban);
  enrichResult(complianceResult);

  let complianceDemo;
  try {
    const countryCode = complianceResult.country?.code ?? '';
    const bic8 = complianceResult.bic?.code?.slice(0, 8) ?? null;
    const issuerType = complianceResult.issuer?.type ?? 'bank';
    const countryRisk = complianceResult.risk_indicators?.country_risk ?? 'standard';
    const isTestBic = complianceResult.risk_indicators?.test_bic ?? false;
    const compliance = buildComplianceResult(countryCode, bic8, issuerType, countryRisk, isTestBic);
    complianceDemo = { ...complianceResult, compliance, cost_usdc: 0.02 };
  } catch {
    complianceDemo = { error: 'Compliance data unavailable' };
  }

  return c.json({
    message:
      'Demo — these results are free. Use POST /v1/iban/validate, POST /v1/iban/batch, GET /v1/bic/:code, or POST /v1/iban/compliance for your own queries.',
    iban_examples: ibanResults,
    bic_examples: DEMO_BICS.map(({ bic, label }) => ({ label, bic, endpoint: `/v1/bic/${bic}` })),
    compliance_example: {
      description: 'Full compliance check for DE89370400440532013000 (Commerzbank, Germany)',
      endpoint: 'POST /v1/iban/compliance',
      cost: '$0.02 USDC per call',
      result: complianceDemo,
    },
  });
});

export { demo };
