import { describe, expect, it } from 'vitest';
import { validateIBAN } from './iban.js';
import { TEXTBOOK_IBANS, isTextbookIban } from './textbook-ibans.js';

describe('textbook IBANs', () => {
  it('every listed IBAN passes the checksum, so a typo cannot hide in the list', () => {
    const failing = [...TEXTBOOK_IBANS].filter((iban) => !validateIBAN(iban).valid);
    expect(failing).toEqual([]);
  });

  it('is keyed on the normalised form', () => {
    expect(isTextbookIban('CH93 0076 2011 6238 5295 7')).toBe(true);
    expect(isTextbookIban('ch9300762011623852957')).toBe(true);
    expect(isTextbookIban('LT12 1000 0111 0100 1000')).toBe(true);
  });

  it('does not match a real-looking IBAN, nor an empty one', () => {
    expect(isTextbookIban('CH5800791123000889012')).toBe(false);
    expect(isTextbookIban('')).toBe(false);
    expect(isTextbookIban(null)).toBe(false);
  });
});
