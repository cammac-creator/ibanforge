import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_ROUTE,
  SCOPED_ADMIN_KEYS,
  adminDecision,
  authorizeAdmin,
  isAdminAuthorized,
  isAdminAuthorizedFor,
  isBackupAuthorized,
  isStatsAuthorized,
} from './admin-auth.js';

/**
 * Les trois portes d'administration, sans application montée autour : ce qui
 * s'ouvre, ce qui reste fermé, et surtout que la clé de la sauvegarde n'ouvre
 * jamais la porte du secret complet.
 */
// Toutes les clés de la table, lues dans la table : une famille ajoutée demain ne
// fuit pas d'un test à l'autre par une variable posée ailleurs.
const NOMS = ['ADMIN_SECRET', 'STATS_TOKEN', ...Object.keys(SCOPED_ADMIN_KEYS)];
const avant: Record<string, string | undefined> = {};

const ADMIN = 'admin-secret-for-tests-0123456789';
const BACKUP = 'backup-token-for-tests-0123456789';
const SITE = 'site-token-for-tests-0123456789';

beforeEach(() => {
  for (const nom of NOMS) {
    avant[nom] = process.env[nom];
    delete process.env[nom];
  }
});
afterEach(() => {
  for (const nom of NOMS) {
    if (avant[nom] === undefined) delete process.env[nom];
    else process.env[nom] = avant[nom];
  }
});

describe('isAdminAuthorized', () => {
  it('accepts the full secret, and only it', () => {
    process.env.ADMIN_SECRET = ADMIN;
    expect(isAdminAuthorized(ADMIN)).toBe(true);
    expect(isAdminAuthorized(ADMIN.slice(0, -1) + 'X')).toBe(false);
    expect(isAdminAuthorized('short')).toBe(false);
    expect(isAdminAuthorized('')).toBe(false);
    expect(isAdminAuthorized(undefined)).toBe(false);
  });

  it('never accepts the backup token', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.BACKUP_TOKEN = BACKUP;
    expect(isAdminAuthorized(BACKUP)).toBe(false);
  });

  it('opens nothing when ADMIN_SECRET is unset or empty', () => {
    expect(isAdminAuthorized('')).toBe(false);
    expect(isAdminAuthorized('anything')).toBe(false);
    process.env.ADMIN_SECRET = '';
    expect(isAdminAuthorized('')).toBe(false);
  });
});

describe('isBackupAuthorized', () => {
  it('accepts the backup token and the full secret', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.BACKUP_TOKEN = BACKUP;
    expect(isBackupAuthorized(BACKUP)).toBe(true);
    expect(isBackupAuthorized(ADMIN)).toBe(true);
    expect(isBackupAuthorized(BACKUP.slice(0, -1) + 'X')).toBe(false);
    expect(isBackupAuthorized(undefined)).toBe(false);
  });

  it('without BACKUP_TOKEN, behaves exactly like the full secret', () => {
    process.env.ADMIN_SECRET = ADMIN;
    expect(isBackupAuthorized(ADMIN)).toBe(true);
    expect(isBackupAuthorized(BACKUP)).toBe(false);
    expect(isBackupAuthorized('')).toBe(false);
  });

  it('never accepts an empty or blank token, whatever is presented', () => {
    for (const blank of ['', ' ', '\t', '  \n']) {
      process.env.BACKUP_TOKEN = blank;
      for (const presented of [blank, '', ' ', undefined]) {
        expect(isBackupAuthorized(presented), JSON.stringify({ blank, presented })).toBe(false);
      }
    }
  });

  it('opens nothing at all when neither variable is set', () => {
    expect(isBackupAuthorized('')).toBe(false);
    expect(isBackupAuthorized(BACKUP)).toBe(false);
  });

  it('names the one route it opens', () => {
    expect(BACKUP_ROUTE).toBe('/v1/admin/backup');
  });
});

describe('isStatsAuthorized', () => {
  it('accepts the Bearer form of STATS_TOKEN, and only it', () => {
    process.env.STATS_TOKEN = 'stats-token-for-tests';
    expect(isStatsAuthorized('Bearer stats-token-for-tests')).toBe(true);
    expect(isStatsAuthorized('stats-token-for-tests')).toBe(false);
    expect(isStatsAuthorized('Bearer stats-token-for-testX')).toBe(false);
    expect(isStatsAuthorized(undefined)).toBe(false);
  });

  it('opens nothing when STATS_TOKEN is unset or empty', () => {
    expect(isStatsAuthorized('Bearer ')).toBe(false);
    expect(isStatsAuthorized('Bearer undefined')).toBe(false);
    process.env.STATS_TOKEN = '';
    expect(isStatsAuthorized('Bearer ')).toBe(false);
  });
});

/**
 * 10.11.2026 (audit SEC-01#2 et WEB-02#1) : la table « clé à portée → routes
 * permises ». Le secret complet ouvre tout ; chaque clé à portée n'ouvre que sa
 * liste, écrite comme Hono enregistre la route (méthode, puis chemin avec ses
 * paramètres) ; tout le reste est refusé.
 */
