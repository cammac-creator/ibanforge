import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doorForPath, originForSignup, type SiteDoor } from './key-origin';

const DOORS: SiteDoor[] = ['site-pricing', 'site-docs', 'site-dashboard', 'site-signup'];

describe('la porte par laquelle une clé est prise', () => {
  it.each([
    ['/', 'site-signup'],
    ['/fr', 'site-signup'],
    ['/pricing', 'site-pricing'],
    ['/de/pricing', 'site-pricing'],
    ['/docs', 'site-docs'],
    ['/fr/docs/api-keys', 'site-docs'],
    ['/dashboard', 'site-dashboard'],
    ['/en/account', 'site-dashboard'],
    ['/blog/2026-08-26-choosing-an-iban-validation-api', 'site-signup'],
  ])('%s → %s', (path, expected) => {
    expect(doorForPath(path)).toBe(expected);
  });

  it('une étiquette de campagne passe avant la porte, sinon la porte', () => {
    expect(originForSignup('npm-mcp', '/pricing')).toBe('npm-mcp');
    expect(originForSignup(null, '/pricing')).toBe('site-pricing');
    expect(originForSignup('', '/docs')).toBe('site-docs');
    expect(originForSignup(undefined, '/')).toBe('site-signup');
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
