import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { buildComplianceResponse, buildBicComplianceResponse } from '../lib/compliance-response.js';
import { recordOperation } from '../lib/stats.js';
import { recordSafely } from '../lib/record-safely.js';
import { getIban, getBic, computeRevenue } from '../lib/request-helpers.js';

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
  const bic = getBic(body);

  const hasIban = typeof iban === 'string' && iban.trim() !== '';
  const hasBic = typeof bic === 'string' && bic.trim() !== '';

  if (hasIban && hasBic) {
    // Refuse rather than pick. The two can disagree — an IBAN resolves to its
    // own BIC — and silently preferring one would report a screen of an
    // institution the caller did not ask about.
    return c.json(
      {
        error: 'invalid_request',
        message:
          "Send either 'iban' or 'bic', not both: they can designate different institutions.",
      },
      400,
    );
  }

  // Screening keyed on a BIC. This exists because the IBAN path cannot reach
  // the banks in countries whose bank code is numeric and whose curated map is
  // empty — a designated bank was in our sanctions table and unreachable by
  // any IBAN. See buildBicComplianceResponse().
  if (hasBic) {
    const screened = buildBicComplianceResponse(bic.trim());
    if ('error' in screened) {
      recordSafely(
        () => recordOperation('iban_compliance', null, false, 0, 'bic', c.get('apiKeyPrefix')),
        'iban_compliance',
      );
      return c.json(screened, 400);
    }
    const processingMs = Math.round((performance.now() - start) * 100) / 100;
    const revenue = computeRevenue(c, 0.02);
    recordSafely(
      () =>
        recordOperation(
          'iban_compliance',
          screened.country.code,
          true,
          revenue,
          undefined,
          c.get('apiKeyPrefix'),
        ),
      'iban_compliance',
    );
    return c.json({
      ...screened,
      cost_usdc: c.get('apiKeyAuthenticated') ? 0 : 0.02,
      processing_ms: processingMs,
    });
  }

  if (!hasIban) {
    return c.json(
      {
        error: 'invalid_request',
        message: "Request body must include an 'iban' or a 'bic' field (case-insensitive).",
      },
      400,
    );
  }

  // One shared assembly for REST and both MCP transports. See
  // src/lib/compliance-response.ts for why this used to be written four times.
  const response = buildComplianceResponse(iban);
  const result = response;

  const processingMs = Math.round((performance.now() - start) * 100) / 100;
  const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
  const revenue = computeRevenue(c, 0.02);
  // Wrapped since 2026-09-01 (QUA-12): the swallow is unchanged, but the
  // failures are now counted and raise an ops alert past a streak, so a stats
  // DB that stops accepting writes cannot look like a service nobody calls.
  recordSafely(
    () =>
      recordOperation(
        'iban_compliance',
        result.country?.code ?? null,
        result.valid,
        revenue,
        errorDetail,
        c.get('apiKeyPrefix'),
      ),
    'iban_compliance',
  );

  const costUsdc = c.get('apiKeyAuthenticated') ? 0 : 0.02;

  // Always surface the scope + disclaimer + data freshness so an agent never
  // mistakes a bank-BIC sanctions check for full beneficiary screening.
  return c.json({ ...response, cost_usdc: costUsdc, processing_ms: processingMs });
});

export { ibanCompliance };
