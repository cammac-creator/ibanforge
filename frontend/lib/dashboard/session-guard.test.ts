import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Chaque page du tableau de bord vérifie elle-même la session, en PREMIÈRE
 * instruction, avant toute lecture de données (relecture de la PR 266,
 * 25.09.2026 ; renforcé après la relecture de sécurité de la PR 268).
 *
 * Le gabarit `(protected)/layout.tsx` vérifie aussi la session, mais Next rend
 * le gabarit et la page en même temps : une page qui lit ses données sans sa
 * propre garde les calcule aussi pour une visite sans session. Ce test lit le
 * source de chaque `page.tsx` ou `page.ts` de `dashboard/` (sauf la page de
 * connexion) et exige que le corps de sa fonction exportée par défaut COMMENCE
 * par `await requireDashboardSession();` : ni commentaire, ni lecture lancée
 * sans attente avant elle. Une page ajoutée entre dans le test d'elle-même.
 */
const DASHBOARD = join(__dirname, '..', '..', 'app', '[locale]', 'dashboard');
const PUBLIC_PAGES = new Set([join('login', 'page.tsx')]);

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' || name === 'page.ts' ? [path] : [];
  });
}

/** Le texte du corps de la fonction exportée par défaut, à partir de sa première accolade. */
function defaultExportBody(source: string): string | null {
  const head = /export default async function \w*\s*\(/.exec(source);
  if (!head) return null;
  let i = head.index + head[0].length;
  for (let depth = 1; depth > 0 && i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') depth--;
  }
  const open = source.indexOf('{', i);
  return open < 0 ? null : source.slice(open + 1);
}

describe('garde de session des pages du tableau de bord', () => {
  const found = pages(DASHBOARD).filter((p) => !PUBLIC_PAGES.has(relative(DASHBOARD, p)));

  it('trouve les pages du tableau de bord', () => {
    // Le compte exact n'est pas figé : une page ajoutée entre dans le test d'elle-même.
    expect(found.length).toBeGreaterThanOrEqual(8);
    expect(found.some((p) => p.includes(`${sep}(protected)${sep}contacts${sep}`))).toBe(true);
  });

  it.each(found.map((p) => [relative(DASHBOARD, p), p]))(
    '%s commence par await requireDashboardSession();',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');
      const body = defaultExportBody(source);
      expect(body, 'fonction exportée par défaut asynchrone').not.toBeNull();
      expect(body!.trimStart().startsWith('await requireDashboardSession();')).toBe(true);
      expect(source).toMatch(/import \{[^}]*\brequireDashboardSession\b[^}]*\} from '@\/lib\/auth'/);
    },
  );
});
