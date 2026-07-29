import { describe, it, expect } from 'vitest';
import { lookupNationalCode, nationalRegisterAvailable, normaliseCode } from './national-registers.js';

/**
 * Austria and Belgium share one table because they are structurally the same
 * register: an authority allocates a fixed-width numeric code to an institution
 * and publishes the whole allocation. Neither carries the retirement/successor
 * pair the Bundesbank does, so neither needs de-blz's extra columns.
 */
describe('normaliseCode', () => {
  it('pads an Austrian code to the width the IBAN carries', () => {
    // The OeNB file writes the central bank as '100'; an Austrian IBAN carries
    // '00100'. Comparing them unpadded would call a real bank unallocated.
    expect(normaliseCode('AT', '100')).toBe('00100');
    expect(normaliseCode('AT', '00100')).toBe('00100');
    expect(normaliseCode('AT', '12000')).toBe('12000');
  });

  it('pads a Belgian code to three', () => {
    expect(normaliseCode('BE', '1')).toBe('001');
    expect(normaliseCode('BE', '001')).toBe('001');
  });

  it('refuses anything that is not the digits of a bank code', () => {
    expect(normaliseCode('AT', '')).toBeNull();
    expect(normaliseCode('AT', '123456')).toBeNull();
    expect(normaliseCode('BE', '12X')).toBeNull();
  });
});

describe('lookupNationalCode', () => {
  const skipIf = (cc: string) => !nationalRegisterAvailable(cc);

  it.skipIf(skipIf('AT'))('resolves an Austrian institution', () => {
    const hit = lookupNationalCode('AT', '12000');
    expect(hit?.bic).toBe('BKAUATWW');
    expect(hit?.name).toMatch(/Bank Austria/i);
  });

  it.skipIf(skipIf('AT'))('resolves the code the register writes unpadded', () => {
    // Published as '100', carried in an IBAN as '00100'.
    expect(lookupNationalCode('AT', '00100')?.bic).toBe('NABAATWW');
  });

  it.skipIf(skipIf('AT'))('denies an Austrian code the register does not carry', () => {
    expect(lookupNationalCode('AT', '99999')).toBeNull();
  });

  it.skipIf(skipIf('BE'))('resolves a Belgian institution', () => {
    expect(lookupNationalCode('BE', '001')?.bic).toBe('GEBABEBB');
    expect(lookupNationalCode('BE', '734')?.bic).toBe('KREDBEBB');
  });

  it.skipIf(skipIf('BE'))('denies a Belgian slot the register marks free', () => {
    // The NBB publishes all 1000 slots and writes 'VRIJ' in the BIC column for
    // the 210 it has not allocated. Storing those would turn an explicit
    // "nobody holds this" into a resolved bank, which is the exact opposite of
    // what the register says.
    expect(lookupNationalCode('BE', '999')).toBeNull();
  });

  it('answers nothing for a country it does not hold', () => {
    expect(lookupNationalCode('FR', '30001')).toBeNull();
    expect(nationalRegisterAvailable('FR')).toBe(false);
  });
});
