/**
 * `.env.example` dit ce que l'API lit (audit du 10.11.2026, ARCH-08#2).
 *
 * Le fichier modèle des réglages s'était écarté du code dans les deux sens : un
 * défaut annoncé à 120 requêtes par minute quand le limiteur en applique 100,
 * une clé documentée que rien ne lit plus, et une quarantaine de variables lues
 * sans une ligne, dont une qui empêche l'API de démarrer en production
 * (`IP_HASH_SECRET`, src/lib/stats.ts). Ce test compare, dans les deux sens, les
 * variables que `src/` lit réellement à celles que `.env.example` documente, et
 * les valeurs d'exemple des réglages chiffrés à leur défaut dans le code.
 *
 * ## Ce qui compte comme une lecture
 *
 * L'arbre syntaxique de chaque fichier de `src/` (hors tests et
 * `src/test-support/`), jamais le texte : un `process.env.X` écrit dans un
 * commentaire n'est pas une lecture.
 *  - `process.env.NOM`, `process.env['NOM']`, et les mêmes formes sur un
 *    paramètre typé `NodeJS.ProcessEnv` (`env.NOM`, `env[NOM_ENV]`) ;
 *  - les chaînes d'une constante dont le nom finit par `_ENV`, `_VAR` ou `_VARS`
 *    (`MCP_MAX_SESSIONS_ENV`, `OVERLAY_ENV`, `SITE_SERVER_KEY_VARS`), la
 *    convention de ce dépôt pour un nom de variable lu par une indirection ;
 *  - le premier argument littéral d'une fonction qui lit `process.env[param]`
 *    (`readPositiveEnv('DEVICE_POLL_WAIT_MS', …)`) ;
 *  - les clés de `SCOPED_ADMIN_KEYS` (src/lib/admin-auth.ts), lues une à une.
 * Toute autre lecture par une clé calculée fait échouer le test : un nom qu'il ne
 * saurait pas trouver ne doit pas passer pour documenté.
 *
 * ## Ce qui compte comme documenté
 *
 * Une ligne `NOM=valeur` ou `# NOM=valeur`, la valeur sans espace (un
 * commentaire de fin `# …` permis). Un nom cité dans une phrase ne documente
 * rien : il faut sa ligne.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SCOPED_ADMIN_KEYS } from '../src/lib/admin-auth.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ENV_EXAMPLE = join(ROOT, '.env.example');

/**
 * Lues par `src/` et absentes de `.env.example`, exprès. Une ligne, une raison.
 */
const READ_NOT_DOCUMENTED: Record<string, string> = {
  VITEST: 'posée par le lanceur de tests, jamais sur un serveur',
  RAILWAY_PUBLIC_DOMAIN: 'posée par l’hébergeur lui-même, jamais à la main',
  SEED_FAMILY:
    'mode des commandes de remplissage des bases (npm run overlay:seed la pose), jamais sur le serveur',
  DB_PATH:
    'base écrite par la commande npm run db:seed (src/db/seed.ts), jamais lue par le serveur',
  GLEIF_API_BASE:
    'source lue par la commande npm run db:seed (src/db/seed.ts), jamais par le serveur',
};

/** Documentées dans `.env.example` sans lecture dans `src/`, exprès. Une ligne, une raison. */
const DOCUMENTED_NOT_READ: Record<string, string> = {};

/**
 * Les fichiers dont les lectures par une clé calculée sont nommées à la main, et
 * par quoi. Un autre fichier qui lit une clé calculée fait échouer le test.
 */
const NAMED_BY_HAND: Record<string, string> = {
  'src/lib/admin-auth.ts':
    'configured(name) parcourt les clés de SCOPED_ADMIN_KEYS, ajoutées une à une',
};

const NAME = /^[A-Z][A-Z0-9_]*$/;
const CONST_SUFFIX = /_(?:ENV|VARS?)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test-support' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function isProcessEnv(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'env' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process'
  );
}

function stringLiterals(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n) && NAME.test(n.text)) found.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) return n;
  }
  return undefined;
}

function functionName(fn: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name))
    return fn.parent.name.text;
  return undefined;
}

/** Une indirection résolue par la convention de nom : `X_ENV`, `X_ENV.repo`, `X_ENV[kind]`. */
function namedByConvention(arg: ts.Expression): boolean {
  if (ts.isIdentifier(arg)) return CONST_SUFFIX.test(arg.text);
  if (ts.isPropertyAccessExpression(arg) || ts.isElementAccessExpression(arg))
    return ts.isIdentifier(arg.expression) && CONST_SUFFIX.test(arg.expression.text);
  return false;
}

export interface EnvReads {
  names: Set<string>;
  /** `fichier:ligne` d'une lecture par une clé que le test ne sait pas nommer. */
  unexplained: string[];
}

