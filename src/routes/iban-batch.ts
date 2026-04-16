import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { recordBatch } from '../lib/stats.js';
import { getIbansArray } from '../lib/request-helpers.js';
import type { IBANValidationResult } from '../types.js';

const ibanBatch = new Hono<HonoEnv>();

ibanBatch.post('/v1/iban/batch', async (c) => {
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

  const rawIbans = getIbansArray(body);
  if (!rawIbans || !Array.isArray(rawIbans) || !rawIbans.every((item) => typeof item === 'string')) {
    return c.json(
      {
        error: 'invalid_request',
        message: "Request body must include an array of IBAN strings (1-100 items). Field accepted: 'ibans', 'iban_list' or 'list'.",
      },
      400,
    );
  }

  const ibans = rawIbans as string[];

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

  const isApiKey = c.get('apiKeyAuthenticated');

  const results: IBANValidationResult[] = ibans.map((iban) => {
    const result = validateIBAN(iban);
    enrichResult(result);
    result.cost_usdc = isApiKey ? 0 : 0.002; // Batch rate (vs $0.005 single), free for API key tier
    return result;
  });

  // Proportional cost: $0.002 per IBAN (discount vs individual $0.005)
  // e.g. 10 IBANs = $0.020, 100 IBANs = $0.200
  const totalCost = isApiKey ? 0 : Math.round(ibans.length * 0.002 * 1000) / 1000;
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
