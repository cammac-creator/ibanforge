import { describe, it, expect } from 'vitest';
import { classifyIssuer, normalizeIssuerName } from './issuers.js';
import { GENERATED_ISSUERS } from './issuers-generated.js';

describe('classifyIssuer', () => {
  describe('known digital banks', () => {
    it('Revolut LT', () => {
      const r = classifyIssuer('REVOLT21');
      expect(r).toEqual({ type: 'digital_bank', name: 'Revolut' });
    });

    it('Revolut GB (corrected BIC)', () => {
      const r = classifyIssuer('REVOGB2L');
      expect(r).toEqual({ type: 'digital_bank', name: 'Revolut' });
    });

    it('Revolut Bank UAB LT', () => {
      const r = classifyIssuer('RVUALT2V');
      expect(r).toEqual({ type: 'digital_bank', name: 'Revolut Bank UAB' });
    });

    it('N26 DE', () => {
      const r = classifyIssuer('NTSBDEB1');
      expect(r).toEqual({ type: 'digital_bank', name: 'N26' });
    });

    it('Monzo GB', () => {
      const r = classifyIssuer('MONZGB2L');
      expect(r).toEqual({ type: 'digital_bank', name: 'Monzo' });
    });

    it('bunq NL', () => {
      const r = classifyIssuer('BUNQNL2A');
      expect(r).toEqual({ type: 'digital_bank', name: 'bunq' });
    });

    it('Memo Bank FR', () => {
      const r = classifyIssuer('MEMOFRP2');
      expect(r).toEqual({ type: 'digital_bank', name: 'Memo Bank' });
    });

    it('Tide GB', () => {
      const r = classifyIssuer('TIPLGB22');
      expect(r).toEqual({ type: 'digital_bank', name: 'Tide' });
    });
  });

  describe('known EMIs', () => {
    it('Wise BE', () => {
      const r = classifyIssuer('TRWIBEB1');
      expect(r).toEqual({ type: 'emi', name: 'Wise' });
    });

    it('Adyen NL', () => {
      const r = classifyIssuer('ADYBNL2A');
      expect(r).toEqual({ type: 'emi', name: 'Adyen' });
    });

    it('Paysera LT (corrected BIC)', () => {
      const r = classifyIssuer('EVIULT2V');
      expect(r).toEqual({ type: 'emi', name: 'Paysera' });
    });

    it('Banking Circle LU (corrected BIC)', () => {
      const r = classifyIssuer('BCIRLULL');
      expect(r).toEqual({ type: 'emi', name: 'Banking Circle' });
    });

    it('Swan FR (corrected BIC)', () => {
      const r = classifyIssuer('SWNBFR22');
      expect(r).toEqual({ type: 'emi', name: 'Swan' });
    });

    it('Mangopay LU (corrected BIC)', () => {
      const r = classifyIssuer('MAGYLUL1');
      expect(r).toEqual({ type: 'emi', name: 'Mangopay' });
    });

    it('Payoneer Europe IE', () => {
      const r = classifyIssuer('PAYNIE22');
      expect(r).toEqual({ type: 'emi', name: 'Payoneer Europe' });
    });

    it('Airwallex GB', () => {
      const r = classifyIssuer('AIRWGB22');
      expect(r).toEqual({ type: 'emi', name: 'Airwallex' });
    });

    it('Currencycloud GB', () => {
      const r = classifyIssuer('TCCLGB3L');
      expect(r).toEqual({ type: 'emi', name: 'Currencycloud' });
    });

    it('Ebury Partners GB', () => {
      const r = classifyIssuer('EBURGB2L');
      expect(r).toEqual({ type: 'emi', name: 'Ebury Partners' });
    });

    it('Finom Payments NL (corrected BIC)', () => {
      const r = classifyIssuer('FNOMNL22');
      expect(r).toEqual({ type: 'emi', name: 'Finom Payments' });
    });

    it('Viva Wallet GR', () => {
      const r = classifyIssuer('VPAYGRAA');
      expect(r).toEqual({ type: 'emi', name: 'Viva Wallet' });
    });

    it('Paynetics BG', () => {
      const r = classifyIssuer('PATCBGSF');
      expect(r).toEqual({ type: 'emi', name: 'Paynetics' });
    });
  });

  describe('known payment institutions', () => {
    it('Solarisbank DE', () => {
      const r = classifyIssuer('SOBKDEB2');
      expect(r).toEqual({ type: 'payment_institution', name: 'Solarisbank' });
    });

    it('Stripe Payments Europe IE (corrected BIC)', () => {
      const r = classifyIssuer('STPUIE21');
      expect(r).toEqual({ type: 'payment_institution', name: 'Stripe Payments Europe' });
    });

    it('Fire Financial Services IE (renamed)', () => {
      const r = classifyIssuer('CPAYIE2D');
      expect(r).toEqual({ type: 'payment_institution', name: 'Fire Financial Services' });
    });

    it('Modulr FS GB', () => {
      const r = classifyIssuer('MODRGB21');
      expect(r).toEqual({ type: 'payment_institution', name: 'Modulr FS' });
    });

    it('Modulr Finance IE (corrected BIC)', () => {
      const r = classifyIssuer('MODRIE22');
      expect(r).toEqual({ type: 'payment_institution', name: 'Modulr Finance' });
    });

    it('TrueLayer GB', () => {
      const r = classifyIssuer('TRYEGB22');
      expect(r).toEqual({ type: 'payment_institution', name: 'TrueLayer' });
    });

    it('GoCardless GB', () => {
      const r = classifyIssuer('GOCRGB22');
      expect(r).toEqual({ type: 'payment_institution', name: 'GoCardless' });
    });

    it('Prepay Technologies GB', () => {
      const r = classifyIssuer('PRTCGB21');
      expect(r).toEqual({ type: 'payment_institution', name: 'Prepay Technologies' });
    });
  });

  describe('removed entries return null', () => {
    it('RABORL2X (unverified Revolut alt) removed', () => {
      expect(classifyIssuer('RABORL2X')).toBeNull();
    });

    it('RABORL22 (unverified Railsr) removed', () => {
      expect(classifyIssuer('RABORL22')).toBeNull();
    });

    it('TOBADED1 (Tomorrow Bank uses Solarisbank) removed', () => {
      expect(classifyIssuer('TOBADED1')).toBeNull();
    });

    it('old incorrect BIC BARCNL22 removed', () => {
      expect(classifyIssuer('BARCNL22')).toBeNull();
    });

    it('old incorrect BIC EABORL2X removed', () => {
      expect(classifyIssuer('EABORL2X')).toBeNull();
    });
  });

  describe('unknown BICs', () => {
    it('returns null for traditional banks not in the list', () => {
      expect(classifyIssuer('UBSWCHZH')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(classifyIssuer('')).toBeNull();
    });

    it('returns null for random string', () => {
      expect(classifyIssuer('XXXXXXXX')).toBeNull();
    });
  });

  describe('normalization', () => {
    it('handles lowercase', () => {
      const r = classifyIssuer('revolt21');
      expect(r?.type).toBe('digital_bank');
    });

    it('handles 11-char BIC (strips branch)', () => {
      const r = classifyIssuer('REVOLT21XXX');
      expect(r?.type).toBe('digital_bank');
    });
  });

  describe('name fallback (stage 2)', () => {
    it('classifies an unknown BIC by a known brand name', () => {
      // BIC8 not in KNOWN_ISSUERS, institution name matches the "Wise" brand
      const r = classifyIssuer('WISEXX99', 'Wise Payments Belgium SA');
      expect(r).toEqual({ type: 'emi', name: 'Wise Payments Belgium SA' });
    });

    it('does not classify a traditional bank by name', () => {
      expect(classifyIssuer('UBSWCHZH', 'UBS Switzerland AG')).toBeNull();
    });

    it('lets the known BIC8 win over the name (stage 1 first)', () => {
      const r = classifyIssuer('TRWIBEB1', 'Some Unrelated Bank');
      expect(r).toEqual({ type: 'emi', name: 'Wise' });
    });

    it('returns null for an unknown BIC with no name', () => {
      expect(classifyIssuer('ZZZZ9999')).toBeNull();
    });

    it('returns null for an unknown BIC with an unmatched name', () => {
      expect(classifyIssuer('ZZZZ9999', 'Banque Cantonale Vaudoise')).toBeNull();
    });
  });

  describe('normalizeIssuerName', () => {
    it('lowercases and collapses punctuation to single spaces', () => {
      expect(normalizeIssuerName('Stripe Payments Europe Ltd.')).toBe('stripe payments europe ltd');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeIssuerName('  N26  ')).toBe('n26');
    });
  });

  describe('generated register index (stage 1b)', () => {
    it('GENERATED_ISSUERS has the expected scale (regression guard)', () => {
      // Catches a silent build-script breakage producing few/zero entries.
      expect(Object.keys(GENERATED_ISSUERS).length).toBeGreaterThan(800);
    });

    it('classifies a BIC present only in the generated index', () => {
      // NEPYITM1 (Nexi Payments) is in GENERATED_ISSUERS, not in KNOWN_ISSUERS.
      const r = classifyIssuer('NEPYITM1', 'NEXI PAYMENTS S.P.A.');
      expect(r).toEqual({ type: 'emi', name: 'NEXI PAYMENTS S.P.A.' });
    });

    it('uses the BIC8 as name when no institution name is supplied', () => {
      const r = classifyIssuer('NEPYITM1');
      expect(r?.type).toBe('emi');
      expect(r?.name).toBe('NEPYITM1');
    });
  });
});
