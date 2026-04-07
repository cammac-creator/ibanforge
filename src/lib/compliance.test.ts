import { describe, it, expect } from 'vitest';
import { calculateRiskScore } from './compliance.js';
import type { SanctionsCheck, ReachabilityCheck, VopCheck } from '../types.js';

describe('calculateRiskScore', () => {
  const clean: SanctionsCheck = { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'member' };
  const goodReach: ReachabilityCheck = { sepa_instant: true, sct: true, sdd: true };
  const goodVop: VopCheck = { participant: true, status: 'active' };

  it('returns low risk for standard bank in FATF member country', () => {
    const r = calculateRiskScore(clean, goodReach, goodVop, 'bank', 'standard', false);
    expect(r.risk_score).toBe(0);
    expect(r.risk_level).toBe('low');
    expect(r.flags).toEqual([]);
  });

  it('returns critical risk for sanctioned country + bank', () => {
    const s: SanctionsCheck = { country_sanctioned: true, bank_sanctioned: true, matched_lists: ['OFAC'], fatf_status: 'black_list' };
    const nr: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false };
    const nv: VopCheck = { participant: false, status: 'not_found' };
    const r = calculateRiskScore(s, nr, nv, 'bank', 'high', false);
    expect(r.risk_score).toBe(100);
    expect(r.risk_level).toBe('critical');
    expect(r.flags).toContain('sanctioned_country');
    expect(r.flags).toContain('sanctioned_bank');
  });

  it('returns elevated risk for EMI in grey list country', () => {
    const s: SanctionsCheck = { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'grey_list' };
    const nr: ReachabilityCheck = { sepa_instant: false, sct: true, sdd: false };
    const nv: VopCheck = { participant: false, status: 'not_found' };
    const r = calculateRiskScore(s, nr, nv, 'emi', 'standard', false);
    expect(r.risk_score).toBe(40);
    expect(r.risk_level).toBe('elevated');
  });

  it('caps score at 100', () => {
    const s: SanctionsCheck = { country_sanctioned: true, bank_sanctioned: true, matched_lists: ['OFAC'], fatf_status: 'black_list' };
    const nr: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false };
    const nv: VopCheck = { participant: false, status: 'not_found' };
    const r = calculateRiskScore(s, nr, nv, 'payment_institution', 'high', true);
    expect(r.risk_score).toBe(100);
  });

  it('adds test_bic flag', () => {
    const r = calculateRiskScore(clean, goodReach, goodVop, 'bank', 'standard', true);
    expect(r.risk_score).toBe(30);
    expect(r.flags).toContain('test_bic');
  });
});
