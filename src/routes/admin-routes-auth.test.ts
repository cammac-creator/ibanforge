import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { SCOPED_ADMIN_KEYS } from '../lib/admin-auth.js';
import { closeAll } from '../lib/db.js';

/**
 * Audit du 16/09/2026, constat 6 : les 83 routes admin de l'API sont gardées
 * une par une, par discipline. Ce test les découvre dans l'application montée
 * et exige un refus sans secret et avec un mauvais secret, pour que la
 * quatre-vingt-quatrième soit gardée par un test et non par la mémoire. Même
 * patron que frontend/app/api/private-routes-auth.test.ts.
 */
describe('every admin route refuses a caller without the right secret', () => {
  const app = buildApp();
  afterAll(() => closeAll());

  const routes = app.routes
    .filter((r) => r.method !== 'ALL' && /\/admin(\/|$)/.test(r.path))
    .map((r) => ({
      method: r.method,
      path: r.path.replace(/:[A-Za-z_]+\??/g, 'x').replace(/\*/g, 'x'),
    }));
  const unique = [...new Map(routes.map((r) => [`${r.method} ${r.path}`, r])).values()];

  it('finds a meaningful number of admin routes', () => {
    expect(unique.length).toBeGreaterThan(50);
  });

  // Une adresse par route : le limiteur de débit (100/min par adresse) répond 429
  // AVANT l'authentification, et 84 routes × 2 appels depuis la même adresse le
  // déclenchent. Le test mesure le refus d'authentification, pas le limiteur.
  it.each(
    unique.map((r, i) => ({
      ...r,
      ip: `203.0.113.${(i % 200) + 1}`,
      ip2: `198.51.100.${(i % 200) + 1}`,
    })),
  )('$method $path', async ({ method, path, ip, ip2 }) => {
    const sansCorps = method === 'GET' || method === 'HEAD' || method === 'DELETE';
    const headers: Record<string, string> = { 'x-forwarded-for': ip };
    if (!sansCorps) headers['content-type'] = 'application/json';
    const init: RequestInit = sansCorps ? { method, headers } : { method, headers, body: '{}' };
    const sansSecret = await app.request(path, init);
    expect([401, 403], `${method} ${path} sans secret → ${sansSecret.status}`).toContain(
      sansSecret.status,
    );
    const mauvais = await app.request(path, {
      ...init,
      headers: {
        ...headers,
        'x-forwarded-for': ip2,
        'X-Admin-Secret': 'definitely-not-the-secret',
        Authorization: 'Bearer definitely-not-the-token',
      },
    });
    expect([401, 403], `${method} ${path} mauvais secret → ${mauvais.status}`).toContain(
      mauvais.status,
    );
  });
});

/**
 * 10.11.2026 (audit OPS-24) : le jeton de la sauvegarde, `BACKUP_TOKEN`, n'ouvre
 * que `GET /v1/admin/backup`. Le déplacement de l'authentification dans
 * `src/lib/admin-auth.ts` touche toutes les routes d'administration : une porte
 * branchée sur la mauvaise fonction ouvrirait une route à la clé de la
 * sauvegarde. Ce test la présente à CHAQUE route montée, dans l'en-tête du secret
 * et en Bearer, et exige un refus partout sauf sur la sauvegarde, qui répond 200.
 *
 * Depuis la table des clés à portée (C08, audit SEC-01#2), ce refus est un 403
 * exact : la clé est reconnue, elle n'a pas le droit. Un 401 voudrait dire
 * qu'une route a échappé au mécanisme.
 */
