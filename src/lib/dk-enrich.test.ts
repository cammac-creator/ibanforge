import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Danemark, îles Féroé et Groenland (18/11/2026) : la liste IBAN d'e-nettet, registre
 * PARTIEL servi par la surcouche privée (membres `register_dk`, `register_fo`,
 * `register_gl`, src/lib/restricted-family.ts), sur le modèle d'Israël et de la
 * Mongolie (src/lib/il-mn-enrich.test.ts), avec deux différences voulues :
 *
 * - sans la surcouche, la réponse reste EXACTEMENT celle d'avant (la carte composite
 *   répondait déjà pour ces pays), jamais « registre non consulté » ;
 * - là où la liste répond, elle gagne sur la clé publique de la carte, BIC compris,
 *   même quand sa ligne n'a pas de BIC.
 *
 * 🔒 Les lignes sont INVENTÉES (noms inventés, BIC en `ZZ`) : la liste est de la case 2
 * de la règle du 28/10/2026 et n'entre pas dans ce dépôt public. Deux codes inventés se
 * posent sur des codes que la carte publique porte (0040 et 2000), pour éprouver la
 * priorité ; ce qu'en dit la vraie liste n'est écrit nulle part ici.
 *
 * Le même jour, quatorze clés DK de la carte publique, assemblées à la main en avril
 * 2026 et contredites par la liste de l'opérateur, ont quitté `src/db/bic_data.json` :
 * sans la surcouche, ces codes répondent « absent de nos données », jamais un BIC faux.
 */
const { fixture, ibanFor } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  const installed = m.installRestrictedFixture();
  return { fixture: installed, ibanFor: m.ibanFor };
});
afterAll(() => fixture.restore());

const { validateIBAN } = await import('./iban.js');
const { enrichResult, registerCoverage } = await import('./enrich.js');
const { nationalRegisterIsExhaustive, resetNationalRegisterStatements } =
  await import('./national-registers.js');
const { DK_REGISTER_NAME } = await import('./dk-credit.js');

const SOURCE = 'e-nettet A/S, IBAN Denmark, Greenland and Faroe Islands (www.iban-denmark.com)';
const EDITION = '2025-12-11';

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

/** Ce qu'une réponse dit de la banque : le verdict du code et le bloc BIC. */
function answer(iban: string) {
  const r = check(iban);
  return { bank_code_check: r.bank_code_check, bank_code_holder: r.bank_code_holder, bic: r.bic };
}

const dk = (code: string) => ibanFor('DK', `${code}0000000000`);
const fo = (code: string) => ibanFor('FO', `${code}0000000000`);
const gl = (code: string) => ibanFor('GL', `${code}0000000000`);

/**
 * Les IBAN éprouvés : deux codes que la carte publique porte et que la liste inventée
 * nomme autrement, un qu'elle porte et que la liste ne nomme pas, un que personne ne
 * porte, un nommé par la liste seule, et la même chose aux îles Féroé et au Groenland.
 */
const PROBES = {
  keyedListed: dk('0040'),
  keyedListedNoBic: dk('2000'),
  removedKey: dk('5301'),
  keyedUnlisted: dk('3000'),
  unkeyedUnlisted: dk('9999'),
  listedOnly: dk('9998'),
  foListed: fo('9990'),
  foKeyedUnlisted: fo('6460'),
  glListed: gl('9991'),
  glKeyedUnlisted: gl('6471'),
} as const;

