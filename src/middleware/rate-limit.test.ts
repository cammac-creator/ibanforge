import { afterEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { RATE_LIMIT, rateLimitMiddleware } from './rate-limit.js';

/**
 * The IETF draft names (RateLimit-Limit / -Remaining / -Reset) exist alongside
 * the legacy X-RateLimit-* triple because automated readiness scorers look for
 * the standard spelling. The 2026-07-28 channel audit found api-evangelist
 * scoring IBANforge `rate_limit_signal: false` while the server was in fact
 * emitting the legacy names on every limited route.
 *
 * The two differ in more than spelling: RateLimit-Reset is delta-seconds until
 * the window resets, where X-RateLimit-Reset is a unix timestamp. Both are kept
 * so existing clients reading the legacy header do not break.
 */
function appWithLimiter() {
  const app = new Hono();
  app.use('*', rateLimitMiddleware());
  app.get('/v1/anything', (c) => c.json({ ok: true }));
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}

const ip = (v: string) => ({ headers: { 'x-real-ip': v } });

describe('rate limit headers', () => {
  it('emits the IETF RateLimit-Limit header on a limited route', async () => {
    const res = await appWithLimiter().request('/v1/anything', ip('203.0.113.10'));
    expect(res.headers.get('RateLimit-Limit')).toBe('100');
  });

  it('emits RateLimit-Remaining counting down with each request', async () => {
    const app = appWithLimiter();
    const first = await app.request('/v1/anything', ip('203.0.113.11'));
    const second = await app.request('/v1/anything', ip('203.0.113.11'));
    expect(first.headers.get('RateLimit-Remaining')).toBe('99');
    expect(second.headers.get('RateLimit-Remaining')).toBe('98');
  });

  it('expresses RateLimit-Reset as delta-seconds, not a unix timestamp', async () => {
    const res = await appWithLimiter().request('/v1/anything', ip('203.0.113.12'));
    const reset = Number(res.headers.get('RateLimit-Reset'));
    // The window is 60s, so the delta must fall inside it. A unix timestamp
    // would be ~1.7e9 and fail this outright.
    expect(reset).toBeGreaterThan(0);
    expect(reset).toBeLessThanOrEqual(60);
  });

  it('keeps the legacy X-RateLimit-* triple so existing clients do not break', async () => {
    const res = await appWithLimiter().request('/v1/anything', ip('203.0.113.13'));
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
    // Legacy reset stays a unix timestamp.
    expect(Number(res.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(1_600_000_000);
  });

  it('does not emit rate limit headers on exempt routes', async () => {
    const res = await appWithLimiter().request('/health', ip('203.0.113.14'));
    expect(res.headers.get('RateLimit-Limit')).toBeNull();
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
  });
});

/**
 * WEB-05 (audit du 10.11.2026) : le playground et les pages de registre du site
 * appellent l'API depuis le serveur du site, donc depuis une seule adresse, avec
 * une clé à eux. Sur les routes que le site appelle réellement avec cette clé,
 * ces appels ne remplissent plus le seau de cette adresse ; partout ailleurs, et
 * jamais sous /v1/admin/ ni /stats/, la même clé est un appel ordinaire.
 */
describe('clés serveur du site', () => {
  const PLAYGROUND = 'ifk_cle_du_playground_fictive';
  const REGISTRES = 'ifk_cle_des_registres_fictive';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Les routes du site, aux gabarits de l'API, et des voisines qui n'en sont pas. */
  function appSite() {
    const app = new Hono();
    app.use('*', rateLimitMiddleware());
    app.post('/v1/iban/validate', (c) => c.json({ ok: true }));
    app.post('/v1/iban/compliance', (c) => c.json({ ok: true }));
    app.get('/v1/bic/:code', (c) => c.json({ ok: true }));
    app.get('/v1/ch/clearing/:iid', (c) => c.json({ ok: true }));
    app.post('/v1/iban/batch', (c) => c.json({ ok: true }));
    app.get('/v1/anything', (c) => c.json({ ok: true }));
    app.get('/v1/admin/keys', (c) => c.json({ ok: true }));
    app.get('/stats/overview', (c) => c.json({ ok: true }));
    return app;
  }

  async function statuts(
    app: Hono,
    route: string,
    adresse: string,
    entetes: Record<string, string>,
    n: number,
  ) {
    const [method, path] = route.split(' ');
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const res = await app.request(path, {
        method,
        headers: { 'x-real-ip': adresse, ...entetes },
      });
      out.push(res.status);
    }
    return out;
  }

  it('avec un mauvais secret d’administration, la clé du site ne soustrait rien au plafond sous /v1/admin/', async () => {
    vi.stubEnv('PLAYGROUND_API_KEY', PLAYGROUND);
    vi.stubEnv('ADMIN_SECRET', 'secret-fictif-du-limiteur');
    const res = await statuts(
      appSite(),
      'GET /v1/admin/keys',
      '198.51.100.50',
      { Authorization: `Bearer ${PLAYGROUND}`, 'X-Admin-Secret': 'mauvais-secret-fictif' },
      RATE_LIMIT + 1,
    );
    expect(res[RATE_LIMIT]).toBe(429);
  });

  it('avec un mauvais jeton de statistiques, la clé du site ne soustrait rien au plafond sous /stats/', async () => {
    vi.stubEnv('PLAYGROUND_API_KEY', PLAYGROUND);
    vi.stubEnv('STATS_TOKEN', 'jeton-fictif-des-statistiques');
    const res = await statuts(
      appSite(),
      'GET /stats/overview',
      '198.51.100.51',
      { Authorization: 'Bearer mauvais-jeton-fictif', 'X-API-Key': PLAYGROUND },
      RATE_LIMIT + 1,
    );
    expect(res[RATE_LIMIT]).toBe(429);
  });

  it('la clé du site est comptée hors de sa liste de routes, et ne l’est pas sur chacune des quatre routes de la liste', async () => {
    vi.stubEnv('PLAYGROUND_API_KEY', PLAYGROUND);
    vi.stubEnv('REGISTER_PAGES_API_KEY', '');
    const app = appSite();
    const cle = { Authorization: `Bearer ${PLAYGROUND}` };

    for (const [route, adresse] of [
      ['POST /v1/iban/batch', '198.51.100.52'],
      ['GET /v1/anything', '198.51.100.53'],
    ]) {
      const hors = await statuts(app, route, adresse, cle, RATE_LIMIT + 1);
      expect(hors[RATE_LIMIT], route).toBe(429);
    }

    for (const [route, adresse] of [
      ['POST /v1/iban/validate', '198.51.100.54'],
      ['POST /v1/iban/compliance', '198.51.100.55'],
      ['GET /v1/bic/UBSWCHZH80A', '198.51.100.56'],
      ['GET /v1/ch/clearing/00230', '198.51.100.57'],
    ]) {
      const dans = await statuts(app, route, adresse, cle, 150);
      expect(
        dans.filter((s) => s === 429),
        route,
      ).toHaveLength(0);
    }

    // Sur une route de la liste, la même adresse sans clé reste limitée : la
    // rafale avec clé n'a ni rempli ni vidé son seau.
    const sansCle = await statuts(
      app,
      'POST /v1/iban/validate',
      '198.51.100.54',
      {},
      RATE_LIMIT + 1,
    );
    expect(sansCle.slice(0, RATE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(sansCle[RATE_LIMIT]).toBe(429);

    // Une autre clé, même de même forme, est un appel ordinaire.
    const autreCle = await statuts(
      app,
      'POST /v1/iban/validate',
      '198.51.100.58',
      { Authorization: 'Bearer ifk_cle_du_playground_fictivE' },
      RATE_LIMIT + 1,
    );
    expect(autreCle[RATE_LIMIT]).toBe(429);

    // Une clé passée dans l'adresse n'est pas exemptée.
    const parAdresse = await statuts(
      app,
      `POST /v1/iban/validate?api_key=${PLAYGROUND}`,
      '198.51.100.59',
      {},
      RATE_LIMIT + 1,
    );
    expect(parAdresse[RATE_LIMIT]).toBe(429);
  });

  it('ne reconnaît ni une clé de même longueur mais différente, ni une plus courte, ni une plus longue', async () => {
    vi.stubEnv('PLAYGROUND_API_KEY', PLAYGROUND);
    vi.stubEnv('REGISTER_PAGES_API_KEY', '');
    const app = appSite();
    const voisines: [string, string][] = [
      [`${PLAYGROUND.slice(0, -1)}X`, '198.51.100.64'],
      [PLAYGROUND.slice(0, -1), '198.51.100.65'],
      [`${PLAYGROUND}x`, '198.51.100.66'],
    ];
    expect(voisines[0][0]).toHaveLength(PLAYGROUND.length);
    for (const [cle, adresse] of voisines) {
      const res = await statuts(
        app,
        'POST /v1/iban/validate',
        adresse,
        { Authorization: `Bearer ${cle}` },
        RATE_LIMIT + 1,
      );
      expect(res[RATE_LIMIT], cle).toBe(429);
    }
  });

  it('reconnaît aussi la clé des pages de registre, en Bearer comme en X-API-Key, sur la validation', async () => {
    vi.stubEnv('PLAYGROUND_API_KEY', '');
    vi.stubEnv('REGISTER_PAGES_API_KEY', REGISTRES);
    const app = appSite();
    const route = 'POST /v1/iban/validate';

    const bearer = await statuts(
      app,
      route,
      '198.51.100.60',
      { Authorization: `Bearer ${REGISTRES}` },
      150,
    );
    expect(bearer.filter((s) => s === 429)).toHaveLength(0);

    const entete = await statuts(app, route, '198.51.100.61', { 'X-API-Key': REGISTRES }, 150);
    expect(entete.filter((s) => s === 429)).toHaveLength(0);

    // La clé facturée est celle du Bearer : une clé ordinaire en Bearer avec la
    // clé du site en X-API-Key reste comptée.
    const melange = await statuts(
      app,
      route,
      '198.51.100.62',
      { Authorization: 'Bearer ifk_cle_ordinaire_fictive', 'X-API-Key': REGISTRES },
      RATE_LIMIT + 1,
    );
    expect(melange[RATE_LIMIT]).toBe(429);

    // Sans variable posée, la clé ne change rien.
    vi.stubEnv('REGISTER_PAGES_API_KEY', '');
    const sansVariable = await statuts(
      app,
      route,
      '198.51.100.63',
      { Authorization: `Bearer ${REGISTRES}` },
      RATE_LIMIT + 1,
    );
    expect(sansVariable[RATE_LIMIT]).toBe(429);
  });

  /**
   * 11.11.2026 (C23) : l'API reconnaissait les valeurs de SES variables
   * `PLAYGROUND_API_KEY` et `REGISTER_PAGES_API_KEY`, alors que le site présente
   * les siennes. `SITE_SERVER_API_KEYS` porte la liste des clés que le site
   * présente, séparées par des virgules : chaque entrée est une clé du site, sur
   * les mêmes quatre routes, comparée de la même façon.
   */
  describe('liste des clés serveur du site (SITE_SERVER_API_KEYS)', () => {
    const PREMIERE = 'ifk_premiere_cle_du_site_fictive';
    const SECONDE = 'ifk_seconde_cle_du_site_fictive';

    function sansLesDeuxAutres() {
      vi.stubEnv('PLAYGROUND_API_KEY', '');
      vi.stubEnv('REGISTER_PAGES_API_KEY', '');
    }

    it('reconnaît chaque entrée de la liste, espaces de bord tolérés, en Bearer comme en X-API-Key', async () => {
      sansLesDeuxAutres();
      vi.stubEnv('SITE_SERVER_API_KEYS', `  ${PREMIERE} ,${SECONDE}  `);
      const app = appSite();
      for (const [entetes, adresse] of [
        [{ Authorization: `Bearer ${PREMIERE}` }, '198.51.100.70'],
        [{ 'X-API-Key': SECONDE }, '198.51.100.71'],
      ] as const) {
        for (const route of [
          'POST /v1/iban/validate',
          'POST /v1/iban/compliance',
          'GET /v1/bic/UBSWCHZH80A',
          'GET /v1/ch/clearing/00230',
        ]) {
          const res = await statuts(app, route, adresse, entetes, RATE_LIMIT + 20);
          expect(
            res.filter((s) => s === 429),
            `${route} ${JSON.stringify(entetes)}`,
          ).toHaveLength(0);
        }
      }
    });

    it('ignore les entrées vides : « a,,b » reconnaît a et b, « , » ne reconnaît rien', async () => {
      sansLesDeuxAutres();
      vi.stubEnv('SITE_SERVER_API_KEYS', `${PREMIERE},, ,${SECONDE},`);
      const app = appSite();
      const route = 'POST /v1/iban/validate';
      const a = await statuts(
        app,
        route,
        '198.51.100.72',
        { Authorization: `Bearer ${PREMIERE}` },
        RATE_LIMIT + 20,
      );
      expect(a.filter((s) => s === 429)).toHaveLength(0);
      const b = await statuts(
        app,
        route,
        '198.51.100.73',
        { Authorization: `Bearer ${SECONDE}` },
        RATE_LIMIT + 20,
      );
      expect(b.filter((s) => s === 429)).toHaveLength(0);

      vi.stubEnv('SITE_SERVER_API_KEYS', ' , ');
      const rien = await statuts(
        app,
        route,
        '198.51.100.74',
        { Authorization: `Bearer ${PREMIERE}` },
        RATE_LIMIT + 1,
      );
      expect(rien[RATE_LIMIT]).toBe(429);
    });

    it('variable vide ou absente : aucun effet', async () => {
      sansLesDeuxAutres();
      const app = appSite();
      vi.stubEnv('SITE_SERVER_API_KEYS', '');
      const vide = await statuts(
        app,
        'POST /v1/iban/validate',
        '198.51.100.75',
        { Authorization: `Bearer ${PREMIERE}` },
        RATE_LIMIT + 1,
      );
      expect(vide[RATE_LIMIT]).toBe(429);
      vi.stubEnv('SITE_SERVER_API_KEYS', undefined);
      const absente = await statuts(
        app,
        'POST /v1/iban/validate',
        '198.51.100.76',
        { Authorization: `Bearer ${PREMIERE}` },
        RATE_LIMIT + 1,
      );
      expect(absente[RATE_LIMIT]).toBe(429);
    });

    it('ne reconnaît ni la valeur entière de la variable, ni une entrée voisine', async () => {
      sansLesDeuxAutres();
      vi.stubEnv('SITE_SERVER_API_KEYS', `${PREMIERE},${SECONDE}`);
      const app = appSite();
      for (const [cle, adresse] of [
        [`${PREMIERE},${SECONDE}`, '198.51.100.77'],
        [`${PREMIERE.slice(0, -1)}X`, '198.51.100.78'],
        [`${SECONDE}x`, '198.51.100.79'],
      ]) {
        const res = await statuts(
          app,
          'POST /v1/iban/validate',
          adresse,
          { Authorization: `Bearer ${cle}` },
          RATE_LIMIT + 1,
        );
        expect(res[RATE_LIMIT], cle).toBe(429);
      }
    });

    it('hors des quatre routes, sous /v1/admin/ et sous /stats/, une clé de la liste reste comptée', async () => {
      sansLesDeuxAutres();
      vi.stubEnv('SITE_SERVER_API_KEYS', PREMIERE);
      vi.stubEnv('ADMIN_SECRET', 'secret-fictif-du-limiteur');
      vi.stubEnv('STATS_TOKEN', 'jeton-fictif-des-statistiques');
      const app = appSite();
      const cle = { Authorization: `Bearer ${PREMIERE}` };
      for (const [route, adresse, entetes] of [
        ['POST /v1/iban/batch', '198.51.100.80', cle],
        ['GET /v1/anything', '198.51.100.81', cle],
        ['GET /v1/admin/keys', '198.51.100.82', { ...cle, 'X-Admin-Secret': 'mauvais-secret' }],
        ['GET /stats/overview', '198.51.100.83', { 'X-API-Key': PREMIERE }],
      ] as const) {
        const res = await statuts(app, route, adresse, entetes, RATE_LIMIT + 1);
        expect(res[RATE_LIMIT], route).toBe(429);
      }
    });
  });
});
