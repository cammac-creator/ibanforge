import { Hono } from 'hono';
import { validateBIC } from '../lib/bic-validator.js';
import { lookup } from '../lib/bic-lookup.js';
import { recordOperation } from '../lib/stats.js';
import type { BICLookupResult } from '../types.js';

const COST_USDC = 0.003;

const bicLookup = new Hono();

bicLookup.get('/v1/bic/:code', (c) => {
  const start = performance.now();
  const code = c.req.param('code');

  const validation = validateBIC(code);

  if (!validation.valid) {
    return c.json(
      {
        bic: validation.bic,
        valid_format: false,
        found: false,
        error: validation.error,
        cost_usdc: COST_USDC,
      },
      400,
    );
  }

  const row = lookup(validation.bic11!);
  const found = row !== null;

  recordOperation('bic_lookup', validation.country_code ?? null, found, COST_USDC);

  const result: BICLookupResult = {
    bic: validation.bic,
    bic8: validation.bic8!,
    bic11: validation.bic11!,
    found,
    valid_format: true,
    institution: row?.institution ?? null,
    country: {
      code: validation.country_code!,
      name: row?.country_name ?? validation.country_code!,
    },
    city: row?.city ?? null,
    branch_code: validation.branch_code!,
    branch_info: row?.branch_info ?? null,
    lei: row?.lei ?? null,
    lei_status: row?.lei_status ?? null,
    is_test_bic: validation.is_test_bic!,
    source: row?.source ?? null,
    cost_usdc: COST_USDC,
    processing_ms: Math.round((performance.now() - start) * 100) / 100,
  };

  if (!found) {
    result.note =
      'BIC format valid but not found in database. Data sourced from GLEIF — coverage may be partial.';
  }

  return c.json(result);
});

export { bicLookup };
