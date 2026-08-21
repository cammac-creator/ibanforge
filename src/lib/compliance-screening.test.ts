import { describe, it, expect } from 'vitest';
import { checkSanctions, checkReachability, checkVop, buildComplianceResult, calculateRiskScore } from './compliance.js';
import type { SanctionsCheck, ReachabilityCheck, VopCheck } from '../types.js';

/**
 * The two defects these tests pin, both found on 20/08/2026:
 *
 * 1. A sanctioned bank absent from our own BIC directory was DISCARDED by the
 *    refresh script. The EU consolidated list exposes exactly two BICs and one
 *    of them, AGRULYLT (Agricultural Bank of Libya), is not in bic_entries — so
 *    half the EU coverage was dropped in silence, on the endpoint sold as a
 *    compliance tool. OFAC lost 27 of 223 the same way.
 *
 * 2. With no institution resolved, the three BIC-keyed axes answered exactly
 *    what a passed check answers: `bank_sanctioned: false`, everything
 *    unreachable, and two penalties added for absences nobody had verified.
 *
 * These read the SHIPPED data/compliance.sqlite on purpose. A fixture database
 * built to match the fixed behaviour would pass with the bug still in the
 * refresh script, which is the failure mode worth guarding against here.
 */

describe('a sanctioned bank stays screenable even when our directory cannot name it', () => {
  it('flags AGRULYLT, which is on the EU list and absent from bic_entries', () => {
    const s = checkSanctions('LY', 'AGRULYLT');
    expect(s.bank_sanctioned).toBe(true);
    expect(s.matched_lists).toContain('EU');
    expect(s.bank_screened).toBe(true);
  });

  it('still flags a sanctioned bank our directory does hold', () => {
    // The other half of the EU list, present in bic_entries. Both must work, or
    // the fix has merely moved the blind spot.
    const s = checkSanctions('IR', 'REFAIRTH');
    expect(s.bank_sanctioned).toBe(true);
    expect(s.matched_lists).toContain('EU');
  });

  it('an ordinary bank is still clean — the fix did not turn the screen into a yes-machine', () => {
    const s = checkSanctions('DE', 'COBADEFF');
    expect(s.bank_sanctioned).toBe(false);
    expect(s.matched_lists).toEqual([]);
    expect(s.bank_screened).toBe(true);
  });
});

describe('"nothing to screen" is reported as such, never as "screened and clean"', () => {
  it('marks the bank axis unscreened when no BIC resolved', () => {
    const s = checkSanctions('DE', null);
    expect(s.bank_screened).toBe(false);
    // The country and FATF axes DID answer — which is why this flag is named
    // bank_screened and not screened.
    expect(s.fatf_status).toBe('member');
  });

  it('marks reachability and VoP unscreened when no BIC resolved', () => {
    expect(checkReachability(null).screened).toBe(false);
    expect(checkVop(null).screened).toBe(false);
  });

  it('marks them screened when a BIC did resolve', () => {
    expect(checkReachability('COBADEFF').screened).toBe(true);
    expect(checkVop('COBADEFF').screened).toBe(true);
  });

  it('stops charging risk points for absences nobody verified', () => {
    const s: SanctionsCheck = {
      country_sanctioned: false, bank_sanctioned: false, matched_lists: [],
      fatf_status: 'member', bank_screened: false,
    };
    const r: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false, screened: false };
    const v: VopCheck = { participant: false, status: 'not_found', screened: false };

    const unscreened = calculateRiskScore(s, r, v, 'bank', 'standard', false);
    expect(unscreened.flags).toContain('no_bank_resolved');
    expect(unscreened.flags).not.toContain('no_sepa_instant');
    expect(unscreened.flags).not.toContain('no_vop');
    expect(unscreened.risk_score).toBe(0);

    // Same inputs, but a bank WAS screened and came back unreachable. That is a
    // finding, and it still scores.
    const screened = calculateRiskScore(
      { ...s, bank_screened: true }, { ...r, screened: true }, { ...v, screened: true },
      'bank', 'standard', false,
    );
    expect(screened.flags).toEqual(['no_sepa_instant', 'no_vop']);
    expect(screened.risk_score).toBe(10);
  });

  it('an unvalidatable IBAN reports every axis as unscreened', () => {
    const c = buildComplianceResult(false, '', null, 'bank', 'standard', false);
    expect(c.sanctions.bank_screened).toBe(false);
    expect(c.reachability.screened).toBe(false);
    expect(c.vop.screened).toBe(false);
    expect(c.risk_level).toBe('unassessable');
  });
});

describe('VoP carries the status the EPC register publishes', () => {
  it('reports a pending registration as pending, not as absent', () => {
    // The register publishes "Pending EDS registration" alongside "Ready for
    // operations". Those rows used to be dropped, which read as `not_found` —
    // indistinguishable from a bank that never registered at all.
    const v = checkVop('AFRIFRPP');
    expect(v.status).toBe('pending');
    expect(v.screened).toBe(true);
  });

  it('does NOT count a pending registration as a participant', () => {
    // The direction of the error matters: telling a payer a name check is
    // available before it is would be a false positive on a regulatory field.
    expect(checkVop('AFRIFRPP').participant).toBe(false);
  });

  it('an active participant is still a participant', () => {
    const v = checkVop('COBADEFF');
    expect(v.status).toBe('active');
    expect(v.participant).toBe(true);
  });
});
