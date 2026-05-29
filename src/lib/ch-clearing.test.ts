import { describe, it, expect, beforeAll } from 'vitest';
import {
  lookupClearing,
  lookupClearingByBankCode,
  detectInstitutionType,
  getHeadquarters,
  getChClearingCount,
} from './ch-clearing.js';

describe('Swiss BC-Nummer Clearing Lookup', () => {
  beforeAll(() => {
    // Verify the table is seeded
    const count = getChClearingCount();
    expect(count).toBeGreaterThan(1000);
  });

  // 9.1 Database lookup tests

  describe('lookupClearing', () => {
    it('lookupClearing("00230") returns UBS Switzerland AG', () => {
      const entry = lookupClearing('00230');
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('UBS Switzerland AG');
      expect(entry!.iid).toBe('00230');
      expect(entry!.bic).toBe('UBSWCHZH80A');
    });

    it('lookupClearing("30000") returns PostFinance AG', () => {
      const entry = lookupClearing('30000');
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('PostFinance AG');
      expect(entry!.iid_type).toBe('other'); // type 4
    });

    it('lookupClearing("00700") returns Zürcher Kantonalbank', () => {
      const entry = lookupClearing('00700');
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('Zürcher Kantonalbank');
      expect(entry!.iid_type).toBe('headquarters');
    });

    it('lookupClearing("80000") returns Raiffeisen Schweiz', () => {
      const entry = lookupClearing('80000');
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('Raiffeisen Schweiz');
    });

    it('lookupClearing("99999") returns null (not found)', () => {
      const entry = lookupClearing('99999');
      expect(entry).toBeNull();
    });

    it('lookupClearing("00100") returns Schweizerische Nationalbank', () => {
      const entry = lookupClearing('00100');
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('Schweizerische Nationalbank');
    });
  });

  // 9.2 Zero-padding / normalization

  describe('Zero-padding / normalization', () => {
    it('lookupClearing("230") normalizes to "00230" and finds UBS', () => {
      const entry = lookupClearing('230');
      expect(entry).not.toBeNull();
      expect(entry!.iid).toBe('00230');
      expect(entry!.name).toBe('UBS Switzerland AG');
    });

    it('lookupClearing("100") normalizes to "00100" and finds SNB', () => {
      const entry = lookupClearing('100');
      expect(entry).not.toBeNull();
      expect(entry!.iid).toBe('00100');
    });

    it('lookupClearingByBankCode("04835") does direct lookup without padding', () => {
      const entry = lookupClearingByBankCode('04835');
      // This may or may not exist depending on the dataset, just verify no crash
      if (entry) {
        expect(entry.iid).toBe('04835');
      }
    });
  });

  // 9.3 Concatenation / redirect following

  describe('Concatenation / redirect following', () => {
    it('lookupClearingByBankCode("30025") follows redirect to "30024"', () => {
      const entry = lookupClearingByBankCode('30025');
      expect(entry).not.toBeNull();
      expect(entry!.iid).toBe('30024');
      expect(entry!.name).toBe('Valiant Bank AG');
    });

    it('redirect result includes redirected_from field', () => {
      const entry = lookupClearingByBankCode('30025');
      expect(entry).not.toBeNull();
      expect(entry!.redirected_from).toBe('30025');
    });

    it('non-redirected lookup does not have redirected_from', () => {
      const entry = lookupClearingByBankCode('00230');
      expect(entry).not.toBeNull();
      expect(entry!.redirected_from).toBeUndefined();
    });
  });

  // 9.4 Institution type detection

  describe('Institution type detection', () => {
    it('detectInstitutionType for PostFinance → "postfinance"', () => {
      expect(detectInstitutionType('PostFinance AG', '30000', 'CH')).toBe('postfinance');
    });

    it('detectInstitutionType for ZKB → "cantonal_bank"', () => {
      expect(detectInstitutionType('Zürcher Kantonalbank', '00700', 'CH')).toBe('cantonal_bank');
    });

    it('detectInstitutionType for Banque Cantonale → "cantonal_bank"', () => {
      expect(detectInstitutionType('Banque Cantonale de Genève', '00768', 'CH')).toBe(
        'cantonal_bank',
      );
    });

    it('detectInstitutionType for Raiffeisen → "raiffeisen"', () => {
      expect(detectInstitutionType('Raiffeisen Schweiz', '80000', 'CH')).toBe('raiffeisen');
    });

    it('detectInstitutionType for Romandy/Ticino "Banque/Banca Raiffeisen" → "raiffeisen"', () => {
      // Regression guard: startsWith("raiffeisen") used to misclassify these as 'bank'.
      expect(detectInstitutionType('Banque Raiffeisen du Léman', '81234', 'CH')).toBe('raiffeisen');
      expect(detectInstitutionType('Banca Raiffeisen Lugano', '81235', 'CH')).toBe('raiffeisen');
    });

    it('detectInstitutionType for SNB → "central_bank"', () => {
      expect(detectInstitutionType('Schweizerische Nationalbank', '00100', 'CH')).toBe(
        'central_bank',
      );
    });

    it('detectInstitutionType for UBS → "bank"', () => {
      expect(detectInstitutionType('UBS Switzerland AG', '00230', 'CH')).toBe('bank');
    });

    it('detectInstitutionType for DE entry → "foreign_participant"', () => {
      expect(detectInstitutionType('SECB Swiss Euro Clearing Bank', '00193', 'DE')).toBe(
        'foreign_participant',
      );
    });

    it('detectInstitutionType for LI entry → "foreign_participant"', () => {
      expect(detectInstitutionType('Neue Bank AG', '30173', 'LI')).toBe(
        'foreign_participant',
      );
    });

    it('full entry detection via lookupClearing', () => {
      const pf = lookupClearing('30000');
      expect(pf!.institution_type).toBe('postfinance');

      const zkb = lookupClearing('00700');
      expect(zkb!.institution_type).toBe('cantonal_bank');

      const raiff = lookupClearing('80000');
      expect(raiff!.institution_type).toBe('raiffeisen');

      const snb = lookupClearing('00100');
      expect(snb!.institution_type).toBe('central_bank');

      const ubs = lookupClearing('00230');
      expect(ubs!.institution_type).toBe('bank');
    });
  });

  // 9.5 Payment services parsing

  describe('Payment services', () => {
    it('PostFinance: sic=true, ip_chf=true, lsv_bdd_chf=false', () => {
      const pf = lookupClearing('30000');
      expect(pf).not.toBeNull();
      expect(pf!.payment_services.sic).toBe(true);
      expect(pf!.payment_services.instant_payments_chf).toBe(true);
      expect(pf!.payment_services.lsv_bdd_chf).toBe(false);
    });

    it('UBS: all payment services = true', () => {
      const ubs = lookupClearing('00230');
      expect(ubs).not.toBeNull();
      expect(ubs!.payment_services.sic).toBe(true);
      expect(ubs!.payment_services.rtgs_chf).toBe(true);
      expect(ubs!.payment_services.instant_payments_chf).toBe(true);
      expect(ubs!.payment_services.eurosic).toBe(true);
      expect(ubs!.payment_services.lsv_bdd_chf).toBe(true);
      expect(ubs!.payment_services.lsv_bdd_eur).toBe(true);
    });

    it('SNB: lsv_bdd_eur=false', () => {
      const snb = lookupClearing('00100');
      expect(snb).not.toBeNull();
      expect(snb!.payment_services.lsv_bdd_eur).toBe(false);
    });
  });

  // QR-IID

  describe('QR-IID', () => {
    it('PostFinance has qr_iid = "9000"', () => {
      const pf = lookupClearing('30000');
      expect(pf!.qr_iid).toBe('9000');
    });

    it('UBS has no qr_iid', () => {
      const ubs = lookupClearing('00230');
      expect(ubs!.qr_iid).toBeNull();
    });
  });

  // getHeadquarters

  describe('getHeadquarters', () => {
    it('headquarters entry returns itself', () => {
      const ubs = lookupClearing('00230');
      const hq = getHeadquarters(ubs!);
      expect(hq).not.toBeNull();
      expect(hq!.iid).toBe('00230');
    });

    it('branch entry returns its headquarters', () => {
      // Find a branch entry
      const branch = lookupClearing('00231'); // UBS branch, if it exists
      if (branch && branch.iid_type === 'branch') {
        const hq = getHeadquarters(branch);
        expect(hq).not.toBeNull();
        expect(hq!.iid_type).toBe('headquarters');
      }
    });
  });
});
