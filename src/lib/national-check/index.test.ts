import { describe, it, expect } from 'vitest';
import { validate } from 'iban-core';
import { checkNationalKey, NATIONAL_CHECK_SCHEMES } from './index.js';

/** Les exemples officiels du registre IBAN de SWIFT pour les pays couverts. */
const REGISTRY_EXAMPLES: Array<[string, string, string]> = [
  ['FR', 'fr_rib_key', 'FR1420041010050500013M02606'],
  ['MC', 'fr_rib_key', 'MC5811222000010123456789030'],
  ['BE', 'be_mod97', 'BE68539007547034'],
  ['IT', 'it_cin', 'IT60X0542811101000000123456'],
  ['SM', 'it_cin', 'SM86U0322509800000000270100'],
  ['ES', 'es_dc', 'ES9121000418450200051332'],
];

describe('checkNationalKey : les pays couverts', () => {
  it.each(REGISTRY_EXAMPLES)('%s (%s) : l’exemple officiel passe', (country, scheme, iban) => {
    expect(validate(iban).valid).toBe(true);
    expect(checkNationalKey(iban)).toEqual({ country, scheme, status: 'pass' });
  });

  it('la table des pays est exactement celle-ci', () => {
    expect(NATIONAL_CHECK_SCHEMES).toEqual({
      FR: 'fr_rib_key',
      MC: 'fr_rib_key',
      BE: 'be_mod97',
      IT: 'it_cin',
      SM: 'it_cin',
      ES: 'es_dc',
    });
  });

  it('normalise comme iban-core : espaces, tirets, minuscules', () => {
    expect(checkNationalKey('fr14 2004 1010 0505 0001 3m02 606')).toEqual({
      country: 'FR',
      scheme: 'fr_rib_key',
      status: 'pass',
    });
    expect(checkNationalKey('BE68-5390-0754-7034')?.status).toBe('pass');
  });

  it('lit le BBAN brut et non les champs analysés par iban-core', () => {
    // iban-core range la clé RIB et le DC dans account_number, et saute le
    // CIN : si le module lisait ces champs, ces exemples échoueraient.
    for (const [, , iban] of REGISTRY_EXAMPLES) {
      expect(checkNationalKey(iban)?.status).toBe('pass');
    }
    expect(validate('FR1420041010050500013M02606').bban?.account_number).toBe('0500013M02606');
  });

  it('un IBAN altéré mais valide au modulo 97 échoue dans chaque pays couvert', () => {
    for (const iban of [
      'FR9620041010050500014M02606',
      'MC7411222000010123456789130',
      'BE34539007548034',
      'IT68X0542811102000000123456',
      'SM59U0322509800000000270101',
      'ES6421000418450200051333',
    ]) {
      expect(validate(iban).valid, iban).toBe(true);
      expect(checkNationalKey(iban)?.status, iban).toBe('fail');
    }
  });
});

describe('checkNationalKey : les pays sans algorithme n’ont pas de bloc', () => {
  it.each([
    'DE89370400440532013000',
    'CH9300762011623852957',
    'GB29NWBK60161331926819',
    'NL91ABNA0417164300',
    'AT611904300234573201',
    'VA59001123000012345678',
    'PT50000201231234567890154',
  ])('%s : null, jamais un faux not_applicable', (iban) => {
    expect(checkNationalKey(iban)).toBeNull();
  });

  it('les anciens préfixes des territoires français ne sont pas acceptés', () => {
    // iban-core les refuse comme pays inconnus ; le module ne les juge pas.
    expect(validate('GF4120041010050500013M02606').valid).toBe(false);
    expect(checkNationalKey('GF4120041010050500013M02606')).toBeNull();
  });

  it('une entrée vide ou absurde rend null sans lever d’erreur', () => {
    expect(checkNationalKey('')).toBeNull();
    expect(checkNationalKey('??')).toBeNull();
    expect(checkNationalKey('constructor')).toBeNull();
  });

  it('un pays couvert au BBAN tronqué donne not_applicable, jamais un verdict', () => {
    expect(checkNationalKey('FR14200410100505')).toMatchObject({
      country: 'FR',
      status: 'not_applicable',
    });
  });
});
