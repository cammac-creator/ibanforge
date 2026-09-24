/**
 * La portée d'une session du compte client (lot C1, relecture de sécurité,
 * point 8) : lecture seule, et rien d'autre.
 *
 * Tout passe par `buildApp()`, rail de paiement ARMÉ, pour la raison que donne
 * `src/app.test.ts` : ce qui décide qui paie est l'ordre des middlewares, et une
 * mini-application ne prouverait que la mini-application. Le facilitateur x402
 * est la même doublure locale que dans `src/middleware/anonymous-trial.test.ts`.
 *
 * Fixtures inventées (dépôt public) : alpha.example.net.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { resetDailyLedger } from '../lib/daily-ip-ledger.js';
import { getStatsDB } from '../lib/db.js';
import { generateApiKey, validateApiKey } from '../lib/api-keys.js';
import { ACCOUNT_COOKIE, createSession } from '../lib/account.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
const VALID_IBAN = 'CH9300762011623852957';
const originalEnv = { ...process.env };
let facilitator: Server;
let facilitatorUrl: string;

beforeAll(async () => {
  facilitator = createServer((req, res) => {
    if (req.url === '/supported') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => facilitator.listen(0, '127.0.0.1', resolve));
  facilitatorUrl = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => facilitator.close(() => resolve()));
  process.env = originalEnv;
});

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = facilitatorUrl;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
  resetDailyLedger();
});

const API = 'https://api.ibanforge.com';

describe('portée d’une session : lecture seule', () => {
  it('Bearer ifs_ sur /v1/iban/validate : aucun appel authentifié', async () => {
    const email = 'portee@alpha.example.net';
    const key = generateApiKey(email);
    if (!key) throw new Error('frappe impossible');
    const { token } = createSession(email, email);
    const app = buildApp();
    const ip = { 'x-real-ip': '198.51.100.81' };

    // Une route payante en lecture : le paywall, exactement comme sans rien.
    const presentations: Array<Record<string, string>> = [
      { Authorization: `Bearer ${token}` },
      { 'X-API-Key': token },
      { Cookie: `${ACCOUNT_COOKIE}=${token}` },
    ];
    for (const header of presentations) {
      const bic = await app.request(`${API}/v1/bic/COBADEFFXXX`, { headers: { ...ip, ...header } });
      expect(bic.status, JSON.stringify(Object.keys(header))).toBe(402);
      expect(bic.headers.get('X-Quota-Used')).toBeNull();
    }

    // La validation avec un vrai IBAN : servie par l'ESSAI SANS CLÉ, jamais au
    // nom d'une clé. Le jeton n'est ni une clé valide ni une clé refusée.
    const res = await app.request(`${API}/v1/iban/validate`, {
      method: 'POST',
      headers: { ...ip, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ iban: VALID_IBAN }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Trial-Used')).not.toBeNull();
    expect(res.headers.get('X-Quota-Used')).toBeNull();
    expect(res.headers.get('X-API-Key-Invalid')).toBeNull();
    const logged = getStatsDB()
      .prepare(
        "SELECT key_prefix FROM request_log WHERE path = '/v1/iban/validate' ORDER BY id DESC LIMIT 1",
      )
      .get() as { key_prefix: string | null };
    expect(logged.key_prefix).toBeNull();
    const usage = getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM api_usage WHERE key_hash = ?')
      .get(key.key_hash) as { n: number };
    expect(usage.n, 'la clé de l’adresse n’a rien payé').toBe(0);

    // Le témoin : la vraie clé, elle, est bien authentifiée par ce même chemin.
    const real = await app.request(`${API}/v1/iban/validate`, {
      method: 'POST',
      headers: {
        ...ip,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key.api_key}`,
      },
      body: JSON.stringify({ iban: VALID_IBAN }),
    });
    expect(real.status).toBe(200);
    expect(real.headers.get('X-Quota-Used')).toBe('1');
  });

  it('le cookie de session n’ouvre ni rotate, ni revoke, ni report', async () => {
    const email = 'outils@alpha.example.net';
    const key = generateApiKey(email);
    if (!key) throw new Error('frappe impossible');
    const { token } = createSession(email, email);
    const app = buildApp();
    const routes: Array<[string, string]> = [
      ['POST', '/v1/keys/rotate'],
      ['POST', '/v1/keys/revoke'],
      ['GET', '/v1/keys/report'],
      ['GET', '/v1/keys/usage'],
      ['POST', '/v1/keys/claim'],
      ['GET', '/v1/credits/balance'],
    ];
    const presentations: Array<Record<string, string>> = [
      { Cookie: `${ACCOUNT_COOKIE}=${token}` },
      { Authorization: `Bearer ${token}` },
    ];
    for (const [method, path] of routes) {
      for (const header of presentations) {
        const res = await app.request(`${API}${path}`, {
          method,
          headers: { 'x-real-ip': '198.51.100.82', 'Content-Type': 'application/json', ...header },
          ...(method === 'POST' ? { body: JSON.stringify({ email }) } : {}),
        });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(((await res.json()) as { error: string }).error, `${method} ${path}`).toBe(
          'missing_key',
        );
      }
    }
    // La clé est intacte : ni tournée, ni révoquée.
    expect(validateApiKey(key.api_key).valid).toBe(true);
    const n = getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE email_norm = ?')
      .get(email) as { n: number };
    expect(n.n).toBe(1);
  });

  it('la session n’écrit rien sur une clé', async () => {
    const email = 'lecture@alpha.example.net';
    const key = generateApiKey(email);
    if (!key) throw new Error('frappe impossible');
    const db = getStatsDB();
    // Des lignes existantes à ne pas toucher : sans elles, une écriture qui ne
    // trouverait rien à modifier passerait pour une lecture.
    db.prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 7)').run(
      key.key_hash,
      new Date().toISOString().slice(0, 7),
    );
    db.prepare("INSERT INTO quota_notices (key_hash, month) VALUES (?, '2026-08')").run(
      key.key_hash,
    );
    db.prepare(
      "INSERT INTO request_log (method, path, status, response_ms, key_prefix) VALUES ('POST', '/v1/iban/validate', 200, 2, ?)",
    ).run(key.key_prefix);
    const snapshot = () => ({
      keys: db.prepare('SELECT * FROM api_keys WHERE email_norm = ? ORDER BY id').all(email),
      usage: db.prepare('SELECT * FROM api_usage WHERE key_hash = ?').all(key.key_hash),
      notices: db.prepare('SELECT * FROM quota_notices WHERE key_hash = ?').all(key.key_hash),
      log: db
        .prepare('SELECT COUNT(*) AS n FROM request_log WHERE key_prefix = ?')
        .get(key.key_prefix),
    });
    const before = snapshot();

    const { token } = createSession(email, email);
    const app = buildApp();
    const headers = { Cookie: `${ACCOUNT_COOKIE}=${token}`, 'x-real-ip': '198.51.100.83' };
    expect((await app.request(`${API}/v1/account/overview`, { headers })).status).toBe(200);
    expect(
      (await app.request(`${API}/v1/account/keys/report?prefix=${key.key_prefix}`, { headers }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request(`${API}/v1/account/logout`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: '{"all": true}',
        })
      ).status,
    ).toBe(204);

    expect(snapshot()).toEqual(before);
  });
});
