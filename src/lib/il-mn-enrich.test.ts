import Database from 'better-sqlite3';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Israël et Mongolie (28/10/2026) : deux registres PARTIELS servis par la surcouche
 * privée (membres `register_il` et `register_mn`, src/lib/restricted-family.ts), sur
 * le modèle de Saint-Marin (src/lib/sm-enrich.test.ts).
 *
 * 🔒 Les lignes sont INVENTÉES : les deux sources sont de la case 2 de la règle du
 * 28/10/2026 et n'entrent pas dans ce dépôt public. Codes et BIC vérifiés absents
 * des vraies listes le 28/10/2026 (codes israéliens au-delà de 900, codes mongols
 * 09xx, BIC en `ZZ`).
 */
const { fixture, ibanFor } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  const installed = m.installRestrictedFixture();
  const { default: Db } = await import('better-sqlite3');
  const db = new Db(installed.bicPath);
  const insert = db.prepare(
    'INSERT INTO national_bank_codes (country, code, name, bic, source, as_of) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const IL_BANKS = 'Bank of Israel, List of banking corporations in Israel (data.gov.il)';
  const IL_BRANCHES = 'Bank of Israel, Bank branches (data.gov.il)';
  const MN = 'Bank of Mongolia (Mongolbank), unified register of payment system participants';
  insert.run('IL', '901', 'Alpha Bank Ltd', 'ZZALILITXXX', IL_BANKS, '2026-10-28');
  insert.run('IL', '902', 'Beta Bank Ltd', null, IL_BRANCHES, '2026-10-27');
  insert.run('MN', '0901', 'Туршилтын банк', 'ZZTSMNUB', MN, '2026-10-28');
  insert.run('MN', '0906', '360 Альфа ББСБ', null, MN, '2026-10-28');
  db.close();
  return { fixture: installed, ibanFor: m.ibanFor };
});
afterAll(() => fixture.restore());

const { validateIBAN } = await import('./iban.js');
const { enrichResult, registerCoverage } = await import('./enrich.js');
const { nationalRegisterIsExhaustive, resetNationalRegisterStatements } =
  await import('./national-registers.js');

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

const il = (bank: string) => ibanFor('IL', `${bank}8000000000999999`);
const mn = (code: string) => ibanFor('MN', `${code}099123456700`);

describe('Israel: the Bank of Israel lists name the holder of a code they carry', () => {
  it('serves the bank, its BIC and the dated credit of the dataset', () => {
    const r = check(il('901'));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.match).toBe('register');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bank_code_check?.register).toBe(
      'Source: Bank of Israel, List of banking corporations in Israel (data.gov.il), dataset updated 2026-10-28. ' +
        'Partial register: the Bank of Israel lists banking corporations and their branches, not the allocation of the bank-code space, so an absence is not a non-allocation',
    );
    expect(r.bank_code_check?.institution?.name).toBe('Alpha Bank Ltd');
    expect(r.bic?.code).toBe('ZZALILITXXX');
    expect(r.bic?.bank_name).toBe('Alpha Bank Ltd');
    expect(r.bic?.source).toBe(
      'Source: Bank of Israel, List of banking corporations in Israel (data.gov.il), dataset updated 2026-10-28',
    );
    expect(r.bic?.basis).toBe('national_register');
  });

  it('names a code only the branch list knows, with its own dataset, and no BIC', () => {
    const r = check(il('902'));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.register).toMatch(
      /^Source: Bank of Israel, Bank branches \(data\.gov\.il\), dataset updated 2026-10-27\. /,
    );
    expect(r.bank_code_check?.institution?.name).toBe('Beta Bank Ltd');
    expect(r.bic).toBeNull();
  });

  it('keeps a code the lists do not carry off any refusal', () => {
    const r = check(il('903'));
    expect(r.bank_code_check?.reason).toBe('absent_from_reference_data');
    expect(r.bank_code_check?.reason).not.toBe('not_allocated');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });
});

describe('Mongolia: the participants register, its SWIFT column only', () => {
  it('serves a bank with its SWIFT BIC and the read day', () => {
    const r = check(mn('0901'));
    expect(r.bank_code_check?.value).toBe('0901');
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.register).toMatch(
      /^Source: Bank of Mongolia \(Mongolbank\), unified register of payment system participants \(read by IBANforge on 2026-10-28\)\. Partial register: /,
    );
    expect(r.bank_code_check?.institution?.name).toBe('Туршилтын банк');
    expect(r.bic?.code).toBe('ZZTSMNUB');
    expect(r.bic?.basis).toBe('national_register');
  });

  it('names a participant without a SWIFT BIC and serves no BIC for it', () => {
    const r = check(mn('0906'));
    expect(r.bank_code_check?.institution?.name).toBe('360 Альфа ББСБ');
    expect(r.bic).toBeNull();
  });
});

describe('the two registers are partial and private', () => {
  it('never settles a negative', () => {
    expect(nationalRegisterIsExhaustive('IL')).toBe(false);
    expect(nationalRegisterIsExhaustive('MN')).toBe(false);
    expect(registerCoverage('IL').basis).toBe('partial');
    expect(registerCoverage('MN').basis).toBe('partial');
  });

  it('says "not consulted" when the overlay does not carry them', () => {
    const db = new Database(fixture.bicPath);
    db.prepare("DELETE FROM national_bank_codes WHERE country IN ('IL', 'MN')").run();
    db.close();
    resetNationalRegisterStatements();
    for (const iban of [il('903'), mn('0907')]) {
      const r = check(iban);
      expect(r.bank_code_check?.status, iban).toBe('unavailable');
      expect(r.bank_code_check?.reason, iban).toBe('national_register_unavailable');
    }
  });
});
