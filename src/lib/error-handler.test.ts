/**
 * Le 500 imprévu de l'API, en JSON (ARCH-09#1, audit du 10.11.2026), et ce qui
 * ne doit pas bouger avec lui : le statut d'une HTTPException, et le
 * remboursement des 4xx du middleware de clé (un 500 n'est pas remboursé, par
 * choix).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import {
  apiErrorHandler,
  INTERNAL_ERROR,
  INTERNAL_ERROR_MESSAGE,
  STACK_LOG_MAX_CHARS,
  redactStackValues,
} from './error-handler.js';
import { generateCreditKey } from './api-keys.js';
import { closeAll, getStatsDB } from './db.js';
import type { HonoEnv } from '../types.js';

const originalEnv = { ...process.env };

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'false';
  process.env.IBANFORGE_FREE_MODE = 'true';
  resetX402Paywall();
});

afterAll(() => {
  process.env = originalEnv;
  closeAll();
});

let errorSpy: MockInstance<typeof console.error>;
beforeAll(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockClear());
afterAll(() => errorSpy.mockRestore());

describe('une exception imprévue rend un 500 JSON', () => {
  it('dans la vraie application : application/json, jeton stable, rien de la cause', async () => {
    const app = buildApp();
    // Monté APRÈS buildApp() : la route passe par tous les middlewares globaux.
    app.get('/__test-error-handler/boom', () => {
      throw new Error('détail interne CH9300762011623852957');
    });
    const res = await app.request('https://api.ibanforge.com/__test-error-handler/boom', {
      headers: { 'x-real-ip': '203.0.113.91' },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const text = await res.text();
    const body = JSON.parse(text) as { error: string; message: string };
    expect(body.error).toBe(INTERNAL_ERROR);
    expect(body.message).toMatch(/support@ibanforge\.com/);
    expect(text).not.toContain('détail interne');
    // La cause est journalisée, l'IBAN de la pile masqué.
    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('/__test-error-handler/boom');
    expect(logged).toContain('détail interne');
    expect(logged).not.toContain('CH9300762011623852957');
  });

  it('masque aussi dans la pile ce qui a la forme d’une adresse ou d’une clé d’API (11.11.2026)', async () => {
    const app = buildApp();
    const values = [
      'acme@example.com',
      `ifk_${'0a'.repeat(32)}`,
      '203.0.113.7',
      '2001:db8::17',
      'fe80::1:2:3:4',
    ];
    app.get('/__test-error-handler/values', () => {
      throw new Error(`détail interne ${values.join(' ; ')}`);
    });
    const res = await app.request('https://api.ibanforge.com/__test-error-handler/values', {
      headers: { 'x-real-ip': '203.0.113.92' },
    });
    expect(res.status).toBe(500);
    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('détail interne');
    for (const value of values) expect(logged, value).not.toContain(value);
    // Les positions de la pile restent lisibles.
    expect(logged).toMatch(/\.(ts|js):\d+:\d+/);
  });

  it('masque en temps borné une pile très longue sans arobase, coupée avant d’être lue', async () => {
    // Deux millions de caractères d'une seule suite, sans arobase : sans borne,
    // chaque essai du motif des adresses relirait la suite jusqu'au bout.
    const long = 'a'.repeat(2_000_000);
    const started = performance.now();
    const out = redactStackValues(long);
    expect(performance.now() - started).toBeLessThan(500);
    expect(out.length).toBeLessThanOrEqual(STACK_LOG_MAX_CHARS + 32);
    expect(out.endsWith('[…pile coupée]')).toBe(true);
    // Une valeur proche de la coupure n'est pas laissée à moitié : la coupe se
    // fait au dernier blanc, avant elle.
    const near = `${'x'.repeat(STACK_LOG_MAX_CHARS - 10)} acme@example.com ${'y'.repeat(100)}`;
    expect(redactStackValues(near)).not.toContain('acme');

    // Par le gestionnaire : la console reçoit la pile coupée, le client le même 500.
    const app = buildApp();
    app.get('/__test-error-handler/long', () => {
      throw new Error(long);
    });
    const res = await app.request('https://api.ibanforge.com/__test-error-handler/long', {
      headers: { 'x-real-ip': '203.0.113.93' },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: INTERNAL_ERROR, message: INTERNAL_ERROR_MESSAGE });
    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged.length).toBeLessThan(STACK_LOG_MAX_CHARS + 1_000);
  });

  it('le contrat publié dit ce que le gestionnaire sert (error-semantics, OpenAPI)', async () => {
    const app = buildApp();
    const yaml = await (await app.request('https://api.ibanforge.com/error-semantics.yml')).text();
    const failure = yaml.slice(yaml.indexOf('unexpected_failure:'));
    expect(failure).toContain(`code: ${INTERNAL_ERROR}`);
    expect(failure).not.toMatch(/body: The plain text/);
    const spec = (await (await app.request('https://api.ibanforge.com/openapi.json')).json()) as {
      info: { description: string };
    };
    expect(spec.info.description).toContain(`error: ${INTERNAL_ERROR}`);
    expect(spec.info.description).not.toMatch(/500 is the plain text/);
  });

  it('une HTTPException garde sa réponse, comme avec le gestionnaire par défaut', async () => {
    const app = new Hono();
    app.onError(apiErrorHandler);
    app.get('/refus', () => {
      throw new HTTPException(403, {
        res: Response.json({ error: 'forbidden', message: 'Not on this route.' }, { status: 403 }),
      });
    });
    const res = await app.request('/refus');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Not on this route.' });
  });
});

describe('le remboursement des 4xx du middleware de clé ne bouge pas', () => {
  function appWithKey() {
    const app = new Hono<HonoEnv>();
    app.use('/v1/*', apiKeyMiddleware());
    app.get('/v1/test-boom', () => {
      throw new Error('panne imprévue');
    });
    app.get('/v1/test-http-400', () => {
      throw new HTTPException(400, {
        res: Response.json({ error: 'invalid_input' }, { status: 400 }),
      });
    });
    app.get('/v1/test-400', (c) => c.json({ error: 'invalid_input' }, 400));
    app.onError(apiErrorHandler);
    return app;
  }

  let seq = 0;
  function creditKey(): { api_key: string; key_hash: string } {
    seq += 1;
    return generateCreditKey(`erreurs-${Date.now()}-${seq}@alpha.example.net`, 10);
  }
  const creditsOf = (keyHash: string): number =>
    (
      getStatsDB()
        .prepare('SELECT credits_remaining FROM api_keys WHERE key_hash = ?')
        .get(keyHash) as { credits_remaining: number }
    ).credits_remaining;

  async function call(path: string, key: string): Promise<Response> {
    return appWithKey().request(path, { headers: { Authorization: `Bearer ${key}` } });
  }

  it('une exception imprévue : 500 JSON, le crédit reste débité (un 500 n’est pas remboursé)', async () => {
    const k = creditKey();
    const res = await call('/v1/test-boom', k.api_key);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe(INTERNAL_ERROR);
    expect(creditsOf(k.key_hash)).toBe(9);
  });

  it('une HTTPException 400 : rendue telle quelle, et remboursée', async () => {
    const k = creditKey();
    const res = await call('/v1/test-http-400', k.api_key);
    expect(res.status).toBe(400);
    expect(creditsOf(k.key_hash)).toBe(10);
  });

  it('un 400 rendu par la route : remboursé, comme avant', async () => {
    const k = creditKey();
    const res = await call('/v1/test-400', k.api_key);
    expect(res.status).toBe(400);
    expect(creditsOf(k.key_hash)).toBe(10);
  });
});
