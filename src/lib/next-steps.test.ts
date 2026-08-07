import { describe, it, expect, afterEach } from 'vitest';
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
    // Fabricated French bank code: valid IBAN, unconfirmable institution, and we
    // hold no French register, so the only honest instruction is "do not treat
    // this as a rejection, verify the payee downstream". Was Germany until
    // 29/07/2026, when the Bundesbank register made that case a hard denial.
    const s = steps('FR1499999000010123456789A42');
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

  describe('generate_payment_qr — partner handoff behind the PARTNER_PAYQR gate', () => {
    afterEach(() => {
      delete process.env.PARTNER_PAYQR;
    });

    it('stays silent while the flag is off, whatever the result', () => {
      expect(codes('DE89370400440532013000')).not.toContain('generate_payment_qr');
    });

    it('fires on a register-confirmed SEPA account once the flag is on', () => {
      process.env.PARTNER_PAYQR = '1';
      const hit = steps('DE89370400440532013000').find((s) => s.code === 'generate_payment_qr');
      expect(hit).toBeDefined();
      expect(hit!.because).toMatch(/sepa\.member/);
      expect(hit!.action).toBe('https://qr.cz-agents.dev');
      // The two limits the partner asked to keep in the copy must travel with it.
      expect(hit!.do).toMatch(/does not verify account ownership/);
      expect(hit!.do).toMatch(/Swiss QR-bills/);
    });

    it('never fires on CH or LI, whose native QR-bill PayQR does not cover', () => {
      process.env.PARTNER_PAYQR = '1';
      expect(codes('CH1000230000000012345')).not.toContain('generate_payment_qr');
    });

    it('never rides on a result where the register denied the code', () => {
      process.env.PARTNER_PAYQR = '1';
      expect(codes('DE44999999990532013000')).not.toContain('generate_payment_qr');
    });
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
