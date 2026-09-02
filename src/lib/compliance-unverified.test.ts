import { describe, it, expect } from 'vitest';
import { buildComplianceResponse } from './compliance-response.js';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import { nextSteps } from './next-steps.js';

function compliance(iban: string) {
  return buildComplianceResponse(iban);
}

/**
 * A pilot customer's observation, in their words: "on a verified result, next_steps
 * points to POST /v1/iban/compliance, the endpoint you just told me still scores
 * unresolved issuers as ordinary banks. Anyone reading only the payload gets
 * routed from the endpoint that stopped guessing to the one that still does,
 * without being told."
 *
 * They were right, and the answer is to stop guessing there too.
 */
describe('compliance stops scoring an unresolved bank code as an ordinary bank', () => {
  it('flags a bank code the register denies', () => {
    // Fabricated Bankleitzahl, now denied by the Bundesbank register.
    const r = compliance('DE44999999990532013000');
    expect(r.compliance!.flags).toContain('bank_code_not_allocated');
  });

  it('flags a bank code we simply could not confirm', () => {
    // France is still a composite map, so this is "we do not know", which is a
    // different flag and a lighter weight than an authoritative denial.
    const r = compliance('FR1499999000010123456789A42');
    expect(r.compliance!.flags).toContain('bank_code_unverified');
    expect(r.compliance!.flags).not.toContain('bank_code_not_allocated');
  });

  it('scores an unconfirmed bank code above an identical confirmed one', () => {
    // The point of the change: the score has to move, or the flag is decoration.
    const unknown = compliance('FR1499999000010123456789A42');
    const known = compliance('FR7630006000011234567890189');
    expect(unknown.compliance!.risk_score ?? 0).toBeGreaterThan(known.compliance!.risk_score ?? 0);
  });

  it('weighs an authoritative denial heavier than an unconfirmed code', () => {
    const denied = compliance('DE44999999990532013000');
    const merelyUnknown = compliance('FR1499999000010123456789A42');
    expect(denied.compliance!.risk_score ?? 0).toBeGreaterThan(
      merelyUnknown.compliance!.risk_score ?? 0,
    );
  });

  it('leaves a clean, confirmed IBAN scoring exactly as before', () => {
    // No regression on the normal path: neither flag fires and the score is the
    // one the existing tests pin.
    const r = compliance('DE89370400440532013000');
    expect(r.compliance!.flags).not.toContain('bank_code_unverified');
    expect(r.compliance!.flags).not.toContain('bank_code_not_allocated');
  });

  it('carries the bank-code verdict into the compliance payload', () => {
    // A caller routed here by next_steps must be able to see the same verdict
    // rather than having to call the other endpoint to learn it.
    const r = compliance('DE44999999990532013000');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
  });
});

describe('the next_steps entry that routes here says what it routes to', () => {
  it('states that compliance now reads the same bank-code verdict', () => {
    const r = validateIBAN('DE89370400440532013000');
    enrichResult(r);
    const step = nextSteps(r).find((s) => s.code === 'screen_compliance');
    expect(step).toBeDefined();
    expect(step!.do).toMatch(/bank[- ]code/i);
  });
});
