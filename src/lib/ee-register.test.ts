import { afterEach, describe, expect, it, vi } from 'vitest';
import { renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  EE_PAGE_OF_KIND,
  eeBicSourceName,
  eeRegisterConfigured,
  eeRegisterName,
  eeRegisterSchema,
  lookupEeCode,
} from './ee-register.js';
import { COMPOSITE_REGISTER, enrichResult, registerCoverage } from './enrich.js';
import { validateIBAN } from './iban.js';
import {
  otherCountriesLine,
  positioningLong,
  registerCountries,
  registerBlock,
  uncoveredCountries,
} from './positioning.js';
import { buildComplianceResponse } from './compliance-response.js';
import { UNLICENSED_MAP_COUNTRIES, countryHasReferenceData } from './bic-lookup.js';
import { EE_FIXTURE, writePrivateFixture } from '../test-support/ee-me-fixtures.js';

/**
 * Le registre estonien (08/10/2026), servi depuis un fichier PRIVÉ désigné par
 * EE_REGISTER_PATH : la table entière n'est pas dans ce dépôt. Les essais écrivent un
 * fichier de quelques lignes (src/test-support/ee-me-fixtures.ts), aux dates
 * inventées (2098, 2099), et passent par la VRAIE validation.
 */

const removers: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  removers.splice(0).forEach((remove) => remove());
});

/** Branche le fichier d'essai (ou un contenu choisi) sur EE_REGISTER_PATH. */
function install(content: unknown = EE_FIXTURE): string {
  const file = writePrivateFixture('ee-register.json', content);
  removers.push(file.remove);
  vi.stubEnv('EE_REGISTER_PATH', file.path);
  return file.path;
}

