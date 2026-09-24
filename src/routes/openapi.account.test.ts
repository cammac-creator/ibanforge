import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSpec } from './openapi.js';
import { ACCOUNT_REPORT_MAX_DAYS } from '../lib/account.js';

/**
 * Les cinq routes publiques du compte dans le contrat (lot C3, 25.09.2026).
 *
 * Un contrat qui tait une route est un contrat qu'un générateur de client ne
 * peut pas suivre, et une page que personne ne trouve. Même principe que
 * `openapi.test.ts` pour `/v1/keys/generate` : la route est la source de
 * vérité, pas ce fichier. Les statuts et les jetons d'erreur de chaque route
 * sont LUS dans `src/routes/account.ts` (le gestionnaire, plus les gardes qu'il
 * appelle et les middlewares montés sur `/v1/account/*`) : ajouter un refus à
 * une route sans le documenter fait rougir ce test.
 *
 * La route d'administration (`POST /v1/admin/account/revoke`) n'est pas
 * publique : elle ne doit jamais apparaître ici.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'src/routes/account.ts'), 'utf8');

/** [méthode, chemin, statut de succès] des cinq routes publiques. */
const ROUTES = [
  ['post', '/v1/account/code', '202'],
  ['post', '/v1/account/session', '200'],
  ['get', '/v1/account/overview', '200'],
  ['get', '/v1/account/keys/report', '200'],
  ['post', '/v1/account/logout', '204'],
] as const;

type Operation = {
  operationId?: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: { maximum?: number };
  }>;
  responses: Record<string, { description?: string }>;
};

const spec = buildSpec() as unknown as {
  paths: Record<string, Record<string, Operation>>;
  tags: Array<{ name: string }>;
  components: {
    securitySchemes: Record<string, { type?: string; in?: string; name?: string }>;
    schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  };
};

/** Le corps d'une fonction du fichier des routes, jusqu'à son accolade finale. */
function fn(name: string): string {
  const start = SRC.indexOf(`function ${name}(`);
  expect(start, `${name} is no longer in src/routes/account.ts`).toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('\n}\n', start));
}

/** Le gestionnaire d'une route, jusqu'à l'enregistrement suivant. */
function handler(method: string, path: string): string {
  const start = SRC.indexOf(`account.${method}('${path}'`);
  expect(start, `${method} ${path} is no longer registered`).toBeGreaterThan(-1);
  const end = SRC.indexOf('\n  account.', start + 10);
  return SRC.slice(start, end === -1 ? undefined : end);
}

/** Les middlewares montés sur toutes les routes du compte (cookie en double). */
const MIDDLEWARES = [...SRC.matchAll(/account\.use\('\/v1\/account\/\*'[\s\S]*?\n {2}\}\);/g)]
  .map((m) => m[0])
  .join('\n');

/** Tout ce qui peut répondre pour cette route, dans le fichier des routes. */
function answering(method: string, path: string): string {
  const h = handler(method, path);
  return [
    h,
    h.includes('writeGuards(') ? fn('writeGuards') : '',
    h.includes('signedOut(') ? fn('signedOut') : '',
    MIDDLEWARES,
  ].join('\n');
}

const statusesOf = (src: string): string[] =>
  [...new Set([...src.matchAll(/(?:\}|null),\s*(\d{3}),?\s*\)/g)].map((m) => m[1]))].sort();

