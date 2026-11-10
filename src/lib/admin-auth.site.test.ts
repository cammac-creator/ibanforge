import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SCOPED_ADMIN_KEYS } from './admin-auth.js';

/**
 * La clé du site (`SITE_ADMIN_TOKEN`, audit du 10.11.2026, WEB-02#1) n'ouvre que
 * les routes d'administration que le site appelle. Ce test tient cette liste
 * contre le code du site, lu à l'exécution par le système de fichiers (un fichier
 * de `frontend/` n'importe jamais hors de `frontend/`, l'inverse se lit) :
 *
 *  - chaque appel du site vers `/v1/admin/…` doit figurer dans la liste de la clé,
 *    sinon le bloc correspondant du tableau de bord tombe en 403 au premier
 *    affichage ;
 *  - chaque route de la liste doit être appelée par le site, sinon la clé ouvre
 *    une porte dont personne ne se sert ;
 *  - un chemin que ce test ne sait pas lire fait échouer le test : on l'écrit en
 *    entier plutôt que de laisser une route passer sans être comptée.
 *
 * Comment un appel est lu (arbre syntaxique de TypeScript, jamais les
 * commentaires) : une chaîne ou un gabarit qui contient `/v1/admin/`. Un trou
 * `${…}` qui occupe un segment entier devient un paramètre (`:param`) ; un trou
 * collé au dernier segment n'est admis que s'il est une chaîne de requête
 * (`qs`, ou `cond ? '?…' : ''`). La méthode est lue dans l'appel qui reçoit le
 * chemin : la propriété `method` d'un objet passé en argument ; un objet qui
 * étale (`...init`) un paramètre de la fonction englobante renvoie aux appels de
 * cette fonction dans le même fichier ; sans méthode écrite, c'est GET. Un chemin
 * rangé dans une constante est suivi jusqu'aux appels qui la reçoivent. Une
 * fonction intermédiaire qui écrirait elle-même une méthode rend l'appel illisible.
 */

const root = resolve(import.meta.dirname, '../..');
const frontend = join(root, 'frontend');
const ADMIN = '/v1/admin/';

function siteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.next', '.git', 'coverage', 'dist', 'out', 'tests'].includes(entry.name))
      return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return siteFiles(path);
    if (!/\.(?:[cm]?[jt]sx?)$/.test(path)) return [];
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return [];
    return [path];
  });
}

type Part = string | ts.Expression;

/** Les morceaux d'un littéral : du texte, et les trous `${…}` d'un gabarit. */
function partsOf(node: ts.Node): Part[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    const parts: Part[] = [node.head.text];
    for (const span of node.templateSpans) parts.push(span.expression, span.literal.text);
    return parts;
  }
  return null;
}

/** Vrai pour un littéral (ou gabarit) dont le texte de tête est vide ou commence par « ? ». */
function startsAQuery(node: ts.Expression): boolean {
  const parts = partsOf(node);
  if (!parts) return false;
  const head = parts[0] as string;
  return head === '' ? parts.length === 1 : head.startsWith('?');
}

/** Un trou collé au dernier segment n'est admis que s'il est une chaîne de requête. */
function isQuery(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return expr.text === 'qs';
  if (ts.isConditionalExpression(expr))
    return startsAQuery(expr.whenTrue) && startsAQuery(expr.whenFalse);
  return false;
}

/**
 * Le chemin d'administration d'un littéral, ou `unreadable`, ou `null` quand le
 * littéral ne porte pas de chemin d'administration.
 */
function adminPath(node: ts.Node): string | 'unreadable' | null {
  const parts = partsOf(node);
  if (!parts) return null;
  const first = parts.findIndex((p) => typeof p === 'string' && p.includes(ADMIN));
  if (first < 0) return null;
  // Avant le chemin : rien, une adresse de base en trou (`${API_URL}`), ou une origine écrite.
  const before = parts.slice(0, first);
  const lead = (parts[first] as string).slice(0, (parts[first] as string).indexOf(ADMIN));
  const leadOk =
    (lead === '' || /^https?:\/\/[^/\s]+$/.test(lead)) &&
    before.every((p) => typeof p !== 'string' || p === '' || /^https?:\/\/[^/\s]+$/.test(p));
  if (!leadOk) return 'unreadable';

  let path = '';
  const rest: Part[] = [(parts[first] as string).slice(lead.length), ...parts.slice(first + 1)];
  for (let i = 0; i < rest.length; i++) {
    const part = rest[i];
    if (typeof part === 'string') {
      const q = part.indexOf('?');
      if (q >= 0) return path + part.slice(0, q);
      path += part;
      continue;
    }
    const next = rest[i + 1];
    const nextText = typeof next === 'string' ? next : '';
    const lastHole = rest.slice(i + 1).every((p) => p === '');
    // Un segment entier juste après `/v1/admin/` désignerait une famille de routes.
    if (path === ADMIN) return 'unreadable';
    if (path.endsWith('/') && (nextText === '' ? lastHole : /^[/?]/.test(nextText))) {
      path += ':param';
      continue;
    }
    if (lastHole && isQuery(part)) return path;
    if (/^\?/.test(nextText) && isQuery(part)) return path;
    return 'unreadable';
  }
  return path;
}

