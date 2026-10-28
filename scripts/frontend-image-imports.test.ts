import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * L'image Docker du site ne copie que `frontend/` (et CHANGELOG.md) : voir `frontend/Dockerfile`. Un fichier de
 * `frontend/` qui importe un module hors de ce dossier passe la CI (qui construit avec tout le dépôt) et la fusion
 * locale, puis fait échouer `next build` au déploiement (TS2307). Payé le 28.10.2026 : le run « Deploy site (VPS) »
 * du commit de la PR 458 est resté rouge et le site a gardé la version précédente.
 *
 * Cette garde refuse, dans les fichiers .ts, .tsx, .js, .jsx, .mjs, .cjs (et leurs variantes .mts, .cts) de
 * `frontend/`, les formes que TypeScript résout à la compilation et qui sortent de `frontend/` : import et import type,
 * export … from et export *, import() avec une chaîne littérale, import = require, typeof import('…') en position de
 * type, et /// <reference path="…" />. Les chemins relatifs et l'alias `@/` (qui pointe sur `frontend/`) sont résolus.
 * Dans un TEST, lire le code de l'API à l'exécution reste permis (readFileSync, import() d'un chemin calculé) ; une
 * page ou une route, elle, ne lit jamais hors de `frontend/` (le pré-rendu casserait dans l'image de la même façon).
 */
const root = resolve(import.meta.dirname, '..');
const frontend = join(root, 'frontend');

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.next', '.git', 'coverage', 'dist', 'out'].includes(entry.name))
      return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return /\.(?:[cm]?[jt]sx?)$/.test(path) ? [path] : [];
  });
}

/** Les spécificateurs relatifs ou en `@/` que TypeScript résout à la compilation, dans un texte source. */
export function staticSpecifiers(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // `/// <reference path="…" />` est du trivia : le visiteur ne le voit pas, le fichier source le garde à part.
  for (const ref of source.referencedFiles)
    found.push(ref.fileName.startsWith('.') ? ref.fileName : `./${ref.fileName}`);
  return found.filter((s) => s.startsWith('.') || s.startsWith('@/'));
}

/** Vrai quand le spécificateur, résolu depuis `file`, sort du dossier `frontend/`. */
export function leavesFrontend(file: string, specifier: string): boolean {
  const target = specifier.startsWith('@/')
    ? resolve(frontend, specifier.slice(2))
    : resolve(dirname(file), specifier);
  return target !== frontend && !target.startsWith(frontend + sep);
}

describe("l'image Docker du site", () => {
  it("aucun fichier de frontend/ n'importe statiquement un module hors de frontend/", () => {
    const fautes = filesIn(frontend).flatMap((file) =>
      staticSpecifiers(file, readFileSync(file, 'utf8'))
        .filter((s) => leavesFrontend(file, s))
        .map((s) => `${relative(root, file)} → ${s}`),
    );
    expect(fautes).toEqual([]);
  });

  it('la garde voit bien les formes interdites, et laisse passer la lecture à l’exécution', () => {
    const file = join(frontend, 'components', 'exemple.test.ts');
    const interdit = [
      // Une directive triple barre n'est reconnue qu'en tête de fichier, avant toute instruction.
      '/// <reference path="../../src/lib/v.d.ts" />',
      "import { A } from '../../src/lib/a';",
      "export { B } from '../../src/lib/b';",
      "const c = await import('../../src/lib/c');",
      "import d = require('../../src/lib/d');",
      "import type { T } from '../../src/lib/t';",
      "export * from '../../src/lib/y';",
      "type U = typeof import('../../src/lib/u');",
      "import { W } from '@/../src/lib/w';",
    ].join('\n');
    expect(staticSpecifiers(file, interdit).filter((s) => leavesFrontend(file, s))).toHaveLength(9);
    const permis = [
      "import { E } from './e';",
      "import { F } from '../lib/f';",
      "import { G } from '@/lib/g';",
      "type R = typeof import('react');",
      "const g = readFileSync(resolve(__dirname, '../../src/lib/g.ts'), 'utf8');",
      'const h = await import(pathToFileURL(chemin).href);',
    ].join('\n');
    expect(staticSpecifiers(file, permis).filter((s) => leavesFrontend(file, s))).toEqual([]);
  });
});
