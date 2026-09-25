import { describe, it, expect } from 'vitest';
import { validate } from 'iban-core';
import { checkFrenchRibKey, computeRibKey, RIB_LETTER_VALUES } from './fr-rib.js';

/**
 * Les vecteurs fabriqués ci-dessous (lettre S, lettres jumelles, chiffre
 * altéré, clé 97) ont été calculés le 24.09.2026 par une implémentation
 * indépendante, la bibliothèque Python schwifty 2025.9.0, et non par le code
 * testé. Chaque IBAN altéré porte des chiffres ISO recalculés : il passe le
 * modulo 97, ce qui est exactement le cas où la clé nationale apporte quelque
 * chose. `validate` d'iban-core le prouve dans chaque test.
 */
const bbanOf = (iban: string) => iban.slice(4);
const isoValid = (iban: string) => validate(iban).valid;

describe('clé RIB : exemples du registre IBAN de SWIFT', () => {
  it.each([
    ['FR', 'FR1420041010050500013M02606'],
    ['MC', 'MC5811222000010123456789030'],
  ])('%s : l’exemple officiel %s passe', (country, iban) => {
    expect(isoValid(iban)).toBe(true);
    expect(checkFrenchRibKey(country, bbanOf(iban))).toEqual({
      country,
      scheme: 'fr_rib_key',
      status: 'pass',
    });
  });
});

describe('clé RIB : conversion des lettres du numéro de compte', () => {
  it('suit la table publiée, avec le saut entre R (9) et S (2)', () => {
    expect(RIB_LETTER_VALUES).toMatchObject({ A: '1', J: '1', I: '9', R: '9', S: '2', Z: '9' });
    expect(Object.keys(RIB_LETTER_VALUES)).toHaveLength(26);
  });

  it('S vaut 2 comme B, et non 1 comme A : une réécriture naïve se trompe de clé', () => {
    expect(computeRibKey('30004', '00567', '0000S012345')).toBe('39');
    expect(computeRibKey('30004', '00567', '0000B012345')).toBe('39');
    expect(computeRibKey('30004', '00567', '0000A012345')).toBe('23');
    const iban = 'FR5030004005670000S01234539';
    expect(isoValid(iban)).toBe(true);
    expect(checkFrenchRibKey('FR', bbanOf(iban)).status).toBe('pass');
  });

  it('ne voit pas l’échange de deux lettres jumelles (M et D valent 4) : pass ne veut pas dire « existe »', () => {
    // L'exemple officiel, avec M remplacé par D et les chiffres ISO recalculés.
    const iban = 'FR5920041010050500013D02606';
    expect(isoValid(iban)).toBe(true);
    expect(checkFrenchRibKey('FR', bbanOf(iban)).status).toBe('pass');
  });
});

describe('clé RIB : ce qui doit échouer', () => {
  it('un chiffre du compte altéré échoue, alors que l’IBAN passe le modulo 97', () => {
    // 0500013M026 devient 0500014M026 ; chiffres ISO recalculés.
    const iban = 'FR9620041010050500014M02606';
    expect(isoValid(iban)).toBe(true);
    const result = checkFrenchRibKey('FR', bbanOf(iban));
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/cannot have been issued as written/);
  });

  it('Monaco échoue de la même manière et reste Monaco', () => {
    const iban = 'MC7411222000010123456789130';
    expect(isoValid(iban)).toBe(true);
    expect(checkFrenchRibKey('MC', bbanOf(iban))).toMatchObject({
      country: 'MC',
      scheme: 'fr_rib_key',
      status: 'fail',
    });
  });

  it('chaque chiffre altéré, à chaque position, fait échouer la clé (97 est premier)', () => {
    const bban = bbanOf('FR1420041010050500013M02606');
    for (let i = 0; i < bban.length; i++) {
      if (!/\d/.test(bban[i])) continue;
      for (let d = 0; d <= 9; d++) {
        if (String(d) === bban[i]) continue;
        const altered = bban.slice(0, i) + d + bban.slice(i + 1);
        expect(checkFrenchRibKey('FR', altered).status, `position ${i}, chiffre ${d}`).toBe('fail');
      }
    }
  });
});

describe('clé RIB : les bornes', () => {
  it('un reste nul donne la clé 97, et 00 échoue alors que le modulo 97 ne voit aucune différence', () => {
    expect(computeRibKey('20041', '01005', '00000000047')).toBe('97');
    const withKey97 = 'FR7620041010050000000004797';
    const withKey00 = 'FR7620041010050000000004700';
    // 97 ≡ 0 (mod 97) : les deux IBAN ont les mêmes chiffres ISO et passent tous deux.
    expect(isoValid(withKey97)).toBe(true);
    expect(isoValid(withKey00)).toBe(true);
    expect(checkFrenchRibKey('FR', bbanOf(withKey97)).status).toBe('pass');
    expect(checkFrenchRibKey('FR', bbanOf(withKey00)).status).toBe('fail');
  });

  it.each([
    ['trop court', '20041010050500013M026'],
    ['lettre dans le code banque', '2004A010050500013M02606'],
    ['lettre dans la clé', '20041010050500013M026A6'],
    ['caractère hors table', '20041010050500013-02606'],
  ])('un BBAN sans la forme française (%s) n’est pas jugé', (_, bban) => {
    const result = checkFrenchRibKey('FR', bban);
    expect(result.status).toBe('not_applicable');
    expect(result.detail).toMatch(/could not be computed/);
  });
});
