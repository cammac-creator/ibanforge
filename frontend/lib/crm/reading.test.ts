import { describe, expect, it } from 'vitest';
import { LANG_LABEL, langName, previewReading, usableLang } from './reading';

describe('usableLang', () => {
  it('garde un code de deux ou trois lettres', () => {
    expect(usableLang('en')).toBe('en');
    expect(usableLang('fil')).toBe('fil');
  });

  it('refuse « und », le vide, les gabarits et les majuscules', () => {
    // « und » est ce que le robot range quand il n'y avait rien à lire ; un
    // gabarit recopié par le modèle a déjà été stocké comme langue.
    for (const bad of ['und', '', null, undefined, '<iso-639-1>', 'EN', 'e']) {
      expect(usableLang(bad)).toBeNull();
    }
  });
});

describe('langName', () => {
  it('dit la langue en français', () => {
    expect(langName('en')).toBe('anglais');
    expect(langName('de')).toBe('allemand');
    expect(langName('fr')).toBe('français');
  });

  it('retombe sur le code pour une langue que la table ne connaît pas', () => {
    expect(langName('xh')).toBe('xh');
  });

  it('nomme en toutes lettres les langues de la table, au lieu de leur code', () => {
    for (const code of ['en', 'de', 'it', 'es', 'zh', 'et', 'ca', 'ka']) {
      expect(LANG_LABEL[code], code).toBeTruthy();
    }
  });
});

describe('previewReading', () => {
  it('lit la traduction française d’un message étranger, et le dit', () => {
    expect(previewReading({ lang: 'en', snippet: 'Thanks', snippet_fr: 'Merci' })).toEqual({
      lang: 'en',
      translated: true,
      untranslated: false,
      text: 'Merci',
    });
  });

  it('montre l’original, signalé, tant que la traduction manque', () => {
    expect(previewReading({ lang: 'en', snippet: 'Thanks', snippet_fr: null })).toEqual({
      lang: 'en',
      translated: false,
      untranslated: true,
      text: 'Thanks',
    });
  });

  it('tient une traduction vide pour absente', () => {
    expect(previewReading({ lang: 'de', snippet: 'Danke', snippet_fr: '   ' })).toMatchObject({
      translated: false,
      untranslated: true,
      text: 'Danke',
    });
  });

  it('laisse un message français tel quel', () => {
    expect(previewReading({ lang: 'fr', snippet: 'Bonjour', snippet_fr: null })).toEqual({
      lang: 'fr',
      translated: false,
      untranslated: false,
      text: 'Bonjour',
    });
  });

  it('ne se fie jamais à une traduction sans langue exploitable', () => {
    expect(previewReading({ lang: 'und', snippet: 'x', snippet_fr: 'y' })).toEqual({
      lang: null,
      translated: false,
      untranslated: false,
      text: 'x',
    });
  });
});
