import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import {
  nationalRegisterAvailable,
  nationalRegisterCredit,
  nationalRegisterEdition,
  nationalRegisterIsExhaustive,
} from './national-registers.js';

/**
 * San Marino — a register that names holders without covering the space.
 *
 * This file exists for ONE property, and everything else in it is scaffolding:
 * a code the BCSM page does not list must answer exactly what San Marino
 * answered before the register was ingested. Not `not_allocated` (the page is a
 * list of banks, not an allocation of the ABI space) and not
 * `national_register_unavailable` (the register was consulted and answered).
 *
 * A San Marino BBAN is `1!a5!n5!n12!c`: a CIN letter, then five digits of ABI
 * in IBAN positions 6-10, five of CAB, and twelve of account. Every IBAN below
 * was generated mod-97 and is asserted valid before anything is read from it.
 */
function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

const noSM = !nationalRegisterAvailable('SM');

/** ABI 03034, Banca Agricola Commerciale — on the BCSM page. */
const LISTED = 'SM15U0303409800000000270100';
/** The same bank with a different CIN letter: our validator accepts any. */
const LISTED_OTHER_CIN = 'SM32A0303409800000000270100';
/** The ISO 13616 registry's own San Marino example. Its ABI is not on the page. */
const SWIFT_EXAMPLE = 'SM86U0322509800000000270100';
/** A fabricated ABI, on the page and in no directory. */
const FABRICATED = 'SM35U9999909800000000270100';

describe('the BCSM list names the holder of a code it carries', () => {
  it.skipIf(noSM)('verifies a listed bank and serves what the supervisor publishes', () => {
    const r = check(LISTED);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.match).toBe('register');
    expect(r.bank_code_check?.register).toMatch(/Central Bank of the Republic of San Marino/);
    const inst = r.bank_code_check?.institution;
    // The full registered office, which this page publishes and Belgium's does
    // not — depth follows the register, never a house style.
    expect(inst?.name).toBe('Banca Agricola Commerciale Istituto Bancario Sammarinese s.p.a.');
    expect(inst?.street).toBe('Via 3 settembre, 316');
    expect(inst?.post_code).toBe('47891');
    expect(inst?.town).toBe('Dogana');
    expect(inst?.country).toBe('SM');
    // The page publishes no LEI, so none is served. Joining one from GLEIF
    // would be our enrichment wearing the BCSM's credit.
    expect(inst?.lei).toBeUndefined();
  });

  it.skipIf(noSM)('serves the name the institution actually has, not the markup artefact', () => {
    // 🚨 The page marks this name up as two adjacent <strong> with no space
    // between them, so it RENDERS as "BancaAgricola" in a browser. Our own
    // GLEIF row for BASMSMSM reads "BANCA AGRICOLA COMMERCIALE …", so the space
    // is the institution's, not ours to invent.
    expect(check(LISTED).bic?.bank_name).toContain('Banca Agricola');
    expect(check(LISTED).bic?.bank_name).not.toContain('BancaAgricola');
  });

  it.skipIf(noSM)('does not care which CIN letter the IBAN carries', () => {
    // The CIN is a check character over the BBAN, not part of the bank code.
    expect(check(LISTED_OTHER_CIN).bank_code_check?.value).toBe('03034');
    expect(check(LISTED_OTHER_CIN).bank_code_check?.status).toBe('verified');
  });
});

/**
 * The property this file is for.
 */
