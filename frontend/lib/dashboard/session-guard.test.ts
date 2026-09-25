import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Chaque page du tableau de bord protégé vérifie elle-même la session, en tête,
 * avant toute lecture de données (relecture de la PR 266, 25.09.2026).
 *
 * Le gabarit `(protected)/layout.tsx` vérifie aussi la session, mais Next rend
 * le gabarit et la page en même temps : une page qui lit ses données sans sa
 * propre garde les calcule aussi pour une visite sans session. Ce test lit le
 * source de chaque `page.tsx` du groupe et exige que `requireDashboardSession()`
 * soit le premier `await` de sa fonction exportée par défaut.
 */
const PROTECTED = join(__dirname, '..', '..', 'app', '[locale]', 'dashboard', '(protected)');

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

describe('garde de session des pages protégées', () => {
  const found = pages(PROTECTED);

  it('trouve les pages du groupe protégé', () => {
    // Le compte exact n'est pas figé : une page ajoutée entre dans le test d'elle-même.
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it.each(found.map((p) => [relative(PROTECTED, p), p]))(
    '%s appelle requireDashboardSession() avant toute autre attente',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');
      const start = source.indexOf('export default async function');
      expect(start, 'fonction exportée par défaut asynchrone').toBeGreaterThanOrEqual(0);
      const body = source.slice(start);
      const guard = body.indexOf('await requireDashboardSession()');
      expect(guard, 'garde présente dans la fonction exportée').toBeGreaterThan(0);
      const firstAwait = body.search(/\bawait\b/);
      expect(firstAwait, 'la garde est la première attente').toBe(guard);
      expect(source).toMatch(/import \{[^}]*\brequireDashboardSession\b[^}]*\} from '@\/lib\/auth'/);
    },
  );
});
