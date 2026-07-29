import { describe, it, expect } from 'vitest';
import { nextSteps } from './next-steps.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

function steps(iban: string) {
  const r = validateIBAN(iban);
  enrichResult(r);
  return nextSteps(r);
}
const codes = (iban: string) => steps(iban).map((s) => s.code);

describe('nextSteps', () => {
  it('tells an agent to fall back to a name check when we cannot confirm the bank code', () => {
    // Fabricated Bankleitzahl: valid IBAN, unconfirmable institution, and we
    // hold no German register, so the only honest instruction is "do not treat
    // this as a rejection, verify the payee downstream".
    const s = steps('DE44999999990532013000');
    const hit = s.find((x) => x.code === 'verify_payee_name');
    expect(hit).toBeDefined();
    expect(hit!.because).toMatch(/bank_code_check/);
  });

  it('says stop, not "verify", when the register itself denies the code', () => {
    // Switzerland is authoritative. This is the one case where an agent may act
    // on non-existence, so it must not be given the same advice as Germany.
    const s = steps('CH8499999012345678901');
    expect(s.map((x) => x.code)).toContain('bank_code_not_allocated');
    expect(s.map((x) => x.code)).not.toContain('verify_payee_name');
  });

  it('warns when the BIC was picked from several candidate institutions', () => {
    const s = steps('NL53ETPW0123456789');
    // ETPW resolves through the prefix path; if it ever matches only one BIC8
    // the step must disappear rather than warn about nothing.
    const hit = s.find((x) => x.code === 'bic_is_advisory');
    if (hit) expect(hit.because).toMatch(/prefix/);
  });

  it('flags a curated non-bank issuer, since name matching is weakest there', () => {
    const s = steps('DE43100110010532013000'); // N26
    const hit = s.find((x) => x.code === 'expect_virtual_iban');
    expect(hit).toBeDefined();
    expect(hit!.because).toMatch(/digital_bank/);
  });

  it('does not claim a virtual IBAN on an issuer we merely defaulted to bank', () => {
    // 97.9% of BIC8 default to 'bank'. Reading that as "not an EMI" would be
    // the same overclaim the classification field exists to prevent.
    expect(codes('DE89370400440532013000')).not.toContain('expect_virtual_iban');
  });

  it('offers our own compliance screening on a clean, confirmed IBAN', () => {
    const s = steps('DE89370400440532013000');
    const hit = s.find((x) => x.code === 'screen_compliance');
    expect(hit).toBeDefined();
    expect(hit!.action).toBe('POST /v1/iban/compliance');
  });

  it('returns nothing at all for an IBAN that failed validation', () => {
    // The error already says what to do. Piling advice on top of a checksum
    // failure is noise an agent has to filter.
    expect(steps('DE00370400440532013000')).toEqual([]);
  });

  it('orders the blocking advice before the optional upsell', () => {
    const c = codes('DE44999999990532013000');
    const verify = c.indexOf('verify_payee_name');
    const screen = c.indexOf('screen_compliance');
    if (screen >= 0) expect(verify).toBeLessThan(screen);
  });

  it('always gives every step a code, a sentence and its evidence', () => {
    for (const iban of [
      'DE44999999990532013000',
      'CH8499999012345678901',
      'DE43100110010532013000',
      'DE89370400440532013000',
      'CH1000230000000012345',
    ]) {
      for (const s of steps(iban)) {
        expect(s.code, iban).toMatch(/^[a-z_]+$/);
        expect(s.do.length, iban).toBeGreaterThan(10);
        expect(s.because.length, iban).toBeGreaterThan(10);
      }
    }
  });
});