describe('the scoped-key table', () => {
  it('writes every route as METHOD and an admin path', () => {
    for (const [name, routes] of Object.entries(SCOPED_ADMIN_KEYS)) {
      for (const route of routes) {
        expect(route, name).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \/v1\/admin\/[a-z0-9/_:-]+$/);
      }
    }
  });

  it('gives the backup token its one route, unchanged since C07', () => {
    expect(SCOPED_ADMIN_KEYS.BACKUP_TOKEN).toEqual([`GET ${BACKUP_ROUTE}`]);
  });

  it('lists each route once per key', () => {
    for (const [name, routes] of Object.entries(SCOPED_ADMIN_KEYS)) {
      expect(new Set(routes).size, name).toBe(routes.length);
    }
  });

  // C08 partie 2 (SEC-01#2) : la famille en lecture seule ne porte que des GET.
  // Le type l'interdit déjà (`AdminReadRoute`) ; ce test le redit à l'exécution.
  it('the read-only family holds GET routes only', () => {
    expect(SCOPED_ADMIN_KEYS.ADMIN_READ_TOKEN.length).toBeGreaterThan(0);
    for (const route of SCOPED_ADMIN_KEYS.ADMIN_READ_TOKEN) {
      expect(route).toMatch(/^GET \/v1\/admin\//);
    }
  });

  // Les familles des scripts du serveur n'ouvrent jamais ce qui fabrique ou
  // exporte : création, import ou relevé de plafond de clés, révocation de
  // compte, sauvegarde, livraison d'une clé achetée, confirmation d'un achat.
  it('no script family creates keys, revokes accounts, reads the backup or confirms purchases', () => {
    const scripts = Object.entries(SCOPED_ADMIN_KEYS).filter(
      ([name]) => name !== 'BACKUP_TOKEN' && name !== 'SITE_ADMIN_TOKEN',
    );
    expect(scripts.length).toBeGreaterThanOrEqual(4);
    for (const [name, routes] of scripts) {
      for (const route of [
        'POST /v1/admin/keys',
        'POST /v1/admin/keys/import',
        'POST /v1/admin/keys/raise-limit',
        'POST /v1/admin/account/revoke',
        'GET /v1/admin/backup',
        'GET /v1/admin/stripe/delivery/:session_id',
        'POST /v1/admin/purchases/:id/confirm',
      ]) {
        expect(routes as readonly string[], `${name} ${route}`).not.toContain(route);
      }
    }
  });

  it('never lets the site key create, import or revoke anything, nor read the backup', () => {
    const site: readonly string[] = SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN;
    for (const route of [
      'POST /v1/admin/keys',
      'POST /v1/admin/keys/import',
      'POST /v1/admin/keys/relabel',
      'POST /v1/admin/account/revoke',
      'GET /v1/admin/backup',
      'GET /v1/admin/stripe/delivery/:session_id',
      'POST /v1/admin/purchases/:id/confirm',
      'POST /v1/admin/purchases/:id/fail',
      'POST /v1/admin/purchases/:id/clawback',
      'POST /v1/admin/test-email',
      'POST /v1/admin/test-notify',
    ]) {
      expect(site, route).not.toContain(route);
    }
  });
});

