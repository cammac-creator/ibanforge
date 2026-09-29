import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doorForPath, originForSignup, type SiteDoor } from './key-origin';

const DOORS: SiteDoor[] = [
  'site-home',
  'site-pricing',
  'site-register',
  'site-docs',
  'site-dashboard',
  'site-api-page',
  'site-signup',
];

describe('la porte par laquelle une clé est prise', () => {
  it.each([
    ['/', 'site-home'],
    ['/fr', 'site-home'],
    ['/de/', 'site-home'],
    ['/pricing', 'site-pricing'],
    ['/de/pricing', 'site-pricing'],
    ['/docs', 'site-docs'],
    ['/fr/docs/api-keys', 'site-docs'],
    ['/dashboard', 'site-dashboard'],
    ['/en/account', 'site-dashboard'],
    ['/iban-validation-api', 'site-api-page'],
    ['/de/iban-validation-api', 'site-api-page'],
    ['/fr/iban-validation-api', 'site-api-page'],
    ['/blog/2026-08-26-choosing-an-iban-validation-api', 'site-signup'],
    // Les pages des codes bancaires publiables, index compris, dans les trois langues.
    ['/blz', 'site-register'],
    ['/blz/12345678', 'site-register'],
    ['/de/blz/12345678', 'site-register'],
    ['/fr/iid/00001', 'site-register'],
    ['/iid', 'site-register'],
    ['/sk/0000', 'site-register'],
    ['/fr/it/00001', 'site-register'],
    ['/de/sk', 'site-register'],
    // Les registres sous conditions gardent la porte qu'ils avaient : rien de
    // plus sur ces pages, et le pilote de mesure autrichien garde sa série.
    ['/at/12345', 'site-signup'],
    ['/de/be/000', 'site-signup'],
    ['/sm/00000', 'site-signup'],
    // Une page pays n'est pas une page de code.
    ['/iban/de', 'site-signup'],
    ['/fr/iban/it', 'site-signup'],
  ])('%s → %s', (path, expected) => {
    expect(doorForPath(path)).toBe(expected);
  });

  it('ne prend jamais le segment pays d’une page anglaise pour une langue', () => {
    // 🚨 L'anglais vit à la racine : `/it/…` et `/sk/…` sont des pages anglaises
    // de codes italiens et slovaques. L'ancien motif (deux lettres quelconques)
    // avalait ce segment et rendait `/00001`, donc la porte générique.
    expect(doorForPath('/it/00001')).toBe('site-register');
    expect(doorForPath('/it')).toBe('site-register');
    expect(doorForPath('/sk/0000')).toBe('site-register');
    // Les vrais préfixes de langue restent retirés.
    expect(doorForPath('/fr/pricing')).toBe('site-pricing');
    expect(doorForPath('/de')).toBe('site-home');
    expect(doorForPath('/en/docs')).toBe('site-docs');
  });

  it('les pages de codes passent la porte au dialogue sans étiquette de campagne', () => {
    expect(originForSignup(null, '/blz/12345678')).toBe('site-register');
    expect(originForSignup('npm-mcp', '/blz/12345678')).toBe('npm-mcp');
  });

  it('une étiquette de campagne passe avant la porte, sinon la porte', () => {
    expect(originForSignup('npm-mcp', '/pricing')).toBe('npm-mcp');
    expect(originForSignup(null, '/pricing')).toBe('site-pricing');
    expect(originForSignup('', '/docs')).toBe('site-docs');
    expect(originForSignup(undefined, '/')).toBe('site-home');
    expect(originForSignup(undefined, '/blog')).toBe('site-signup');
  });

  it('chaque porte du site existe dans le vocabulaire de l’API', () => {
    // 🚨 Le piège que ce test ferme : le site peut inventer un nom, l'API le
    // stocke sans broncher (la validation ne juge que la FORME), et le
    // tableau de bord affiche une porte qui n'appartient à aucune liste. Le
    // vocabulaire de référence est src/lib/key-origins.ts, jamais ce fichier.
    const vocabulary = readFileSync(resolve(process.cwd(), '../src/lib/key-origins.ts'), 'utf8');
    for (const door of DOORS) {
      expect(vocabulary, door).toContain(`'${door}'`);
    }
  });
});