describe('the backup token opens the backup and no other admin route', () => {
  const app = buildApp();
  const TOKEN = 'backup-only-token-for-the-route-sweep-0123456789';
  const avant = process.env.BACKUP_TOKEN;
  beforeAll(() => {
    process.env.BACKUP_TOKEN = TOKEN;
  });
  afterAll(() => {
    if (avant === undefined) delete process.env.BACKUP_TOKEN;
    else process.env.BACKUP_TOKEN = avant;
    closeAll();
  });

  const routes = app.routes
    .filter((r) => r.method !== 'ALL' && /\/admin(\/|$)/.test(r.path))
    .map((r) => ({
      method: r.method,
      path: r.path.replace(/:[A-Za-z_]+\??/g, 'x').replace(/\*/g, 'x'),
    }));
  const unique = [...new Map(routes.map((r) => [`${r.method} ${r.path}`, r])).values()];

  it('sweeps the same routes, the backup included', () => {
    expect(unique.length).toBeGreaterThan(50);
    expect(unique.some((r) => r.method === 'GET' && r.path === '/v1/admin/backup')).toBe(true);
  });

  // Un troisième bloc d'adresses : le limiteur compte par adresse, et les deux
  // blocs du balayage précédent sont déjà entamés.
  it.each(unique.map((r, i) => ({ ...r, ip: `192.0.2.${(i % 200) + 1}` })))(
    '$method $path',
    async ({ method, path, ip }) => {
      const sansCorps = method === 'GET' || method === 'HEAD' || method === 'DELETE';
      const headers: Record<string, string> = {
        'x-forwarded-for': ip,
        'X-Admin-Secret': TOKEN,
        Authorization: `Bearer ${TOKEN}`,
      };
      if (!sansCorps) headers['content-type'] = 'application/json';
      const init: RequestInit = sansCorps ? { method, headers } : { method, headers, body: '{}' };
      const res = await app.request(path, init);
      if (method === 'GET' && path === '/v1/admin/backup') {
        expect(res.status, `${method} ${path} jeton de sauvegarde → ${res.status}`).toBe(200);
      } else {
        expect(res.status, `${method} ${path} jeton de sauvegarde → ${res.status}`).toBe(403);
      }
    },
  );
});

/**
 * 10.11.2026 (C08, audit WEB-02#1) : la clé du site, `SITE_ADMIN_TOKEN`, n'ouvre
 * que les routes que le site appelle (`SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN`, tenue
 * contre le code du site par `src/lib/admin-auth.site.test.ts`).
 *
 * Deux balayages, parce que présenter une clé VALIDE à une route l'exécute :
 *  - hors de la liste, CHAQUE route montée doit répondre 403 exact : la porte est
 *    la première ligne de chaque route, rien ne s'exécute avant elle ;
 *  - dans la liste, chaque route doit laisser passer la clé (ni 401 ni 403). Les
 *    écritures reçoivent un corps illisible, qu'elles refusent en 400 après la
 *    porte ; une seule route est tenue à l'écart, parce qu'elle prend un corps
 *    illisible pour « tout balayer » et partirait sur le réseau.
 */
const ALL_ROUTES_OF = (app: ReturnType<typeof buildApp>) => {
  const routes = app.routes
    .filter((r) => r.method !== 'ALL' && /\/admin(\/|$)/.test(r.path))
    .map((r) => ({ method: r.method, pattern: r.path }));
  return [...new Map(routes.map((r) => [`${r.method} ${r.pattern}`, r])).values()];
};
const concrete = (pattern: string) => pattern.replace(/:[A-Za-z_]+\??/g, '7').replace(/\*/g, 'x');

/** Lancée sur un corps illisible, elle balaie les forums sur le réseau : sa porte est lue ailleurs. */
const NOT_CALLED_WITH_A_VALID_KEY = new Set(['POST /v1/admin/forum-scan']);

