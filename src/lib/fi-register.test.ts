import { describe, it, expect } from 'vitest';
import { lookupFiInstitution, FI_REGISTER_AS_OF } from './fi-register.js';

/**
 * Finland allocates monetary institution codes at four different lengths, so
 * the only correct resolution is longest allocated prefix. A fixed 3-digit
 * slice would read Nordea's code '1' as '123' and answer not_in_register on
 * the country's largest bank, with authoritative: true. That is a false hard
 * denial telling a caller to stop a real payment, which is worse than the
 * bic: null ambiguity this whole field exists to remove.
 */
describe('lookupFiInstitution', () => {
  it('reads a one-character code, which is the case a 3-digit slice destroys', () => {
    // Nordea is '1 and 2'. The BBAN continues 23456..., so a slice would ask
    // about '123' and find nothing.
    const hit = lookupFiInstitution('12345600000785');
    expect(hit?.status).toBe('allocated');
    expect(hit?.code).toBe('1');
    expect(hit?.bic).toBe('NDEAFIHH');
  });

  it('reads the other one-character codes', () => {
    expect(lookupFiInstitution('50009420999999')?.code).toBe('5'); // OP Group
    expect(lookupFiInstitution('66010001000000')?.code).toBe('6'); // Bank of Åland
    expect(lookupFiInstitution('80001170000000')?.code).toBe('8'); // Danske
  });

  it('reads a two-character code, where the register says codes from 3 are two long', () => {
    expect(lookupFiInstitution('33010001000000')?.bic).toBe('ESSEFIHX'); // SEB
    expect(lookupFiInstitution('36001100000000')?.bic).toBe('SBANFIHH'); // S-Bank
  });

  it('reads a three-character code, listed singly or inside a range', () => {
    expect(lookupFiInstitution('40500110000000')?.bic).toBe('HELSFIHH'); // Aktia, listed
    expect(lookupFiInstitution('71300110000000')?.bic).toBe('CITIFIHX'); // Citibank, listed
    expect(lookupFiInstitution('47500110000000')?.bic).toBe('POPFFI22'); // inside 470-479
    expect(lookupFiInstitution('44100110000000')?.bic).toBe('ITELFIHH'); // inside 435-452
  });

  it('prefers the longer allocation when a shorter prefix would also match', () => {
    // '405' is Aktia. The single digit '4' is never a code: the register says
    // codes beginning with 4 are three characters long. Resolution must not
    // fall back to a shorter prefix that was never allocated.
    const hit = lookupFiInstitution('40500110000000');
    expect(hit?.code).toBe('405');
    expect(hit?.code).not.toBe('4');
  });

  it('denies a prefix that falls in no allocated range', () => {
    // 9xx is not allocated to anyone in the published list.
    expect(lookupFiInstitution('99901234567890')?.status).toBe('not_allocated');
    // 404 sits between 403 and 405, both allocated, but is itself outside
    // every published range.
    expect(lookupFiInstitution('40400110000000')?.status).toBe('not_allocated');
  });

  it('refuses to answer in the 72-78 band rather than deny it', () => {
    // The document defines 72-78 as four-character codes but lists no
    // institution holding one. Absence from a table that names holders is not
    // proof the band is unallocated, so this must not become a hard denial.
    expect(lookupFiInstitution('72000110000000')?.status).toBe('unknown');
  });

  it('refuses to guess on a BBAN that is not the expected shape', () => {
    expect(lookupFiInstitution('')).toBeNull();
    expect(lookupFiInstitution('12X4')).toBeNull();
  });

  it('carries the publication date of the transcribed list', () => {
    // Finland is a hand-transcribed table, not an automated reseed. The date
    // is the only way a reader knows how stale the answer may be.
    expect(FI_REGISTER_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