describe('a code the list does not carry keeps the answer it always had', () => {
  it.skipIf(noSM)('never says not_allocated, and never blames the register', () => {
    for (const iban of [SWIFT_EXAMPLE, FABRICATED]) {
      const r = check(iban);
      const check_ = r.bank_code_check;
      // Exactly the reason San Marino returned before this register existed.
      expect(check_?.reason, iban).toBe('absent_from_reference_data');
      // The two wrong answers, named so a regression cannot pass by accident:
      // `not_allocated` would tell a payment engine to stop over a code the
      // BCSM simply never listed; `national_register_unavailable` would call
      // IBANforge broken when the register was read and answered.
      expect(check_?.reason, iban).not.toBe('not_allocated');
      expect(check_?.reason, iban).not.toBe('national_register_unavailable');
      expect(check_?.authoritative, iban).toBe(false);
      // The composite map is credited, because the composite map is what
      // answered — not the BCSM list, which was consulted and said nothing.
      expect(check_?.register, iban).toMatch(/composite/i);
      expect(
        r.next_steps?.map((s) => s.code),
        iban,
      ).not.toContain('bank_code_not_allocated');
    }
  });

  it.skipIf(noSM)('says the same about the ISO registry example as about a made-up code', () => {
    // The registry's own San Marino example carries an ABI the operating-banks
    // page does not list. For Austria and Slovakia that is a FINDING — their
    // registers allocate, so the example points at nobody. Here it is not: the
    // page never claimed to cover the space, so the honest answer is the same
    // shrug a fabricated code gets, and the two must not diverge.
    const example = check(SWIFT_EXAMPLE).bank_code_check;
    const made_up = check(FABRICATED).bank_code_check;
    expect(example?.status).toBe(made_up?.status);
    expect(example?.reason).toBe(made_up?.reason);
    expect(example?.authoritative).toBe(made_up?.authoritative);
  });
});

describe('the BIC pairing is the supervisor s, even though the code space is not', () => {
  it.skipIf(noSM)('serves the register BIC as national_register', () => {
    const r = check(LISTED);
    expect(r.bic?.code).toBe('BASMSMSM');
    // The mirror image of Switzerland: there the SIX register settles the CODE
    // while the BIC comes from our curated map, so bank_code_check is
    // authoritative and bic is not. Here it is the other way round — the BCSM
    // prints this BIC beside this code, so the pairing is its own, while the
    // code space it never published stays non-authoritative.
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bic?.source).toBe(nationalRegisterEdition('SM').source);
  });

  it.skipIf(noSM)('resolves a bank our curated map could never have reached', () => {
    // Measured 06/09/2026, before the register: every San Marino IBAN answered
    // `bic: null`. The eleven curated SM keys are four-letter BIC stems
    // (SM:BASM, SM:MAOI …) and a San Marino IBAN carries five DIGITS, so they
    // can never match. The register is the only thing that resolves these.
    expect(check(LISTED).bic).not.toBeNull();
  });
});

describe('the attribution, and what its date belongs to', () => {
  it.skipIf(noSM)('words San Marino s credit as a READ date, not an edition', () => {
    const { source, as_of } = nationalRegisterEdition('SM');
    expect(source).toBe('Central Bank of the Republic of San Marino, operating banks');
    expect(as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // "read on" is the whole point: the BCSM publishes no edition and no
    // revision date, so a bare parenthesis would read as the source's own date
    // and overstate it. Slovakia's, which IS the register's date, reads plain.
    expect(nationalRegisterCredit('SM')).toBe(`Source: ${source} (read on ${as_of})`);
    expect(nationalRegisterCredit('SK')).toMatch(/^Zdroj: /);
    expect(nationalRegisterCredit('SK')).not.toMatch(/read on/);
  });
});

describe('nationalRegisterIsExhaustive', () => {
  it('separates the registers that allocate from the one that merely lists', () => {
    for (const cc of ['AT', 'BE', 'SK']) {
      expect(nationalRegisterIsExhaustive(cc), cc).toBe(true);
    }
    // The flag that keeps four rows of good data from becoming a denial engine.
    expect(nationalRegisterIsExhaustive('SM')).toBe(false);
    // A country we hold no register for answers the same as a non-exhaustive
    // one, on purpose: both mean "do not turn a miss into a denial".
    expect(nationalRegisterIsExhaustive('FR')).toBe(false);
  });
});
