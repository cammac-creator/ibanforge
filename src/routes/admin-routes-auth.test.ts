import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { SCOPED_ADMIN_KEYS, type ScopedAdminKey } from '../lib/admin-auth.js';
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
 * Les routes balayées et leur forme concrète. Le filtre `/admin(/|$)` attrape
 * aussi trois routes HORS de `/v1/admin/`, voir `STATS_GATED`.
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

/**
 * Les routes qui répondent 403 D'ELLES-MÊMES à une clé à portée, pour une autre
 * raison que la table : trois lectures de `/admin/*` (hors `/v1/admin/`), gardées
 * par `STATS_TOKEN` en `Authorization: Bearer` et jamais par `X-Admin-Secret`.
 * Leur refus est le leur, `{ "error": "unauthorized" }` en 403 : la table n'y est
 * pas consultée, et aucune clé à portée ne les ouvre. Elles sont nommées ici une
 * par une, et un test exige que les routes balayées hors de `/v1/admin/` soient
 * EXACTEMENT celles-là : une quatrième ne passerait pas en silence.
 */
const STATS_GATED = new Set([
  'GET /admin/business-summary',
  'GET /admin/revenue',
  'GET /admin/scanners',
]);

describe('the swept routes outside /v1/admin/ are exactly the STATS_TOKEN ones', () => {
  const app = buildApp();
  afterAll(() => closeAll());

  it('names them one by one', () => {
    const outsideV1 = ALL_ROUTES_OF(app)
      .filter((r) => !r.pattern.startsWith('/v1/admin/'))
      .map((r) => `${r.method} ${r.pattern}`)
      .sort();
    expect(outsideV1).toEqual([...STATS_GATED].sort());
  });
});

/** Une requête faite avec une clé à portée, dans l'en-tête du secret et en Bearer. */
function withKey(method: string, token: string, ip: string, body: string): RequestInit {
  const sansCorps = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  const headers: Record<string, string> = {
    'x-forwarded-for': ip,
    'X-Admin-Secret': token,
    Authorization: `Bearer ${token}`,
  };
  if (!sansCorps) headers['content-type'] = 'application/json';
  return sansCorps ? { method, headers } : { method, headers, body };
}

/** Le refus d'une clé à portée hors de sa liste : 403 exact, et le corps de la porte. */
async function expectForbidden(res: Response, label: string, route: string): Promise<void> {
  expect(res.status, `${label} → ${res.status}`).toBe(403);
  const body = (await res.json()) as { error?: unknown };
  expect(body.error, `${label} : corps`).toBe(
    STATS_GATED.has(route) ? 'unauthorized' : 'forbidden',
  );
}

/**
 * CHAQUE clé de la table, présentée à CHAQUE route montée (C07 pour la
 * sauvegarde, C08 pour le site et pour les familles des scripts du serveur). La
 * liste des clés est lue dans la table : une famille ajoutée demain est balayée
 * sans toucher ce fichier. Une seule clé posée à la fois, les autres absentes.
 *
 * Deux balayages, parce que présenter une clé VALIDE à une route l'exécute :
 *  - hors de sa liste, chaque route répond 403 exact avec le corps de la porte,
 *    `{ "error": "forbidden" }` : la porte est la première ligne de chaque route,
 *    rien ne s'exécute avant elle. Un 401 voudrait dire qu'une route a échappé au
 *    mécanisme ; un autre corps, que la route a refusé pour une autre raison
 *    (seules les trois de `STATS_GATED` en ont le droit) ;
 *  - dans sa liste, chaque route laisse passer la clé (ni 401 ni 403). Les
 *    écritures reçoivent un corps illisible, qu'elles refusent en 400 après la
 *    porte ; une seule route est tenue à l'écart, parce qu'elle prend un corps
 *    illisible pour « tout balayer » et partirait sur le réseau.
 *
 * Une adresse par requête, tirée du rang de la clé et du rang de la route : le
 * limiteur de débit compte par adresse et répondrait 429 avant la porte.
 */
const KEY_NAMES = Object.keys(SCOPED_ADMIN_KEYS) as ScopedAdminKey[];
const ipOf = (key: number, half: 'outside' | 'inside', i: number) =>
  `10.${key + 1}.${(half === 'outside' ? 0 : 100) + Math.floor(i / 250)}.${(i % 250) + 1}`;

describe.each(KEY_NAMES.map((name, k) => ({ name, k })))(
  'the scoped key $name opens its list and no other admin route',
  ({ name, k }) => {
    const app = buildApp();
    const TOKEN = `${name.toLowerCase()}-for-the-route-sweep-0123456789`;
    const avant: Record<string, string | undefined> = {};
    beforeAll(() => {
      for (const other of KEY_NAMES) {
        avant[other] = process.env[other];
        delete process.env[other];
      }
      process.env[name] = TOKEN;
    });
    afterAll(() => {
      for (const other of KEY_NAMES) {
        if (avant[other] === undefined) delete process.env[other];
        else process.env[other] = avant[other];
      }
      closeAll();
    });

    const all = ALL_ROUTES_OF(app);
    const listed: readonly string[] = SCOPED_ADMIN_KEYS[name];
    const outside = all.filter((r) => !listed.includes(`${r.method} ${r.pattern}`));
    const inside = all.filter(
      (r) =>
        listed.includes(`${r.method} ${r.pattern}`) &&
        !NOT_CALLED_WITH_A_VALID_KEY.has(`${r.method} ${r.pattern}`),
    );

    it('sweeps every route: each listed route is mounted, the rest is outside', () => {
      expect(all.length).toBeGreaterThan(50);
      expect(outside.length + listed.length).toBe(all.length);
      expect(inside.length).toBeGreaterThan(0);
    });

    it.each(outside.map((r, i) => ({ ...r, ip: ipOf(k, 'outside', i) })))(
      'outside the list: $method $pattern → 403 forbidden',
      async ({ method, pattern, ip }) => {
        const res = await app.request(concrete(pattern), withKey(method, TOKEN, ip, '{}'));
        await expectForbidden(res, `${method} ${pattern} ${name}`, `${method} ${pattern}`);
      },
    );

    it.each(inside.map((r, i) => ({ ...r, ip: ipOf(k, 'inside', i) })))(
      'inside the list: $method $pattern lets the key through',
      async ({ method, pattern, ip }) => {
        const init = withKey(method, TOKEN, ip, 'pas du json');
        // Dans la liste, la clé n'est présentée que dans l'en-tête du secret.
        delete (init.headers as Record<string, string>).Authorization;
        const res = await app.request(concrete(pattern), init);
        expect([401, 403], `${method} ${pattern} ${name} → ${res.status}`).not.toContain(
          res.status,
        );
      },
    );
  },
);

