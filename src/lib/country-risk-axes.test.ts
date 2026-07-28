import { describe, expect, it } from 'vitest';
import { buildComplianceResponse } from './compliance-response.js';
import { COUNTRY_RISK_AS_OF } from './countries.js';

/**
 * The two country signals may disagree. What they may NOT do is disagree
 * silently, with only one of them dated. See COUNTRY_RISK_AS_OF in countries.ts:
 * the audit recommended deriving one from the other and that was wrong, because
 * folding them would downgrade sanctioned countries.
 */
describe('the two country-risk axes are both dated and both scoped', () => {
  it('exposes a review date for the editorial axis, beside the FATF one', () => {
    const r = buildComplianceResponse('DE89370400440532013000');
    expect(r.meta.country_risk_as_of).toBe(COUNTRY_RISK_AS_OF);
    expect(r.meta.country_risk_as_of).toMatch(/^\d{4}-\d{2}$/);
    expect(r.meta.fatf_as_of).toBeTruthy();
  });

  it('says in the response that the two are different questions', () => {
    const r = buildComplianceResponse('DE89370400440532013000');
    expect(r.meta.country_risk_scope).toMatch(/not a restatement/i);
    expect(r.meta.country_risk_scope).toMatch(/can disagree/i);
  });

  it('still stacks rather than deduplicates: Russia stays critical', () => {
    // The regression the dated warning in countries.ts exists to prevent. If
    // country_risk were ever re-derived from the FATF table, RU would drop from
    // high to elevated and lose 10 points.
    const ru = buildComplianceResponse('RU8404452522540702810412345678901');
    expect(ru.risk_indicators?.country_risk).toBe('high');
    expect(ru.compliance.flags).toContain('high_risk_country');
    expect(ru.compliance.risk_level).toBe('critical');
  });

  it('a FATF-grey SEPA country keeps its own two answers, both visible', () => {
    // Bulgaria: grey_list on the FATF axis, standard on the editorial one. That
    // is the pair the audit called a contradiction. It is a considered
    // difference, and the response now carries both dates to prove it.
    const bg = buildComplianceResponse('BG80BNBG96611020345678');
    expect(bg.valid).toBe(true);
    expect(bg.compliance.sanctions.fatf_status).toBe('grey_list');
    expect(bg.risk_indicators?.country_risk).toBe('standard');
    expect(bg.compliance.flags).toContain('fatf_grey_list');
    expect(bg.meta.country_risk_as_of).toBeTruthy();
  });
});
