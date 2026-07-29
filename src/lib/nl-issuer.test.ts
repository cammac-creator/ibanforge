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
 * The defect, stated as the customer met it: a fabricated Dutch IBAN carrying
 * SHEL came back verified with issuer.type 'bank', naming Shell Asset
 * Management. Every IBAN here was generated mod-97 and is asserted valid above.
 */
describe('a Dutch code that resolves is no longer assumed to be a bank', () => {
  it('stops typing a corporate treasury as a bank', () => {
    const r = check('NL09SHEL0123456789');
    expect(r.issuer?.iban_issuer).toBe('not_listed');
    // The same rule already applied one layer down: a type we cannot support is
    // null, not a default. Naming who holds the BIC stays, because that is a fact.
    expect(r.issuer?.type).toBeNull();
    expect(r.risk_indicators?.issuer_type).toBeNull();
    expect(r.bic?.bank_name).toMatch(/SHELL/i);
  });

  it('does the same for the other treasuries we were calling banks', () => {
    for (const iban of ['NL88PANA0123456789', 'NL17IMOP0123456789', 'NL53ETPW0123456789']) {
      const r = check(iban);
      expect(r.issuer?.iban_issuer, iban).toBe('not_listed');
      expect(r.issuer?.type, iban).toBeNull();
    }
  });

  it('tells an agent what to do about it instead of only flagging it', () => {
    const r = check('NL09SHEL0123456789');
    const step = r.next_steps?.find((s) => s.code === 'issuer_not_a_known_iban_issuer');
    expect(step).toBeDefined();
    expect(step!.because).toMatch(/iban_issuer/);
  });

  it('confirms a real Dutch bank instead of merely not denying it', () => {
    const r = check('NL69INGB0123456789'); // ING
    expect(r.issuer?.iban_issuer).toBe('confirmed');
    expect(r.issuer?.type).not.toBeNull();
    expect(r.next_steps?.map((s) => s.code)).not.toContain('issuer_not_a_known_iban_issuer');
  });

  it('leaves the bank-code verdict alone, because that is a different question', () => {
    // The code did resolve in our map. Saying otherwise would be a second wrong
    // claim, and authoritative is already false for the Netherlands.
    const r = check('NL09SHEL0123456789');
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });

  it('says nothing about issuers in countries that have no such list', () => {
    // Silence, not a guess. A German or French result must be unchanged.
    for (const iban of ['DE89370400440532013000', 'FR1499999000010123456789A42']) {
      const r = check(iban);
      expect(r.issuer?.iban_issuer, iban).toBeUndefined();
    }
  });
});

describe('the providers our map was missing now resolve', () => {
  it('resolves two real Dutch providers we were refusing', () => {
    // Measured 29/07/2026 on production: HLGT and PYNL are on the published
    // list and came back not_in_register with no BIC. We were turning away two
    // real banks.
    for (const [iban, code] of [
      ['NL94HLGT0123456789', 'HLGT'],
      ['NL79PYNL0123456789', 'PYNL'],
    ] as const) {
      const r = check(iban);
      expect(r.bic?.code, code).toBeTruthy();
      expect(r.issuer?.iban_issuer, code).toBe('confirmed');
    }
  });
});
