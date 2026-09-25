import { describe, it, expect } from 'vitest';
import { validate } from 'iban-core';
import { checkSpanishDc, computeSpanishDc } from './es-dc.js';

/**
 * Vecteurs fabriqués (chiffre altéré, cas 11 → 0 et 10 → 1, collision des
 * restes 1 et 10) calculés le 24.09.2026 par schwifty 2025.9.0, pas par le
 * code testé ; chaque IBAN porte des chiffres ISO justes (`validate` le prouve).
 */
const bbanOf = (iban: string) => iban.slice(4);
const isoValid = (iban: string) => validate(iban).valid;

describe('DC espagnol : exemples publiés', () => {
  it('l’exemple officiel du registre IBAN de SWIFT passe', () => {
    const iban = 'ES9121000418450200051332';
    expect(isoValid(iban)).toBe(true);
    expect(checkSpanishDc('ES', bbanOf(iban))).toEqual({
      country: 'ES',
      scheme: 'es_dc',
      status: 'pass',
    });
  });

  it('l’exemple de la source (0049-1500-05-1234567892) passe', () => {
    expect(computeSpanishDc('0049', '1500', '1234567892')).toBe('05');
    const iban = 'ES6000491500051234567892';
    expect(isoValid(iban)).toBe(true);
    expect(checkSpanishDc('ES', bbanOf(iban)).status).toBe('pass');
  });
});

describe('DC espagnol : les deux cas particuliers', () => {
  it('un reste nul donne 11, écrit 0', () => {
    // 00 + 0001 + 0002 : somme pondérée multiple de 11.
    expect(computeSpanishDc('0001', '0002', '0000000000')).toBe('00');
  });

  it('un reste de 1 donne 10, écrit 1', () => {
    expect(computeSpanishDc('0001', '0004', '0000000000')).toBe('10');
  });

  it('les restes 1 et 10 donnent le même chiffre : deux comptes différents partagent leur DC', () => {
    // 0000000002 : somme 6 × 2 = 12, reste 1 → 10 → 1.
    // 0000000009 : somme 6 × 9 = 54, reste 10 → 1.
    expect(computeSpanishDc('2100', '0418', '0000000002')).toBe('41');
    expect(computeSpanishDc('2100', '0418', '0000000009')).toBe('41');
  });
});

describe('DC espagnol : ce qui doit échouer', () => {
  it('un chiffre du compte altéré échoue, alors que l’IBAN passe le modulo 97', () => {
    // 0200051332 devient 0200051333 ; chiffres ISO recalculés.
    const iban = 'ES6421000418450200051333';
    expect(isoValid(iban)).toBe(true);
    const result = checkSpanishDc('ES', bbanOf(iban));
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/cannot have been issued as written/);
  });

  it('un DC modifié échoue', () => {
    expect(checkSpanishDc('ES', '21000418460200051332').status).toBe('fail');
  });

  it.each([
    ['trop court', '2100041845020005133'],
    ['lettre', '2100041845020005133A'],
  ])('un BBAN sans la forme espagnole (%s) n’est pas jugé', (_, bban) => {
    const result = checkSpanishDc('ES', bban);
    expect(result.status).toBe('not_applicable');
    expect(result.detail).toMatch(/could not be computed/);
  });
});
