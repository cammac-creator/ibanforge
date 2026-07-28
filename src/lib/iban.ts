import { validate } from 'iban-core';
import type { IBANValidationResult } from '../types.js';

/**
 * Adapter over the open-source library (t23).
 *
 * The library is free, so it prices nothing and appends an `enrich` hint
 * telling the caller where to buy what it cannot compute. Inside the paid API
 * both are wrong: the call has a price, and the caller is already here — so we
 * restore cost_usdc and drop the hint.
 *
 * Keeping this thin adapter, rather than calling validate() everywhere, is
 * what lets the existing tests pass untouched.
 *
 * `iban-core` is an npm alias for the `ibanforge` package (see package.json).
 * The alias is not cosmetic: this repo's own package is *also* named
 * "ibanforge" and declares "exports", so a bare `from 'ibanforge'` would
 * self-resolve to dist/index.js — the product importing itself — instead of
 * node_modules. Verified with import.meta.resolve.
 */
export function validateIBAN(input: string): IBANValidationResult {
  const result: IBANValidationResult = { ...validate(input), cost_usdc: 0.005 };
  delete (result as { enrich?: unknown }).enrich;
  return result;
}
