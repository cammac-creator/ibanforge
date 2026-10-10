import { afterEach, describe, expect, it, vi } from 'vitest';
import { renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  RS_PUBLICATION,
  lookupRsCode,
  rsCredit,
  rsRegisterConfigured,
  rsRegisterName,
  rsRegisterSchema,
} from './rs-register.js';
import { COMPOSITE_REGISTER, enrichResult, registerCoverage } from './enrich.js';
import { EXAMPLE_IBANS } from './countries.js';
import { validateIBAN } from './iban.js';
import {
  otherCountriesLine,
  positioningLong,
  registerBlock,
  registerCountries,
  uncoveredCountries,
} from './positioning.js';
import { nationalRegisterBicCountries } from './register-lists.js';
import { buildComplianceResponse } from './compliance-response.js';
import { UNLICENSED_MAP_COUNTRIES, countryHasReferenceData } from './bic-lookup.js';
import { RS_FIXTURE, writePrivateFixture } from '../test-support/ee-me-fixtures.js';

/**
 * Le registre serbe (10/10/2026), servi depuis un fichier PRIVÉ désigné par
 * RS_REGISTER_PATH : la table entière n'est pas dans ce dépôt. Les essais écrivent
 * quatre lignes (src/test-support/ee-me-fixtures.ts), aux dates inventées (2099), et
 * passent par la VRAIE validation.
 */

const removers: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  removers.splice(0).forEach((remove) => remove());
});

function install(content: unknown = RS_FIXTURE): string {
  const file = writePrivateFixture('rs-register.json', content);
  removers.push(file.remove);
  vi.stubEnv('RS_REGISTER_PATH', file.path);
  return file.path;
}

/**
 * Un IBAN serbe de ce code bancaire : treize chiffres de compte inventés, la clé
 * nationale (ISO 7064 mod 97-10 sur les 16 premiers chiffres) puis la clé IBAN.
 */
