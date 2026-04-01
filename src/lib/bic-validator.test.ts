import { describe, it, expect } from 'vitest';
import { validateBIC } from './bic-validator.js';

describe('validateBIC', () => {
  // --- Valid BICs ---

  it('accepts a valid 8-char BIC', () => {
    const result = validateBIC('UBSWCHZH');
    expect(result.valid).toBe(true);
    expect(result.bic8).toBe('UBSWCHZH');
    expect(result.bic11).toBe('UBSWCHZHXXX');
    expect(result.institution_code).toBe('UBSW');
    expect(result.country_code).toBe('CH');
    expect(result.location_code).toBe('ZH');
    expect(result.branch_code).toBe('XXX');
  });

  it('accepts a valid 11-char BIC', () => {
    const result = validateBIC('UBSWCHZH80A');
    expect(result.valid).toBe(true);
    expect(result.bic8).toBe('UBSWCHZH');
    expect(result.bic11).toBe('UBSWCHZH80A');
    expect(result.branch_code).toBe('80A');
  });

  it('accepts another known valid BIC (Deutsche Bank Germany)', () => {
    const result = validateBIC('DEUTDEDB');
    expect(result.valid).toBe(true);
    expect(result.country_code).toBe('DE');
  });

  // --- Invalid: length ---

  it('rejects BIC that is too short (< 8 chars)', () => {
    const result = validateBIC('UBSWCH');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('too_short');
  });

  it('rejects BIC that is too long (> 11 chars)', () => {
    const result = validateBIC('UBSWCHZH80ABCD');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('too_long');
  });

  it('rejects BIC with length between 9 and 10 chars', () => {
    const result = validateBIC('UBSWCHZH80');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_length');
  });

  // --- Invalid: characters ---

  it('rejects BIC with invalid characters (digits in institution code)', () => {
    const result = validateBIC('1234CHZH');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_format');
  });

  it('rejects BIC with special characters', () => {
    const result = validateBIC('UBS@CHZH');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_format');
  });

  // --- Test BIC detection ---

  it('detects a test BIC (location code second char is "0")', () => {
    // ZH → second char 'H' — not a test BIC
    const normal = validateBIC('UBSWCHZH');
    expect(normal.valid).toBe(true);
    expect(normal.is_test_bic).toBe(false);
  });

  it('marks BIC as test when location code ends in "0"', () => {
    // Build a BIC where location code is "X0" → second char '0'
    const result = validateBIC('TESTCHX0');
    expect(result.valid).toBe(true);
    expect(result.is_test_bic).toBe(true);
  });

  // --- Edge cases ---

  it('accepts lowercase input and normalises to uppercase', () => {
    const result = validateBIC('ubswchzh');
    expect(result.valid).toBe(true);
    expect(result.bic).toBe('UBSWCHZH');
    expect(result.bic8).toBe('UBSWCHZH');
  });

  it('accepts mixed-case input', () => {
    const result = validateBIC('UbSwChZh');
    expect(result.valid).toBe(true);
    expect(result.bic).toBe('UBSWCHZH');
  });

  it('strips surrounding spaces before validation', () => {
    const result = validateBIC('  UBSWCHZH  ');
    expect(result.valid).toBe(true);
  });

  it('rejects empty string', () => {
    const result = validateBIC('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('too_short');
  });

  // --- Invalid country code ---

  it('rejects BIC with invalid country code', () => {
    // "ZZ" is not in the VALID_COUNTRIES set (except XX)
    const result = validateBIC('UBSWZZZH');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_country');
  });
});
