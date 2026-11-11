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
 * une clé qui a son propre quota. Ces appels ne remplissent plus le seau de
 * cette adresse ; tout autre appel venu de la même adresse reste limité.
 */
describe('clés serveur du site', () => {
  const PLAYGROUND = 'ifk_cle_du_playground_fictive';
  const REGISTRES = 'ifk_cle_des_registres_fictive';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function statuts(app: Hono, adresse: string, entetes: Record<string, string>, n: number) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const res = await app.request('/v1/anything', {
        headers: { 'x-real-ip': adresse, ...entetes },
      });
      out.push(res.status);
    }
    return out;
  }

  it('150 appels en une minute avec la clé du playground ne reçoivent aucun 429 ; sans elle, le 101e le reçoit', async () => {
    vi.stubEnv('PLAYGROUND_API_KEY', PLAYGROUND);
    vi.stubEnv('REGISTER_PAGES_API_KEY', '');
    const app = appWithLimiter();

    const avecCle = await statuts(
      app,
      '198.51.100.20',
      { Authorization: `Bearer ${PLAYGROUND}` },
      150,
    );
    expect(avecCle.filter((s) => s === 429)).toHaveLength(0);

    // La même adresse sans clé : le plafond par adresse tient, la rafale avec
    // clé ne l'a ni rempli ni vidé.
    const sansCle = await statuts(app, '198.51.100.20', {}, RATE_LIMIT + 1);
    expect(sansCle.slice(0, RATE_LIMIT).every((s) => s === 200)).toBe(true);
    expect(sansCle[RATE_LIMIT]).toBe(429);

    // Une autre clé, même de même forme, est comptée comme un appel ordinaire.
    const autreCle = await statuts(
      app,
      '198.51.100.21',
      { Authorization: 'Bearer ifk_cle_du_playground_fictivE' },
      RATE_LIMIT + 1,
    );
    expect(autreCle[RATE_LIMIT]).toBe(429);

    // Une clé passée dans l'adresse n'est pas exemptée.
    let dernier = 0;
    for (let i = 0; i < RATE_LIMIT + 1; i++) {
      const res = await app.request(`/v1/anything?api_key=${PLAYGROUND}`, {
        headers: { 'x-real-ip': '198.51.100.22' },
      });
      dernier = res.status;
    }
    expect(dernier).toBe(429);
  });

  it('reconnaît aussi la clé des pages de registre, en Bearer comme en X-API-Key', async () => {
    vi.stubEnv('PLAYGROUND_API_KEY', '');
    vi.stubEnv('REGISTER_PAGES_API_KEY', REGISTRES);
    const app = appWithLimiter();

    const bearer = await statuts(
      app,
      '198.51.100.30',
      { Authorization: `Bearer ${REGISTRES}` },
      RATE_LIMIT + 50,
    );
    expect(bearer.filter((s) => s === 429)).toHaveLength(0);

    const entete = await statuts(app, '198.51.100.31', { 'X-API-Key': REGISTRES }, RATE_LIMIT + 50);
    expect(entete.filter((s) => s === 429)).toHaveLength(0);

    // La clé facturée est celle du Bearer : une clé ordinaire en Bearer avec la
    // clé du site en X-API-Key reste comptée.
    const melange = await statuts(
      app,
      '198.51.100.32',
      { Authorization: 'Bearer ifk_cle_ordinaire_fictive', 'X-API-Key': REGISTRES },
      RATE_LIMIT + 1,
    );
    expect(melange[RATE_LIMIT]).toBe(429);

    // Sans variable posée, la clé ne change rien.
    vi.stubEnv('REGISTER_PAGES_API_KEY', '');
    const sansVariable = await statuts(
      app,
      '198.51.100.33',
      { Authorization: `Bearer ${REGISTRES}` },
      RATE_LIMIT + 1,
    );
    expect(sansVariable[RATE_LIMIT]).toBe(429);
  });
});
