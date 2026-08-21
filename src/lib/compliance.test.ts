import { describe, it, expect } from 'vitest';
import { calculateRiskScore } from './compliance.js';
import type { SanctionsCheck, ReachabilityCheck, VopCheck } from '../types.js';

describe('calculateRiskScore', () => {
  const clean: SanctionsCheck = { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'member', bank_screened: true };
  const goodReach: ReachabilityCheck = { sepa_instant: true, sct: true, sdd: true, screened: true };
  const goodVop: VopCheck = { participant: true, status: 'active', screened: true };

  it('returns low risk for standard bank in FATF member country', () => {
    const r = calculateRiskScore(clean, goodReach, goodVop, 'bank', 'standard', false);
    expect(r.risk_score).toBe(0);
    expect(r.risk_level).toBe('low');
    expect(r.flags).toEqual([]);
  });

  it('returns critical risk for sanctioned country + bank', () => {
    const s: SanctionsCheck = { country_sanctioned: true, bank_sanctioned: true, matched_lists: ['OFAC'], fatf_status: 'black_list', bank_screened: true };
    const nr: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false, screened: true };
    const nv: VopCheck = { participant: false, status: 'not_found', screened: true };
    const r = calculateRiskScore(s, nr, nv, 'bank', 'high', false);
    expect(r.risk_score).toBe(100);
    expect(r.risk_level).toBe('critical');
    expect(r.flags).toContain('sanctioned_country');
    expect(r.flags).toContain('sanctioned_bank');
  });

  it('returns elevated risk for EMI in grey list country', () => {
    const s: SanctionsCheck = { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'grey_list', bank_screened: true };
    const nr: ReachabilityCheck = { sepa_instant: false, sct: true, sdd: false, screened: true };
    const nv: VopCheck = { participant: false, status: 'not_found', screened: true };
    const r = calculateRiskScore(s, nr, nv, 'emi', 'standard', false);
    expect(r.risk_score).toBe(40);
    expect(r.risk_level).toBe('elevated');
  });

  it('caps score at 100', () => {
    const s: SanctionsCheck = { country_sanctioned: true, bank_sanctioned: true, matched_lists: ['OFAC'], fatf_status: 'black_list', bank_screened: true };
    const nr: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false, screened: true };
    const nv: VopCheck = { participant: false, status: 'not_found', screened: true };
    const r = calculateRiskScore(s, nr, nv, 'payment_institution', 'high', true);
    expect(r.risk_score).toBe(100);
  });

  it('adds test_bic flag', () => {
    const r = calculateRiskScore(clean, goodReach, goodVop, 'bank', 'standard', true);
    expect(r.risk_score).toBe(30);
    expect(r.flags).toContain('test_bic');
  });

  it('does NOT penalise a standard FATF non-member SEPA country (e.g. PL, MT)', () => {
    // Regression guard: a +10 'fatf_non_member' weight used to push ~13 standard
    // EU/SEPA countries from 'low' to 'medium'. FATF non-membership carries no
    // AML signal, so a clean non-member bank must score 0 / low.
    const nonMember: SanctionsCheck = {
      country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'non_member', bank_screened: true,
    };
    const r = calculateRiskScore(nonMember, goodReach, goodVop, 'bank', 'standard', false);
    expect(r.risk_score).toBe(0);
    expect(r.risk_level).toBe('low');
    expect(r.flags).not.toContain('fatf_non_member');
  });

  it('scores a SUSPENDED FATF membership at least as severely as non_member, with a flag', () => {
    const suspended: SanctionsCheck = {
      country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'suspended', bank_screened: true,
    };
    const nonMember: SanctionsCheck = { ...suspended, fatf_status: 'non_member' };
    const s = calculateRiskScore(suspended, goodReach, goodVop, 'bank', 'standard', false);
    const n = calculateRiskScore(nonMember, goodReach, goodVop, 'bank', 'standard', false);
    expect(s.risk_score).toBeGreaterThanOrEqual(n.risk_score);
    expect(s.flags).toContain('fatf_suspended');
  });

  it('Russia-shaped inputs (sanctioned + suspended + high country risk) reach critical', () => {
    const ru: SanctionsCheck = {
      country_sanctioned: true, bank_sanctioned: false, matched_lists: [], fatf_status: 'suspended', bank_screened: true,
    };
    const nr: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false, screened: true };
    const nv: VopCheck = { participant: false, status: 'not_found', screened: true };
    const r = calculateRiskScore(ru, nr, nv, 'bank', 'high', false);
    expect(r.risk_score).toBeGreaterThanOrEqual(80);
    expect(r.risk_level).toBe('critical');
    expect(r.flags).toContain('sanctioned_country');
    expect(r.flags).toContain('high_risk_country');
    expect(r.flags).toContain('fatf_suspended');
  });
});
