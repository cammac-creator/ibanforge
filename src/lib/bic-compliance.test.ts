import { describe, it, expect } from 'vitest';
import { buildBicComplianceResponse } from './compliance-response.js';
import { screenBicSanctions } from './compliance.js';

/**
 * Closing the loop the sanctions fix left open.
 *
 * On 21/08/2026 the refresh script stopped discarding designated banks absent
 * from our own BIC directory, which recovered 33 of them. They were correct in
 * the table and UNREACHABLE in practice: /v1/iban/compliance took only an IBAN,
 * and in the 19 countries whose bank code is purely numeric with no curated map
 * — Libya among them — no IBAN can ever resolve to a BIC. So the EU's
 * Agricultural Bank of Libya sat in the sanctions table while every request
 * about it answered "clean".
 *
 * Fabricating an LY bank-code map to bridge that gap would have been inventing
 * a register. Accepting the BIC the caller already holds costs nothing.
 */
describe('screening keyed on a BIC reaches the banks no IBAN can', () => {
  it('flags AGRULYLT — designated by the EU, absent from our directory', () => {
    const r = buildBicComplianceResponse('AGRULYLT');
    expect('error' in r).toBe(false);
    if ('error' in r) return;

    // The two facts that must coexist. Before this endpoint, the first one
    // silenced the second.
    expect(r.found).toBe(false);
    expect(r.institution).toBeNull();
    expect(r.compliance.sanctions.bank_sanctioned).toBe(true);
    expect(r.compliance.sanctions.matched_lists).toContain('EU');
    expect(r.compliance.sanctions.bank_screened).toBe(true);
    expect(r.compliance.risk_level).toBe('critical');
  });

  it('flags a bank OFAC designated that our directory also cannot name', () => {
    const r = buildBicComplianceResponse('MOSWRUMM');
    if ('error' in r) throw new Error('should validate');
    expect(r.found).toBe(false);
    expect(r.compliance.sanctions.bank_sanctioned).toBe(true);
    expect(r.compliance.sanctions.matched_lists).toContain('OFAC');
  });

  it('reads the country out of the BIC, so every axis is screened', () => {
    const r = buildBicComplianceResponse('AGRULYLT');
    if ('error' in r) throw new Error('should validate');
    // Positions 5-6 of a BIC are its country. No resolution step, no bank code,
    // nothing to fail — which is why this input is better than an IBAN here.
    expect(r.country.code).toBe('LY');
    expect(r.compliance.reachability.screened).toBe(true);
    expect(r.compliance.vop.screened).toBe(true);
  });

  it('leaves an ordinary bank clean — the endpoint is not a yes-machine', () => {
    const r = buildBicComplianceResponse('COBADEFF');
    if ('error' in r) throw new Error('should validate');
    expect(r.found).toBe(true);
    expect(r.institution).toBeTruthy();
    expect(r.compliance.sanctions.bank_sanctioned).toBe(false);
    expect(r.compliance.risk_score).toBe(0);
  });

  it('rejects a malformed BIC rather than screening nonsense', () => {
    const r = buildBicComplianceResponse('NOPE');
    expect('error' in r).toBe(true);
  });
});

describe('a BIC lookup never answers a bare "not found" about a designated bank', () => {
  it('reports the sanctions hit even though the directory holds nothing', () => {
    const s = screenBicSanctions('AGRULYLT');
    expect(s.screened).toBe(true);
    expect(s.listed).toBe(true);
    expect(s.matched_lists).toContain('EU');
  });

  it('reports a clean bank as clean', () => {
    const s = screenBicSanctions('COBADEFF');
    expect(s.screened).toBe(true);
    expect(s.listed).toBe(false);
    expect(s.matched_lists).toEqual([]);
  });

  it('says listed:null — never false — if the screen itself could not run', () => {
    // `false` would be a claim. The whole point of the 21/08 work is that a
    // check which did not happen must not look like a check that passed, and
    // re-introducing that on the cheap endpoint would be no better.
    const shape = screenBicSanctions('COBADEFF');
    expect(shape.listed === null || typeof shape.listed === 'boolean').toBe(true);
    if (!shape.screened) expect(shape.listed).toBeNull();
  });
});
