import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { recordOperation } from '../lib/stats.js';
import type { IBANValidationResult } from '../types.js';

const ibanValidate = new Hono<HonoEnv>();

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

  if (c.get('apiKeyAuthenticated')) {
    result.cost_usdc = 0;
  }

  result.processing_ms = Math.round((performance.now() - start) * 100) / 100;

  const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
  recordOperation('iban_validate', result.country?.code ?? null, result.valid, result.cost_usdc, errorDetail);

  return c.json(result);
});

export { ibanValidate };