function isFunctionLike(node: ts.Node): node is ts.SignatureDeclaration & { body?: ts.Node } {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Les expressions qu'on traverse en remontant d'un littéral vers l'appel qui le reçoit. */
function isTransparent(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isConditionalExpression(node) ||
    ts.isBinaryExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTemplateSpan(node) ||
    ts.isTemplateExpression(node)
  );
}

type Holder =
  | { kind: 'call'; call: ts.CallExpression }
  | { kind: 'variable'; decl: ts.VariableDeclaration }
  | { kind: 'none' };

function holderOf(literal: ts.Node): Holder {
  let child: ts.Node = literal;
  let parent = literal.parent;
  while (parent) {
    if (ts.isCallExpression(parent) && parent.arguments.some((a) => a === child))
      return { kind: 'call', call: parent };
    if (ts.isVariableDeclaration(parent) && parent.initializer === child)
      return { kind: 'variable', decl: parent };
    if (!isTransparent(parent)) return { kind: 'none' };
    child = parent;
    parent = parent.parent;
  }
  return { kind: 'none' };
}

function enclosingFunction(node: ts.Node): (ts.SignatureDeclaration & { body?: ts.Node }) | null {
  let p = node.parent;
  while (p) {
    if (isFunctionLike(p)) return p;
    p = p.parent;
  }
  return null;
}

