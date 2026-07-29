import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import { nationalRegisterAvailable } from './national-registers.js';

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

const noAT = !nationalRegisterAvailable('AT');
const noBE = !nationalRegisterAvailable('BE');

/**
 * Austria and Belgium end to end. Every IBAN below was generated mod-97 and is
 * asserted valid before anything is checked against it.
 */
describe('Austria answers from the OeNB register', () => {
  it.skipIf(noAT)('verifies a real Austrian bank', () => {
    const r = check('AT311200000012345678'); // UniCredit Bank Austria
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.register).toMatch(/Nationalbank/i);
  });

  it.skipIf(noAT)('verifies the code the register publishes unpadded', () => {
    // Published as '100', carried in the IBAN as '00100'. Without padding this
    // would deny the Austrian central bank.
    const r = check('AT170010000012345678');
    expect(r.bank_code_check?.status).toBe('verified');
  });

  it.skipIf(noAT)('denies a fabricated Austrian code, and says stop', () => {
    const r = check('AT479999900012345678');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });
});

describe('Belgium answers from the NBB Protocol register', () => {
  it.skipIf(noBE)('verifies a real Belgian bank', () => {
    const r = check('BE23001123456789'); // BNP Paribas Fortis
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
  });

  it.skipIf(noBE)('denies a slot the register marks free', () => {
    // 999 is published with 'VRIJ' in the BIC column: the register is stating
    // that nobody holds it. That has to read as a denial, not as a bank.
    const r = check('BE24999123456789');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bic).toBeNull();
  });

  it.skipIf(noBE)('never resolves a BIC for a code its own verdict denies', () => {
    // 23 of our 781 Belgian keys claimed a bank on a slot the register calls
    // vacant. Same defect as the 52 German and 21 Finnish ones.
    for (const iban of ['BE24999123456789', 'BE72500123456789']) {
      const r = check(iban);
      if (r.bank_code_check?.status === 'not_in_register') {
        expect(r.bic, `${iban} resolved a BIC despite not_in_register`).toBeNull();
      }
    }
  });
});

describe('the four registers keep their separate meanings', () => {
  it('does not claim authority for a country we hold no register for', () => {
    const r = check('FR1499999000010123456789A42');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });
});
