import { describe, it, expect } from 'vitest';
import { lookupNlPsp, nlPspAsOf, nlPspCount } from './nl-psp.js';

/**
 * The Dutch provider list answers one question and refuses the other.
 *
 * A Dutch IBAN's four-letter code is an identifier handed to a provider
 * BECAUSE it issues IBANs. Holding a Dutch BIC is a different fact: corporate
 * treasuries hold one for their own SWIFT traffic and issue nothing. Our map
 * could not tell the two apart, because all 815 of its Dutch keys are simply
 * the first four letters of their own BIC, which makes the confirmation
 * circular.
 */
describe('lookupNlPsp', () => {
  it('confirms an identifier that really issues Dutch IBANs', () => {
    expect(lookupNlPsp('INGB')?.bic).toBe('INGBNL2A');
    expect(lookupNlPsp('ABNA')?.name).toMatch(/ABN AMRO/i);
  });

  it('is case-insensitive, since a caller may send either', () => {
    expect(lookupNlPsp('ingb')?.bic).toBe('INGBNL2A');
  });

  it('does not confirm a corporate treasury that merely holds a Dutch BIC', () => {
    // Every one of these resolves to a real BIC in our directory and is
    // therefore served today as a bank. None of them issues an IBAN.
    for (const code of ['SHEL', 'PANA', 'IMOP', 'ETPW']) {
      expect(lookupNlPsp(code), code).toBeNull();
    }
  });

  it('refuses anything that is not a four-letter identifier', () => {
    expect(lookupNlPsp('')).toBeNull();
    expect(lookupNlPsp('ING')).toBeNull();
    expect(lookupNlPsp('1NGB')).toBeNull();
  });

  it('carries the publication date, because the list is not exhaustive', () => {
    // A caller weighing a "not listed" answer needs to know how old the list is.
    expect(nlPspAsOf()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nlPspCount()).toBeGreaterThan(70);
  });
});
