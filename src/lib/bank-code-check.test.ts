import { describe, it, expect } from 'vitest';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

/**
 * The three states `bic: null` used to collapse.
 *
 * A customer running a payee pre-flight cannot act on `bic: null`, because it
 * means any of: the bank code does not identify an institution, the institution
 * exists but is absent from our reference data, or we hold no reference data for
 * that country at all. The first is a reason to stop; the other two are a reason
 * to carry on and let the downstream name check decide.
 *
 * Every IBAN below has a valid mod-97 checksum; the bank codes are the variable.
 */
function check(iban: string) {
  const r = validateIBAN(iban);
  enrichResult(r);
  return r;
}

describe('bank_code_check', () => {
  it('reports verified, and says the answer came from an exact register key', () => {
    // Commerzbank, the canonical German example IBAN.
    const r = check('DE89370400440532013000');
    expect(r.bank_code_check).toBeDefined();
    expect(r.bank_code_check!.value).toBe('37040044');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.match).toBe('register');
    expect(r.bic?.code).toBe('COBADEFF');
  });

  it('separates "absent from our reference data" from "we have no data here"', () => {
    // Fabricated French bank code: valid checksum, no such code in our map.
    const r = check('FR1499999000010123456789A42');
    expect(r.valid).toBe(true); // still ISO 13616 conformant, a separate question
    expect(r.bic).toBeNull();
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.match).toBeNull();
  });

  it('now answers Germany from the register, not from the map', () => {
    // The same fabricated Bankleitzahl this test file used to prove the LIMIT
    // now proves the capability. Kept here so the change of meaning is visible
    // in the file that documented the old one. See de-blz.test.ts.
    const r = check('DE44999999990532013000');
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.authoritative).toBe(true);
    expect(r.bank_code_check!.register).toMatch(/Bundesbank/i);
  });

  it('does not claim a French miss proves the bank code does not exist', () => {
    // The invariant, moved off Germany when Germany gained a register on
    // 29/07/2026. France is still a composite map, so `not_in_register` there
    // must not be read as non-existence. The test has to live on a country that
    // is still composite or it stops testing anything.
    const r = check('FR1499999000010123456789A42');
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.authoritative).toBe(false);
  });

  it('does claim it for Switzerland, where the register is the national one', () => {
    const real = check('CH5604835012345678009');
    expect(real.bank_code_check!.authoritative).toBe(true);
    expect(real.bank_code_check!.register).toMatch(/BankMaster/i);
    expect(real.bank_code_check!.status).toBe('verified');

    // 99999 is not an allocated IID in the SIX BankMaster.
    const fake = check('CH8499999012345678901');
    expect(fake.bank_code_check!.authoritative).toBe(true);
    expect(fake.bank_code_check!.status).toBe('not_in_register');
  });

  it('confirms a Swiss institution even when no BIC is on file for it', () => {
    // Existence and BIC availability are different questions; the register
    // answers the first one on its own.
    const r = check('CH5604835012345678009');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.match).toBe('register');
  });

  it('flags an answer that came from the prefix heuristic rather than the register', () => {
    // NL bank codes are alphabetic, so `bic8 LIKE 'XXXX%'` can fire. This one is
    // absent from the curated map and resolves only through that fallback.
    const r = check('NL53ETPW0123456789');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.match).toBe('prefix');
    expect(r.bank_code_check!.candidates).toBeGreaterThanOrEqual(1);
  });

  it('never reports a prefix match where a prefix match is arithmetically impossible', () => {
    // A BIC8 opens on four letters. A numeric bank code can never be its prefix,
    // so every German, French or Swiss hit is an exact register key by
    // construction — 59 of the 89 IBAN countries.
    for (const iban of ['DE89370400440532013000', 'CH5604835012345678009']) {
      expect(check(iban).bank_code_check!.match).not.toBe('prefix');
    }
  });

  it('never names a national register on a non-authoritative answer', () => {
    // The field used to list the contributing sources, Bundesbank among them.
    // A customer asking whether German bank codes are checked against the
    // Bundesbank register would read that as yes, while authoritative:false on
    // the same object says no. Two fields contradicting each other on the exact
    // point at issue is worse than saying less.
    const r = check('FR7630006000011234567890189');
    expect(r.bank_code_check!.authoritative).toBe(false);
    expect(r.bank_code_check!.register).not.toMatch(/bundesbank|nbp|six|eba/i);
    expect(r.bank_code_check!.register).toMatch(/not a national/i);
  });

  it('carries the date of the reference data it checked against', () => {
    const r = check('DE89370400440532013000');
    expect(r.bank_code_check!.as_of).toMatch(/^\d{4}-\d{2}/);
  });

  it('says nothing at all about an IBAN that failed validation', () => {
    const r = check('DE00370400440532013000');
    expect(r.valid).toBe(false);
    expect(r.bank_code_check).toBeUndefined();
  });
});

