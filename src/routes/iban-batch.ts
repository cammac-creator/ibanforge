import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { lookupByCountryBank } from '../lib/bic-lookup.js';
import { recordBatch } from '../lib/stats.js';
import type { IBANValidationResult } from '../types.js';

const ibanBatch = new Hono();

ibanBatch.post('/v1/iban/batch', async (c) => {
  const start = performance.now();

  let body: { ibans?: unknown };
  try {
    body = await c.req.json<{ ibans?: unknown }>();
  } catch {
    return c.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      400,
    );
  }

  if (
    !body.ibans ||
    !Array.isArray(body.ibans) ||
    !body.ibans.every((item) => typeof item === 'string')
  ) {
    return c.json(
      {
        error: 'invalid_request',
        message: "Request body must include an 'ibans' array of strings (1-10 items)",
      },
      400,
    );
  }

  const ibans = body.ibans as string[];

  if (ibans.length === 0) {
    return c.json(
      { error: 'empty_batch', message: 'At least 1 IBAN is required' },
      400,
    );
  }

  if (ibans.length > 10) {
    return c.json(
      { error: 'batch_too_large', message: 'Maximum 10 IBANs per batch request' },
      400,
    );
  }

  const results: IBANValidationResult[] = ibans.map((iban) => {
    const result = validateIBAN(iban);
    if (result.valid && result.bban?.bank_code) {
      result.bic = lookupByCountryBank(result.country!.code, result.bban.bank_code);
    }
    return result;
  });

  const totalCost = 0.020;
  const processingMs = Math.round((performance.now() - start) * 100) / 100;
  const validCount = results.filter((r) => r.valid).length;

  recordBatch(results.length, validCount, totalCost);

  return c.json({
    results,
    count: results.length,
    valid_count: validCount,
    cost_usdc: totalCost,
    processing_ms: processingMs,
  });
});

export { ibanBatch };
