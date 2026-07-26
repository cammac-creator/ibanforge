import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bicGuardMiddleware, iidGuardMiddleware } from './identifier-guard.js';
import { bicLookup } from '../routes/bic-lookup.js';
import { chClearing } from '../routes/ch-clearing.js';
import { getRejectionStats } from '../lib/stats.js';
import type { HonoEnv } from '../types.js';

/**
 * Composition identique à src/index.ts : la garde est enregistrée en premier
 * sur le même chemin, la route est montée ensuite. C'est CETTE composition qui
 * tourne en production, et c'est elle qui rendait les gardes des routes
 * inatteignables — instrumenter les seules routes comptait zéro.
 *
 * Ce que ce fichier verrouille, et qu'aucun test de route seule ne peut voir :
 * le total des rejets bouge d'EXACTEMENT 1 par requête rejetée. À 0, les
 * compteurs de production sont morts ; à 2, les deux copies se déclenchent et
 * les chiffres de la phase 2 sont faux.
 */
function makeMountedApp() {
  const app = new Hono<HonoEnv>();
  app.get('/v1/bic/:code', bicGuardMiddleware());
  app.get('/v1/ch/clearing/:iid', iidGuardMiddleware());
  app.route('/', bicLookup);
  app.route('/', chClearing);
  return app;
}

/** Somme de TOUTES les lignes de rejet du jour, toutes catégories confondues. */
function totalRejections(): number {
  return getRejectionStats(1).reduce((n, r) => n + r.count, 0);
}

function count(operation: string, reason: string): number {
  return (
    getRejectionStats(1).find(
      (r) => r.operation_type === operation && r.reject_reason === reason,
    )?.count ?? 0
  );
}

describe('garde + route montées ensemble (composition de src/index.ts)', () => {
  it.each([
    ['/v1/bic/UBSW%20CHZH', 'bic_lookup', 'normalizable'],
    ['/v1/bic/%7Bcode%7D', 'bic_lookup', 'placeholder_literal'],
    ['/v1/bic/ABC', 'bic_lookup', 'too_short'],
    ['/v1/ch/clearing/CH-230', 'ch_clearing_lookup', 'normalizable'],
    ['/v1/ch/clearing/%7Biid%7D', 'ch_clearing_lookup', 'placeholder_literal'],
    ['/v1/ch/clearing/abc', 'ch_clearing_lookup', 'not_numeric'],
  ])('%s enregistre exactement un rejet %s/%s', async (path, operation, reason) => {
    const totalBefore = totalRejections();
    const categoryBefore = count(operation, reason);

    const res = await makeMountedApp().request(path);
    expect(res.status).toBe(400);

    // Ni 0 (compteurs morts) ni 2 (double comptage par les deux copies).
    expect(totalRejections()).toBe(totalBefore + 1);
    expect(count(operation, reason)).toBe(categoryBefore + 1);
  });

  it('compte le rejet post-garde (forme ISO 9362) une seule fois lui aussi', async () => {
    // 12345678 passe la garde — donc la garde appelle next() et c'est la ROUTE
    // qui enregistre, en `invalid_bic_shape`. Le total ne doit bouger que de 1.
    const totalBefore = totalRejections();
    const shapeBefore = count('bic_lookup', 'invalid_bic_shape');

    const res = await makeMountedApp().request('/v1/bic/12345678');
    expect(res.status).toBe(400);

    expect(totalRejections()).toBe(totalBefore + 1);
    expect(count('bic_lookup', 'invalid_bic_shape')).toBe(shapeBefore + 1);
  });

  it("n'enregistre rien quand la garde laisse passer une entrée valide", async () => {
    const totalBefore = totalRejections();
    const res = await makeMountedApp().request('/v1/bic/UBSWCHZH');
    expect(res.status).toBe(200);
    expect(totalRejections()).toBe(totalBefore);
  });

  it("n'enregistre rien pour un IID accepté mais introuvable (200, found:false)", async () => {
    const totalBefore = totalRejections();
    const res = await makeMountedApp().request('/v1/ch/clearing/99999');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { found: boolean }).found).toBe(false);
    expect(totalRejections()).toBe(totalBefore);
  });
});

describe('la garde ne change aucun comportement observable', () => {
  it('rend les corps de réponse 400 attendus, au champ près', async () => {
    const app = makeMountedApp();

    const bicFormat = await app.request('/v1/bic/UBSW%20CHZH');
    expect(await bicFormat.json()).toEqual({
      error: 'invalid_bic_format',
      message: 'BIC code must be 8 or 11 alphanumeric characters',
    });

    const bicPlaceholder = await app.request('/v1/bic/%7Bcode%7D');
    expect(await bicPlaceholder.json()).toEqual({
      error: 'placeholder_literal',
      message:
        "You sent the literal OpenAPI placeholder '{code}'. Substitute it with a real BIC.",
      example: 'GET /v1/bic/UBSWCHZH',
      schema: 'https://api.ibanforge.com/openapi.json',
    });

    const iidFormat = await app.request('/v1/ch/clearing/abc');
    expect(await iidFormat.json()).toEqual({
      error: 'invalid_iid_format',
      message: 'IID must be a 1-5 digit number.',
    });

    const iidPlaceholder = await app.request('/v1/ch/clearing/%7Biid%7D');
    expect(await iidPlaceholder.json()).toEqual({
      error: 'placeholder_literal',
      message:
        "You sent the literal OpenAPI placeholder '{iid}'. Substitute it with a real Swiss IID.",
      example: 'GET /v1/ch/clearing/230',
      schema: 'https://api.ibanforge.com/openapi.json',
    });
  });

  it('laisse passer vers la route ce que la garde acceptait déjà', async () => {
    const res = await makeMountedApp().request('/v1/bic/UBSWCHZH80A');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { bic11: string }).bic11).toBe('UBSWCHZH80A');
  });
});
