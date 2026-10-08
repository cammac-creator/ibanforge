import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lookupMeCode,
  meCredit,
  meRegisterConfigured,
  meRegisterName,
  meRegisterSchema,
} from './me-register.js';
import { COMPOSITE_REGISTER, enrichResult, registerCoverage } from './enrich.js';
import { validateIBAN } from './iban.js';
import { registerBlock, registerCountries } from './positioning.js';
import { nationalRegisterBicCountries } from './register-lists.js';
import { buildComplianceResponse } from './compliance-response.js';
import { lookupByCountryBank } from './bic-lookup.js';
import { ME_FIXTURE, writePrivateFixture } from '../test-support/ee-me-fixtures.js';

/**
 * Le registre monténégrin (08/10/2026), servi depuis un fichier PRIVÉ désigné par
 * ME_REGISTER_PATH : la table entière n'est pas dans ce dépôt. Les essais écrivent
 * quatre lignes (src/test-support/ee-me-fixtures.ts), au jour de lecture inventé
 * (2099), et passent par la VRAIE validation.
 */

const removers: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  removers.splice(0).forEach((remove) => remove());
});

function install(content: unknown = ME_FIXTURE): string {
  const file = writePrivateFixture('me-register.json', content);
  removers.push(file.remove);
  vi.stubEnv('ME_REGISTER_PATH', file.path);
  return file.path;
}

/**
 * Un IBAN monténégrin de ce code bancaire : treize chiffres de compte inventés, la
 * clé nationale (ISO 7064 mod 97-10 sur les 18 premiers chiffres) puis la clé IBAN.
 * Le calcul reproduit l'exemple officiel du registre IBAN, ME25 5050 0001 2345 6789 51.
 */
