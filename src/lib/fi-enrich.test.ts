import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

/**
 * Finland end to end. Every IBAN here was generated mod-97 and asserted valid
 * above, because a fabricated example that fails the checksum invalidates
 * whatever it was meant to demonstrate.
 */
describe('Finnish bank codes answer from the Finance Finland list', () => {
  it('verifies Nordea, whose code is one character', () => {
    const r = check('FI2112345600000785');
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    // The value is the institution code, not the positional 3-digit slice.
    expect(r.bank_code_check?.value).toBe('1');
  });

  it('states the value it checked when that differs from the BBAN slice', () => {
    // bban.bank_code stays '123': it is the positional slice and other callers
    // read it. bank_code_check.value is the code actually looked up. Two
    // granularities in one response have to be told apart, or a reader
    // comparing them finds a contradiction we did not explain.
    const r = check('FI2112345600000785');
    expect(r.bban?.bank_code).toBe('123');
    expect(r.bank_code_check?.value).toBe('1');
    expect(r.bank_code_check?.register).toMatch(/banking group/i);
  });

  it('denies a prefix held by nobody, which is the point of holding a register', () => {
    const r = check('FI1499901234567890');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
  });

  it('tells an agent to stop on an unallocated Finnish code', () => {
    const r = check('FI1499901234567890');
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });

  it('does not deny the 72-78 band the source leaves unpopulated', () => {
    // Answering not_in_register here would assert more than the document says.
    const r = check('FI2972000110000000');
    expect(r.bank_code_check?.status).toBe('unavailable');
    expect(r.next_steps?.map((s) => s.code)).not.toContain('bank_code_not_allocated');
  });

  it('verifies each remaining code length', () => {
    for (const [iban, expected] of [
      ['FI2750009420999999', '5'], // OP Group, one character
      ['FI6133010001000000', '33'], // SEB, two characters
      ['FI6840500110000000', '405'], // Aktia, three characters
      ['FI2747500110000000', '475'], // POP, inside range 470-479
    ] as const) {
      const r = check(iban);
      expect(r.bank_code_check?.status, iban).toBe('verified');
      expect(r.bank_code_check?.value, iban).toBe(expected);
    }
  });

  it('never resolves a BIC for a code its own verdict calls unallocated', () => {
    // The German pruning found 52 of these. The same inconsistency in Finland
    // would let one response contradict itself.
    //
    // 310 and 380 are the real cases: the curated map claims Handelsbanken and
    // Swedbank, both of which left Finnish retail, and the published list
    // allocates neither '31' nor '38' to anyone. Before pruning, these returned
    // not_in_register with authoritative: true AND a resolved BIC.
    for (const iban of [
      'FI1499901234567890',
      'FI0940400110000000',
      'FI8931000110000000',
      'FI4838000110000000',
    ]) {
      const r = check(iban);
      if (r.bank_code_check?.status === 'not_in_register') {
        expect(r.bic, `${iban} resolved a BIC despite not_in_register`).toBeNull();
      }
    }
  });
});
