import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SITE_SERVER_KEY_ROUTES } from './rate-limit.js';

/**
 * Les routes où la clé serveur du site passe le limiteur (`SITE_SERVER_KEY_ROUTES`)
 * tenues contre les appels réels, sur le modèle de `src/lib/admin-auth.site.test.ts`
 * (relecture de la PR 613, C23) :
 *
 *  - le playground du site, `frontend/app/api/playground/route.ts` ;
 *  - les pages de registre, `frontend/lib/register-live.ts` ;
 *  - le relais de l'API, `src/routes/playground.ts`.
 *
 * Une route appelée par l'un d'eux et absente de la liste ferait compter les
 * appels du site par adresse (429 pour tous les visiteurs à la fois) ; une route
 * de la liste que personne n'appelle exempterait la clé là où elle n'a rien à
 * faire. Les deux font échouer ce test.
 *
 * Comment un appel est lu (arbre syntaxique de TypeScript, jamais les
 * commentaires) : un littéral dont le texte COMMENCE par `/v1/`, ou un gabarit
 * dont un seul trou de tête (l'adresse de base) précède `/v1/`. Un trou qui
 * occupe un segment entier devient `:param`. La méthode est lue, dans l'ordre :
 *
 *  - dans l'objet qui porte le chemin (`{ path: '/v1/…', method: 'GET' }`) ;
 *  - dans un objet passé au même appel (`fetch(url, { method: 'POST' })`) ;
 *  - dans le bloc où le chemin est affecté (`apiPath = '/v1/…'` puis
 *    `fetchOptions = { method: 'POST', … }`), qui doit porter une seule méthode.
 *
 * Toute autre forme est « illisible », et fait échouer le test : on l'écrit en
 * clair plutôt que de laisser une route passer sans être comptée.
 */

const root = resolve(import.meta.dirname, '../..');

export const SITE_KEY_CALLERS = [
  'frontend/app/api/playground/route.ts',
  'frontend/lib/register-live.ts',
  'src/routes/playground.ts',
] as const;

type Part = string | ts.Expression;

function partsOf(node: ts.Node): Part[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    const parts: Part[] = [node.head.text];
    for (const span of node.templateSpans) parts.push(span.expression, span.literal.text);
    return parts;
  }
  return null;
}

