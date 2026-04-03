import { describe, it, expect } from 'vitest';
import { enrichResult } from './enrich.js';
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
    expect(result.risk_indicators!.issuer_type).toBe('bank');
    expect(result.risk_indicators!.sepa_reachable).toBe(false);
  });
});
