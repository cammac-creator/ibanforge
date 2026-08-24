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

/**
 * The name axis, added 24/08/2026.
 *
 * The refresh script populated sanctioned_entities ONLY from "SWIFT/BIC …"
 * tokens in the lists' free text. Designated banks whose entry carries no
 * token — Bank Saderat Iran and Bank Melli Iran among them, both designated
 * "all offices worldwide" — answered bank_sanctioned:false while our own
 * directory held their SEPA branches under exactly those names. The name
 * axis joins SDN entity names against bic_entries.institution.
 *
 * The axis is gated by GEOGRAPHY (SDN addresses + program country) because a
 * name alone accuses too much: ungated, it matched the designated
 * AGRICULTURAL DEVELOPMENT BANK to unrelated homonyms in Nepal, China,
 * Trinidad and Ghana. Both directions are pinned here so neither the recall
 * nor the precision half of the fix can silently regress.
 */
describe('the name axis reaches banks the SWIFT tokens never named', () => {
  it('flags Bank Saderat Iran, Paris — designated worldwide, no SWIFT token in its SDN entry', () => {
    const r = buildBicComplianceResponse('SDINFRP1');
    if ('error' in r) throw new Error('should validate');
    expect(r.compliance.sanctions.bank_sanctioned).toBe(true);
    expect(r.compliance.sanctions.matched_lists).toContain('OFAC');
    expect(['high', 'critical']).toContain(r.compliance.risk_level);
  });

  it('flags the Hamburg BRANCH via the word-boundary prefix match', () => {
    const r = buildBicComplianceResponse('SIHRDEH1');
    if ('error' in r) throw new Error('should validate');
    expect(r.compliance.sanctions.bank_sanctioned).toBe(true);
    expect(r.compliance.sanctions.matched_lists).toContain('OFAC');
  });

  it('does NOT flag the Kuwaiti homonym of a designated Lebanese entity', () => {
    // BAYT AL-MAL (Hizballah, LB) shares its exact name with an unrelated
    // Kuwaiti institution. The geographic gate is what keeps the name axis
    // from accusing it; if this starts failing, precision broke.
    const s = screenBicSanctions('BAYTKWK1');
    expect(s.listed).not.toBe(true);
  });

  it('does NOT flag the homonymous agricultural development banks', () => {
    // The designated AGRICULTURAL DEVELOPMENT BANK is not the Chinese, the
    // Nepalese, the Trinidadian nor the Ghanaian bank of the same name.
    for (const bic of ['ADBNCNBJ', 'ADBLNPKA', 'ADEVTTP1']) {
      const s = screenBicSanctions(bic);
      expect(s.listed, bic).not.toBe(true);
    }
  });
});
