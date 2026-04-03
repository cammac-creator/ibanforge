import { describe, it, expect } from 'vitest';
import { classifyIssuer } from './issuers.js';

describe('classifyIssuer', () => {
  describe('known digital banks', () => {
    it('Revolut LT', () => {
      const r = classifyIssuer('REVOLT21');
      expect(r).toEqual({ type: 'digital_bank', name: 'Revolut' });
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

    it('Paysera LT', () => {
      const r = classifyIssuer('EABORL2X');
      expect(r).toEqual({ type: 'emi', name: 'Paysera' });
    });
  });

  describe('known payment institutions', () => {
    it('Solarisbank DE', () => {
      const r = classifyIssuer('SOBKDEB2');
      expect(r).toEqual({ type: 'payment_institution', name: 'Solarisbank' });
    });

    it('Stripe IE', () => {
      const r = classifyIssuer('SUGBIE22');
      expect(r).toEqual({ type: 'payment_institution', name: 'Stripe' });
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
});
