import { describe, it, expect } from 'vitest';
import { normalizeIdentifier, classifyBicInput, classifyIidInput } from './input-normalize.js';

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
});