function loadList(): void {
  const db = new Database(fixture.bicPath);
  const insert = db.prepare(
    `INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei, source, as_of)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
  );
  insert.run('DK', '0040', 'Alpha Bank A/S', 'ZZALDKKK', 'ALPHABY', SOURCE, EDITION);
  insert.run('DK', '2000', 'Beta Sparekasse', null, 'BETABY', SOURCE, EDITION);
  insert.run('DK', '9998', 'Gamma Bank A/S', 'ZZGADKKK', 'GAMMABY', SOURCE, EDITION);
  insert.run('FO', '9990', 'Delta Banki P/F', 'ZZDEFOTX', 'DELTAVIK', SOURCE, EDITION);
  insert.run('GL', '9991', 'Epsilon Bank A/S', 'ZZEPGLGX', 'EPSILONUUK', SOURCE, EDITION);
  db.close();
  resetNationalRegisterStatements();
}

function unloadList(): void {
  const db = new Database(fixture.bicPath);
  db.prepare("DELETE FROM national_bank_codes WHERE country IN ('DK', 'FO', 'GL')").run();
  db.close();
  resetNationalRegisterStatements();
}

type Answer = ReturnType<typeof answer>;
const before = new Map<string, Answer>();

describe('Denmark, Faroe Islands, Greenland: the e-nettet IBAN list, partial and private', () => {
  it('without the overlay, answers as before: the composite map, never "not consulted"', () => {
    unloadList();
    for (const [name, iban] of Object.entries(PROBES)) {
      const a = answer(iban);
      before.set(name, a);
      expect(a.bank_code_check?.reason, name).not.toBe('national_register_unavailable');
      expect(a.bank_code_check?.status, name).not.toBe('unavailable');
    }
    // Une clé publique répond comme avant : déduit de la carte composite.
    expect(before.get('keyedUnlisted')?.bank_code_check?.status).toBe('verified');
    expect(before.get('keyedUnlisted')?.bic?.basis).toBe('curated_map');
    // Un code sans clé : absent de nos données, pas un refus, pas « non consulté ».
    expect(before.get('unkeyedUnlisted')?.bank_code_check?.reason).toBe(
      'absent_from_reference_data',
    );
    expect(before.get('keyedListed')?.bic?.code).toBeTruthy();
    expect(before.get('keyedListed')?.bic?.code).not.toMatch(/^ZZ/);
    // Une clé retirée le 18/11/2026 : « absent de nos données », aucun BIC.
    expect(before.get('removedKey')?.bank_code_check?.status).toBe('not_in_register');
    expect(before.get('removedKey')?.bank_code_check?.reason).toBe('absent_from_reference_data');
    expect(before.get('removedKey')?.bank_code_check?.authoritative).toBe(false);
    expect(before.get('removedKey')?.bic).toBeNull();
  });

  it('the map keys the operator list contradicted stay out of the public map', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const map = JSON.parse(readFileSync(resolve(here, '../db/bic_data.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const contradicted = ['0216', '0400', '0580', '0620', '0710', '0860', '1551', '2650'].concat([
      '5051',
      '5301',
      '6880',
      '9070',
      '9380',
      '9860',
    ]);
    for (const code of contradicted) expect(map[`DK:${code}`], `DK:${code}`).toBeUndefined();
  });

  it('a listed code names its bank and its BIC, with the dated credit of the edition', () => {
    loadList();
    const r = check(PROBES.listedOnly);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.match).toBe('register');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bank_code_check?.register).toBe(
      `Source: ${SOURCE}, edition ${EDITION}. Partial register: the list maps the registration numbers of Danish, Faroese and Greenlandic IBANs to banks and their BICs, not the allocation of the registration-number space, so an absence is not a non-allocation`,
    );
    expect(r.bank_code_check?.as_of).toBe('2025-12');
    expect(r.bank_code_check?.institution).toEqual({
      name: 'Gamma Bank A/S',
      street: null,
      post_code: null,
      town: 'GAMMABY',
      country: 'DK',
    });
    expect(r.bank_code_holder).toBe('confirmed');
    expect(r.bic?.code).toBe('ZZGADKKK');
    expect(r.bic?.bank_name).toBe('Gamma Bank A/S');
    expect(r.bic?.city).toBe('GAMMABY');
    expect(r.bic?.source).toBe(`Source: ${SOURCE}, edition ${EDITION}`);
    expect(r.bic?.as_of).toBe('2025-12');
    expect(r.bic?.basis).toBe('national_register');
  });

  it('wins over the public key of the composite map where it lists the code, BIC included', () => {
    const r = check(PROBES.keyedListed);
    expect(r.bank_code_check?.institution?.name).toBe('Alpha Bank A/S');
    expect(r.bank_code_check?.register).toMatch(/^Source: e-nettet A\/S/);
    // One answer, one bank: the BIC is the list's, not the key it contradicts.
    expect(r.bic?.code).toBe('ZZALDKKK');
    expect(r.bic?.bank_name).toBe('Alpha Bank A/S');
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.code).not.toBe(before.get('keyedListed')?.bic?.code);
  });

  it('a listed code without a valid BIC answers bic: null, never the key the list contradicts', () => {
    const r = check(PROBES.keyedListedNoBic);
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.institution?.name).toBe('Beta Sparekasse');
    expect(before.get('keyedListedNoBic')?.bic).not.toBeNull();
    expect(r.bic).toBeNull();
  });

  it('a code the list does not carry keeps exactly the answer it had', () => {
    for (const name of [
      'keyedUnlisted',
      'unkeyedUnlisted',
      'removedKey',
      'foKeyedUnlisted',
      'glKeyedUnlisted',
    ] as const) {
      const a = answer(PROBES[name]);
      expect(a, name).toEqual(before.get(name));
      expect(a.bank_code_check?.reason, name).not.toBe('not_allocated');
    }
  });

  it('serves the Faroese and Greenlandic codes of the same list', () => {
    const f = check(PROBES.foListed);
    expect(f.bank_code_check?.institution?.name).toBe('Delta Banki P/F');
    expect(f.bank_code_check?.institution?.country).toBe('FO');
    expect(f.bic?.code).toBe('ZZDEFOTX');
    const g = check(PROBES.glListed);
    expect(g.bank_code_check?.institution?.name).toBe('Epsilon Bank A/S');
    expect(g.bic?.code).toBe('ZZEPGLGX');
    expect(g.bank_code_check?.register).toBe(f.bank_code_check?.register);
  });

  it('is partial: never settles a negative, one register name for the three countries', () => {
    for (const cc of ['DK', 'FO', 'GL']) {
      expect(nationalRegisterIsExhaustive(cc), cc).toBe(false);
      expect(registerCoverage(cc), cc).toEqual({ basis: 'partial', register: DK_REGISTER_NAME });
    }
  });

  it('withdrawn (rows gone), every answer is the one it had before the list', () => {
    unloadList();
    for (const [name, iban] of Object.entries(PROBES))
      expect(answer(iban), name).toEqual(before.get(name));
  });
});