/** Le chemin d'API d'un littéral, `unreadable`, ou `null` s'il n'en porte pas. */
function apiPath(node: ts.Node): string | 'unreadable' | null {
  const parts = partsOf(node);
  if (!parts) return null;
  let rest: Part[];
  if (typeof parts[0] === 'string' && parts[0].startsWith('/v1/')) rest = parts;
  else if (
    parts[0] === '' &&
    parts.length >= 3 &&
    typeof parts[2] === 'string' &&
    parts[2].startsWith('/v1/')
  )
    rest = parts.slice(2);
  else return null;
  let path = '';
  for (let i = 0; i < rest.length; i++) {
    const part = rest[i];
    if (typeof part === 'string') {
      if (/[?#]/.test(part)) return 'unreadable';
      path += part;
      continue;
    }
    const next = rest[i + 1];
    // Un trou n'est admis que s'il occupe un segment entier.
    if (!path.endsWith('/') || (typeof next === 'string' && next !== '' && !next.startsWith('/')))
      return 'unreadable';
    path += ':param';
  }
  return path;
}

function methodOf(obj: ts.ObjectLiteralExpression): string | 'unreadable' | null {
  for (const prop of obj.properties) {
    if (!prop.name || prop.name.getText().replace(/['"]/g, '') !== 'method') continue;
    if (ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(prop.initializer))
      return prop.initializer.text.toUpperCase();
    return 'unreadable';
  }
  return null;
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Les méthodes écrites dans les objets d'un nœud (sans descendre dans une fonction). */
function methodsIn(node: ts.Node): Set<string> | 'unreadable' {
  const found = new Set<string>();
  let bad = false;
  walk(node, (n) => {
    if (ts.isObjectLiteralExpression(n)) {
      const m = methodOf(n);
      if (m === 'unreadable') bad = true;
      else if (m) found.add(m);
    }
  });
  return bad ? 'unreadable' : found;
}

function methodFor(literal: ts.Node): string | 'unreadable' {
  let child: ts.Node = literal;
  let parent = literal.parent;
  // Remonter les enveloppes sans effet (parenthèses, `as`, conditions).
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isConditionalExpression(parent))
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return 'unreadable';
  // `{ path: '/v1/…', method: 'GET' }`
  if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
    const m = methodOf(parent.parent);
    return m ?? 'unreadable';
  }
  // `fetch('/v1/…', { method: 'POST' })` ; sans objet ni méthode écrite : GET.
  if (ts.isCallExpression(parent) && parent.arguments.some((a) => a === child)) {
    const objects = parent.arguments.filter(ts.isObjectLiteralExpression);
    if (parent.arguments.length > 1 && objects.length === 0) return 'unreadable';
    for (const obj of objects) {
      const m = methodOf(obj);
      if (m) return m;
    }
    return 'GET';
  }
  // `apiPath = '/v1/…'` : la méthode du bloc où l'affectation est écrite.
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === child &&
    ts.isExpressionStatement(parent.parent) &&
    ts.isBlock(parent.parent.parent)
  ) {
    const methods = methodsIn(parent.parent.parent);
    if (methods === 'unreadable' || methods.size !== 1) return 'unreadable';
    return [...methods][0]!;
  }
  return 'unreadable';
}

export interface SiteKeyCalls {
  /** `METHOD /v1/…`, paramètres écrits `:param`. */
  calls: string[];
  /** Les endroits que la lecture ne sait pas attribuer, avec leur ligne. */
  unreadable: string[];
}

export function siteKeyCalls(fileName: string, text: string): SiteKeyCalls {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const calls = new Set<string>();
  const unreadable: string[] = [];
  const where = (n: ts.Node) =>
    `${fileName}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  walk(source, (node) => {
    // Un gabarit niché dans le trou d'un autre est lu avec son parent.
    if (ts.isNoSubstitutionTemplateLiteral(node) && ts.isTemplateSpan(node.parent)) return;
    const path = apiPath(node);
    if (path === null) return;
    if (path === 'unreadable') {
      unreadable.push(`${where(node)} chemin illisible : ${node.getText()}`);
      return;
    }
    const method = methodFor(node);
    if (method === 'unreadable') {
      unreadable.push(`${where(node)} méthode illisible pour ${path}`);
      return;
    }
    calls.add(`${method} ${path}`);
  });
  return { calls: [...calls].sort(), unreadable };
}

const normalize = (route: string) => route.replace(/:[A-Za-z_]+/g, ':param');

describe('les routes exemptées pour la clé du site sont exactement celles que le site appelle', () => {
  const found = SITE_KEY_CALLERS.map((file) => ({
    file,
    ...siteKeyCalls(file, readFileSync(join(root, file), 'utf8')),
  }));
  const called = [...new Set(found.flatMap((f) => f.calls))].sort();
  const listed = [...new Set(SITE_SERVER_KEY_ROUTES.map(normalize))].sort();

  it('lit chacune des trois sources (garde-fou contre un balayage vide)', () => {
    for (const f of found) expect(f.calls.length, f.file).toBeGreaterThan(0);
  });

  it('sait attribuer chaque chemin d’API écrit dans ces sources', () => {
    expect(found.flatMap((f) => f.unreadable)).toEqual([]);
  });

  it('chaque route appelée avec la clé du site est dans la liste', () => {
    expect(called.filter((r) => !listed.includes(r))).toEqual([]);
  });

  it('chaque route de la liste est appelée par le site ou par le relais', () => {
    expect(listed.filter((r) => !called.includes(r))).toEqual([]);
  });

  it('la liste ne contient pas de doublon', () => {
    expect(new Set(SITE_SERVER_KEY_ROUTES).size).toBe(SITE_SERVER_KEY_ROUTES.length);
  });
});

describe('la lecture des appels avec la clé du site', () => {
  const read = (code: string) => siteKeyCalls('exemple.ts', code);

  it('lit les trois formes des sources', () => {
    const code = [
      // chemin et méthode dans le même objet
      "const T = { a: (v: string) => ({ path: '/v1/a', method: 'POST' }),",
      '  b: (v: string) => ({ path: `/v1/b/${encodeURIComponent(v)}`, method: "GET" }) };',
      // fetch en ligne, adresse de base en trou de tête
      "await fetch(`${apiUrl}/v1/c`, { method: 'POST', headers });",
      // affectation dans un bloc qui porte la méthode
      'if (x) {',
      '  apiPath = `/v1/d/${encodeURIComponent(String(value))}`;',
      "  fetchOptions = { method: 'GET', headers };",
      '}',
    ].join('\n');
    expect(read(code)).toEqual({
      calls: ['GET /v1/b/:param', 'GET /v1/d/:param', 'POST /v1/a', 'POST /v1/c'],
      unreadable: [],
    });
  });

  it('refuse les formes qu’elle ne sait pas attribuer', () => {
    const forms = [
      // segment caché dans un trou
      "fetch(`${api}/v1/x${suffix}`, { method: 'POST' });",
      // méthode qui n'est pas écrite en toutes lettres
      'fetch(`${api}/v1/y`, { method: verb });',
      // objet d'appel passé par une variable
      "const opts = { method: 'POST' }; fetch(`${api}/v1/z`, opts);",
      // bloc qui porte deux méthodes
      "if (x) { p = '/v1/w'; a = { method: 'GET' }; b = { method: 'POST' }; }",
      // chemin rangé dans une constante
      "const ROUTE = '/v1/v';",
    ];
    for (const form of forms) expect(read(form).unreadable, form).toHaveLength(1);
  });

  it('ignore les commentaires et un chemin cité au milieu d’une phrase', () => {
    const code = [
      '// POST /v1/iban/batch',
      '/** GET /v1/keys */',
      "const message = 'Take a key (POST /v1/keys/generate) to keep going.';",
    ].join('\n');
    expect(read(code)).toEqual({ calls: [], unreadable: [] });
  });
});