describe('isAdminAuthorizedFor', () => {
  it('the full secret opens every admin route, listed or not', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.SITE_ADMIN_TOKEN = SITE;
    expect(isAdminAuthorizedFor(ADMIN, 'POST', '/v1/admin/keys')).toBe(true);
    expect(isAdminAuthorizedFor(ADMIN, 'GET', BACKUP_ROUTE)).toBe(true);
    expect(isAdminAuthorizedFor(ADMIN, 'GET', '/v1/admin/route-de-demain')).toBe(true);
  });

  it('the site key opens its list, and is refused everywhere else', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.SITE_ADMIN_TOKEN = SITE;
    expect(isAdminAuthorizedFor(SITE, 'GET', '/v1/admin/keys')).toBe(true);
    expect(isAdminAuthorizedFor(SITE, 'PATCH', '/v1/admin/forum-threads/:id')).toBe(true);
    // Même chemin, autre méthode : refusé.
    expect(isAdminAuthorizedFor(SITE, 'POST', '/v1/admin/keys')).toBe(false);
    expect(isAdminAuthorizedFor(SITE, 'POST', '/v1/admin/keys/import')).toBe(false);
    expect(isAdminAuthorizedFor(SITE, 'POST', '/v1/admin/account/revoke')).toBe(false);
    expect(isAdminAuthorizedFor(SITE, 'GET', BACKUP_ROUTE)).toBe(false);
    // Une route ajoutée demain est fermée sans que personne n'y pense.
    expect(isAdminAuthorizedFor(SITE, 'GET', '/v1/admin/route-de-demain')).toBe(false);
    // Le chemin concret n'est jamais comparé : seul le gabarit de la route l'est.
    expect(isAdminAuthorizedFor(SITE, 'PATCH', '/v1/admin/forum-threads/12')).toBe(false);
  });

  it('the backup token opens the backup and nothing else', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.BACKUP_TOKEN = BACKUP;
    expect(isAdminAuthorizedFor(BACKUP, 'GET', BACKUP_ROUTE)).toBe(true);
    expect(isAdminAuthorizedFor(BACKUP, 'POST', BACKUP_ROUTE)).toBe(false);
    expect(isAdminAuthorizedFor(BACKUP, 'GET', '/v1/admin/keys')).toBe(false);
  });

  it('never accepts a scoped key that is unset, empty or blank', () => {
    for (const blank of [undefined, '', ' ', '\t', '  \n']) {
      if (blank === undefined) delete process.env.SITE_ADMIN_TOKEN;
      else process.env.SITE_ADMIN_TOKEN = blank;
      for (const presented of [blank, '', ' ', undefined, SITE]) {
        expect(
          isAdminAuthorizedFor(presented, 'GET', '/v1/admin/keys'),
          JSON.stringify({ blank, presented }),
        ).toBe(false);
      }
    }
  });

  it('never accepts a blank ADMIN_SECRET either', () => {
    for (const blank of ['', ' ', '  \n']) {
      process.env.ADMIN_SECRET = blank;
      for (const presented of [blank, '', ' ', undefined]) {
        expect(isAdminAuthorizedFor(presented, 'GET', '/v1/admin/keys')).toBe(false);
        expect(isAdminAuthorized(presented)).toBe(false);
      }
    }
  });

  it('a key of one family never opens the routes of another', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.BACKUP_TOKEN = BACKUP;
    process.env.SITE_ADMIN_TOKEN = SITE;
    expect(isAdminAuthorizedFor(SITE, 'GET', BACKUP_ROUTE)).toBe(false);
    expect(isAdminAuthorizedFor(BACKUP, 'GET', '/v1/admin/keys')).toBe(false);
  });
});

describe('adminDecision', () => {
  it('tells a recognised key out of its list (403) from an unknown one (401)', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.SITE_ADMIN_TOKEN = SITE;
    expect(adminDecision(ADMIN, 'POST', '/v1/admin/keys')).toBe('full');
    expect(adminDecision(SITE, 'GET', '/v1/admin/keys')).toBe('scoped');
    expect(adminDecision(SITE, 'POST', '/v1/admin/keys')).toBe('out_of_scope');
    expect(adminDecision('not-a-key', 'GET', '/v1/admin/keys')).toBe('none');
    expect(adminDecision(undefined, 'GET', '/v1/admin/keys')).toBe('none');
  });
});

/**
 * La porte posée dans chaque route d'administration : elle lit la route qui
 * répond (méthode et gabarit enregistrés par Hono), jamais l'adresse demandée.
 */
describe('authorizeAdmin', () => {
  function appli() {
    const app = new Hono();
    const gate = (c: Parameters<typeof authorizeAdmin>[0]) =>
      authorizeAdmin(c) ? c.json({ ok: true }) : c.json({ error: 'unauthorized' }, 401);
    app.get('/v1/admin/keys', gate);
    app.post('/v1/admin/keys', gate);
    app.patch('/v1/admin/forum-threads/:id', gate);
    app.get('/v1/admin/route-de-demain', gate);
    return app;
  }
  const avec = (secret: string, method = 'GET') => ({
    method,
    headers: { 'X-Admin-Secret': secret },
  });

  beforeEach(() => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.SITE_ADMIN_TOKEN = SITE;
  });

  it('lets the site key through on a listed route, by the route pattern', async () => {
    expect((await appli().request('/v1/admin/keys', avec(SITE))).status).toBe(200);
    expect((await appli().request('/v1/admin/forum-threads/42', avec(SITE, 'PATCH'))).status).toBe(
      200,
    );
  });

  it('answers 403 to the site key off its list, 401 to an unknown secret', async () => {
    const off = await appli().request('/v1/admin/keys', avec(SITE, 'POST'));
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ error: 'forbidden' });
    expect((await appli().request('/v1/admin/route-de-demain', avec(SITE))).status).toBe(403);
    expect((await appli().request('/v1/admin/keys', avec('pas-la-cle'))).status).toBe(401);
    expect((await appli().request('/v1/admin/keys')).status).toBe(401);
  });

  it('lets the full secret through everywhere', async () => {
    expect((await appli().request('/v1/admin/keys', avec(ADMIN, 'POST'))).status).toBe(200);
    expect((await appli().request('/v1/admin/route-de-demain', avec(ADMIN))).status).toBe(200);
  });

  it('reads HEAD as the GET route it is served by', async () => {
    expect((await appli().request('/v1/admin/keys', avec(SITE, 'HEAD'))).status).toBe(200);
  });
});
