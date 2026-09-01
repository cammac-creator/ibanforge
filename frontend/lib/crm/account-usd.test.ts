import { describe, expect, it } from 'vitest';
import { accountUsd, creditPackUsd, CREDIT_PACK_USD } from './account-usd';

/**
 * The revenue rule, mirrored from src/lib/business-summary.ts. These
 * assertions are the contract between the two copies: they are written so that
 * the same expectations can be read against the server's accountUsd, and a
 * divergence shows up as a failing test rather than as two dashboards quoting
 * two revenues.
 */

describe('creditPackUsd', () => {
  it('prices the three known bundles exactly', () => {
    for (const [credits, usd] of Object.entries(CREDIT_PACK_USD)) {
      expect(creditPackUsd(Number(credits))).toEqual({ usd, exact: true });
    }
  });

  it('prices an unknown bundle pro rata on the nearest tier, and says so', () => {
    // 777 is nearest 1000, which is 5 USD for 1000 credits.
    expect(creditPackUsd(777)).toEqual({ usd: 3.89, exact: false });
  });

  it('is worth nothing for no credits, and does not divide by zero', () => {
    expect(creditPackUsd(0)).toEqual({ usd: 0, exact: false });
  });
});

describe('accountUsd', () => {
  it('takes the charged amount when there is one', () => {
    expect(accountUsd({ creditsTotal: 5000, amountPaidMinor: 1500, amountPaidCurrency: 'usd' })).toEqual({
      usd: 15,
      source: 'measured',
      exact: true,
    });
  });

  it('accepts the currency in either case, as the column stores it', () => {
    expect(accountUsd({ creditsTotal: 1000, amountPaidMinor: 500, amountPaidCurrency: 'USD' }).source).toBe(
      'measured',
    );
  });

  it('refuses to convert another currency, and deduces instead', () => {
    // Converting would mean inventing a rate and a date, which is the error the
    // stored column exists to end.
    const r = accountUsd({ creditsTotal: 5000, amountPaidMinor: 1800, amountPaidCurrency: 'eur' });
    expect(r).toEqual({ usd: 20, source: 'deduced', exact: true });
  });

  it('reads an absent field and a null one the same way', () => {
    // The API serves neither today: absent is the truthful state, not a caller
    // forgetting the field.
    expect(accountUsd({ creditsTotal: 1000 })).toEqual({ usd: 5, source: 'deduced', exact: true });
    expect(accountUsd({ creditsTotal: 1000, amountPaidMinor: null, amountPaidCurrency: null })).toEqual({
      usd: 5,
      source: 'deduced',
      exact: true,
    });
  });

  it('never drops an unlisted bundle to zero', () => {
    const r = accountUsd({ creditsTotal: 777 });
    expect(r.usd).toBeGreaterThan(0);
    expect(r.exact).toBe(false);
  });
});
