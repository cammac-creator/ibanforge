import { describe, it, expect } from 'vitest';
import { validate } from 'iban-core';
import { checkItalianCin, computeItalianCin, CIN_ODD_VALUES } from './it-cin.js';

/**
 * Vecteurs fabriqués (chiffre altéré, alias 0/A, IBAN de l'exemple de
 * Rodichevski) calculés le 24.09.2026 par schwifty 2025.9.0, pas par le code
 * testé ; chaque IBAN porte des chiffres ISO justes (`validate` le prouve).
 */
const bbanOf = (iban: string) => iban.slice(4);
const isoValid = (iban: string) => validate(iban).valid;

describe('CIN : exemples publiés', () => {
  it.each([
    ['IT', 'IT60X0542811101000000123456'],
    ['SM', 'SM86U0322509800000000270100'],
  ])('%s : l’exemple officiel %s passe', (country, iban) => {
    expect(isoValid(iban)).toBe(true);
    expect(checkItalianCin(country, bbanOf(iban))).toEqual({
      country,
      scheme: 'it_cin',
      status: 'pass',
    });
  });

  it('l’exemple de la source (Q0123412345000000753XYZ, somme 146, CIN Q) passe, lettres comprises', () => {
    // Les lettres X, Y, Z tombent sur des positions paires ET impaires.
    expect(computeItalianCin('01234', '12345', '000000753XYZ')).toBe('Q');
    const iban = 'IT60Q0123412345000000753XYZ';
    expect(isoValid(iban)).toBe(true);
    expect(checkItalianCin('IT', bbanOf(iban)).status).toBe('pass');
  });

  it('la table des positions impaires est une permutation de 0 à 25', () => {
    expect([...CIN_ODD_VALUES].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 26 }, (_, i) => i),
    );
  });
});

describe('CIN : ce qui doit échouer', () => {
  it('un chiffre du code agence altéré échoue, alors que l’IBAN passe le modulo 97', () => {
    // CAB 11101 devient 11102 ; chiffres ISO recalculés.
    const iban = 'IT68X0542811102000000123456';
    expect(isoValid(iban)).toBe(true);
    const result = checkItalianCin('IT', bbanOf(iban));
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/cannot have been issued as written/);
  });

  it('Saint-Marin échoue de la même manière et reste Saint-Marin', () => {
    const iban = 'SM59U0322509800000000270101';
    expect(isoValid(iban)).toBe(true);
    expect(checkItalianCin('SM', bbanOf(iban))).toMatchObject({
      country: 'SM',
      scheme: 'it_cin',
      status: 'fail',
    });
  });

  it('chaque chiffre altéré, à chaque position après le CIN, fait échouer le contrôle', () => {
    const bban = bbanOf('IT60X0542811101000000123456');
    for (let i = 1; i < bban.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === bban[i]) continue;
        const altered = bban.slice(0, i) + d + bban.slice(i + 1);
        expect(checkItalianCin('IT', altered).status, `position ${i}, chiffre ${d}`).toBe('fail');
      }
    }
  });

  it('une autre lettre de contrôle échoue', () => {
    expect(checkItalianCin('IT', 'Y0542811101000000123456').status).toBe('fail');
  });
});

describe('CIN : les limites', () => {
  it('ne voit pas un 0 remplacé par un A dans le compte (même code) : pass ne veut pas dire « existe »', () => {
    const iban = 'IT40X054281110100000A123456';
    expect(isoValid(iban)).toBe(true);
    expect(checkItalianCin('IT', bbanOf(iban)).status).toBe('pass');
  });

  it.each([
    ['trop court', 'X054281110100000012345'],
    ['chiffre à la place du CIN', '10542811101000000123456'],
    ['lettre dans l’ABI', 'X05A2811101000000123456'],
  ])('un BBAN sans la forme italienne (%s) n’est pas jugé', (_, bban) => {
    const result = checkItalianCin('IT', bban);
    expect(result.status).toBe('not_applicable');
    expect(result.detail).toMatch(/could not be computed/);
  });
});
