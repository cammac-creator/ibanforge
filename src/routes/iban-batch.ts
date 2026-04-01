import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { lookupBIC } from '../lib/bic-lookup.js';
import { recordOperation } from '../lib/stats.js';
import type { IBANValidationResult } from '../types.js';

const ibanBatch = new Hono();

ibanBatch.post('/v1/iban/batch', async (c) => {
  const start = performance.now();
  const body = await c.req.json<{ ibans?: string[] }>();

  if (!body.ibans || !Array.isArray(body.ibans)) {
    return c.json({ error: 'Missing or invalid "ibans" array' }, 400);
  }

  if (body.ibans.length > 10) {
    return c.json({ error: 'Maximum 10 IBANs per batch request' }, 400);
  }

  const results: IBANValidationResult[] = body.ibans.map((iban) => {
    const result = validateIBAN(iban);
    if (result.valid && result.bban?.bank_code) {
      result.bic = lookupBIC(result.country!.code, result.bban.bank_code);
    }
    return result;
  });

  const totalCost = 0.015;
  const processingMs = Math.round((performance.now() - start) * 100) / 100;
  const validCount = results.filter((r) => r.valid).length;

  recordOperation('iban_batch', {
    country: null,
    valid: validCount > 0,
    count: results.length,
    validCount,
    cost: totalCost,
  });

  return c.json({
    results,
    count: results.length,
    valid_count: validCount,
    cost_usdc: totalCost,
    processing_ms: processingMs,
  });
});

export { ibanBatch };