describe('the site key opens the site routes and no other admin route', () => {
  const app = buildApp();
  const TOKEN = 'site-only-token-for-the-route-sweep-0123456789';
  const avant = process.env.SITE_ADMIN_TOKEN;
  beforeAll(() => {
    process.env.SITE_ADMIN_TOKEN = TOKEN;
  });
  afterAll(() => {
    if (avant === undefined) delete process.env.SITE_ADMIN_TOKEN;
    else process.env.SITE_ADMIN_TOKEN = avant;
    closeAll();
  });

  const all = ALL_ROUTES_OF(app);
  const listed: readonly string[] = SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN;
  const outside = all.filter((r) => !listed.includes(`${r.method} ${r.pattern}`));
  const inside = all.filter(
    (r) =>
      listed.includes(`${r.method} ${r.pattern}`) &&
      !NOT_CALLED_WITH_A_VALID_KEY.has(`${r.method} ${r.pattern}`),
  );

  it('sweeps both halves', () => {
    expect(outside.length).toBeGreaterThan(30);
    expect(inside.length).toBeGreaterThan(30);
  });

  // Quatrième bloc d'adresses : le limiteur compte par adresse.
  it.each(outside.map((r, i) => ({ ...r, ip: `100.64.0.${(i % 250) + 1}` })))(
    'outside the list: $method $pattern → 403',
    async ({ method, pattern, ip }) => {
      const sansCorps = method === 'GET' || method === 'HEAD' || method === 'DELETE';
      const headers: Record<string, string> = {
        'x-forwarded-for': ip,
        'X-Admin-Secret': TOKEN,
        Authorization: `Bearer ${TOKEN}`,
      };
      if (!sansCorps) headers['content-type'] = 'application/json';
      const init: RequestInit = sansCorps ? { method, headers } : { method, headers, body: '{}' };
      const res = await app.request(concrete(pattern), init);
      expect(res.status, `${method} ${pattern} clé du site → ${res.status}`).toBe(403);
    },
  );

  it.each(inside.map((r, i) => ({ ...r, ip: `198.18.0.${(i % 200) + 1}` })))(
    'inside the list: $method $pattern lets the key through',
    async ({ method, pattern, ip }) => {
      const sansCorps = method === 'GET' || method === 'HEAD';
      const headers: Record<string, string> = { 'x-forwarded-for': ip, 'X-Admin-Secret': TOKEN };
      if (!sansCorps) headers['content-type'] = 'application/json';
      const init: RequestInit = sansCorps
        ? { method, headers }
        : { method, headers, body: 'pas du json' };
      const res = await app.request(concrete(pattern), init);
      expect([401, 403], `${method} ${pattern} clé du site → ${res.status}`).not.toContain(
        res.status,
      );
    },
  );

  // Les preuves du brief (WEB-02#1), nommées une par une.
  it('403 on POST /v1/admin/keys, /keys/import and /account/revoke; 200 on GET /v1/admin/keys', async () => {
    const write = (path: string) =>
      app.request(path, {
        method: 'POST',
        headers: {
          'x-forwarded-for': '198.18.1.1',
          'content-type': 'application/json',
          'X-Admin-Secret': TOKEN,
        },
        body: JSON.stringify({ email: 'acme@example.com' }),
      });
    expect((await write('/v1/admin/keys')).status).toBe(403);
    expect((await write('/v1/admin/keys/import')).status).toBe(403);
    expect((await write('/v1/admin/account/revoke')).status).toBe(403);
    const read = await app.request('/v1/admin/keys', {
      headers: { 'x-forwarded-for': '198.18.1.2', 'X-Admin-Secret': TOKEN },
    });
    expect(read.status).toBe(200);
  });
});

describe('every scoped key names routes that exist', () => {
  const app = buildApp();
  afterAll(() => closeAll());
  const mounted = new Set(ALL_ROUTES_OF(app).map((r) => `${r.method} ${r.pattern}`));

  // Une faute de frappe dans la table ne se verrait qu'en production, par un bloc
  // du tableau de bord qui tombe en 403.
  it.each(
    Object.entries(SCOPED_ADMIN_KEYS).flatMap(([name, routes]) =>
      routes.map((route) => ({ name, route })),
    ),
  )('$name: $route is mounted', ({ route }) => {
    expect(mounted.has(route)).toBe(true);
  });
});

/**
 * Une seule façon d'ouvrir une route d'administration : `authorizeAdmin(c)`, qui
 * lit la table. L'ancienne forme (`isAdminAuthorized` sur l'en-tête) ouvrirait la
 * route au seul secret complet, et la clé du site y recevrait 401 : ce test la
 * refuse dans tout `src/`, sous-dossiers compris (sauf la porte elle-même).
 */
describe('the admin routes all go through the scoped-key table', () => {
  const src = resolve(import.meta.dirname, '..');
  const files = (readdirSync(src, { recursive: true }) as string[]).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== join('lib', 'admin-auth.ts'),
  );

  it('reads the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no source file checks the admin header by hand', () => {
    const offenders = files.filter((f) =>
      /isAdminAuthorized\s*\(\s*c\.req\.header|isBackupAuthorized\s*\(|deps\.isAdminAuthorized/.test(
        readFileSync(join(src, f), 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
