import { describe, expect, it } from 'vitest';
import { buildRouteTable } from '../middleware/x402.js';
import { CLAIM_MIN_PAID_USD, FREE_TIER_MONTHLY_LIMIT, UNIT_PRICE_USD } from './tiers.js';

describe('cohérence du seuil de réclamation', () => {
  it('finance le quota au prix réellement publié par x402', () => {
    const routes = buildRouteTable(
      '0x0000000000000000000000000000000000000001',
      'POST',
      'https://api.ibanforge.com/v1/iban/validate',
    );
    const validate = routes['POST /v1/iban/validate'] as { accepts: { price: string } };
    expect(UNIT_PRICE_USD).toBe(Number(validate.accepts.price.replace('$', '')));
    expect(CLAIM_MIN_PAID_USD).toBe(Number((FREE_TIER_MONTHLY_LIMIT * UNIT_PRICE_USD).toFixed(2)));
    expect(CLAIM_MIN_PAID_USD).toBe(1);
  });
});
