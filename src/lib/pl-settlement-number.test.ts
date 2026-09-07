import { describe, it, expect } from 'vitest';
import {
  expectedPolishCheckDigit,
  polishSettlementCheckDigit,
  PL_SETTLEMENT_ALGORITHM,
} from './pl-settlement-number.js';

/**
 * The algorithm is pinned by published settlement numbers, because the
 * ordinance that defines it is not machine-readable (see the module note).
 * Each number below is the one the institution itself publishes on its
 * account details; together they cover four different bank identifiers and
 * four different check digits.
 */
describe('Polish settlement-number check digit', () => {
  it.each([
    ['10100000', 'Narodowy Bank Polski'],
    ['10201026', 'PKO Bank Polski'],
    ['10901014', 'Santander Bank Polska (now Erste Bank Polska)'],
    ['11402004', 'mBank'],
  ])('reproduces the published number %s (%s)', (code) => {
    expect(expectedPolishCheckDigit(code)).toBe(code[7]);
    expect(polishSettlementCheckDigit(code)).toEqual({
      valid: true,
      algorithm: PL_SETTLEMENT_ALGORITHM,
    });
  });

  it('rejects a settlement number whose last digit was mistyped', () => {
    expect(polishSettlementCheckDigit('10901015')?.valid).toBe(false);
    expect(polishSettlementCheckDigit('10100001')?.valid).toBe(false);
  });

  it('rejects a transposition inside the number, not only the last digit', () => {
    // 10901014 with its 5th and 6th digits swapped: the weights differ (3 and
    // 9), so the sum moves and the stored check digit no longer fits.
    expect(polishSettlementCheckDigit('10900114')?.valid).toBe(false);
  });

  it('has nothing to say about a code that is not eight digits', () => {
    expect(polishSettlementCheckDigit('1090101')).toBeNull();
    expect(polishSettlementCheckDigit('109010144')).toBeNull();
    expect(polishSettlementCheckDigit('1090101A')).toBeNull();
    expect(expectedPolishCheckDigit('')).toBeNull();
  });

  it('produces every digit, including the zero of a sum that is a multiple of ten', () => {
    // 1010000 weighted: 3+0+7+0+0+0+0 = 10 → complement 0.
    expect(expectedPolishCheckDigit('10100009')).toBe('0');
  });
});
