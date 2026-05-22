import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';

describe('IBAN Validation', () => {
  describe('Valid IBANs', () => {
    it('CH valid', () => {
      const r = validateIBAN('CH5604835012345678009');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('CH');
      expect(r.country?.name).toBe('Switzerland');
      expect(r.check_digits).toBe('56');
      expect(r.bban?.bank_code).toBe('04835');
      expect(r.bban?.account_number).toBe('012345678009');
    });

    it('DE valid', () => {
      const r = validateIBAN('DE89370400440532013000');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('DE');
      expect(r.bban?.bank_code).toBe('37040044');
      expect(r.bban?.account_number).toBe('0532013000');
    });

    it('FR valid', () => {
      const r = validateIBAN('FR7630006000011234567890189');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('FR');
      expect(r.bban?.bank_code).toBe('30006');
      expect(r.bban?.branch_code).toBe('00001');
    });

    it('GB valid', () => {
      const r = validateIBAN('GB29NWBK60161331926819');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('GB');
      expect(r.bban?.bank_code).toBe('NWBK');
      expect(r.bban?.branch_code).toBe('601613');
      expect(r.bban?.account_number).toBe('31926819');
    });
  });

  describe('Invalid — checksum', () => {
    it('CH invalid checksum (last digit modified)', () => {
      const r = validateIBAN('CH5604835012345678000');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('checksum_failed');
    });

    it('DE invalid checksum (last digit modified)', () => {
      const r = validateIBAN('DE89370400440532013001');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('checksum_failed');
    });
  });

  describe('Invalid — length', () => {
    it('CH too short', () => {
      const r = validateIBAN('CH560483501234567800');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('wrong_length');
    });
  });

  describe('Invalid — unknown country', () => {
    it('ZZ unknown country', () => {
      const r = validateIBAN('ZZ123456789');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('unsupported_country');
    });
  });

  describe('Formatting tolerance', () => {
    it('lowercase accepted', () => {
      const r = validateIBAN('ch5604835012345678009');
      expect(r.valid).toBe(true);
    });

    it('spaces accepted', () => {
      const r = validateIBAN('CH56 0483 5012 3456 7800 9');
      expect(r.valid).toBe(true);
    });

    it('hyphens accepted', () => {
      const r = validateIBAN('CH56-0483-5012-3456-7800-9');
      expect(r.valid).toBe(true);
    });
  });

  describe('SEPA enrichment', () => {
    it('CH is SEPA non-eurozone, no VoP (not EU)', () => {
      const r = validateIBAN('CH5604835012345678009');
      expect(r.sepa).toEqual({ member: true, schemes: ['SCT', 'SDD'], vop_required: false });
    });

    it('DE is eurozone with VoP mandatory', () => {
      const r = validateIBAN('DE89370400440532013000');
      expect(r.sepa).toEqual({ member: true, schemes: ['SCT', 'SDD', 'SCT_INST'], vop_required: true });
    });

    it('FR is eurozone with SCT_INST and VoP', () => {
      const r = validateIBAN('FR7630006000011234567890189');
      expect(r.sepa?.member).toBe(true);
      expect(r.sepa?.schemes).toContain('SCT_INST');
      expect(r.sepa?.vop_required).toBe(true);
    });

    it('GB is SEPA but no VoP (not EU)', () => {
      const r = validateIBAN('GB29NWBK60161331926819');
      expect(r.sepa).toEqual({ member: true, schemes: ['SCT', 'SDD'], vop_required: false });
    });

    it('BR is not a SEPA member', () => {
      const r = validateIBAN('BR1800360305000010009795493C1');
      expect(r.sepa).toEqual({ member: false, schemes: [], vop_required: false });
    });

    it('sepa is absent on invalid IBANs', () => {
      const r = validateIBAN('ZZ123456789');
      expect(r.sepa).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('empty string', () => {
      const r = validateIBAN('');
      expect(r.valid).toBe(false);
    });

    it('special characters rejected', () => {
      const r = validateIBAN('CH56!0483@5012');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('invalid_format');
    });

    it('formatted output correct', () => {
      const r = validateIBAN('CH5604835012345678009');
      expect(r.formatted).toBe('CH56 0483 5012 3456 7800 9');
    });
  });

  describe('BBAN bank-code extraction (SWIFT registry sync)', () => {
    it('IT extracts the 5-digit ABI as bank code (decomposition convention kept)', () => {
      // [1,5] skips the CIN check letter — must NOT be "aligned" to registry [0,6].
      const r = validateIBAN('IT60X0542811101000000123456');
      expect(r.valid).toBe(true);
      expect(r.bban?.bank_code).toBe('05428');
    });

    it('PL extracts the full 8-digit routing number as bank code', () => {
      // Regression: was [0,3], too short to match the bic_data.json lookup keys.
      const r = validateIBAN('PL61109010140000071219812874');
      expect(r.valid).toBe(true);
      expect(r.bban?.bank_code).toBe('10901014');
    });

    it('SI extracts the 5-digit bank identifier', () => {
      // Regression: was [0,2], too short to match the bic_data.json lookup keys.
      const r = validateIBAN('SI56263300012039086');
      expect(r.valid).toBe(true);
      expect(r.bban?.bank_code).toBe('26330');
    });

    it('validates an IBAN from a newly-synced registry country (YE)', () => {
      const r = validateIBAN('YE9600010002123456789012345678');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('YE');
      expect(r.bban?.bank_code).toBe('0001');
    });

    it('validates an IBAN from a newly-synced registry country (OM)', () => {
      const r = validateIBAN('OM490010123456789012345');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('OM');
    });
  });
});
