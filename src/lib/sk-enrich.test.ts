import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import {
  nationalRegisterAvailable,
  nationalRegisterCredit,
  nationalRegisterEdition,
} from './national-registers.js';

/**
 * Slovakia end to end, against the prevodník the Národná banka Slovenska
 * publishes.
 *
 * Every IBAN below was generated mod-97 and is asserted valid before anything
 * is checked against it. A Slovak BBAN is `4!n6!n10!n`: four digits of bank
 * code in IBAN positions 5-8, then a six-digit account prefix and a ten-digit
 * account number.
 */
function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

const noSK = !nationalRegisterAvailable('SK');

describe('Slovakia answers from the NBS prevodník', () => {
  it.skipIf(noSK)('verifies a real Slovak bank and names the register', () => {
    const r = check('SK9811000000000000000001'); // 1100, Tatra banka
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.register).toMatch(/Národná banka Slovenska/);
  });

  it.skipIf(noSK)('verifies the code the register publishes without its leading zero', () => {
    // The CSV writes Slovakia's largest bank as '200' while the IBAN carries
    // '0200' — and the register's own PDF writes '0200' too. Comparing the two
    // unpadded would deny the country's largest bank.
    const r = check('SK9402000000000000000001');
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.institution?.name).toBe('Všeobecná úverová banka, a.s.');
  });

  it.skipIf(noSK)('denies a fabricated Slovak code, and says stop', () => {
    const r = check('SK4499990000000000000001');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });

  it.skipIf(noSK)('denies the code the SWIFT registry uses as its Slovak example', () => {
    // SK3112000000198742637541 is the example IBAN in the ISO 13616 registry,
    // and bank code 1200 is not in the prevodník at all. With an authoritative
    // register that has to read as `not_allocated` — exactly as the Austrian
    // example AT611904300234573201 does. This is the finding, not a bug: see
    // the 06/08/2026 post on example IBANs and unallocated bank codes.
    const r = check('SK3112000000198742637541');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bic).toBeNull();
  });

  it.skipIf(noSK)('denies a bank the register no longer lists', () => {
    // 5200 was OTP Banka Slovensko. Our curated map still claimed it; the
    // prevodník does not carry it, so the map key is pruned at load time and
    // the answer follows the register.
    const r = check('SK3052000000000000000001');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bic).toBeNull();
  });

  it.skipIf(noSK)('serves the institution name, and only nulls for its address', () => {
    // The prevodník publishes a name and a BIC, no address at all — the same
    // honest shape as Belgium. Nulls are what the NBS publishes, not data
    // missing on our side.
    const r = check('SK9811000000000000000001');
    const inst = r.bank_code_check?.institution;
    expect(inst?.name).toBe('Tatra banka, a.s.');
    expect(inst?.street).toBeNull();
    expect(inst?.post_code).toBeNull();
    expect(inst?.town).toBeNull();
    expect(inst?.country).toBe('SK');
  });

  it.skipIf(noSK)('dates the verdict from the register, not from our refresh month', () => {
    // The NBS publishes a versioned edition with an effective date of its own.
    // Austria and Belgium publish a rolling file and are dated by the reference
    // set; Slovakia must not borrow that date, in either direction.
    const registerMonth = nationalRegisterEdition('SK').as_of?.slice(0, 7);
    expect(registerMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(check('SK9811000000000000000001').bank_code_check?.as_of).toBe(registerMonth);
    // The negative branch too: a denial a caller will act on has to say how
    // current the list behind it is.
    expect(check('SK4499990000000000000001').bank_code_check?.as_of).toBe(registerMonth);
  });
});

describe('the register BIC wins the served Slovak pairing', () => {
  it.skipIf(noSK)('serves the BIC the register publishes, credited from the row', () => {
    const r = check('SK9811000000000000000001');
    expect(r.bic?.code).toBe('TATRSKBX');
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
    // The credit is DATA: the NBS terms make naming the source a condition of
    // reuse, so this string is read from the row the seeder wrote, never a
    // literal in enrich.ts. It carries the edition the run actually read.
    expect(r.bic?.source).toBe(nationalRegisterEdition('SK').source);
    expect(r.bic?.source).toMatch(/^Národná banka Slovenska, .*version \d+$/);
    expect(r.bic?.as_of).toBe(nationalRegisterEdition('SK').as_of?.slice(0, 7));
  });

  it.skipIf(noSK)('serves a name verbatim, diacritics and all', () => {
    // The NBS terms forbid altering the file. Transliterating "Slovenská
    // sporiteľňa" would be exactly that alteration.
    const r = check('SK5409000000000000000001');
    expect(r.bic?.bank_name).toBe('Slovenská sporiteľňa, a.s.');
  });

  it.skipIf(noSK)('keeps a Czech BIC on a Slovak bank code', () => {
    // Eight Czech institutions hold a Slovak payment code. A BIC-country check
    // at seed time would have dropped all eight; here the register's own
    // pairing is served, foreign BIC and all.
    const r = check('SK8506000000000000000001'); // 0600, MONETA Money Bank
    expect(r.bic?.code).toBe('AGBACZPP');
    expect(r.bic?.basis).toBe('national_register');
  });

  it.skipIf(noSK)('keeps the verdict without inventing a BIC for a row that has none', () => {
    // Four Slovak codes are allocated and publish no BIC (8191, 8400, 9950,
    // 9956). Existence and BIC availability stay separate answers, which is the
    // whole point of the bank_code_check block.
    const r = check('SK4281910000000000000001');
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.institution?.name).toBe(
      'Centrálny depozitár cenných papierov SR, a.s.',
    );
    expect(r.bic).toBeNull();
  });
});

describe('the attribution the NBS terms require', () => {
  it.skipIf(noSK)('is built from the loaded rows, version and date together', () => {
    const credit = nationalRegisterCredit('SK');
    const { source, as_of } = nationalRegisterEdition('SK');
    expect(credit).toBe(`Zdroj: ${source} (${as_of})`);
    expect(credit).toMatch(/^Zdroj: Národná banka Slovenska,/);
  });

  it('states nothing for a register that publishes no edition of its own', () => {
    // Austria and Belgium store neither column. A credit line naming an
    // authority beside a date we do not hold is worse than no credit line, so
    // both stay null and both keep dating their answers by the reference set.
    expect(nationalRegisterCredit('AT')).toBeNull();
    expect(nationalRegisterCredit('BE')).toBeNull();
    expect(nationalRegisterEdition('AT')).toEqual({ source: null, as_of: null });
  });

  it('states nothing for a country we hold no register for', () => {
    expect(nationalRegisterCredit('FR')).toBeNull();
    expect(nationalRegisterEdition('FR')).toEqual({ source: null, as_of: null });
  });
});

/**
 * The two failures of ours that must never come out as a refusal — an
 * unreadable table and a missing one — live with their siblings in
 * bank-code-failure.test.ts, which owns the mock seam for that whole class.
 */
