import { describe, it, expect } from 'vitest';
import { enrichResult, isTestBic } from './enrich.js';
import { validateIBAN } from './iban.js';
import type { IBANValidationResult } from '../types.js';

describe('enrichResult', () => {
  it('enriches a valid CH IBAN with sepa, issuer, risk_indicators', () => {
    const result = validateIBAN('CH5604835012345678009');
    enrichResult(result);

    expect(result.sepa).toBeDefined();
    expect(result.sepa!.member).toBe(true);
    expect(result.sepa!.vop_required).toBe(false); // CH not EU

    expect(result.risk_indicators).toBeDefined();
    expect(result.risk_indicators!.country_risk).toBe('standard');
    expect(result.risk_indicators!.sepa_reachable).toBe(true);
    expect(result.risk_indicators!.vop_coverage).toBe(false);
  });

  it('enriches a valid DE IBAN with eurozone data', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);

    expect(result.sepa!.schemes).toContain('SCT_INST');
    expect(result.sepa!.vop_required).toBe(true);
    expect(result.risk_indicators!.vop_coverage).toBe(true);
  });

  it('does not enrich invalid IBANs', () => {
    const result = validateIBAN('INVALID');
    enrichResult(result);

    expect(result.bic).toBeUndefined();
    expect(result.issuer).toBeUndefined();
    expect(result.risk_indicators).toBeUndefined();
  });

  it('sets issuer to bank by default when BIC is found but not in EMI list', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);

    if (result.bic) {
      expect(result.issuer).toBeDefined();
      expect(result.issuer!.type).toBe('bank');
    }
  });

  it('populates risk_indicators even when BIC is not found', () => {
    // Use a valid IBAN where BIC may not resolve
    const result: IBANValidationResult = {
      iban: 'BR1800360305000010009795493C1',
      valid: true,
      country: { code: 'BR', name: 'Brazil' },
      check_digits: '18',
      bban: { bank_code: '00360305', account_number: '0010009795493C1' },
      sepa: { member: false, schemes: [], vop_required: false },
      cost_usdc: 0.005,
    };
    enrichResult(result);

    expect(result.risk_indicators).toBeDefined();
    // Was 'bank'. That default typed an institution the lookup had not found,
    // and a caller could not tell it apart from a genuine bank — see
    // bank-code-check.test.ts. The honest answer for an unresolved bank code is
    // no answer.
    expect(result.risk_indicators!.issuer_type).toBeNull();
    expect(result.risk_indicators!.sepa_reachable).toBe(false);
  });

  // Swiss clearing enrichment tests

  it('enriches a valid CH IBAN with clearing data', () => {
    const result = validateIBAN('CH5604835012345678009');
    enrichResult(result);

    expect(result.clearing).toBeDefined();
    // 04835 (ex-Credit Suisse) now concatenates to UBS's 00230 after the merger.
    expect(result.clearing!.iid).toBe('00230');
    expect(typeof result.clearing!.sic).toBe('boolean');
    expect(typeof result.clearing!.instant_payments_chf).toBe('boolean');
    expect(typeof result.clearing!.eurosic).toBe('boolean');
  });

  it('DE IBAN does NOT get clearing field', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);

    expect(result.clearing).toBeUndefined();
  });

  it('invalid CH IBAN does NOT get clearing field', () => {
    const result = validateIBAN('CH5604835012345678000'); // bad checksum
    enrichResult(result);

    expect(result.clearing).toBeUndefined();
  });

  it('CH IBAN with known bank_code gets correct institution type', () => {
    // CH5604835012345678009 has bank_code '04835'
    const result = validateIBAN('CH5604835012345678009');
    enrichResult(result);

    if (result.clearing) {
      expect(['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant']).toContain(result.clearing.type);
    }
  });

  // Regression: test_bic was previously hardcoded to false in enrich.ts,
  // silently disabling the +30 risk score penalty for test BICs in
  // compliance.calculateRiskScore.
  describe('isTestBic (ISO 9362 §5.3 — location code[1] === "0")', () => {
    it('false for a production BIC', () => {
      expect(isTestBic('COBADEFFXXX')).toBe(false);
      expect(isTestBic('UBSWCHZH')).toBe(false);
    });

    it('true when location code second char is "0"', () => {
      expect(isTestBic('MARKDE50')).toBe(true);
      expect(isTestBic('TESTUS60XXX')).toBe(true);
    });

    it('false for empty, undefined, or too-short input', () => {
      expect(isTestBic(undefined)).toBe(false);
      expect(isTestBic(null)).toBe(false);
      expect(isTestBic('')).toBe(false);
      expect(isTestBic('SHORT')).toBe(false);
    });

    it('enrichResult uses isTestBic for real IBANs (non-test production path)', () => {
      const result = validateIBAN('DE89370400440532013000');
      enrichResult(result);
      expect(result.risk_indicators?.test_bic).toBe(false);
    });
  });
});