function nameOf(fn: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name)
    return fn.name.getText();
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    fn.parent &&
    ts.isVariableDeclaration(fn.parent) &&
    ts.isIdentifier(fn.parent.name)
  )
    return fn.parent.name.text;
  return null;
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** La méthode écrite dans un objet `{ method: '…' }` : absente, littérale, ou illisible. */
function methodProperty(obj: ts.ObjectLiteralExpression): string | 'unreadable' | null {
  for (const prop of obj.properties) {
    if (!prop.name || prop.name.getText().replace(/['"]/g, '') !== 'method') continue;
    if (ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(prop.initializer))
      return prop.initializer.text.toUpperCase();
    return 'unreadable';
  }
  return null;
}

/** Les déclarations de fonction du fichier, par nom. */
function functionsByName(source: ts.SourceFile): Map<string, ts.Node> {
  const map = new Map<string, ts.Node>();
  walk(source, (n) => {
    if (isFunctionLike(n)) {
      const name = nameOf(n);
      if (name && !map.has(name)) map.set(name, n);
    }
  });
  return map;
}

function callsTo(source: ts.SourceFile, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  walk(source, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name)
      calls.push(n);
  });
  return calls;
}

/** Les méthodes d'un appel qui reçoit un chemin d'administration. */
function methodsOfCall(
  source: ts.SourceFile,
  call: ts.CallExpression,
  depth = 0,
): string[] | 'unreadable' {
  if (depth > 3) return 'unreadable';
  // Une fonction intermédiaire du même fichier qui écrit elle-même une méthode
  // cacherait le verbe à cette lecture.
  if (ts.isIdentifier(call.expression)) {
    const callee = functionsByName(source).get(call.expression.text);
    if (callee) {
      let written = false;
      walk(callee, (n) => {
        if (ts.isObjectLiteralExpression(n) && methodProperty(n) !== null) written = true;
      });
      if (written) return 'unreadable';
    }
  }
  const objects = call.arguments.filter(ts.isObjectLiteralExpression);
  for (const obj of objects) {
    const m = methodProperty(obj);
    if (m === 'unreadable') return 'unreadable';
    if (m) return [m];
  }
  // `{ ...init }` ou `fetch(url, init)`, où `init` est un paramètre de la fonction
  // englobante : la méthode est celle de chaque appel de cette fonction.
  const forwarded: ts.Identifier[] = [];
  for (const obj of objects)
    for (const prop of obj.properties)
      if (ts.isSpreadAssignment(prop) && ts.isIdentifier(prop.expression))
        forwarded.push(prop.expression);
  const isFetch = ts.isIdentifier(call.expression) && call.expression.text === 'fetch';
  const init = call.arguments[1];
  if (isFetch && init && !ts.isObjectLiteralExpression(init)) {
    if (ts.isIdentifier(init)) forwarded.push(init);
    else return 'unreadable';
  }
  if (forwarded.length === 0) return ['GET'];
  const fn = enclosingFunction(call);
  const name = fn && nameOf(fn);
  if (!fn || !name) return 'unreadable';
  const methods = new Set<string>();
  for (const id of forwarded) {
    const index = fn.parameters.findIndex(
      (p) => ts.isIdentifier(p.name) && p.name.text === id.text,
    );
    if (index < 0) return 'unreadable';
    const callers = callsTo(source, name);
    if (callers.length === 0) return 'unreadable';
    for (const caller of callers) {
      const arg = caller.arguments[index];
      if (!arg) methods.add('GET');
      else if (ts.isObjectLiteralExpression(arg)) {
        const m = methodProperty(arg);
        if (m === 'unreadable') return 'unreadable';
        methods.add(m ?? 'GET');
      } else return 'unreadable';
    }
  }
  return [...methods];
}

/** Les appels qui reçoivent une constante, dans la portée qui la déclare. */
function callsReceiving(decl: ts.VariableDeclaration): ts.CallExpression[] {
  if (!ts.isIdentifier(decl.name)) return [];
  const name = decl.name.text;
  let scope: ts.Node = decl;
  while (scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  const calls: ts.CallExpression[] = [];
  walk(scope, (n) => {
    if (ts.isIdentifier(n) && n.text === name && n !== decl.name) {
      const holder = holderOf(n);
      if (holder.kind === 'call') calls.push(holder.call);
    }
  });
  return calls;
}

export interface SiteAdminCalls {
  /** `METHOD /v1/admin/…`, paramètres écrits `:param`. */
  calls: string[];
  /** Les endroits que la lecture ne sait pas attribuer, avec leur ligne. */
  unreadable: string[];
}

/** Les appels d'administration écrits dans un fichier source du site. */
export function siteAdminCalls(fileName: string, text: string): SiteAdminCalls {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const calls = new Set<string>();
  const unreadable: string[] = [];
  const where = (n: ts.Node) =>
    `${fileName}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  walk(source, (node) => {
    // Un gabarit niché dans le trou d'un autre est lu avec son parent.
    if (ts.isNoSubstitutionTemplateLiteral(node) && ts.isTemplateSpan(node.parent)) return;
    const path = adminPath(node);
    // Le préfixe seul (`path.startsWith('/v1/admin/')`) ne désigne aucune route.
    if (path === null || path === ADMIN) return;
    if (path === 'unreadable') {
      unreadable.push(`${where(node)} chemin illisible : ${node.getText()}`);
      return;
    }
    const holder = holderOf(node);
    const targets =
      holder.kind === 'call'
        ? [holder.call]
        : holder.kind === 'variable'
          ? callsReceiving(holder.decl)
          : [];
    if (targets.length === 0) {
      unreadable.push(`${where(node)} aucun appel ne reçoit ce chemin : ${node.getText()}`);
      return;
    }
    for (const call of targets) {
      const methods = methodsOfCall(source, call);
      if (methods === 'unreadable') {
        unreadable.push(`${where(call)} méthode illisible pour ${path}`);
        continue;
      }
      for (const method of methods) calls.add(`${method} ${path}`);
    }
  });
  return { calls: [...calls].sort(), unreadable };
}

const normalize = (route: string) => route.replace(/:[A-Za-z_]+/g, ':param');

describe('la clé du site ouvre exactement les routes que le site appelle', () => {
  const files = siteFiles(frontend);
  const found = files.map((file) =>
    siteAdminCalls(relative(root, file), readFileSync(file, 'utf8')),
  );
  const siteRoutes = [...new Set(found.flatMap((f) => f.calls))].sort();
  const keyRoutes = [...new Set(SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN.map(normalize))].sort();

  it('lit le code du site (garde-fou contre un balayage vide)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(siteRoutes.length).toBeGreaterThan(30);
  });

  it('sait attribuer chaque chemin d’administration écrit dans le site', () => {
    expect(found.flatMap((f) => f.unreadable)).toEqual([]);
  });

  it('chaque route appelée par le site est dans la liste de sa clé', () => {
    expect(siteRoutes.filter((r) => !keyRoutes.includes(r))).toEqual([]);
  });

  it('chaque route de la liste est appelée par le site', () => {
    expect(keyRoutes.filter((r) => !siteRoutes.includes(r))).toEqual([]);
  });

  it('la liste de la clé ne contient pas de doublon', () => {
    const raw = SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN;
    expect(new Set(raw).size).toBe(raw.length);
  });
});

/**
 * Un seul fichier du site lit `ADMIN_SECRET` : celui qui rend la clé à envoyer
 * à l'API (`frontend/lib/admin-key.ts`). Un nouveau lecteur contournerait la clé
 * du site et garderait la clé complète dans un chemin d'appel.
 */
describe('le site ne lit la clé complète qu’à un seul endroit', () => {
  it('aucun autre fichier du site ne lit process.env.ADMIN_SECRET', () => {
    const readers = siteFiles(frontend)
      .filter((file) =>
        /process\.env(?:\.ADMIN_SECRET\b|\[\s*['"]ADMIN_SECRET['"]\s*\])|\bADMIN_SECRET\b[^=;]*}\s*=\s*process\.env/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(root, file));
    expect(readers).toEqual(['frontend/lib/admin-key.ts']);
  });
});

describe('la lecture des appels du site', () => {
  const read = (code: string) => siteAdminCalls('exemple.ts', code);

  it('lit les formes du site', () => {
    const code = [
      // fetch en ligne, méthode écrite
      "await fetch(`${API_URL}/v1/admin/a`, { method: 'POST', headers });",
      // fetch en ligne, sans méthode, chaîne de requête conditionnelle
      "await fetch(`${API_URL}/v1/admin/b${q.size ? `?${q}` : ''}`, { headers });",
      // relais qui reçoit le chemin complet et l'objet de la méthode
      "forward('/v1/admin/c', { method: 'PATCH', body });",
      'forward(`/v1/admin/c/${id}`, { method: "DELETE" });',
      // relais qui étale l'objet reçu : la méthode vient de ses appels
      'async function relay(init: RequestInit, qs: string) {',
      '  return fetch(`${API_URL}/v1/admin/d${qs}`, { ...init, headers });',
      '}',
      "relay({ method: 'GET' }, '');",
      "relay({ method: 'POST', body }, '');",
      // aide de lecture sans objet : GET
      "admin<T>('/v1/admin/e?days=7', 6000);",
      // chemin rangé dans une constante
      "const url = `${API_URL}/v1/admin/f${asked ? `?week=${asked}` : ''}`;",
      'await fetchJSON(url, { h: 1 });',
      // gabarit avec paramètre de segment au milieu
      "await fetch(`${api}/v1/admin/g/${id}/confirm`, { method: 'POST' });",
    ].join('\n');
    expect(read(code)).toEqual({
      calls: [
        'DELETE /v1/admin/c/:param',
        'GET /v1/admin/b',
        'GET /v1/admin/d',
        'GET /v1/admin/e',
        'GET /v1/admin/f',
        'PATCH /v1/admin/c',
        'POST /v1/admin/a',
        'POST /v1/admin/d',
        'POST /v1/admin/g/:param/confirm',
      ],
      unreadable: [],
    });
  });

  it('refuse les formes qu’elle ne sait pas attribuer', () => {
    const forms = [
      // suffixe de chemin caché dans un trou
      "fetch(`${API_URL}/v1/admin/aliases${path}`, { method: 'POST' });",
      // segment entier caché, une famille de routes en un seul gabarit
      'fetch(`${API_URL}/v1/admin/${source}`, { headers });',
      // objet d'appel passé par une variable qui n'est pas un paramètre
      'const opts = { method: "POST" }; fetch(`${API_URL}/v1/admin/x`, opts);',
      // méthode qui n'est pas écrite en toutes lettres
      'fetch(`${API_URL}/v1/admin/y`, { method: verb });',
      // fonction intermédiaire qui écrit elle-même sa méthode
      "const post = (p: string) => fetch(`${API_URL}${p}`, { method: 'POST' }); post('/v1/admin/z');",
      // chemin qui ne part dans aucun appel
      "export const ROUTE = { a: '/v1/admin/w' };",
    ];
    for (const form of forms) {
      expect(read(form).unreadable, form).toHaveLength(1);
    }
  });

  it('ignore les commentaires', () => {
    expect(read('// GET /v1/admin/keys\n/** POST /v1/admin/keys */\nconst x = 1;')).toEqual({
      calls: [],
      unreadable: [],
    });
  });
});