const errorsOf = (src: string): string[] =>
  [...new Set([...src.matchAll(/error:\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort();

describe('the five public account routes are in the contract', () => {
  it('reads real statuses and error tokens (guards the extraction itself)', () => {
    // Un extracteur qui ne trouve rien ferait passer les tests ci-dessous à vide.
    expect(statusesOf(answering('post', '/v1/account/code'))).toEqual(
      expect.arrayContaining(['202', '400', '401', '403', '415', '429', '503']),
    );
    expect(errorsOf(answering('post', '/v1/account/session'))).toEqual(
      expect.arrayContaining(['invalid_code', 'signed_out', 'forbidden_origin']),
    );
    expect(MIDDLEWARES).toContain('signed_out');
  });

  it.each(ROUTES)(
    '%s %s: an operation, described, tagged and with its security',
    (method, path) => {
      const op = spec.paths[path]?.[method];
      expect(op, `${method.toUpperCase()} ${path} is not in the document`).toBeDefined();
      expect(op!.operationId).toMatch(/^[a-zA-Z]+$/);
      expect((op!.description ?? '').length).toBeGreaterThan(80);
      expect(op!.tags).toContain('Account');
      expect(op!.security).toBeDefined();
    },
  );

  it.each(ROUTES)('%s %s: every status the route can answer is documented', (method, path, ok) => {
    const documented = Object.keys(spec.paths[path][method].responses);
    expect(documented).toContain(ok);
    for (const status of statusesOf(answering(method, path))) {
      expect(documented, `${path} answers ${status}, the contract does not say so`).toContain(
        status,
      );
    }
  });

  it.each(ROUTES)('%s %s: every error token the route can emit is named', (method, path) => {
    const text = JSON.stringify(spec.paths[path][method]);
    for (const token of errorsOf(answering(method, path))) {
      expect(text, `${path} can answer "${token}", the contract never names it`).toContain(token);
    }
  });

  it('the two sign-in steps need nothing; the three others need the session cookie', () => {
    expect(spec.paths['/v1/account/code'].post.security).toEqual([]);
    expect(spec.paths['/v1/account/session'].post.security).toEqual([]);
    for (const [method, path] of [
      ['get', '/v1/account/overview'],
      ['get', '/v1/account/keys/report'],
      ['post', '/v1/account/logout'],
    ] as const) {
      expect(spec.paths[path][method].security, path).toEqual([{ accountSession: [] }]);
    }
    expect(spec.components.securitySchemes.accountSession).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'ibanforge_account' }),
    );
    expect(spec.tags.map((t) => t.name)).toContain('Account');
  });

  it('the report of a key takes its prefix as a required query parameter', () => {
    const params = spec.paths['/v1/account/keys/report'].get.parameters ?? [];
    const prefix = params.find((p) => p.name === 'prefix');
    expect(prefix).toEqual(expect.objectContaining({ in: 'query', required: true }));
    // Le préfixe voyage en paramètre et jamais dans le chemin : aucun gabarit
    // `{prefix}` ne doit réapparaître.
    expect(Object.keys(spec.paths).filter((p) => p.includes('{prefix}'))).toEqual([]);
    const days = params.find((p) => p.name === 'days');
    expect(days?.schema?.maximum).toBe(ACCOUNT_REPORT_MAX_DAYS);
  });

  it('the overview schema names every field the view serves', () => {
    // Les champs de premier niveau des deux interfaces de `src/lib/account.ts`,
    // lus dans le source : le schéma publié ne peut pas en oublier un.
    const lib = readFileSync(join(ROOT, 'src/lib/account.ts'), 'utf8');
    const fields = (iface: string): string[] => {
      const start = lib.indexOf(`export interface ${iface} {`);
      expect(start, iface).toBeGreaterThan(-1);
      const body = lib.slice(start, lib.indexOf('\n}\n', start));
      return [...body.matchAll(/^ {2}([a-z_]+)\??:/gm)].map((m) => m[1]).sort();
    };
    const overview = spec.components.schemas.AccountOverview;
    const key = spec.components.schemas.AccountKey;
    expect(Object.keys(overview.properties ?? {}).sort()).toEqual(fields('AccountOverview'));
    expect(Object.keys(key.properties ?? {}).sort()).toEqual(fields('OverviewKey'));
    expect(fields('OverviewKey')).toContain('key_prefix');
  });

  it('never documents the admin route', () => {
    expect(spec.paths['/v1/admin/account/revoke']).toBeUndefined();
    expect(JSON.stringify(spec)).not.toContain('/v1/admin/account');
  });

  it('GET /v1/keys/report points a person at the account page, at the root', () => {
    const text = spec.paths['/v1/keys/report'].get.description ?? '';
    expect(text).toContain('https://ibanforge.com/account');
    expect(JSON.stringify(spec)).not.toContain('ibanforge.com/en/account');
  });
});
