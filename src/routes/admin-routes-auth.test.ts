import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
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
        expect([401, 403], `${method} ${path} jeton de sauvegarde → ${res.status}`).toContain(
          res.status,
        );
      }
    },
  );
});
