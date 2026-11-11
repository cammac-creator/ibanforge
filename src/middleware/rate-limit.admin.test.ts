import { Hono } from 'hono';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll } from '../lib/db.js';
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

  it('HEAD sur la sauvegarde, servi par la route GET, garde l’exemption du jeton', async () => {
    let dernier = 0;
    const app = appliSauvegarde();
    for (let i = 0; i < RATE_LIMIT + 20; i++) {
      const res = await app.request('/v1/admin/backup', {
        method: 'HEAD',
        headers: { 'x-forwarded-for': '203.0.113.26', 'X-Admin-Secret': JETON },
      });
      dernier = res.status;
    }
    expect(dernier).toBe(200);
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

/**
 * C23 (relecture de la PR 592) : l'exemption du jeton de la sauvegarde ne vaut
 * que pour `GET` (et `HEAD`, servi par la route GET) sur `/v1/admin/backup`
 * exactement. Une autre méthode, ou une variante du chemin, est un appel sans
 * secret valide. Éprouvé sur l'application montée : c'est la route qui va
 * répondre, parmi toutes celles de l'API, qui décide.
 */
describe('Plafond d’appels et jeton de la sauvegarde, méthode et chemin exacts', () => {
  const JETON = 'jeton-de-sauvegarde-methode-et-chemin';
  const avant = process.env.BACKUP_TOKEN;
  const app = buildApp();

  async function rafale(ip: string, method: string, chemin: string, n: number) {
    let dernier = 0;
    for (let i = 0; i < n; i++) {
      const res = await app.request(chemin, {
        method,
        headers: { 'x-forwarded-for': ip, 'X-Admin-Secret': JETON },
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

  it('compte le jeton présenté en POST sur la sauvegarde', async () => {
    expect(await rafale('203.0.113.41', 'POST', '/v1/admin/backup', RATE_LIMIT + 1)).toBe(429);
  });

  it('compte le jeton présenté en DELETE sur la sauvegarde', async () => {
    expect(await rafale('203.0.113.42', 'DELETE', '/v1/admin/backup', RATE_LIMIT + 1)).toBe(429);
  });

  it('compte le jeton présenté sur une variante du chemin (barre finale)', async () => {
    expect(await rafale('203.0.113.43', 'GET', '/v1/admin/backup/', RATE_LIMIT + 1)).toBe(429);
  });

  it('compte le jeton présenté sous le chemin de la sauvegarde', async () => {
    expect(await rafale('203.0.113.44', 'GET', '/v1/admin/backup/x', RATE_LIMIT + 1)).toBe(429);
  });
});

/**
 * Le 10.11.2026 (C08) : la clé du site garde l'exemption sur les routes de SA
 * liste, et redevient un appelant anonyme partout ailleurs. Éprouvé sur
 * l'application réelle (`buildApp`), parce que le limiteur lit la route qui va
 * répondre parmi toutes celles qui correspondent, et que l'ordre réel de montage
 * (les intergiciels de `/v1/*` montés après les routes de clés) est le piège.
 */
describe('Plafond d’appels et clé du site, sur l’application montée', () => {
  const CLE = 'cle-du-site-pour-le-limiteur-0123456789';
  const avantSite = process.env.SITE_ADMIN_TOKEN;
  const app = buildApp();

  async function rafaleDepuis(ip: string, chemin: string, n: number) {
    let dernier = 0;
    for (let i = 0; i < n; i++) {
      const res = await app.request(chemin, {
        headers: { 'x-forwarded-for': ip, 'X-Admin-Secret': CLE },
      });
      dernier = res.status;
    }
    return dernier;
  }

  beforeEach(() => {
    process.env.ADMIN_SECRET = 'secret-de-test-pour-le-limiteur';
    process.env.SITE_ADMIN_TOKEN = CLE;
  });
  afterEach(() => {
    if (ancien === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = ancien;
    if (avantSite === undefined) delete process.env.SITE_ADMIN_TOKEN;
    else process.env.SITE_ADMIN_TOKEN = avantSite;
  });
  afterAll(() => closeAll());

  it('laisse passer une lecture de sa liste bien au-delà du plafond', async () => {
    expect(await rafaleDepuis('203.0.113.31', '/v1/admin/pack-sales', RATE_LIMIT + 20)).toBe(200);
  });

  it('limite la même clé sur une route hors de sa liste', async () => {
    expect(await rafaleDepuis('203.0.113.32', '/v1/admin/backup', RATE_LIMIT + 5)).toBe(429);
  });
});
