import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { methodMismatch, notFoundBody, notFoundHandler } from './not-found.js';
import type { HonoEnv } from '../types.js';

/**
 * Le handler est monté TEL QUEL, comme dans src/index.ts (`app.notFound(
 * notFoundHandler)`), sur une app sans aucune route : toute requête tombe donc
 * dans le 404. C'est le chemin réel de Hono qui est exercé — statut,
 * content-type et corps — et non un appel direct à la fonction pure.
 *
 * src/index.ts reste inimportable (`serve()` à l'import, pas d'`app` exportée) ;
 * la seule ligne non couverte y est le montage lui-même.
 */
function makeApp() {
  const app = new Hono<HonoEnv>();
  app.notFound(notFoundHandler);
  return app;
}

describe('404 monté dans Hono', () => {
  it('oriente un POST sur la racine vers le bon endpoint', async () => {
    const res = await makeApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'CH9300762011623852957' }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = (await res.json()) as { did_you_mean?: string; endpoints?: unknown };
    expect(json.did_you_mean).toContain('/v1/iban/validate');
    expect(json.endpoints).toBeDefined();
  });

  it("garde le statut 404 et le message d'origine, au caractère près", async () => {
    const res = await makeApp().request('/nope/nope', { method: 'GET' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe('not_found');
    expect(json.message).toBe('Route GET /nope/nope not found');
  });
});

describe('did_you_mean — les trois confusions observées', () => {
  it.each([
    ['POST', '/', '/v1/iban/validate'],
    ['POST', '/v1/bic/UBSWCHZH', 'GET /v1/bic/UBSWCHZH'],
    ['GET', '/v1/iban/validate', 'POST the same path'],
    ['GET', '/v1/iban/compliance', 'POST the same path'],
    ['GET', '/v1/iban/batch', 'POST the same path'],
  ])('%s %s → %s', (method, path, expected) => {
    expect(notFoundBody(method, path).did_you_mean).toContain(expected);
  });

  it.each([
    ['GET', '/'],
    ['GET', '/v1/bic/UBSWCHZH'],
    ['POST', '/v1/iban/validate'],
    ['DELETE', '/v1/iban/validate'],
    ['GET', '/totalement/inconnu'],
  ])("ne devine rien pour %s %s (pas de piste inventée)", (method, path) => {
    expect(notFoundBody(method, path).did_you_mean).toBeUndefined();
  });

  it('sert le catalogue et les schémas même sans piste', () => {
    const body = notFoundBody('GET', '/totalement/inconnu');
    expect(body.endpoints.validate_iban).toContain('POST /v1/iban/validate');
    expect(body.endpoints.bic_lookup).toContain('GET /v1/bic/');
    expect(body.schema).toBe('https://api.ibanforge.com/openapi.json');
    expect(body.mcp).toBe('https://api.ibanforge.com/mcp');
  });
});

describe('DPA — le corps nomme le chemin, jamais la charge utile', () => {
  it("ne contient aucun champ dérivé du corps de requête", async () => {
    const iban = 'CH9300762011623852957';
    const res = await makeApp().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban }),
    });
    // Le seul champ variable est `message`, qui reprend le pathname. Ici le
    // pathname est `/` : l'IBAN posté ne ressort nulle part.
    expect(await res.text()).not.toContain(iban);
  });
});

/**
 * A 404 tells a machine "this endpoint does not exist" and it stops. A 405
 * with an Allow header tells it "right path, wrong verb" in a field it can act
 * on without parsing prose. Production request_log, 2026-07-29, distinct IPs
 * that hit a real endpoint with the wrong method and were told it did not
 * exist: 93 on /v1/iban/validate, 64 on /v1/iban/batch, 25 on
 * /v1/iban/compliance, 24 on /v1/keys/generate.
 */
describe('method mismatch — 405 with Allow, not 404', () => {
  const post = ['/v1/iban/validate', '/v1/iban/batch', '/v1/iban/compliance', '/v1/keys/generate'];

  for (const path of post) {
    it(`reports GET ${path} as a method mismatch allowing POST`, () => {
      const m = methodMismatch('GET', path);
      expect(m).toEqual({ allow: ['POST'] });
    });
  }

  it('treats HEAD and DELETE on a POST endpoint the same way', () => {
    expect(methodMismatch('HEAD', '/v1/iban/validate')).toEqual({ allow: ['POST'] });
    expect(methodMismatch('DELETE', '/v1/iban/compliance')).toEqual({ allow: ['POST'] });
  });

  it('reports POST on the GET-only BIC lookup as allowing GET', () => {
    expect(methodMismatch('POST', '/v1/bic/UBSWCHZH')).toEqual({ allow: ['GET'] });
  });

  it('does not fire on the correct method', () => {
    expect(methodMismatch('POST', '/v1/iban/validate')).toBeNull();
    expect(methodMismatch('GET', '/v1/bic/UBSWCHZH')).toBeNull();
  });

  it('does not fire on a path that is genuinely unknown', () => {
    expect(methodMismatch('GET', '/v1/nope')).toBeNull();
    expect(methodMismatch('POST', '/')).toBeNull();
  });

  it('still carries the did_you_mean hint in the body', () => {
    // The hint already existed; only the status code was wrong.
    expect(notFoundBody('GET', '/v1/iban/validate').did_you_mean).toMatch(/POST the same path/);
  });
});
