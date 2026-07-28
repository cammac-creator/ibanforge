/**
 * Contract test against the open-source library (iban-core, npm alias of
 * `ibanforge`).
 *
 * Why this file exists. The mod-97 layer, the country tables, BIC format
 * validation and issuer classification left this repo in t23 — and their unit
 * tests left with them, into the repo that owns the code. That is correct, but
 * it leaves the product with no local proof that the library still keeps the
 * promises the paid API is built on. The failure this guards against is
 * concrete: the library ships a version that drops one rule, someone runs
 * `npm install` instead of `npm ci`, Railway deploys, and an invalid IBAN is
 * declared valid to a paying customer — with every other test green.
 *
 * Belt and braces: the dependency is also pinned to an exact version in
 * package.json (no caret), so a library upgrade is a deliberate act. This file
 * is what tells you, loudly and precisely, what broke when you make it.
 *
 * Scope: only the behaviours the product depends on, asserted on concrete
 * values. It is not a re-implementation of the library's own test suite.
 */
import { describe, it, expect } from 'vitest';
// Imported through the product's own facades, not straight from the package:
// this exercises the full path a route takes — facade → library — so a broken
// re-export fails here too.
import { getSepaInfo, getCountryRisk, IBAN_LENGTHS, getCountryName } from './countries.js';
import { validateBIC } from './bic-validator.js';
import { classifyIssuer } from './issuers.js';
import { validateIBAN } from './iban.js';

describe('iban-core contract — IBAN validation', () => {
  // One representative country per BBAN shape the product serves:
  // CH (all-numeric), DE (longest numeric bank code), GB (letters + branch
  // code), LT (eurozone SCT_INST + VoP).
  it.each([
    ['CH9300762011623852957', 'CH', 'Switzerland', '93', '00762', '011623852957'],
    ['DE89370400440532013000', 'DE', 'Germany', '89', '37040044', '0532013000'],
    ['GB29NWBK60161331926819', 'GB', 'United Kingdom', '29', 'NWBK', '31926819'],
    ['LT121000011101001000', 'LT', 'Lithuania', '12', '10000', '11101001000'],
  ])('validates %s and decomposes its BBAN', (iban, code, name, checkDigits, bankCode, accountNumber) => {
    const r = validateIBAN(iban);
    expect(r.valid).toBe(true);
    expect(r.country).toEqual({ code, name });
    expect(r.check_digits).toBe(checkDigits);
    expect(r.bban?.bank_code).toBe(bankCode);
    expect(r.bban?.account_number).toBe(accountNumber);
    expect(r.error).toBeUndefined();
  });

  it('reads the GB branch code, which is the only re-exported structure with three fields', () => {
    expect(validateIBAN('GB29NWBK60161331926819').bban?.branch_code).toBe('601613');
  });

  it('formats and normalises: lowercase, spaces and dashes all reach the same result', () => {
    const canonical = validateIBAN('CH9300762011623852957');
    expect(canonical.formatted).toBe('CH93 0076 2011 6238 5295 7');
    for (const variant of ['ch9300762011623852957', 'CH93 0076 2011 6238 5295 7', 'CH93-0076-2011-6238-5295-7']) {
      expect(validateIBAN(variant)).toEqual(canonical);
    }
  });

  // These three IBANs pass a bare mod-97 check (remainder === 1). Only the
  // ISO 13616 range rule rejects them. If the library ever drops that rule,
  // these become "valid" and the product bills a customer for a wrong answer.
  it.each([
    ['CH0000000000000000066', '00'],
    ['CH0100000000000000048', '01'],
    ['CH9900000000000000030', '99'],
  ])('rejects %s: check digits %s are outside the ISO 13616 range despite passing mod-97', (iban, digits) => {
    const r = validateIBAN(iban);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_check_digits');
    expect(r.error_detail).toContain(`'${digits}'`);
  });

  it('rejects non-numeric check digits', () => {
    const r = validateIBAN('CHXX00762011623852957');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_check_digits');
  });

  it('rejects a BBAN whose characters break the country registry pattern', () => {
    // Passes mod-97, yet puts letters inside Germany's all-numeric bank code.
    const r = validateIBAN('DE17ABCDEFGH1234567890');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_bban_structure');
    expect(r.error_detail).toContain('bank code must be 8 digits');
  });

  it.each([
    ['CH9300762011623852958', 'checksum_failed'],
    ['CH930076201162385295', 'wrong_length'],
    ['CH93007620116238529571', 'wrong_length'],
    ['ZZ9300762011623852957', 'unsupported_country'],
    ['CH93-INVALID-@@@', 'invalid_format'],
  ])('maps %s to the error code %s the API contract publishes', (iban, error) => {
    const r = validateIBAN(iban);
    expect(r.valid).toBe(false);
    expect(r.error).toBe(error);
  });

  it('caps absurdly long input instead of burning CPU on it (anti-DoS)', () => {
    const huge = 'C'.repeat(1_000_000);
    const started = performance.now();
    const r = validateIBAN(huge);
    const elapsed = performance.now() - started;

    expect(r.valid).toBe(false);
    expect(r.error).toBe('invalid_format');
    // The guard truncates before any regex / toUpperCase / BigInt runs.
    expect(r.iban).toBe('C'.repeat(64));
    expect(r.iban.length).toBe(64);
    // Without the guard, the mod-97 BigInt on a million characters takes
    // seconds. Measured with the guard: ~0.2 ms.
    expect(elapsed).toBeLessThan(250);
  });

  it.each([[null], [undefined], [{}], [42], [[]]])('does not throw on the non-string input %s', (input) => {
    let r: ReturnType<typeof validateIBAN> | undefined;
    expect(() => {
      r = validateIBAN(input as unknown as string);
    }).not.toThrow();
    expect(r?.valid).toBe(false);
    expect(r?.iban).toBe('');
    expect(r?.error).toBe('invalid_format');
  });
});

