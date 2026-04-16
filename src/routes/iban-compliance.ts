import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { buildComplianceResult } from '../lib/compliance.js';
import { recordOperation } from '../lib/stats.js';
import { getIban } from '../lib/request-helpers.js';
import type { IBANValidationResult, ComplianceResult } from '../types.js';

const ibanCompliance = new Hono<HonoEnv>();

ibanCompliance.post('/v1/iban/compliance', async (c) => {
  const start = performance.now();

  let body: Record<string, unknown> | null;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const iban = getIban(body);
  if (!iban || typeof iban !== 'string' || iban.trim() === '') {
    return c.json({ error: 'invalid_request', message: "Request body must include an 'iban' field (case-insensitive)." }, 400);
  }

  const result: IBANValidationResult = validateIBAN(iban);
  enrichResult(result);

  const countryCode = result.country?.code ?? '';
  const bic8 = result.bic?.code?.slice(0, 8) ?? null;
  const issuerType = result.issuer?.type ?? 'bank';
  const countryRisk = result.risk_indicators?.country_risk ?? 'standard';
  const isTestBic = result.risk_indicators?.test_bic ?? false;

  let compliance: ComplianceResult;
  try {
    compliance = buildComplianceResult(countryCode, bic8, issuerType, countryRisk, isTestBic);
  } catch {
    compliance = {
      sanctions: { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'non_member' },
      reachability: { sepa_instant: false, sct: false, sdd: false },
      vop: { participant: false, status: 'not_found' },
      risk_score: 50, risk_level: 'elevated', flags: ['compliance_data_unavailable'],
    };
  }

  const processingMs = Math.round((performance.now() - start) * 100) / 100;
  const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
  recordOperation('iban_compliance', countryCode || null, result.valid, 0.02, errorDetail);

  const costUsdc = c.get('apiKeyAuthenticated') ? 0 : 0.02;

  return c.json({ ...result, compliance, cost_usdc: costUsdc, processing_ms: processingMs });
});

export { ibanCompliance };
