import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { lookupBIC } from '../lib/bic-lookup.js';
import { recordOperation } from '../lib/stats.js';
import type { IBANValidationResult } from '../types.js';

const ibanValidate = new Hono();

ibanValidate.post('/v1/iban/validate', async (c) => {
  const start = performance.now();
  const body = await c.req.json<{ iban?: string }>();

  if (!body.iban || typeof body.iban !== 'string') {
    return c.json({ error: 'Missing or invalid "iban" field' }, 400);
  }

  const result: IBANValidationResult = validateIBAN(body.iban);

  // Lookup BIC if IBAN is valid and bank code is available
  if (result.valid && result.bban?.bank_code) {
    result.bic = lookupBIC(result.country!.code, result.bban.bank_code);
  }

  result.processing_ms = Math.round((performance.now() - start) * 100) / 100;

  recordOperation('iban_validate', {
    country: result.country?.code ?? null,
    valid: result.valid,
    hasBic: !!result.bic,
    cost: result.cost_usdc,
  });

  return c.json(result);
});

export { ibanValidate };
