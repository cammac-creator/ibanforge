import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WEB-03 (audit du 10.11.2026) : /fr/famille chargeait ses polices chez Google
 * (une feuille sur fonts.googleapis.com, les fichiers sur fonts.gstatic.com).
 * La règle de sécurité du contenu, désormais appliquée, ne permet les polices et
 * les feuilles que depuis le site, et chaque visiteur était annoncé à Google.
 * Les polices passent par next/font, téléchargées à la construction et servies
 * par le site, comme celles du layout racine.
 *
 * Ce test lit les sources : next/font ne s'exécute qu'à la compilation de Next.
 */

const FRONTEND = resolve(import.meta.dirname, '../../..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|mdx|css)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe('polices de /fr/famille', () => {
  it('aucune page ni composant ne charge de police chez Google ; la maquette prend les siennes par next/font', () => {
    const offenders = ['app', 'components', 'content']
      .flatMap((d) => sources(join(FRONTEND, d)))
      .filter((file) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(FRONTEND, file));
    expect(offenders).toEqual([]);

    const page = readFileSync(join(FRONTEND, 'app/[locale]/famille/page.tsx'), 'utf8');
    expect(page).toMatch(/import \{ Bricolage_Grotesque, Familjen_Grotesk \} from "next\/font\/google"/);
    // Les trois variables de la maquette reçoivent le nom réel de chaque famille.
    expect(page).toMatch(/--font-display:\$\{bricolage\.style\.fontFamily\}/);
    expect(page).toMatch(/--font-body:\$\{familjen\.style\.fontFamily\}/);
    expect(page).toMatch(/--font-mono:var\(--font-jetbrains-mono\)/);
  });
});
