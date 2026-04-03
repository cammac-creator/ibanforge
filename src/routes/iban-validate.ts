import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { recordOperation } from '../lib/stats.js';
import type { IBANValidationResult } from '../types.js';

const ibanValidate = new Hono();

ibanValidate.post('/v1/iban/validate', async (c) => {
  const start = performance.now();

  let body: { iban?: unknown };
  try {
    body = await c.req.json<{ iban?: unknown }>();
  } catch {
    return c.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      400,
    );
  }

  if (!body.iban || typeof body.iban !== 'string' || body.iban.trim() === '') {
    return c.json(
      {
        error: 'invalid_request',
        message: "Request body must include an 'iban' field (string)",
      },
      400,
    );
  }

  const result: IBANValidationResult = validateIBAN(body.iban as string);

  enrichResult(result);

  result.processing_ms = Math.round((performance.now() - start) * 100) / 100;

  recordOperation('iban_validate', result.country?.code ?? null, result.valid, result.cost_usdc);

  return c.json(result);
});

export { ibanValidate };
