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
    // Commerzbank, the canonical German example IBAN. The BIC is the register's
    // exact 11-character form, not the composite BIC8.
    const r = check('DE89370400440532013000');
    expect(r.bank_code_check).toBeDefined();
    expect(r.bank_code_check!.value).toBe('37040044');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bank_code_check!.match).toBe('register');
    expect(r.bic?.code).toBe('COBADEFFXXX');
  });

  it('serves the register BIC of the account-holding bank, not the BIC8 of the shared Landesbank', () => {
    // The failure a German integrator measured before dropping the API: for
    // Sparkassen, the first eight characters of the BIC belong to the shared
    // clearing Landesbank. BLZ 55350010 is a Sparkasse whose register BIC is
    // MALADE51WOR; MALADE51 alone names a different institution entirely.
    const r = check('DE95553500100000005017');
    expect(r.bank_code_check!.status).toBe('verified');
    expect(r.bic?.code).toBe('MALADE51WOR');
    expect(r.bic?.bank_name).toBe('Rheinhessen Sparkasse');
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

/**
 * The second question, which `status` alone cannot answer.
 *
 * A payout engine reading this response has to separate "this bank code does not
 * exist" from "we could not answer just now" — the first stops a payment, the
 * second must not. `status` + `authoritative` let that be RECONSTRUCTED; `reason`
 * makes it one token to branch on, and one that never has to be parsed out of
 * `register`, a prose string that gains sources every month.
 */
describe('bank_code_check.reason — why an answer is not verified', () => {
  it('says not_allocated only where a register actually denies the code', () => {
    const r = check('DE44999999990532013000');
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.authoritative).toBe(true);
    expect(r.bank_code_check!.reason).toBe('not_allocated');
  });

  it('says absent_from_reference_data where we consulted only our own map', () => {
    const r = check('FR1499999000010123456789A42');
    expect(r.bank_code_check!.status).toBe('not_in_register');
    expect(r.bank_code_check!.authoritative).toBe(false);
    expect(r.bank_code_check!.reason).toBe('absent_from_reference_data');
  });

  it('says register_names_no_holder where the register is silent rather than negative', () => {
    // The Finnish 72-78 band: the document defines the code length and lists no
    // holder. Silence is not a denial, and the reason has to say which it is.
    const r = check('FI2972000110000000');
    expect(r.bank_code_check!.status).toBe('unavailable');
    expect(r.bank_code_check!.reason).toBe('register_names_no_holder');
  });

  it('explains nothing on a verified answer, because there is nothing to explain', () => {
    for (const iban of ['DE89370400440532013000', 'CH5604835012345678009', 'NL53ETPW0123456789']) {
      const c = check(iban).bank_code_check!;
      expect(c.status).toBe('verified');
      expect(c.reason).toBeUndefined();
    }
  });

  it('never lets an unavailable answer carry the one reason that licenses a stop', () => {
    // The contract in one line: `not_allocated` is the only value a caller may
    // act on as non-existence, and `unavailable` means we did not decide. The
    // two must never meet on the same object.
    for (const iban of [
      'FI2972000110000000',
      'FR1499999000010123456789A42',
      'DE44999999990532013000',
      'CH8499999012345678901',
    ]) {
      const c = check(iban).bank_code_check!;
      if (c.status === 'unavailable') expect(c.reason).not.toBe('not_allocated');
      if (c.reason === 'not_allocated') expect(c.authoritative).toBe(true);
      if (c.status !== 'verified') expect(c.reason).toBeDefined();
    }
  });
});

/**
 * "Is your derived BIC authoritative enough to store and settle against, or
 * advisory only?"
 *
 * The question a regulated pilot customer put in writing, and the answer had to
 * move from the documentation into the payload: a caveat on a docs page is a
 * caveat the first integration to read the JSON never sees.
 */
describe('bic.basis — where the pairing came from, and what it licenses', () => {
  it('calls the German pairing what it is: the register publishing a BIC per bank code', () => {
    const r = check('DE89370400440532013000');
    expect(r.bic!.basis).toBe('national_register');
    expect(r.bic!.authoritative).toBe(true);
  });

  it('does not promote our own curated pairing to a register one', () => {
    const r = check('FR7630006000011234567890189');
    expect(r.bic!.basis).toBe('curated_map');
    expect(r.bic!.authoritative).toBe(false);
  });

  it('marks the prefix fallback as the weakest basis of the three', () => {
    const r = check('NL53ETPW0123456789');
    expect(r.bic!.basis).toBe('directory_prefix');
    expect(r.bic!.authoritative).toBe(false);
  });

  it('keeps the two authoritative flags apart, because they answer different questions', () => {
    // Switzerland is where they visibly differ, and where collapsing them would
    // mislead: SIX confirms the IID is allocated, so bank_code_check is
    // authoritative — while the BIC beside it still comes from our curated map
    // and must not be settled against on the strength of that verdict.
    const r = check('CH5604835012345678009');
    expect(r.bank_code_check!.authoritative).toBe(true);
    expect(r.bic!.basis).toBe('curated_map');
    expect(r.bic!.authoritative).toBe(false);
  });

  it('derives the flag from the basis rather than carrying two independent claims', () => {
    for (const iban of [
      'DE89370400440532013000',
      'FR7630006000011234567890189',
      'NL53ETPW0123456789',
      'CH5604835012345678009',
    ]) {
      const bic = check(iban).bic!;
      expect(bic.authoritative).toBe(bic.basis === 'national_register');
    }
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

/**
 * Latvia and Gibraltar: crediting the authority that published the rule.
 *
 * Both national authorities publish that IBAN positions 5-8 ARE the first four
 * characters of the institution's BIC — Latvijas Banka for the Latvian IBAN,
 * the Gibraltar Financial Services Commission in Guidance Note 07. Both codes
 * already resolved before that rule was named; what these tests pin is that the
 * answer stops crediting our own assembly for a pairing a central bank
 * published, and that it does not thereby become authoritative.
 */
describe('structural bank-code rules (LV, GI)', () => {
  /** Fixture accounts, checksum-correct and owned by nobody. */
  function iban(cc: string, bban: string): string {
    const rearranged = (bban + cc + '00')
      .split('')
      .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
      .join('');
    let rem = 0;
    for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
    return cc + String(98 - rem).padStart(2, '0') + bban;
  }

  it('credits Latvijas Banka for a Latvian code that is a BIC prefix', () => {
    const r = check(iban('LV', 'HABA0551017882234'));
    expect(r.bank_code_check?.register).toMatch(/Latvijas Banka/);
    expect(r.bank_code_check?.register).toMatch(/structural rule published by/);
  });

  it('credits the GFSC for a Gibraltar code that is a BIC prefix', () => {
    const r = check(iban('GI', 'RBOS000000001234567'));
    expect(r.bank_code_check?.register).toMatch(/Gibraltar Financial Services Commission/);
  });

  it('does not become authoritative on the strength of a published rule', () => {
    // The rule says how to READ the IBAN. It does not say the BIC it points at
    // was allocated, and it does not make our directory exhaustive — so it
    // cannot license a `not_in_register` verdict off a coverage gap.
    for (const b of [iban('LV', 'HABA0551017882234'), iban('GI', 'RBOS000000001234567')]) {
      expect(check(b).bank_code_check?.authoritative).toBe(false);
    }
  });

  it('says how many institutions the rule alone leaves standing', () => {
    // GI 'RBOS' matches two BIC8. A caller told "this is the bank" deserves to
    // know the published rule did not single it out on its own.
    const r = check(iban('GI', 'RBOS000000001234567'));
    expect(r.bank_code_check?.candidates).toBeGreaterThan(1);
  });

  it('falls back to the composite map when the rule does not explain the pairing', () => {
    // The SWIFT IBAN Registry's Latvian example uses the literal 'BANK', which
    // no institution holds. Nothing resolves, so there is no pairing for the
    // rule to have produced and no authority to credit for one.
    const r = check('LV80BANK0000435195001');
    expect(r.bank_code_check?.register).not.toMatch(/Latvijas Banka/);
  });
});
