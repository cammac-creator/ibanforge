import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { recordOperation } from '../lib/stats.js';
import { getIban, computeRevenue } from '../lib/request-helpers.js';

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

  // One shared assembly for REST and both MCP transports. See
  // src/lib/compliance-response.ts for why this used to be written four times.
  const response = buildComplianceResponse(iban);
  const result = response;

  const processingMs = Math.round((performance.now() - start) * 100) / 100;
  const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
  const revenue = computeRevenue(c, 0.02);
  recordOperation('iban_compliance', result.country?.code ?? null, result.valid, revenue, errorDetail);

  const costUsdc = c.get('apiKeyAuthenticated') ? 0 : 0.02;

  // Always surface the scope + disclaimer + data freshness so an agent never
  // mistakes a bank-BIC sanctions check for full beneficiary screening.
  return c.json({ ...response, cost_usdc: costUsdc, processing_ms: processingMs });
});

export { ibanCompliance };
