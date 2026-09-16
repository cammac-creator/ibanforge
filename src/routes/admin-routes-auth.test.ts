import { afterAll, describe, expect, it } from 'vitest';
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
