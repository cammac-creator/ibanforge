import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';
import { IBAN_LENGTHS, BBAN_SPECS, BBAN_STRUCTURE, EXAMPLE_IBANS } from './countries.js';

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

    it('SK valid — bank code, account prefix (branch) and account isolated per SWIFT registry', () => {
      // SK BBAN = 4-digit bank + 6-digit account prefix + 10-digit account.
      // Regression guard: the prefix must NOT be folded into account_number.
      const r = validateIBAN('SK3112000000198742637541');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('SK');
      expect(r.bban?.bank_code).toBe('1200');
      expect(r.bban?.branch_code).toBe('000019');
      expect(r.bban?.account_number).toBe('8742637541');
      expect(r.bban?.account_number).toHaveLength(10);
    });

    it('EU EMI hubs (LT/EE/LV/MT/CY) decompose a non-empty bank_code', () => {
      // Regression guard: these had no BBAN_STRUCTURE, so bank_code came back
      // empty and enrichResult bailed early — silently killing BIC/EMI/vIBAN
      // detection for the European EMI capital (LT) and neighbours.
      const cases: Array<[string, string]> = [
        ['LT121000011101001000', '10000'],
        ['EE382200221020145685', '22'],
        ['LV80BANK0000435195001', 'BANK'],
        ['MT84MALT011000012345MTLCAST001S', 'MALT'],
        ['CY17002001280000001200527600', '002'],
      ];
      for (const [iban, bankCode] of cases) {
        const r = validateIBAN(iban);
        expect(r.valid).toBe(true);
        expect(r.bban?.bank_code).toBe(bankCode);
      }
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

    it('rejects absurdly long input fast without throwing (CPU guard)', () => {
      const r = validateIBAN('CH' + '9'.repeat(5000));
      expect(r.valid).toBe(false);
      expect(r.error).toBe('invalid_format');
      // The echoed iban must be capped, not the multi-KB input.
      expect(r.iban.length).toBeLessThanOrEqual(64);
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
      // Official registry sample — YE bank codes are 4!a (the previous test
      // IBAN 'YE96 0001 0002…' had a numeric bank code, which the registry
      // pattern rightly rejects).
      const r = validateIBAN('YE15CBYE0001018861234567891234');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('YE');
      expect(r.bban?.bank_code).toBe('CBYE');
    });

    it('validates an IBAN from a newly-synced registry country (OM)', () => {
      const r = validateIBAN('OM490010123456789012345');
      expect(r.valid).toBe(true);
      expect(r.country?.code).toBe('OM');
    });
  });

  // -------------------------------------------------------------------------
  // Registry conformance suite (2026-07-10 audit): the SWIFT IBAN Registry
  // publishes one official sample IBAN per country. Every one of the 89 MUST
  // validate — if a sample fails, the BBAN_SPECS pattern is wrong, not the
  // sample (anti-over-rejection guard).
  // -------------------------------------------------------------------------
  describe('SWIFT registry conformance — all 89 official samples validate', () => {
    it('covers exactly the supported country set', () => {
      expect(Object.keys(EXAMPLE_IBANS).sort()).toEqual(Object.keys(IBAN_LENGTHS).sort());
      expect(Object.keys(BBAN_SPECS).sort()).toEqual(Object.keys(IBAN_LENGTHS).sort());
    });

    it('every BBAN spec length matches the country IBAN length', () => {
      for (const [cc, spec] of Object.entries(BBAN_SPECS)) {
        let len = 0;
        for (const m of spec.matchAll(/(\d+)!([nac])/g)) len += parseInt(m[1], 10);
        expect(len, `${cc}: BBAN spec '${spec}' length`).toBe(IBAN_LENGTHS[cc] - 4);
      }
    });

    it.each(Object.entries(EXAMPLE_IBANS))('%s official sample %s validates', (cc, iban) => {
      const r = validateIBAN(iban);
      expect(r.valid, `${cc} ${iban}: ${r.error} ${r.error_detail ?? ''}`).toBe(true);
      expect(r.country?.code).toBe(cc);
      // Full-coverage guarantee: bank_code must decompose for every country
      // (47 countries used to return an empty bank_code and lost all
      // BIC/issuer/risk enrichment).
      expect(r.bban?.bank_code, `${cc}: bank_code`).not.toBe('');
      expect(r.bban?.bank_code.length).toBe(BBAN_STRUCTURE[cc].bankCode[1]);
    });
  });

  describe('BBAN structure rejection (targeted negatives)', () => {
    it('rejects letters inside an all-numeric bank code (DE) even when mod-97 passes', () => {
      const r = validateIBAN('DE17ABCDEFGH1234567890');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('invalid_bban_structure');
      expect(r.error_detail).toContain('bank code must be 8 digits');
      expect(r.error_detail).toContain('8!n10!n');
    });

    it('rejects digits inside a letters-only bank code (GB)', () => {
      // GB bank code is 4!a; craft a mod-97-passing IBAN with digits there.
      // GB29NWBK… with bank '1WBK' → recompute check digits.
      const bban = '1WBK60161331926819';
      const candidate = findValidCheckDigits('GB', bban);
      const r = validateIBAN(candidate);
      expect(r.valid).toBe(false);
      expect(r.error).toBe('invalid_bban_structure');
      expect(r.error_detail).toContain('bank code must be 4 uppercase letters');
    });

    it('rejects a letter inside a numeric account segment (CH)', () => {
      // CH BBAN is 5!n12!c — put a letter inside the 5!n bank code.
      const bban = '0A835012345678009';
      const candidate = findValidCheckDigits('CH', bban);
      const r = validateIBAN(candidate);
      expect(r.valid).toBe(false);
      expect(r.error).toBe('invalid_bban_structure');
      expect(r.error_detail).toContain('bank code must be 5 digits');
    });

    it('names the offending position and field in the detail', () => {
      const r = validateIBAN('DE17ABCDEFGH1234567890');
      expect(r.error_detail).toMatch(/found 'A' at BBAN position 1/);
    });
  });

  describe('Check digits — ISO 13616 range (02–98)', () => {
    it('rejects check digits 99 even when mod-97 passes (CH99…)', () => {
      const r = validateIBAN('CH9900762000000000051');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('invalid_check_digits');
      expect(r.error_detail).toContain('02–98');
    });

    it('rejects check digits 00 and 01', () => {
      // Structure-valid BBANs; the CD range must reject before mod-97 runs.
      for (const cd of ['00', '01']) {
        const r = validateIBAN(`CH${cd}00762011623852957`);
        expect(r.valid).toBe(false);
        expect(r.error).toBe('invalid_check_digits');
      }
    });

    it('rejects non-numeric check digits explicitly', () => {
      const r = validateIBAN('CHAB00762011623852957');
      expect(r.valid).toBe(false);
      expect(r.error).toBe('invalid_check_digits');
    });
  });
});

/**
 * Find the (unique) valid ISO 13616 check digits for a country+BBAN and return
 * the full IBAN — lets negative tests craft mod-97-passing IBANs so they prove
 * the STRUCTURE check rejects them (not the checksum).
 */
function findValidCheckDigits(cc: string, bban: string): string {
  for (let cd = 2; cd <= 98; cd++) {
    const cdStr = String(cd).padStart(2, '0');
    const candidate = cc + cdStr + bban;
    const rearranged = candidate.slice(4) + candidate.slice(0, 4);
    let num = '';
    for (const ch of rearranged) {
      const code = ch.charCodeAt(0);
      num += code >= 65 && code <= 90 ? String(code - 55) : ch;
    }
    if (BigInt(num) % 97n === 1n) return candidate;
  }
  throw new Error(`No valid check digits for ${cc}${bban}`);
}
