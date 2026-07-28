import { describe, expect, it } from 'vitest';
import { buildComplianceResponse } from './compliance-response.js';

/**
 * The defect these tests exist for, measured on production 28/07/2026:
 * /v1/iban/compliance answered risk_level "low", risk_score 10 for an IBAN that
 * did not validate at all. The 10 came from no_sepa_instant (+5) and no_vop
 * (+5), i.e. two failed lookups, and landed just under the 20-point 'medium'
 * threshold. The less the API could establish, the more reassuring its verdict.
 */
describe('buildComplianceResponse — an IBAN that does not validate is not scored', () => {
  const INVALID = [
    ['nonsense', 'XX00NOTANIBAN0000'],
    ['checksum failure', 'DE89370400440532013001'],
    ['wrong length', 'RU84044525225407028100000000001'],
    ['too short', 'CH93'],
    ['empty', ''],
  ] as const;

  for (const [name, iban] of INVALID) {
    it(`refuses to score: ${name}`, () => {
      const r = buildComplianceResponse(iban);
      expect(r.valid).toBe(false);
      expect(r.compliance.risk_score).toBeNull();
      expect(r.compliance.risk_level).toBe('unassessable');
      expect(r.compliance.flags).toEqual(['iban_invalid']);
    });
  }

  it('never answers a level that reads as permission', () => {
    // The regression in one line: whatever else changes, an unvalidatable IBAN
    // must not come back 'low'.
    for (const [, iban] of INVALID) {
      expect(buildComplianceResponse(iban).compliance.risk_level).not.toBe('low');
    }
  });

  it('carries no score-derived flag, since no score was computed', () => {
    const r = buildComplianceResponse('DE89370400440532013001');
    expect(r.compliance.flags).not.toContain('no_sepa_instant');
    expect(r.compliance.flags).not.toContain('no_vop');
  });

  it('still attaches the scope disclaimer', () => {
    // An agent that reads meta.scope must get it on every answer, including
    // the refusals: "we could not assess" and "we only screen the bank" are
    // two different limits and it needs both.
    const r = buildComplianceResponse('DE89370400440532013001');
    expect(r.meta.scope).toBe('bank_bic_only');
    expect(r.meta.disclaimer).toBeTruthy();
  });

  it('keeps the validation error, so the caller can fix the input', () => {
    const r = buildComplianceResponse('DE89370400440532013001');
    expect(r.error).toBe('checksum_failed');
  });
});

describe('buildComplianceResponse — a valid IBAN is scored exactly as before', () => {
  it('scores an ordinary German IBAN low, on merit', () => {
    const r = buildComplianceResponse('DE89370400440532013000');
    expect(r.valid).toBe(true);
    expect(r.compliance.risk_level).toBe('low');
    expect(typeof r.compliance.risk_score).toBe('number');
  });

  it('scores a Russian IBAN critical, and the typo next to it does not', () => {
    // The pair that made the defect undeniable. One character apart.
    const real = buildComplianceResponse('RU8404452522540702810412345678901');
    expect(real.valid).toBe(true);
    expect(real.compliance.risk_level).toBe('critical');
    expect(real.compliance.risk_score).toBeGreaterThanOrEqual(80);
    expect(real.compliance.flags).toContain('sanctioned_country');

    const typo = buildComplianceResponse('RU1704452522540702810412345678901');
    expect(typo.valid).toBe(false);
    expect(typo.compliance.risk_level).toBe('unassessable');
    // Before the fix this said 'low'. That is the whole bug: a typo turned a
    // sanctioned-country hit into a green light.
  });

  it('derives country risk from the country code, not from risk_indicators', () => {
    // risk_indicators is absent whenever BBAN parsing fails, and three of the
    // four old copies read country risk from it. That is how a Russian IBAN
    // once scored 60/high instead of critical.
    const r = buildComplianceResponse('RU8404452522540702810412345678901');
    expect(r.compliance.flags).toContain('high_risk_country');
  });

  it('attaches meta on the valid path too', () => {
    expect(buildComplianceResponse('DE89370400440532013000').meta.scope).toBe('bank_bic_only');
  });
});