/** Un IBAN estonien de ce code bancaire, à clé mod-97 valide (le compte est inventé). */
function estonianIban(bankCode: string): string {
  const bban = `${bankCode}0022102014568${'5'}`;
  const digits = `${bban}EE00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `EE${String(98 - rest).padStart(2, '0')}${bban}`;
}

function answer(iban: string) {
  const result = validateIBAN(iban);
  expect(result.valid, iban).toBe(true);
  enrichResult(result);
  return result;
}

describe('sans EE_REGISTER_PATH, l’Estonie répond comme avant', () => {
  it('ne lit rien et n’annonce rien', () => {
    vi.stubEnv('EE_REGISTER_PATH', '');
    expect(eeRegisterConfigured()).toBe(false);
    expect(lookupEeCode('22')).toBeNull();
    expect(registerCountries().partial).not.toContain('EE');
    expect(registerBlock().join('\n')).not.toContain('Finantsinspektsioon');
  });

  it('garde la réponse « aucune donnée » du 29/09/2026, y compris pour l’IBAN d’exemple du registre', () => {
    vi.stubEnv('EE_REGISTER_PATH', '');
    const r = answer('EE382200221020145685');
    expect(r.bic ?? null).toBeNull();
    expect(r.bank_code_check).toMatchObject({
      value: '22',
      status: 'unavailable',
      reason: 'no_reference_data_for_country',
      match: null,
      register: null,
      authoritative: false,
    });
    expect(r.bank_code_holder).toBe('unknown');
  });

  it('n’est jamais un registre qui fait foi, branché ou non', () => {
    vi.stubEnv('EE_REGISTER_PATH', '');
    expect(registerCoverage('EE').basis).toBe('none');
    install();
    expect(registerCoverage('EE').basis).not.toBe('authoritative');
    expect(registerCountries().authoritative).not.toContain('EE');
    expect(registerCountries().partial).toContain('EE');
  });
});

describe('le fichier de l’Estonie', () => {
  it('suit son schéma', () => {
    expect(eeRegisterSchema.safeParse(EE_FIXTURE).success).toBe(true);
    const duplicated = { ...EE_FIXTURE, entries: [EE_FIXTURE.entries[0], EE_FIXTURE.entries[0]] };
    expect(eeRegisterSchema.safeParse(duplicated).success).toBe(false);
    const foreignBic = {
      ...EE_FIXTURE,
      entries: [{ ...EE_FIXTURE.entries[0], bic: 'HABALV2X' }],
    };
    expect(eeRegisterSchema.safeParse(foreignBic).success).toBe(false);
    const oneDigit = { ...EE_FIXTURE, entries: [{ ...EE_FIXTURE.entries[0], code: '2' }] };
    expect(eeRegisterSchema.safeParse(oneDigit).success).toBe(false);
  });

  it('dit « page last edited » et « read by IBANforge on », jamais « published »', () => {
    for (const page of ['credit_institutions', 'payment_institutions'] as const) {
      const text = eeRegisterName(page, '2099-01-02', '2099-03-04');
      expect(text.startsWith('Source: Finantsinspektsioon')).toBe(true);
      expect(text).toContain('page last edited 2099-01-02');
      expect(text).toContain('read by IBANforge on 2099-03-04');
      expect(text).not.toMatch(/published/i);
    }
    expect(eeBicSourceName('2099-03-04')).toContain('Eesti Pangaliit');
  });

  it('relit le fichier remplacé sans redémarrer', () => {
    const path = install();
    expect(lookupEeCode('22')?.name).toBe('Swedbank AS');
    const next = {
      ...EE_FIXTURE,
      entries: [{ code: '22', name: 'Banque Remplacée AS', kind: 'credit_institution', bic: null }],
    };
    const neighbour = join(dirname(path), 'ee-next.json');
    writeFileSync(neighbour, JSON.stringify(next));
    renameSync(neighbour, path);
    expect(lookupEeCode('22')?.name).toBe('Banque Remplacée AS');
    expect(lookupEeCode('10')).toBeNull();
  });

  it('un fichier configuré absent ou corrompu produit une indisponibilité, pas un rejet ni un plantage', () => {
    install('{invalide');
    let r = answer(estonianIban('22'));
    expect(r.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'lookup_failed',
      authoritative: false,
    });
    vi.stubEnv('EE_REGISTER_PATH', '/nonexistent/ee-register.json');
    r = answer(estonianIban('22'));
    expect(r.bank_code_check).toMatchObject({ status: 'unavailable', reason: 'lookup_failed' });
  });
});

describe('une banque estonienne listée', () => {
  it('est reconnue par la validation, avec la source et les dates du fichier dans la réponse', () => {
    install();
    const r = answer('EE382200221020145685');
    expect(r.bank_code_holder).toBe('confirmed');
    expect(r.bank_code_check).toMatchObject({
      value: '22',
      status: 'verified',
      match: 'register',
      authoritative: false,
      as_of: '2099-03',
      institution: {
        name: 'Swedbank AS',
        street: null,
        post_code: null,
        town: null,
        country: 'EE',
      },
    });
    expect(r.bank_code_check?.register).toBe(
      eeRegisterName(EE_PAGE_OF_KIND.credit_institution, '2098-12-31', '2099-03-04'),
    );
    expect(r.bank_code_check?.register).toContain('Source: Finantsinspektsioon');
    expect(r.checks?.bank_code).toBe('pass');
  });

  it('porte le BIC d’Eesti Pangaliit sous la base `curated_map`, indicative, jamais `national_register`', () => {
    install();
    const r = answer('EE382200221020145685');
    expect(r.bic).toMatchObject({
      code: 'HABAEE2X',
      bic8: 'HABAEE2X',
      bank_name: 'Swedbank AS',
      basis: 'curated_map',
      authoritative: false,
      as_of: '2099-03',
    });
    expect(r.bic?.source).toBe(eeBicSourceName('2099-03-04'));
    expect(answer('EE471000001020145685').bic).toMatchObject({
      code: 'EEUHEE2X',
      basis: 'curated_map',
    });
  });

  it('reconnaît les deux codes de Luminor', () => {
    install();
    for (const code of ['96', '17']) {
      const r = answer(estonianIban(code));
      expect(r.bank_code_check?.institution?.name, code).toBe('Luminor Bank AS');
      expect(r.bic?.code, code).toBe('RIKOEE22');
    }
  });

  it('date un établissement de paiement par SA page, pas par celle des banques', () => {
    install();
    const r = answer(estonianIban('88'));
    expect(r.bank_code_check?.institution?.name).toBe('Wallester AS');
    expect(r.bank_code_check?.register).toBe(
      eeRegisterName(EE_PAGE_OF_KIND.payment_or_e_money_institution, '2099-01-02', '2099-03-04'),
    );
    expect(r.bic?.code).toBe('WALLEE22');
  });

  it('nomme le titulaire d’un code sans BIC, et laisse `bic: null` : aucun BIC n’est déduit d’un nom', () => {
    install();
    for (const entry of EE_FIXTURE.entries.filter((e) => e.bic === null)) {
      const r = answer(estonianIban(entry.code));
      expect(r.bank_code_check, entry.code).toMatchObject({
        status: 'verified',
        match: 'register',
        authoritative: false,
        institution: { name: entry.name, country: 'EE' },
      });
      expect(r.bic ?? null, entry.code).toBeNull();
    }
  });

  it('fait cribler la banque : le BIC d’un code listé arrive à la conformité', () => {
    install();
    const c = buildComplianceResponse('EE382200221020145685');
    expect(c.compliance.sanctions.bank_screened).toBe(true);
    expect(c.compliance.flags).not.toContain('bank_code_data_unavailable');
  });
});

describe('un code estonien que le fichier ne porte pas', () => {
  it('garde la réponse d’avant le registre : ni non-attribution, ni « non consulté »', () => {
    vi.stubEnv('EE_REGISTER_PATH', '');
    const before = answer(estonianIban('33'));
    install();
    const r = answer(estonianIban('33'));
    expect(lookupEeCode('33')).toBeNull();
    expect(r.bank_code_check).toEqual(before.bank_code_check);
    expect(r.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'no_reference_data_for_country',
      match: null,
      register: null,
      authoritative: false,
    });
    expect(r.bank_code_holder).toBe('unknown');
    expect(r.bic ?? null).toBeNull();
  });

  it('n’est jamais refusé, même un code que Pangaliit liste et que l’autorité ne portait pas le 08/10/2026', () => {
    install();
    for (const code of ['00', '83', '99']) {
      const r = answer(estonianIban(code));
      expect(r.bank_code_check?.authoritative, code).toBe(false);
      expect(r.bank_code_check?.status, code).not.toBe('not_in_register');
    }
  });
});

describe('la place de l’Estonie parmi les pays', () => {
  it('est annoncée comme registre partiel là où le fichier est branché, et nulle part ailleurs', () => {
    vi.stubEnv('EE_REGISTER_PATH', '');
    expect(registerBlock().join('\n')).not.toContain('Estonia');
    install();
    expect(registerBlock().join('\n')).toContain('Estonia: Finantsinspektsioon');
  });

  it('sort de la phrase des pays sans données, comme du décompte « in all but N », là où le fichier est branché', () => {
    vi.stubEnv('EE_REGISTER_PATH', '');
    const before = uncoveredCountries();
    expect(before).toContain('EE');
    expect(otherCountriesLine()).toContain('Estonia');
    expect(positioningLong()).toContain(`in all but ${before.length} of them`);
    install();
    const after = uncoveredCountries();
    expect(after).not.toContain('EE');
    expect(after).toContain('TR');
    expect(after).toHaveLength(before.length - 1);
    expect(otherCountriesLine()).not.toContain('Estonia');
    expect(otherCountriesLine()).toContain('Türkiye');
    expect(positioningLong()).toContain(`in all but ${after.length} of them`);
  });

  it('reste privée de la carte composite retirée le 29/09/2026, fichier branché ou non', () => {
    install();
    expect(UNLICENSED_MAP_COUNTRIES.has('EE')).toBe(true);
    expect(countryHasReferenceData('EE')).toBe(false);
    expect(COMPOSITE_REGISTER).not.toContain('Finantsinspektsioon');
  });
});
