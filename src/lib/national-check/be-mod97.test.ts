import { describe, it, expect } from 'vitest';
import { validate } from 'iban-core';
import { checkBelgianMod97, computeBelgianCheckDigits } from './be-mod97.js';

/**
 * Vecteurs fabriqués (clé 97, chiffre altéré) calculés le 24.09.2026 par
 * schwifty 2025.9.0, pas par le code testé ; chaque IBAN altéré porte des
 * chiffres ISO recalculés et passe le modulo 97 (`validate` le prouve).
 */
const bbanOf = (iban: string) => iban.slice(4);
const isoValid = (iban: string) => validate(iban).valid;

describe('Belgique : exemples publiés', () => {
  it('l’exemple officiel du registre IBAN de SWIFT passe', () => {
    const iban = 'BE68539007547034';
    expect(isoValid(iban)).toBe(true);
    expect(checkBelgianMod97('BE', bbanOf(iban))).toEqual({
      country: 'BE',
      scheme: 'be_mod97',
      status: 'pass',
    });
  });

  it.each([
    ['091-0122401-16', 'BE72091012240116', 'exemple de la page néerlandaise de Wikipédia'],
    ['068-2492526-41', 'BE88068249252641', 'exemple repris par plusieurs guides comptables belges'],
  ])('le numéro %s (%s, %s) passe', (_, iban) => {
    expect(isoValid(iban)).toBe(true);
    expect(checkBelgianMod97('BE', bbanOf(iban)).status).toBe('pass');
  });
});

describe('Belgique : ce qui doit échouer', () => {
  it('un chiffre du compte altéré échoue, alors que l’IBAN passe le modulo 97', () => {
    // 539-0075470-34 devient 539-0075480-34 ; chiffres ISO recalculés.
    const iban = 'BE34539007548034';
    expect(isoValid(iban)).toBe(true);
    const result = checkBelgianMod97('BE', bbanOf(iban));
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/cannot have been issued as written/);
  });

  it('chaque chiffre altéré, à chaque position, fait échouer la clé', () => {
    const bban = bbanOf('BE68539007547034');
    for (let i = 0; i < bban.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === bban[i]) continue;
        const altered = bban.slice(0, i) + d + bban.slice(i + 1);
        expect(checkBelgianMod97('BE', altered).status, `position ${i}, chiffre ${d}`).toBe('fail');
      }
    }
  });
});

describe('Belgique : les bornes', () => {
  it('un reste nul donne la clé 97, et 00 échoue alors que le modulo 97 ne voit aucune différence', () => {
    expect(computeBelgianCheckDigits('3100000011')).toBe('97');
    const withKey97 = 'BE54310000001197';
    const withKey00 = 'BE54310000001100';
    expect(isoValid(withKey97)).toBe(true);
    expect(isoValid(withKey00)).toBe(true);
    expect(checkBelgianMod97('BE', bbanOf(withKey97)).status).toBe('pass');
    expect(checkBelgianMod97('BE', bbanOf(withKey00)).status).toBe('fail');
  });

  it('une clé à un chiffre s’écrit avec son zéro', () => {
    expect(computeBelgianCheckDigits('0000000001')).toBe('01');
  });

  it.each([
    ['trop court', '53900754703'],
    ['trop long', '5390075470341'],
    ['lettre', '53900754A034'],
  ])('un BBAN sans la forme belge (%s) n’est pas jugé', (_, bban) => {
    const result = checkBelgianMod97('BE', bban);
    expect(result.status).toBe('not_applicable');
    expect(result.detail).toMatch(/could not be computed/);
  });
});