function serbianIban(bankCode: string, account = '0000123456789'): string {
  const base = BigInt(`${bankCode}${account}`);
  const national = String(98n - ((base * 100n) % 97n)).padStart(2, '0');
  const bban = `${bankCode}${account}${national}`;
  const digits = `${bban}RS00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `RS${String(98 - rest).padStart(2, '0')}${bban}`;
}

function answer(iban: string) {
  const result = validateIBAN(iban);
  expect(result.valid, iban).toBe(true);
  enrichResult(result);
  return result;
}

describe('le calcul des IBAN d’essai', () => {
  it('retrouve l’exemple officiel du registre IBAN, clé nationale comprise', () => {
    expect(serbianIban('260', '0056010016113')).toBe('RS35260005601001611379');
    expect(EXAMPLE_IBANS.RS).toBe('RS35260005601001611379');
  });
});

describe('sans RS_REGISTER_PATH, la Serbie répond comme avant', () => {
  it('ne lit rien et n’annonce rien', () => {
    vi.stubEnv('RS_REGISTER_PATH', '');
    expect(rsRegisterConfigured()).toBe(false);
    expect(lookupRsCode('160')).toBeNull();
    expect(registerCountries().partial).not.toContain('RS');
    expect(registerBlock().join('\n')).not.toContain('Serbia');
  });

  it('garde la réponse « aucune donnée » du 29/09/2026', () => {
    vi.stubEnv('RS_REGISTER_PATH', '');
    const r = answer(serbianIban('160'));
    expect(r.bic ?? null).toBeNull();
    expect(r.bank_code_check).toMatchObject({
      value: '160',
      status: 'unavailable',
      reason: 'no_reference_data_for_country',
      match: null,
      register: null,
      authoritative: false,
    });
    expect(r.bank_code_holder).toBe('unknown');
  });

  it('n’est jamais un registre qui fait foi, branché ou non', () => {
    vi.stubEnv('RS_REGISTER_PATH', '');
    expect(registerCoverage('RS').basis).toBe('none');
    install();
    expect(registerCoverage('RS').basis).not.toBe('authoritative');
    expect(registerCountries().authoritative).not.toContain('RS');
    expect(registerCountries().partial).toContain('RS');
  });
});

describe('le fichier de la Serbie', () => {
  it('suit son schéma', () => {
    expect(rsRegisterSchema.safeParse(RS_FIXTURE).success).toBe(true);
    const e = RS_FIXTURE.entries[1];
    const bad = (entry: Record<string, unknown>) =>
      rsRegisterSchema.safeParse({ ...RS_FIXTURE, entries: [{ ...e, ...entry }] }).success;
    expect(bad({})).toBe(true);
    expect(bad({ bic: 'DBDBBEBGXXX' })).toBe(false);
    expect(bad({ code: '16' })).toBe(false);
    expect(bad({ registration_number: '0775923' })).toBe(false);
    expect(rsRegisterSchema.safeParse({ ...RS_FIXTURE, entries: [e, e] }).success).toBe(false);
    // Un document daté après le jour où il a été lu n'existe pas.
    expect(rsRegisterSchema.safeParse({ ...RS_FIXTURE, published: '2099-03-05' }).success).toBe(
      false,
    );
  });

  it('cite « National Bank of Serbia », la date du document et un lien qui mène chez la NBS', () => {
    for (const text of [
      rsCredit('2099-01-02', '2099-03-04'),
      rsRegisterName('2099-01-02', '2099-03-04'),
    ]) {
      expect(text.startsWith('Source: National Bank of Serbia')).toBe(true);
      expect(text).toContain('list dated 2099-01-02');
      expect(text).toContain('read by IBANforge on 2099-03-04');
      expect(text).toContain(RS_PUBLICATION);
    }
    expect(RS_PUBLICATION.startsWith('https://www.nbs.rs/')).toBe(true);
    // La réserve et l'absence de responsabilité qualifient le verdict, pas le BIC qui le suit.
    expect(rsRegisterName('2099-01-02', '2099-03-04')).toContain(
      'an absence is not a non-allocation',
    );
    expect(rsRegisterName('2099-01-02', '2099-03-04')).toContain('accepts no responsibility');
    expect(rsCredit('2099-01-02', '2099-03-04')).not.toContain('non-allocation');
  });

  it('relit le fichier remplacé sans redémarrer', () => {
    const path = install();
    expect(lookupRsCode('160')?.name).toBe('BANCA INTESA AKCIONARSKO DRUŠTVO BEOGRAD');
    const next = {
      ...RS_FIXTURE,
      entries: [{ ...RS_FIXTURE.entries[1], name: 'BANQUE REMPLACÉE AD' }],
    };
    const neighbour = join(dirname(path), 'rs-next.json');
    writeFileSync(neighbour, JSON.stringify(next));
    renameSync(neighbour, path);
    expect(lookupRsCode('160')?.name).toBe('BANQUE REMPLACÉE AD');
    expect(lookupRsCode('105')).toBeNull();
  });

  it('un fichier configuré absent ou corrompu produit une indisponibilité, pas un rejet ni un plantage', () => {
    install('{invalide');
    let r = answer(serbianIban('160'));
    expect(r.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'lookup_failed',
      authoritative: false,
    });
    vi.stubEnv('RS_REGISTER_PATH', '/nonexistent/rs-register.json');
    r = answer(serbianIban('160'));
    expect(r.bank_code_check).toMatchObject({ status: 'unavailable', reason: 'lookup_failed' });
  });
});

describe('une banque serbe listée', () => {
  it('Banca Intesa (160) est reconnue par la validation, avec la source et les dates dans la réponse', () => {
    install();
    const r = answer('RS35160000012345678956');
    expect(r.bank_code_holder).toBe('confirmed');
    expect(r.bank_code_check).toMatchObject({
      value: '160',
      status: 'verified',
      match: 'register',
      authoritative: false,
      // Le mois de la date que le document porte.
      as_of: '2099-01',
      institution: {
        name: 'BANCA INTESA AKCIONARSKO DRUŠTVO BEOGRAD',
        street: null,
        post_code: null,
        town: null,
        country: 'RS',
      },
    });
    expect(r.bank_code_check?.register).toBe(rsRegisterName('2099-01-02', '2099-03-04'));
    expect(r.checks?.bank_code).toBe('pass');
  });

  it('Raiffeisen (265) est reconnue de même', () => {
    install();
    const r = answer('RS35265000012345678984');
    expect(r.bank_code_check).toMatchObject({
      value: '265',
      status: 'verified',
      institution: { name: 'RAIFFEISEN BANKA A.D. BEOGRAD', country: 'RS' },
    });
    expect(r.bic?.code).toBe('RZBSRSBGXXX');
  });

  it('sert le BIC de la NBS sous la base `national_register`, onze caractères comme publiés', () => {
    install();
    const r = answer('RS35160000012345678956');
    expect(r.bic).toMatchObject({
      code: 'DBDBRSBGXXX',
      bic8: 'DBDBRSBG',
      bank_name: 'BANCA INTESA AKCIONARSKO DRUŠTVO BEOGRAD',
      basis: 'national_register',
      authoritative: true,
      as_of: '2099-01',
      source: rsCredit('2099-01-02', '2099-03-04'),
    });
    expect(r.bic?.source).toContain('Source: National Bank of Serbia');
  });

  it('ne sert jamais le matični broj : aucun champ de la réponse ne le porte', () => {
    install();
    for (const entry of RS_FIXTURE.entries) {
      const r = answer(serbianIban(entry.code));
      expect(JSON.stringify(r), entry.code).not.toContain(entry.registration_number);
      expect(JSON.stringify(lookupRsCode(entry.code)), entry.code).not.toContain(
        entry.registration_number,
      );
    }
  });

  it('trouve chaque banque du fichier, avec son nom et son BIC', () => {
    install();
    for (const entry of RS_FIXTURE.entries) {
      expect(lookupRsCode(entry.code)).toMatchObject({ name: entry.name, bic: entry.bic });
      const r = answer(serbianIban(entry.code));
      expect(r.bank_code_check?.institution?.name, entry.code).toBe(entry.name);
      expect(r.bic?.code, entry.code).toBe(entry.bic);
    }
  });

  it('fait cribler la banque : le BIC arrive à la conformité', () => {
    install();
    const c = buildComplianceResponse(serbianIban('265'));
    expect(c.compliance.sanctions.bank_screened).toBe(true);
    expect(c.compliance.flags).not.toContain('bank_code_data_unavailable');
  });
});

describe('un code serbe que le fichier ne porte pas', () => {
  it('garde la réponse d’avant, jamais une non-attribution : l’IBAN d’exemple du registre (code 260)', () => {
    vi.stubEnv('RS_REGISTER_PATH', '');
    const before = answer(EXAMPLE_IBANS.RS!);
    install();
    const r = answer(EXAMPLE_IBANS.RS!);
    expect(lookupRsCode('260')).toBeNull();
    expect(r.bank_code_check).toEqual(before.bank_code_check);
    expect(r.bank_code_check).toMatchObject({
      value: '260',
      status: 'unavailable',
      reason: 'no_reference_data_for_country',
      match: null,
      register: null,
      authoritative: false,
    });
    expect(r.bank_code_check?.reason).not.toBe('not_allocated');
    expect(r.bic ?? null).toBeNull();
  });

  it('n’est pas confondu avec la carte composite', () => {
    install();
    expect(COMPOSITE_REGISTER).not.toContain('National Bank of Serbia');
    expect(UNLICENSED_MAP_COUNTRIES.has('RS')).toBe(true);
    expect(countryHasReferenceData('RS')).toBe(false);
  });
});

describe('la place de la Serbie parmi les pays', () => {
  it('est annoncée comme registre partiel là où le fichier est branché, et nulle part ailleurs', () => {
    vi.stubEnv('RS_REGISTER_PATH', '');
    expect(registerBlock().join('\n')).not.toContain('Serbia');
    install();
    expect(registerBlock().join('\n')).toContain('Serbia: National Bank of Serbia');
  });

  it('sort de la phrase des pays sans données, comme du décompte « in all but N », là où le fichier est branché', () => {
    vi.stubEnv('RS_REGISTER_PATH', '');
    const before = uncoveredCountries();
    expect(before).toContain('RS');
    expect(otherCountriesLine()).toContain('Serbia');
    expect(positioningLong()).toContain(`in all but ${before.length} of them`);
    install();
    const after = uncoveredCountries();
    expect(after).not.toContain('RS');
    expect(after).toContain('TR');
    expect(after).toHaveLength(before.length - 1);
    expect(otherCountriesLine()).not.toContain('Serbia');
    expect(otherCountriesLine()).toContain('Türkiye');
    expect(positioningLong()).toContain(`in all but ${after.length} of them`);
  });

  it('a un BIC qui est celui de la NBS : le contrat le dit avec Saint-Marin et le Monténégro', () => {
    expect(nationalRegisterBicCountries()).toEqual(expect.arrayContaining(['SM', 'ME', 'RS']));
  });
});
