import { describe, it, expect } from 'vitest';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { nextSteps } from './next-steps.js';

function check(iban: string) {
  const r = validateIBAN(iban);
  enrichResult(r);
  return r;
}

describe('Germany answers from the Bundesbank register', () => {
  it('confirms a real Bankleitzahl authoritatively', () => {
    const r = check('DE89370400440532013000'); // Commerzbank
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.authoritative).toBe(true);
    expect(r.bank_code_check!.register).toMatch(/Bundesbank/i);
  });

  it('now says a fabricated Bankleitzahl does not exist', () => {
    // The gap a pilot customer named. Until the register was ingested this answered
    // not_in_register with authoritative false, meaning "absent from our data",
    // which they could only treat as UNAVAILABLE. It is now a fact.
    const r = check('DE44999999990532013000');
    expect(r.valid).toBe(true);
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.authoritative).toBe(true);
  });

  it('answers the merged-bank case instead of hiding it', () => {
    // Pax-Bank, BLZ 10060198, carries a deletion mark and names 37060193 as its
    // successor. This is the edge case they put on their own list and the one I
    // had no verifiable example for. A retired code was really allocated, so
    // not_in_register would be a worse answer than verified: the truth is that
    // it exists and is being retired, and the successor is what they need.
    const r = check('DE91100601980532013000');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.authoritative).toBe(true);
    expect(r.bank_code_check!.retired).toBe(true);
    expect(r.bank_code_check!.superseded_by).toBe('37060193');
  });

  it('tells an agent to re-paper the beneficiary on a retired code', () => {
    const steps = nextSteps(check('DE91100601980532013000'));
    const hit = steps.find((s) => s.code === 'bank_code_retired');
    expect(hit).toBeDefined();
    expect(hit!.do).toMatch(/37060193/);
  });

  it('says nothing about retirement on a live code', () => {
    const r = check('DE89370400440532013000');
    expect(r.bank_code_check!.retired).toBeUndefined();
    expect(nextSteps(r).map((s) => s.code)).not.toContain('bank_code_retired');
  });

  it('stops resolving a bank code the register does not list', () => {
    // 10030200 is one of 52 German codes our composite map claimed and the
    // Bundesbank does not list. Serving a BIC for it was the same defect as the
    // four stale Swiss codes pruned in July, and the register is what settles it.
    const r = check('DE89100302000532013000');
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bic).toBeNull();
    expect(r.risk_indicators!.issuer_type).toBeNull();
  });

  it('leaves the rest of Europe exactly where it was', () => {
    // Promoting one country must not promote its neighbours: France is still a
    // composite map and an absence there still proves nothing.
    const fr = check('FR1499999000010123456789A42');
    expect(fr.bank_code_check!.authoritative).toBe(false);
    expect(fr.bank_code_check!.register).toMatch(/not a national/i);
  });
});