describe('issuer classification says whether it identified or assumed', () => {
  it('marks a curated identification as such', () => {
    // N26, Bankleitzahl 10011001.
    const r = check('DE43100110010532013000');
    expect(r.issuer!.type).toBe('digital_bank');
    expect(r.issuer!.classification).toBe('curated');
  });

  it('marks the bank fallback as a default rather than a determination', () => {
    // Commerzbank resolves a BIC, but the classifier holds no entry for it, so
    // 'bank' is what we assume, not what we established. Measured 29/07/2026:
    // 47,356 of 48,386 distinct BIC8 (97.9%) land here. A customer sizing how
    // much of their virtual-IBAN traffic we would flag needs to see that line.
    const r = check('DE89370400440532013000');
    expect(r.issuer!.type).toBe('bank');
    expect(r.issuer!.classification).toBe('default');
  });
});

describe('risk_indicators stop asserting facts about an institution that did not resolve', () => {
  it('leaves issuer_type null rather than defaulting to bank', () => {
    const r = check('DE44999999990532013000');
    expect(r.issuer).toBeUndefined();
    expect(r.risk_indicators!.issuer_type).toBeNull();
  });

  it('still types the issuer when the institution did resolve', () => {
    const r = check('DE89370400440532013000');
    expect(r.risk_indicators!.issuer_type).toBe('bank');
  });

  it('declares that sepa_reachable is a country-level fact, not an account-level one', () => {
    // Germany is SEPA-reachable whether or not this particular bank code exists.
    // The value was never wrong; the field name invited an account-level reading.
    const r = check('DE44999999990532013000');
    expect(r.risk_indicators!.sepa_reachable).toBe(true);
    expect(r.risk_indicators!.sepa_reachable_scope).toBe('country');
  });
});

describe('bank_code_check.institution — what the register publishes, no more', () => {
  it('serves the full Swiss seat address, street and house number joined', () => {
    // SIX splits street and number; the served shape is one line, like GLEIF.
    const r = check('CH5604835012345678009');
    const inst = r.bank_code_check?.institution;
    expect(inst?.name).toBeTruthy();
    expect(inst?.street).toMatch(/\d/); // street WITH its house number
    expect(inst?.post_code).toBeTruthy();
    expect(inst?.town).toBeTruthy();
    expect(inst?.country).toBe('CH');
  });

  it('serves Germany as postal code and town only — the register has no street', () => {
    const r = check('DE89370400440532013000');
    const inst = r.bank_code_check?.institution;
    expect(inst?.name).toBeTruthy();
    expect(inst?.street).toBeNull();
    expect(inst?.post_code).toMatch(/^\d{5}$/);
    expect(inst?.town).toBeTruthy();
  });

  it('stays absent on a composite-map hit — no register was consulted', () => {
    const r = check('GB29NWBK60161331926819');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bank_code_check?.institution).toBeUndefined();
  });

  it('stays absent for Finland — codes belong to banking groups, not seats', () => {
    const r = check('FI1499901234567890');
    expect(r.bank_code_check?.institution).toBeUndefined();
  });

  it('stays absent when the register denies the code — no subject, no claim', () => {
    const r = check('DE44999999990532013000');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.institution).toBeUndefined();
  });
});
