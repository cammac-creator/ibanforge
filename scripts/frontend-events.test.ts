import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseWebEvent } from '../src/lib/web-events.js';

const root = resolve(import.meta.dirname, '..');
const frontend = join(root, 'frontend');

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.next', '.git', 'coverage', 'dist'].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(path);
    return /\.(?:[cm]?[jt]sx?|mdx|html)$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}

function declaredEvents(): Set<string> {
  const paths = filesIn(frontend);
  const configPath = join(frontend, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, frontend);
  const program = ts.createProgram(
    paths.filter((p) => /\.[jt]sx?$/.test(p)),
    options,
  );
  const checker = program.getTypeChecker();
  const files = paths.filter((p) => /\.[jt]sx?$/.test(p)).map((p) => program.getSourceFile(p)!);
  const forwarded: string[] = [];
  function walk(node: ts.Node, visit: (node: ts.Node) => void) {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  }
  // Les deux composants qui transmettent une prop evt reçoivent des valeurs
  // littérales de leurs appelants. Une nouvelle construction dynamique échoue.
  for (const file of files) {
    walk(file, (node) => {
      if (
        (ts.isJsxAttribute(node) || ts.isPropertyAssignment(node)) &&
        node.name.getText(file) === 'evt'
      ) {
        const value = node.initializer;
        const expression = value && ts.isJsxExpression(value) ? value.expression : value;
        expect(expression, `${file.fileName}: evt doit rester vérifiable`).toBeDefined();
        forwarded.push(...values(expression!));
      }
    });
  }
  function values(expression: ts.Expression): string[] {
    if (ts.isStringLiteralLike(expression)) return [expression.text];
    if (ts.isTemplateExpression(expression)) {
      let result = [expression.head.text];
      for (const span of expression.templateSpans) {
        result = result.flatMap((prefix) =>
          values(span.expression).map((value) => prefix + value + span.literal.text),
        );
      }
      return result;
    }
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.expression)) {
      return [...expression.expression.text];
    }
    if (['evt', 'way.link.evt'].includes(expression.getText())) {
      expect(forwarded.length).toBeGreaterThan(0);
      return forwarded;
    }
    const type = checker.getTypeAtLocation(expression);
    const alternatives = type.isUnion() ? type.types : [type];
    return alternatives.map((item) => {
      expect(
        item.isStringLiteral(),
        `Événement dynamique à résoudre : ${expression.getText()}`,
      ).toBe(true);
      return (item as ts.StringLiteralType).value;
    });
  }
  const names = new Set<string>();
  for (const file of files) {
    walk(file, (node) => {
      if (!ts.isJsxAttribute(node) || node.name.getText(file) !== 'data-evt') return;
      const value = node.initializer;
      const expression = value && ts.isJsxExpression(value) ? value.expression : value;
      expect(expression, relative(frontend, file.fileName)).toBeDefined();
      for (const name of values(expression!)) {
        expect(
          parseWebEvent({ name, page: '/', locale: 'fr' }),
          `${relative(frontend, file.fileName)}: ${name}`,
        ).not.toBeNull();
        names.add(name);
      }
    });
  }
  // Ne pas ignorer silencieusement une nouvelle balise hors JSX.
  for (const path of paths.filter((p) => /\.(mdx|html)$/.test(p))) {
    const source = readFileSync(path, 'utf8');
    const attrs = [...source.matchAll(/\bdata-evt\s*=/g)];
    const literals = [...source.matchAll(/\bdata-evt\s*=\s*["']([^"']+)["']/g)];
    expect(literals.length, path).toBe(attrs.length);
    for (const [, name] of literals) {
      expect(parseWebEvent({ name, page: '/', locale: 'fr' }), path).not.toBeNull();
      names.add(name);
    }
  }
  return names;
}

describe('toutes les portes du site respectent le contrat du serveur', () => {
  it('accepte chaque data-evt et nomme les achats et audits dans les trois langues', () => {
    const names = declaredEvents();
    expect(names.size).toBeGreaterThan(20);
    const doors = readFileSync(
      join(frontend, 'components/dashboard/overview/landing-doors-card.tsx'),
      'utf8',
    );
    const order = [
      ...doors.match(/const DOOR_ORDER = \[([\s\S]*?)\];/)![1].matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    expect(new Set(order).size).toBe(order.length);
    const purchases = [...names].filter((name) =>
      /^cta:(buy-|oem-mail$|audit-(upload|sample|from-qr)$)/.test(name),
    );
    expect(purchases).toHaveLength(13);
    for (const locale of ['fr', 'en', 'de']) {
      const messages = JSON.parse(
        readFileSync(join(frontend, 'messages', `${locale}.json`), 'utf8'),
      );
      for (const name of purchases) {
        expect(order, name).toContain(name);
        const key = name.replace(/[^a-z0-9]/g, '_');
        for (const dictionary of [
          messages.dashboard.audience.actionNames,
          messages.dashboard.overview.fresh.doors.names,
        ]) {
          expect(dictionary[key], `${locale}: ${name}`).toBeTypeOf('string');
          expect(dictionary[key].trim().length).toBeGreaterThan(0);
          expect(dictionary[key]).not.toBe(name);
        }
      }
    }
  }, 30_000);
});