/** 10.11.2026 (audit OPS-24, C07) : la preuve nommée de la sauvegarde. */
describe('the backup token opens the backup', () => {
  const app = buildApp();
  const TOKEN = 'backup-only-token-for-the-named-proof-0123456789';
  const avant = process.env.BACKUP_TOKEN;
  beforeAll(() => {
    process.env.BACKUP_TOKEN = TOKEN;
  });
  afterAll(() => {
    if (avant === undefined) delete process.env.BACKUP_TOKEN;
    else process.env.BACKUP_TOKEN = avant;
    closeAll();
  });

  it('200 on GET /v1/admin/backup, 403 forbidden on POST /v1/admin/keys', async () => {
    const backup = await app.request('/v1/admin/backup', {
      headers: { 'x-forwarded-for': '192.0.2.1', 'X-Admin-Secret': TOKEN },
    });
    expect(backup.status).toBe(200);
    const keys = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '192.0.2.2',
        'content-type': 'application/json',
        'X-Admin-Secret': TOKEN,
      },
      body: JSON.stringify({ email: 'acme@example.com' }),
    });
    await expectForbidden(keys, 'POST /v1/admin/keys BACKUP_TOKEN', 'POST /v1/admin/keys');
  });
});

/**
 * C08 partie 2 (audit SEC-01#2) : la clé de la famille en lecture seule reçoit
 * 403 sur TOUTE écriture d'administration (POST, PATCH, PUT, DELETE), quelle que
 * soit la route. Le balayage par clé le dit déjà route par route ; celui-ci le
 * dit de la lecture seule en tant que telle, et ne passe pas à vide.
 */
describe('the read-only key is refused on every admin write', () => {
  const app = buildApp();
  const TOKEN = 'read-only-token-for-the-write-sweep-0123456789';
  const avant = process.env.ADMIN_READ_TOKEN;
  beforeAll(() => {
    process.env.ADMIN_READ_TOKEN = TOKEN;
  });
  afterAll(() => {
    if (avant === undefined) delete process.env.ADMIN_READ_TOKEN;
    else process.env.ADMIN_READ_TOKEN = avant;
    closeAll();
  });

  const writes = ALL_ROUTES_OF(app).filter(
    (r) =>
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method) && r.pattern.startsWith('/v1/admin/'),
  );

  it('sweeps the writes of every kind that is mounted', () => {
    expect(writes.length).toBeGreaterThan(40);
    expect([...new Set(writes.map((r) => r.method))]).toEqual(
      expect.arrayContaining(['POST', 'PATCH', 'DELETE']),
    );
  });

  it.each(writes.map((r, i) => ({ ...r, ip: `10.200.${Math.floor(i / 250)}.${(i % 250) + 1}` })))(
    '$method $pattern → 403 forbidden',
    async ({ method, pattern, ip }) => {
      const res = await app.request(
        concrete(pattern),
        withKey(method, TOKEN, ip, JSON.stringify({ email: 'acme@example.com' })),
      );
      await expectForbidden(res, `${method} ${pattern} ADMIN_READ_TOKEN`, `${method} ${pattern}`);
    },
  );
});

/**
 * 10.11.2026 (C08, audit WEB-02#1) : la clé du site, `SITE_ADMIN_TOKEN`, n'ouvre
 * que les routes que le site appelle (`SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN`, tenue
 * contre le code du site par `src/lib/admin-auth.site.test.ts`). Le balayage
 * ci-dessus la présente à chaque route ; ici, les preuves nommées du brief.
 */
describe('the site key: the named proofs', () => {
  const app = buildApp();
  const TOKEN = 'site-only-token-for-the-named-proofs-0123456789';
  const avant = process.env.SITE_ADMIN_TOKEN;
  beforeAll(() => {
    process.env.SITE_ADMIN_TOKEN = TOKEN;
  });
  afterAll(() => {
    if (avant === undefined) delete process.env.SITE_ADMIN_TOKEN;
    else process.env.SITE_ADMIN_TOKEN = avant;
    closeAll();
  });

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
    // Le code ET le corps de la porte : un 403 venu d'ailleurs ne passerait pas.
    for (const path of ['/v1/admin/keys', '/v1/admin/keys/import', '/v1/admin/account/revoke']) {
      await expectForbidden(await write(path), `POST ${path} SITE_ADMIN_TOKEN`, `POST ${path}`);
    }
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