describe('iban-core contract — the adapter itself (t23)', () => {
  it('restores cost_usdc on a valid result and never leaks the enrich hint', () => {
    const r = validateIBAN('CH9300762011623852957');
    expect(r.cost_usdc).toBe(0.005);
    expect('enrich' in r).toBe(false);
    expect(Object.keys(r)).not.toContain('enrich');
  });

  it('restores cost_usdc on an error result and never leaks the enrich hint', () => {
    const r = validateIBAN('ZZ00');
    expect(r.valid).toBe(false);
    expect(r.cost_usdc).toBe(0.005);
    expect('enrich' in r).toBe(false);
  });

  it('leaves no enrich anywhere in the serialized payload a customer receives', () => {
    for (const input of ['CH9300762011623852957', 'DE89370400440532013000', 'nonsense', '']) {
      expect(JSON.stringify(validateIBAN(input))).not.toContain('enrich');
    }
  });
});

describe('iban-core contract — BIC format validation', () => {
  it('decomposes a valid 8-character BIC', () => {
    expect(validateBIC('UBSWCHZH')).toEqual({
      bic: 'UBSWCHZH',
      valid: true,
      bic8: 'UBSWCHZH',
      bic11: 'UBSWCHZHXXX',
      institution_code: 'UBSW',
      country_code: 'CH',
      location_code: 'ZH',
      branch_code: 'XXX',
      is_test_bic: false,
    });
  });

  it('keeps the branch code of an 11-character BIC', () => {
    const r = validateBIC('CRESCHZZ80A');
    expect(r.valid).toBe(true);
    expect(r.bic8).toBe('CRESCHZZ');
    expect(r.branch_code).toBe('80A');
  });

  it.each([
    ['CRESCHZ', 'too_short'],
    ['', 'too_short'],
    ['CRESCHZZ80AX', 'too_long'],
    ['CRES1HZZ', 'invalid_format'],
    ['CRESZZZZ', 'invalid_country'],
  ])('rejects %s with the error code %s', (bic, error) => {
    const r = validateBIC(bic);
    expect(r.valid).toBe(false);
    expect(r.error).toBe(error);
  });
});

describe('iban-core contract — issuer classification (vIBAN detection)', () => {
  it('classifies Wise as an EMI, with its curated display name', () => {
    expect(classifyIssuer('TRWIGB2L')).toEqual({ type: 'emi', name: 'Wise' });
  });

  it('classifies a BIC from the generated register, falling back to the BIC as name', () => {
    expect(classifyIssuer('REVOGB21')).toEqual({ type: 'emi', name: 'REVOGB21' });
  });

  it('returns null for an unknown institution, so the caller can default to bank', () => {
    expect(classifyIssuer('ZZZZZZZZ')).toBeNull();
  });

  it.each([
    ['Revolut Bank UAB', 'digital_bank'],
    ['Wise Payments Limited', 'emi'],
    ['Stripe Payments Europe', 'payment_institution'],
  ])('falls back to the institution name when the BIC is unknown: %s → %s', (name, type) => {
    expect(classifyIssuer('ZZZZZZZZ', name)).toEqual({ type, name });
  });
});

describe('iban-core contract — country tables', () => {
  it.each([
    ['CH', 21],
    ['DE', 22],
    ['GB', 22],
    ['LT', 20],
  ])('keeps the ISO 13616 IBAN length of %s at %i', (code, length) => {
    expect(IBAN_LENGTHS[code]).toBe(length);
  });

  it('keeps SEPA membership and VoP obligation per country', () => {
    expect(getSepaInfo('CH')).toEqual({ member: true, schemes: ['SCT', 'SDD'], vop_required: false });
    expect(getSepaInfo('DE')).toEqual({ member: true, schemes: ['SCT', 'SDD', 'SCT_INST'], vop_required: true });
    expect(getSepaInfo('BR')).toEqual({ member: false, schemes: [], vop_required: false });
  });

  it('keeps the country risk tiers the compliance endpoint scores on', () => {
    expect(getCountryRisk('RU')).toBe('high');
    expect(getCountryRisk('TR')).toBe('elevated');
    expect(getCountryRisk('DE')).toBe('standard');
    expect(getCountryRisk('XX')).toBe('standard');
  });

  it('resolves country names, including the non-IBAN countries of the BIC database', () => {
    // Fast path: an IBAN country, named by the library's table.
    expect(getCountryName('CH')).toBe('Switzerland');
    // Fallback path: not an IBAN country — this is the one piece of logic the
    // countries.ts facade still owns (Intl.DisplayNames).
    expect(getCountryName('NZ')).toBe('New Zealand');
    expect(getCountryName('X')).toBeNull();
  });
});