/** Les variables que les fichiers lisent. */
export function envReads(files: string[]): EnvReads {
  const names = new Set<string>(Object.keys(SCOPED_ADMIN_KEYS));
  const unexplained: string[] = [];
  /** Fonction lectrice → position du paramètre qui porte le nom. */
  const readers = new Map<string, number>();
  const pendingCalls: { name: string; call: ts.CallExpression; where: string }[] = [];
  const parsed = files.map((file) => ({
    file,
    source: ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
  }));

  for (const { file, source } of parsed) {
    const where = (n: ts.Node): string =>
      `${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const envParams = new Set<string>();
    const scan = (node: ts.Node): void => {
      if (
        ts.isParameter(node) &&
        ts.isIdentifier(node.name) &&
        node.type?.getText(source) === 'NodeJS.ProcessEnv'
      )
        envParams.add(node.name.text);
      ts.forEachChild(node, scan);
    };
    scan(source);
    const isEnv = (e: ts.Expression): boolean =>
      isProcessEnv(e) || (ts.isIdentifier(e) && envParams.has(e.text));

    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        CONST_SUFFIX.test(node.name.text) &&
        node.initializer
      ) {
        for (const s of stringLiterals(node.initializer)) names.add(s);
      } else if (ts.isPropertyAccessExpression(node) && isEnv(node.expression)) {
        if (NAME.test(node.name.text)) names.add(node.name.text);
      } else if (ts.isElementAccessExpression(node) && isEnv(node.expression)) {
        const arg = node.argumentExpression;
        if (ts.isStringLiteralLike(arg)) {
          names.add(arg.text);
        } else if (!namedByConvention(arg)) {
          const fn = enclosingFunction(node);
          const index =
            fn && ts.isIdentifier(arg)
              ? fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === arg.text)
              : -1;
          const fnName = fn && functionName(fn);
          const mapped =
            fn &&
            index >= 0 &&
            ts.isCallExpression(fn.parent) &&
            ts.isPropertyAccessExpression(fn.parent.expression) &&
            fn.parent.expression.name.text === 'map' &&
            namedByConvention(fn.parent.expression.expression);
          if (mapped) {
            // `X_VARS.map((name) => process.env[name])` : les noms sont les chaînes de X_VARS.
          } else if (fnName && index >= 0) {
            readers.set(fnName, index);
          } else {
            unexplained.push(where(node));
          }
        }
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        pendingCalls.push({ name: node.expression.text, call: node, where: where(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  for (const { name, call, where } of pendingCalls) {
    const index = readers.get(name);
    if (index === undefined) continue;
    const arg = call.arguments[index];
    if (arg && ts.isStringLiteralLike(arg)) names.add(arg.text);
    else if (!arg || !namedByConvention(arg)) unexplained.push(where);
  }
  return { names, unexplained };
}

/** Les lignes `NOM=valeur` ou `# NOM=valeur`, avec la valeur et le commentaire juste au-dessus. */
export function documented(text: string): Map<string, { value: string; comment: string[] }> {
  const lines = text.split('\n');
  const LINE = /^(?:#\s*)?([A-Z][A-Z0-9_]*)=(\S*)(?:\s+#.*)?$/;
  const found = new Map<string, { value: string; comment: string[] }>();
  lines.forEach((line, i) => {
    const m = LINE.exec(line.trim());
    if (!m) return;
    const comment: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const above = lines[j].trim();
      if (!above.startsWith('#') || LINE.test(above)) break;
      comment.unshift(above);
    }
    found.set(m[1], { value: m[2], comment });
  });
  return found;
}

/**
 * Les réglages chiffrés dont le défaut est une constante du code : la valeur
 * d'exemple de `.env.example`, et tout « default N » du commentaire juste
 * au-dessus, doivent la répéter.
 */
const DEFAULTS: Record<string, () => Promise<number>> = {
  RATE_LIMIT_PER_MIN: async () => {
    // Lu au chargement du module : la variable doit être absente à cet instant.
    const saved = process.env.RATE_LIMIT_PER_MIN;
    delete process.env.RATE_LIMIT_PER_MIN;
    try {
      return (await import('../src/middleware/rate-limit.js')).RATE_LIMIT;
    } finally {
      if (saved !== undefined) process.env.RATE_LIMIT_PER_MIN = saved;
    }
  },
  MCP_MAX_SESSIONS: async () => (await import('../src/lib/mcp-limits.js')).MCP_MAX_SESSIONS_DEFAULT,
  UNAUTHENTICATED_MAILS_PER_HOUR: async () =>
    (await import('../src/lib/key-creation-guard.js')).UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR,
  UNAUTHENTICATED_MAILS_PER_DAY: async () =>
    (await import('../src/lib/key-creation-guard.js')).UNAUTHENTICATED_MAILS_GLOBAL_PER_DAY,
  ACCOUNT_CODES_PER_DAY: async () => (await import('../src/lib/account.js')).ACCOUNT_CODES_PER_DAY,
  AUDIT_UNPAID_REPORT_MAX_BYTES: async () =>
    (await import('../src/lib/audit-jobs.js')).AUDIT_UNPAID_REPORT_MAX_BYTES,
  AUDIT_UNPAID_STORAGE_BYTES: async () =>
    (await import('../src/lib/audit-jobs.js')).AUDIT_UNPAID_STORAGE_BYTES,
  DEVICE_POLLS_IN_FLIGHT_MAX: async () =>
    (await import('../src/lib/device-grant.js')).DEVICE_POLLS_IN_FLIGHT_MAX,
  DEVICE_POLLS_IN_FLIGHT_PER_RAIL: async () =>
    (await import('../src/lib/device-grant.js')).DEVICE_POLLS_IN_FLIGHT_PER_RAIL,
  DEVICE_POLLS_IN_FLIGHT_PER_IP: async () =>
    (await import('../src/lib/device-grant.js')).DEVICE_POLLS_IN_FLIGHT_PER_IP,
  DEVICE_MISS_DELAY_FLOOR_MS: async () =>
    (await import('../src/lib/device-grant.js')).DEVICE_MISS_DELAY_FLOOR_MS,
  DEVICE_MISS_DELAY_MAX_MS: async () =>
    (await import('../src/lib/device-grant.js')).DEVICE_MISS_DELAY_MAX_MS,
};

const reads = envReads(sourceFiles(SRC));
const docs = documented(readFileSync(ENV_EXAMPLE, 'utf8'));

describe('.env.example et les variables que src/ lit', () => {
  it('la lecture trouve les indirections connues (sinon elle est aveugle)', () => {
    for (const name of [
      'IP_HASH_SECRET', // process.env.X
      'DEVICE_POLL_WAIT_MS', // readPositiveEnv('…')
      'X402_SETTLE_TIMEOUT_MS', // FACILITATOR_TIMEOUT_ENV[operation]
      'RESTRICTED_BIC_OVERLAY_PATH', // OVERLAY_ENV[kind]
      'REGISTER_PAGES_API_KEY', // SITE_SERVER_KEY_VARS.map(…)
      'DOOR_BOARD_DIGEST_DISABLED', // env.X, env: NodeJS.ProcessEnv
      'SITE_ADMIN_TOKEN', // SCOPED_ADMIN_KEYS
      'UNAUTHENTICATED_MAILS_PER_HOUR', // ceilingFromEnv(X_ENV, …)
    ])
      expect(reads.names, name).toContain(name);
    expect(reads.names).not.toContain('X'); // `process.env.X` d'un commentaire
  });

  it('aucune lecture par une clé que le test ne sait pas nommer', () => {
    const byHand = Object.keys(NAMED_BY_HAND);
    expect(reads.unexplained.filter((w) => !byHand.includes(w.split(':')[0]))).toEqual([]);
    // Chaque fichier nommé à la main en a encore besoin.
    for (const file of byHand)
      expect(
        reads.unexplained.some((w) => w.startsWith(`${file}:`)),
        file,
      ).toBe(true);
  });

  it('chaque variable lue est documentée, ou une exception nommée', () => {
    const missing = [...reads.names]
      .filter((n) => !docs.has(n) && !(n in READ_NOT_DOCUMENTED))
      .sort();
    expect(missing).toEqual([]);
  });

  it('chaque variable documentée est lue, ou une exception nommée', () => {
    const unread = [...docs.keys()]
      .filter((n) => !reads.names.has(n) && !(n in DOCUMENTED_NOT_READ))
      .sort();
    expect(unread).toEqual([]);
  });

  it('les exceptions servent encore', () => {
    for (const name of Object.keys(READ_NOT_DOCUMENTED)) {
      expect(reads.names, name).toContain(name);
      expect(docs.has(name), name).toBe(false);
    }
    for (const name of Object.keys(DOCUMENTED_NOT_READ)) {
      expect(docs.has(name), name).toBe(true);
      expect(reads.names.has(name), name).toBe(false);
    }
  });

  it.each(Object.keys(DEFAULTS))('%s : la valeur d’exemple est le défaut du code', async (name) => {
    const expected = await DEFAULTS[name]();
    const doc = docs.get(name);
    expect(doc, `${name} n'a pas sa ligne dans .env.example`).toBeDefined();
    expect(doc!.value).toBe(String(expected));
    const announced = doc!.comment.join(' ').matchAll(/\bdefaults?\s+(?:is\s+)?(\d+)/gi);
    for (const m of announced) expect(Number(m[1]), m[0]).toBe(expected);
  });
});
