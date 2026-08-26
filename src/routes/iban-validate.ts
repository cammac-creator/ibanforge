import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { recordOperation } from '../lib/stats.js';
import { getIban, computeRevenue } from '../lib/request-helpers.js';
import { buildReferenceCheck } from '../lib/payment-reference.js';
import type { IBANValidationResult } from '../types.js';

const ibanValidate = new Hono<HonoEnv>();

ibanValidate.post('/v1/iban/validate', async (c) => {
  const start = performance.now();

  let body: Record<string, unknown> | null;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      400,
    );
  }

  const iban = getIban(body);
  if (!iban || typeof iban !== 'string' || iban.trim() === '') {
    return c.json(
      {
        error: 'invalid_request',
        message: "Request body must include an 'iban' field (case-insensitive: 'iban', 'IBAN', 'Iban' all work).",
      },
      400,
    );
  }

  const result: IBANValidationResult = validateIBAN(iban);

  enrichResult(result);

  // Optional structured payment reference. Attached HERE and not inside
  // enrichResult: that path is shared with batch validation and with several MCP
  // tools whose output schemas do not name this block, and Zod would strip it
  // there without raising anything.
  //
  // The reference is judged even when the IBAN is invalid — the two answers are
  // independent, and a caller fixing a typo still wants to know their reference
  // is sound. Only the PAIRING needs a parsed BBAN, and it reports
  // `not_applicable` when there is none.
  const reference = body.reference;
  if (typeof reference === 'string' && reference.trim() !== '') {
    const referenceType = typeof body.reference_type === 'string' ? body.reference_type : null;
    result.reference_check = buildReferenceCheck(result, reference, referenceType);
  }

  const postedPrice = result.cost_usdc;
  if (c.get('apiKeyAuthenticated')) {
    result.cost_usdc = 0;
  }

  result.processing_ms = Math.round((performance.now() - start) * 100) / 100;

  const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
  const revenue = computeRevenue(c, postedPrice);
  recordOperation('iban_validate', result.country?.code ?? null, result.valid, revenue, errorDetail, c.get('apiKeyPrefix'));

  return c.json(result);
});

export { ibanValidate };
