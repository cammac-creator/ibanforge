import { describe, it, expect } from 'vitest';
import {
  normalizeIdentifier,
  classifyBicInput,
  classifyFrnInput,
  classifyIidInput,
} from './input-normalize.js';

describe('normalizeIdentifier', () => {
  it('retire les séparateurs que les agents recopient et passe en majuscules', () => {
    expect(normalizeIdentifier('UBSW CHZH')).toBe('UBSWCHZH');
    expect(normalizeIdentifier('ubsw-chzh')).toBe('UBSWCHZH');
    expect(normalizeIdentifier(' ubsw.chzh ')).toBe('UBSWCHZH');
  });
});

describe('classifyBicInput', () => {
  it('rend null quand la route actuelle accepte déjà l’entrée', () => {
    expect(classifyBicInput('UBSWCHZH')).toBeNull();
    expect(classifyBicInput('ubswchzh')).toBeNull();
  });
  it('repère le placeholder OpenAPI', () => {
    expect(classifyBicInput('{code}')).toBe('placeholder_literal');
  });
  it('marque normalizable ce que la phase 2 réparera', () => {
    expect(classifyBicInput('UBSW CHZH')).toBe('normalizable');
    expect(classifyBicInput('UBSW-CHZH')).toBe('normalizable');
  });
  it('distingue trop court, trop long et jeu de caractères', () => {
    expect(classifyBicInput('UBS')).toBe('too_short');
    expect(classifyBicInput('UBSWCHZHXXXXXX')).toBe('too_long');
    expect(classifyBicInput('UBSWCHZ!')).toBe('invalid_charset');
  });
  it('distingue une longueur invalide d’un jeu de caractères invalide', () => {
    expect(classifyBicInput('UBSWCHZHX')).toBe('invalid_length');
    expect(classifyBicInput('UBSWCHZHXX')).toBe('invalid_length');
    expect(classifyBicInput('UBSWCHZ!')).toBe('invalid_charset');
  });
  it('ne compte pas un nom de banque comme un identifiant trop long', () => {
    expect(classifyBicInput('UBS Switzerland AG')).toBe('not_an_identifier');
    // Sans séparateur, la longueur reste la vraie explication du rejet.
    expect(classifyBicInput('UBSSWITZERLANDAG')).toBe('too_long');
  });
});

describe('classifyIidInput', () => {
  it('rend null quand la route actuelle accepte déjà', () => {
    expect(classifyIidInput('230')).toBeNull();
    expect(classifyIidInput('00230')).toBeNull();
  });
  it('repère le placeholder', () => {
    expect(classifyIidInput('{iid}')).toBe('placeholder_literal');
  });
  it('marque normalizable un IID préfixé ou espacé', () => {
    expect(classifyIidInput('CH230')).toBe('normalizable');
    expect(classifyIidInput(' 230 ')).toBe('normalizable');
  });
  it('distingue non numérique et trop long', () => {
    expect(classifyIidInput('UBS')).toBe('not_numeric');
    expect(classifyIidInput('123456789')).toBe('too_long');
  });
  it('tolère un préfixe CH et des séparateurs', () => {
    expect(classifyIidInput('CH230')).toBe('normalizable');
    expect(classifyIidInput('CH-230')).toBe('normalizable');
    expect(classifyIidInput(' 230 ')).toBe('normalizable');
  });
  it('refuse de deviner un IID noyé dans du texte', () => {
    expect(classifyIidInput('230 Zurich')).toBe('not_an_identifier');
    expect(classifyIidInput('account-230-CHF')).toBe('not_an_identifier');
  });
  it('range le même déchet dans le même seau, quel que soit le nombre de chiffres', () => {
    expect(classifyIidInput('account-230-CHF')).toBe('not_an_identifier');
    expect(classifyIidInput('account-230-CHF-2026')).toBe('not_an_identifier');
  });
  it('garde invalid_charset pour un cafouillage sans séparateur', () => {
    expect(classifyIidInput('a1b2c3')).toBe('invalid_charset');
  });
});

describe('classifyFrnInput', () => {
  it('rend null sur ce que la route accepte déjà : 6 ou 7 chiffres', () => {
    expect(classifyFrnInput('123456')).toBeNull();
    expect(classifyFrnInput('1234567')).toBeNull();
  });
  it('reconnaît le gabarit OpenAPI collé tel quel', () => {
    expect(classifyFrnInput('{frn}')).toBe('placeholder_literal');
  });
  it('compte comme normalisable ce qu’un agent recopie du registre', () => {
    expect(classifyFrnInput('FRN 123456')).toBe('normalizable');
    expect(classifyFrnInput('123 456')).toBe('normalizable');
    expect(classifyFrnInput('123-456')).toBe('normalizable');
  });
  it('refuse une référence d’individu : lettres en tête, jamais transmise au registre', () => {
    expect(classifyFrnInput('ABC01234')).toBe('invalid_charset');
  });
  it('sépare trop court, trop long, non numérique et texte libre', () => {
    expect(classifyFrnInput('12345')).toBe('too_short');
    expect(classifyFrnInput('12345678')).toBe('too_long');
    expect(classifyFrnInput('abcdef')).toBe('not_numeric');
    expect(classifyFrnInput('firm 123456 london')).toBe('not_an_identifier');
  });
});
