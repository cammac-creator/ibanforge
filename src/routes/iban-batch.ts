import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
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
        message: "Request body must include an 'ibans' array of strings (1-100 items)",
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

  if (ibans.length > 100) {
    return c.json(
      { error: 'batch_too_large', message: 'Maximum 100 IBANs per batch request' },
      400,
    );
  }

  const results: IBANValidationResult[] = ibans.map((iban) => {
    const result = validateIBAN(iban);
    enrichResult(result);
    result.cost_usdc = 0.002; // Batch rate (vs $0.005 single)
    return result;
  });

  // Proportional cost: $0.002 per IBAN (discount vs individual $0.005)
  // e.g. 10 IBANs = $0.020, 100 IBANs = $0.200
  const totalCost = Math.round(ibans.length * 0.002 * 1000) / 1000;
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
