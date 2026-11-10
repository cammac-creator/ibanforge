import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rateLimitMiddleware, RATE_LIMIT } from './rate-limit.js';

/**
 * Le 11.09.2026 : un seul affichage du tableau de bord tire une quinzaine
 * d'appels privés, donc trois affichages dans la minute dépassaient le plafond
 * et tous les blocs privés disparaissaient d'un coup. Ces tests fixent les deux
 * moitiés de la réparation : la lecture authentifiée passe, celle qui ne l'est
 * pas reste limitée.
 */
const ancien = process.env.ADMIN_SECRET;

function appli() {
  const app = new Hono();
  app.use('*', rateLimitMiddleware());
  app.get('/v1/admin/quelquechose', (c) => c.json({ ok: true }));
  app.get('/v1/iban/validate', (c) => c.json({ ok: true }));
  return app;
}

async function rafale(app: Hono, chemin: string, entetes: Record<string, string>, n: number) {
  let dernier = 0;
  for (let i = 0; i < n; i++) {
    const res = await app.request(chemin, {
      headers: { 'x-forwarded-for': '203.0.113.7', ...entetes },
    });
    dernier = res.status;
  }
  return dernier;
}

describe('Plafond d’appels et lectures privées', () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = 'secret-de-test-pour-le-limiteur';
  });
  afterEach(() => {
    if (ancien === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = ancien;
  });

  it('laisse passer une lecture admin authentifiée bien au-delà du plafond', async () => {
    const statut = await rafale(
      appli(),
      '/v1/admin/quelquechose',
      { 'X-Admin-Secret': 'secret-de-test-pour-le-limiteur' },
      RATE_LIMIT + 20,
    );
    expect(statut).toBe(200);
  });

  it('continue de limiter une tentative SANS secret, donc l’essai en force', async () => {
    const statut = await rafale(appli(), '/v1/admin/quelquechose', {}, RATE_LIMIT + 5);
    expect(statut).toBe(429);
  });

  it('continue de limiter une tentative avec un MAUVAIS secret', async () => {
    const statut = await rafale(
      appli(),
      '/v1/admin/quelquechose',
      { 'X-Admin-Secret': 'pas-le-bon' },
      RATE_LIMIT + 5,
    );
    expect(statut).toBe(429);
  });

  it('ne change rien pour les routes publiques', async () => {
    const statut = await rafale(appli(), '/v1/iban/validate', {}, RATE_LIMIT + 5);
    expect(statut).toBe(429);
  });
});

/**
 * Le 10.11.2026 (audit OPS-24) : le jeton de la sauvegarde garde l'exemption
 * accordée au secret valide, mais sur SA route seulement. Ailleurs, son porteur
 * est un appelant sans secret, et reste limité. Chaque test a sa propre adresse :
 * le compteur du limiteur est partagé par tout le fichier.
 */
describe('Plafond d’appels et jeton de la sauvegarde', () => {
  const JETON = 'jeton-de-sauvegarde-pour-le-limiteur';
  const avant = process.env.BACKUP_TOKEN;

  function appliSauvegarde() {
    const app = new Hono();
    app.use('*', rateLimitMiddleware());
    app.get('/v1/admin/backup', (c) => c.json({ ok: true }));
    app.get('/v1/admin/quelquechose', (c) => c.json({ ok: true }));
    return app;
  }

  async function rafaleDepuis(
    app: Hono,
    ip: string,
    chemin: string,
    entetes: Record<string, string>,
    n: number,
  ) {
    let dernier = 0;
    for (let i = 0; i < n; i++) {
      const res = await app.request(chemin, {
        headers: { 'x-forwarded-for': ip, ...entetes },
      });
      dernier = res.status;
    }
    return dernier;
  }

  beforeEach(() => {
    process.env.ADMIN_SECRET = 'secret-de-test-pour-le-limiteur';
    process.env.BACKUP_TOKEN = JETON;
  });
  afterEach(() => {
    if (ancien === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = ancien;
    if (avant === undefined) delete process.env.BACKUP_TOKEN;
    else process.env.BACKUP_TOKEN = avant;
  });

  it('laisse passer la sauvegarde avec son jeton bien au-delà du plafond', async () => {
    const statut = await rafaleDepuis(
      appliSauvegarde(),
      '203.0.113.21',
      '/v1/admin/backup',
      { 'X-Admin-Secret': JETON },
      RATE_LIMIT + 20,
    );
    expect(statut).toBe(200);
  });

  it('laisse passer la sauvegarde avec le secret complet, comme avant', async () => {
    const statut = await rafaleDepuis(
      appliSauvegarde(),
      '203.0.113.22',
      '/v1/admin/backup',
      { 'X-Admin-Secret': 'secret-de-test-pour-le-limiteur' },
      RATE_LIMIT + 20,
    );
    expect(statut).toBe(200);
  });

  it('limite le jeton de la sauvegarde sur toute autre route d’administration', async () => {
    const statut = await rafaleDepuis(
      appliSauvegarde(),
      '203.0.113.23',
      '/v1/admin/quelquechose',
      { 'X-Admin-Secret': JETON },
      RATE_LIMIT + 5,
    );
    expect(statut).toBe(429);
  });

  it('limite un mauvais jeton sur la sauvegarde, donc l’essai en force', async () => {
    const statut = await rafaleDepuis(
      appliSauvegarde(),
      '203.0.113.24',
      '/v1/admin/backup',
      { 'X-Admin-Secret': 'pas-le-bon-jeton' },
      RATE_LIMIT + 5,
    );
    expect(statut).toBe(429);
  });

  it('jeton absent ou vide : la sauvegarde sans le secret complet reste limitée', async () => {
    process.env.BACKUP_TOKEN = '';
    const statut = await rafaleDepuis(
      appliSauvegarde(),
      '203.0.113.25',
      '/v1/admin/backup',
      { 'X-Admin-Secret': '' },
      RATE_LIMIT + 5,
    );
    expect(statut).toBe(429);
  });
});
