import { describe, it, expect } from 'vitest';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import { nationalRegisterAvailable } from './national-registers.js';

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

const noAT = !nationalRegisterAvailable('AT');
const noBE = !nationalRegisterAvailable('BE');

/**
 * Austria and Belgium end to end. Every IBAN below was generated mod-97 and is
 * asserted valid before anything is checked against it.
 */
describe('Austria answers from the OeNB register', () => {
  it.skipIf(noAT)('verifies a real Austrian bank', () => {
    const r = check('AT311200000012345678'); // UniCredit Bank Austria
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.register).toMatch(/Nationalbank/i);
  });

  it.skipIf(noAT)('verifies the code the register publishes unpadded', () => {
    // Published as '100', carried in the IBAN as '00100'. Without padding this
    // would deny the Austrian central bank.
    const r = check('AT170010000012345678');
    expect(r.bank_code_check?.status).toBe('verified');
  });

  it.skipIf(noAT)('denies a fabricated Austrian code, and says stop', () => {
    const r = check('AT479999900012345678');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });
});

describe('Belgium answers from the NBB Protocol register', () => {
  it.skipIf(noBE)('verifies a real Belgian bank', () => {
    const r = check('BE23001123456789'); // BNP Paribas Fortis
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
  });

  it.skipIf(noBE)('denies a slot the register marks free', () => {
    // 999 is published with 'VRIJ' in the BIC column: the register is stating
    // that nobody holds it. That has to read as a denial, not as a bank.
    const r = check('BE24999123456789');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bic).toBeNull();
  });

  it.skipIf(noBE)('never resolves a BIC for a code its own verdict denies', () => {
    // 23 of our 781 Belgian keys claimed a bank on a slot the register calls
    // vacant. Same defect as the 52 German and 21 Finnish ones.
    for (const iban of ['BE24999123456789', 'BE72500123456789']) {
      const r = check(iban);
      if (r.bank_code_check?.status === 'not_in_register') {
        expect(r.bic, `${iban} resolved a BIC despite not_in_register`).toBeNull();
      }
    }
  });

  it.skipIf(noBE)('denies the reserved slot the whole web uses as its example IBAN', () => {
    // The register writes 'Onbeschikbaar' (unavailable) for code 539 — it is
    // reserved, held by nobody. Before the seeder dropped these, the served
    // answer named a bank called "Onbeschikbaar": the corporate-treasury
    // defect in miniature.
    const r = check('BE68539007547034');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.institution).toBeUndefined();
  });

  it.skipIf(noBE)('serves the Belgian institution name, and only nulls for its address', () => {
    // The BNB file publishes names in four languages and no address at all.
    // Nulls are the honest shape of what Belgium publishes.
    const r = check('BE23001123456789');
    const inst = r.bank_code_check?.institution;
    expect(inst?.name).toBeTruthy();
    expect(inst?.street).toBeNull();
    expect(inst?.post_code).toBeNull();
    expect(inst?.town).toBeNull();
    expect(inst?.country).toBe('BE');
  });
});

describe('Austria publishes the full seat address, and it is served', () => {
  it.skipIf(noAT)('serves street with house number, postal code, town and LEI', () => {
    // The central bank: every field the OeNB publishes, none invented.
    const r = check('AT170010000012345678');
    const inst = r.bank_code_check?.institution;
    expect(inst?.name).toMatch(/Nationalbank/i);
    expect(inst?.street).toMatch(/\d/);
    expect(inst?.post_code).toBeTruthy();
    expect(inst?.town).toBeTruthy();
    expect(inst?.country).toBe('AT');
    expect(inst?.lei).toMatch(/^[A-Z0-9]{20}$/);
  });
});

describe('the four registers keep their separate meanings', () => {
  it('does not claim authority for a country we hold no register for', () => {
    const r = check('FR1499999000010123456789A42');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });
});

/**
 * The register BIC, served and labelled.
 *
 * Both tables have carried a BIC per bank code since they were seeded, and
 * until 29/08/2026 it was read only for the bank-code verdict while the served
 * BIC still came from the composite map. The IBANs below pin the measured cost
 * of that split: retired pairings served as truth, and an EMI resolving to
 * nothing while its BIC sat in our own database.
 */
describe('the register BIC wins the served pairing', () => {
  it.skipIf(noBE)('serves the register BIC where the composite map was stale', () => {
    // BE 679 belongs to BNP Paribas Fortis; the composite map still said bpost,
    // its predecessor on the code.
    const r = check('BE11679123456748');
    expect(r.bic?.code).toBe('GEBABEBB');
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
    expect(r.bic?.source).toMatch(/Banque nationale de Belgique/);
  });

  it.skipIf(noBE)('gives an EMI the BIC the register publishes for it', () => {
    // bunq's Belgian branch: no curated key, and a numeric bank code means the
    // directory prefix fallback is structurally empty. Before the register BIC
    // was served, this IBAN resolved to nothing.
    const r = check('BE79167123456733');
    expect(r.bic?.code).toBe('BUNQBEB2');
    expect(r.bic?.basis).toBe('national_register');
  });

  it.skipIf(noAT)('replaces the retired Austrian pairing', () => {
    // AT 19510: the register says Liechtensteinische Landesbank (Österreich);
    // the composite map still said Zürcher Kantonalbank Österreich.
    const r = check('AT711951000001234567');
    expect(r.bic?.code).toBe('COPRATWW');
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });

  it.skipIf(noBE)('keeps the verdict without inventing a BIC for a row that has none', () => {
    // BE 102 is allocated — the register names its holder — but publishes no
    // BIC, and the composite map has no key for it either. Existence and BIC
    // availability stay separate answers, which is the whole point of the
    // bank_code_check block.
    const r = check('BE02102123456740');
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bic).toBeNull();
  });
});