function montenegrinIban(bankCode: string, account = '0000123456789'): string {
  const base = BigInt(`${bankCode}${account}`);
  const national = String(98n - ((base * 100n) % 97n)).padStart(2, '0');
  const bban = `${bankCode}${account}${national}`;
  const digits = `${bban}ME00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `ME${String(98 - rest).padStart(2, '0')}${bban}`;
}

function answer(iban: string) {
  const result = validateIBAN(iban);
  expect(result.valid, iban).toBe(true);
  enrichResult(result);
  return result;
}

describe('le calcul des IBAN d’essai', () => {
  it('retrouve l’exemple officiel du registre IBAN', () => {
    expect(montenegrinIban('505')).toBe('ME25505000012345678951');
  });
});

describe('sans ME_REGISTER_PATH, le Monténégro répond comme avant', () => {
  it('ne lit rien et n’annonce rien', () => {
    vi.stubEnv('ME_REGISTER_PATH', '');
    expect(meRegisterConfigured()).toBe(false);
    expect(lookupMeCode('510')).toBeNull();
    expect(registerCountries().partial).not.toContain('ME');
    expect(registerBlock().join('\n')).not.toContain('Montenegro');
  });

  it('garde la réponse de la carte composite, BIC compris', () => {
    vi.stubEnv('ME_REGISTER_PATH', '');
    const r = answer(montenegrinIban('535'));
    // La carte composite donnait à ce code un BIC que la banque centrale ne confirme pas.
    expect(r.bic?.code).toBe('NIKBMEP2XXX');
    expect(r.bic?.basis).toBe('curated_map');
    expect(r.bank_code_check?.register).toBe(COMPOSITE_REGISTER);
  });

  it('n’est jamais un registre qui fait foi, branché ou non', () => {
    vi.stubEnv('ME_REGISTER_PATH', '');
    expect(registerCoverage('ME').basis).toBe('none');
    install();
    expect(registerCoverage('ME').basis).not.toBe('authoritative');
    expect(registerCountries().authoritative).not.toContain('ME');
    expect(registerCountries().partial).toContain('ME');
  });
});

describe('le fichier du Monténégro', () => {
  it('suit son schéma', () => {
    expect(meRegisterSchema.safeParse(ME_FIXTURE).success).toBe(true);
    const badBic = { ...ME_FIXTURE, entries: [{ ...ME_FIXTURE.entries[1], bic: 'CKBCRSBG' }] };
    expect(meRegisterSchema.safeParse(badBic).success).toBe(false);
    const twoDigits = { ...ME_FIXTURE, entries: [{ ...ME_FIXTURE.entries[1], code: '51' }] };
    expect(meRegisterSchema.safeParse(twoDigits).success).toBe(false);
    const duplicated = { ...ME_FIXTURE, entries: [ME_FIXTURE.entries[1], ME_FIXTURE.entries[1]] };
    expect(meRegisterSchema.safeParse(duplicated).success).toBe(false);
  });

  it('cite « Central Bank of Montenegro » et dit « read by IBANforge on », sans date de publication', () => {
    for (const text of [meCredit('2099-03-04'), meRegisterName('2099-03-04')]) {
      expect(text.startsWith('Source: Central Bank of Montenegro')).toBe(true);
      expect(text).toContain('read by IBANforge on 2099-03-04');
      expect(text).toContain('no publication date stated');
      expect(text).not.toMatch(/published on/i);
    }
    // La réserve qualifie le verdict sur le code, pas le BIC qui le suit.
    expect(meRegisterName('2099-03-04')).toContain('an absence is not a non-allocation');
    expect(meCredit('2099-03-04')).not.toContain('non-allocation');
  });

  it('un fichier configuré absent ou corrompu produit une indisponibilité, pas un rejet ni un plantage', () => {
    install('{invalide');
    let r = answer(montenegrinIban('510'));
    expect(r.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'lookup_failed',
      authoritative: false,
    });
    vi.stubEnv('ME_REGISTER_PATH', '/nonexistent/me-register.json');
    r = answer(montenegrinIban('510'));
    expect(r.bank_code_check).toMatchObject({ status: 'unavailable', reason: 'lookup_failed' });
  });
});

describe('une banque monténégrine listée', () => {
  it('est reconnue par la validation, avec la source dans la réponse', () => {
    install();
    const r = answer(montenegrinIban('510'));
    expect(r.bank_code_holder).toBe('confirmed');
    expect(r.bank_code_check).toMatchObject({
      value: '510',
      status: 'verified',
      match: 'register',
      authoritative: false,
      as_of: '2099-03',
      institution: {
        name: 'Crnogorska komercijalna banka AD',
        street: null,
        post_code: null,
        town: null,
        country: 'ME',
      },
    });
    expect(r.bank_code_check?.register).toBe(meRegisterName('2099-03-04'));
    expect(r.checks?.bank_code).toBe('pass');
  });

  it('sert le BIC de la banque centrale sous la base `national_register`', () => {
    install();
    const r = answer(montenegrinIban('510'));
    expect(r.bic).toMatchObject({
      code: 'CKBCMEPG',
      bic8: 'CKBCMEPG',
      bank_name: 'Crnogorska komercijalna banka AD',
      basis: 'national_register',
      authoritative: true,
      source: meCredit('2099-03-04'),
    });
    expect(r.bic?.source).toContain('Central Bank of Montenegro');
  });

  it('l’emporte sur une clé de la carte composite qui dirait autre chose (code 535)', () => {
    install();
    const composite = lookupByCountryBank('ME', '535');
    expect(composite?.code.slice(0, 8)).not.toBe('PRVAMEPG');
    const r = answer(montenegrinIban('535'));
    expect(r.bic?.code).toBe('PRVAMEPG');
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bank_code_check?.institution?.name).toBe(
      'Prva banka Crne Gore AD - Osnovana 1901. godine',
    );
  });

  it('trouve chaque banque du fichier, avec son nom et son BIC', () => {
    install();
    for (const entry of ME_FIXTURE.entries) {
      expect(lookupMeCode(entry.code)).toMatchObject({ name: entry.name, bic: entry.bic });
      const r = answer(montenegrinIban(entry.code));
      expect(r.bank_code_check?.institution?.name, entry.code).toBe(entry.name);
      expect(r.bic?.code, entry.code).toBe(entry.bic);
    }
  });

  it('fait cribler la banque : le BIC arrive à la conformité', () => {
    install();
    const c = buildComplianceResponse(montenegrinIban('530'));
    expect(c.compliance.sanctions.bank_screened).toBe(true);
  });
});

describe('un code monténégrin que le fichier ne porte pas', () => {
  it('garde la réponse d’avant, jamais une non-attribution', () => {
    // 505 est le code de l'exemple officiel du registre IBAN : la banque centrale
    // ne le liste pas, et la réponse reste celle de la carte composite.
    vi.stubEnv('ME_REGISTER_PATH', '');
    const before = answer('ME25505000012345678951');
    install();
    const r = answer('ME25505000012345678951');
    expect(lookupMeCode('505')).toBeNull();
    expect(r.bank_code_check).toEqual(before.bank_code_check);
    expect(r.bank_code_check).toMatchObject({
      value: '505',
      status: 'not_in_register',
      reason: 'absent_from_reference_data',
      match: null,
      register: COMPOSITE_REGISTER,
      authoritative: false,
    });
    expect(r.bank_code_check?.reason).not.toBe('not_allocated');
    expect(r.bic ?? null).toBeNull();
  });
});

describe('la place du Monténégro parmi les pays', () => {
  it('est annoncé comme registre partiel là où le fichier est branché, et nulle part ailleurs', () => {
    vi.stubEnv('ME_REGISTER_PATH', '');
    expect(registerBlock().join('\n')).not.toContain('Montenegro');
    install();
    expect(registerBlock().join('\n')).toContain('Montenegro: Central Bank of Montenegro');
  });

  it('a un BIC qui est celui de la banque centrale : le contrat le dit avec Saint-Marin', () => {
    expect(nationalRegisterBicCountries()).toContain('ME');
    expect(nationalRegisterBicCountries()).toContain('SM');
  });
});
