/**
 * Le rapport d'une clé vu depuis le compte, `GET /v1/account/keys/report`
 * (lot C1) : le même rapport que la clé collée, et le même 404 pour tout ce
 * qui n'appartient pas à l'adresse de la session.
 *
 * Fixtures inventées (dépôt public) : alpha.example.net.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';
import { generateApiKey, generateCreditKey, revokeApiKey } from '../lib/api-keys.js';
import { ACCOUNT_COOKIE, ACCOUNT_REPORT_MAX_DAYS, createSession } from '../lib/account.js';

const ENV = { ...process.env };

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

function cookieFor(email: string): string {
  return `${ACCOUNT_COOKIE}=${createSession(email, email).token}`;
}

function logCall(keyPrefix: string, at: string, status: number, path = '/v1/iban/validate'): void {
  getStatsDB()
    .prepare(
      `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix, ip_hash)
         VALUES ('POST', ?, ?, 3, ?, ?, ?)`,
    )
    .run(path, status, at, keyPrefix, `ip-${status}`);
}

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe('GET /v1/account/keys/report', () => {
  it('le rapport d’une clé de l’adresse est le même que /v1/keys/report', async () => {
    const app = makeApp();
    const email = 'rapport@alpha.example.net';
    const key = generateApiKey(email);
    if (!key) throw new Error('frappe impossible');
    const recent = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    logCall(key.key_prefix, recent(20), 200);
    logCall(key.key_prefix, recent(5), 400);
    logCall(key.key_prefix, recent(2), 200, '/v1/bic/:code');
    logCall(key.key_prefix, recent(1), 429);
    getStatsDB()
      .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 3)')
      .run(key.key_hash, new Date().toISOString().slice(0, 7));

    const cookie = cookieFor(email);
    // Au-delà de 90 jours, le compte plafonne là où `/v1/keys/report` va jusqu'à
    // 365 : il rend alors le rapport de la clé collée sur 90 jours.
    for (const [query, pastedQuery] of [
      ['', ''],
      ['&days=7', '&days=7'],
      ['&days=90', '&days=90'],
      ['&days=9999', '&days=90'],
    ]) {
      const pasted = await app.request(`/v1/keys/report?x=1${pastedQuery}`, {
        headers: { Authorization: `Bearer ${key.api_key}` },
      });
      const signedIn = await app.request(
        `/v1/account/keys/report?prefix=${key.key_prefix}${query}`,
        { headers: { Cookie: cookie } },
      );
      expect(pasted.status).toBe(200);
      expect(signedIn.status).toBe(200);
      expect(signedIn.headers.get('cache-control')).toBe('no-store');
      const a = await pasted.json();
      expect(await signedIn.json()).toEqual(a);
      expect((a as { report: { total: number } }).report.total).toBeGreaterThan(0);
    }
  });

  it('depuis le compte, le rapport s’arrête à 90 jours', async () => {
    const app = makeApp();
    const email = 'fenetre@alpha.example.net';
    const key = generateCreditKey(email, 1000);
    const at = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    logCall(key.key_prefix, at(200), 200);
    logCall(key.key_prefix, at(120), 200);
    logCall(key.key_prefix, at(20), 200);
    const cookie = cookieFor(email);
    const read = async (path: string, headers: Record<string, string>) =>
      (await (await app.request(path, { headers })).json()) as {
        report: { window_days: number; total: number };
      };

    expect(ACCOUNT_REPORT_MAX_DAYS).toBe(90);
    for (const days of ['365', '91', '100000']) {
      const signedIn = await read(`/v1/account/keys/report?prefix=${key.key_prefix}&days=${days}`, {
        Cookie: cookie,
      });
      // Plafonné, pas refusé : la fenêtre servie est écrite dans la réponse.
      expect(signedIn.report.window_days, days).toBe(ACCOUNT_REPORT_MAX_DAYS);
      expect(signedIn.report.total, days).toBe(1);
    }
    // La clé collée garde sa propre borne : l'année entière.
    const pasted = await read('/v1/keys/report?days=365', {
      Authorization: `Bearer ${key.api_key}`,
    });
    expect(pasted.report.window_days).toBe(365);
    expect(pasted.report.total).toBe(3);
  });

  it('le préfixe d’une autre adresse rend le même 404 qu’un préfixe inconnu', async () => {
    const app = makeApp();
    const email = 'proprio@alpha.example.net';
    const mine = generateCreditKey(email, 1000);
    const revoked = generateCreditKey(email, 1000);
    revokeApiKey(revoked.api_key);
    const cohort = generateCreditKey(email, 1000);
    getStatsDB()
      .prepare(
        "UPDATE api_keys SET email = 'client-2026-09-24@cohorte.invalid' WHERE key_prefix = ?",
      )
      .run(cohort.key_prefix);
    const someoneElse = generateCreditKey('quelquun@alpha.example.net', 1000);
    const cookie = cookieFor(email);
    const ask = (prefix: string | null) =>
      app.request(
        `/v1/account/keys/report${prefix === null ? '' : `?prefix=${encodeURIComponent(prefix)}`}`,
        { headers: { Cookie: cookie } },
      );

    expect((await ask(mine.key_prefix)).status).toBe(200);

    const unknown = await ask('ifk_00000000');
    expect(unknown.status).toBe(404);
    const reference = await unknown.text();
    expect(JSON.parse(reference).error).toBe('not_found');
    for (const [label, prefix] of [
      ['une autre adresse', someoneElse.key_prefix],
      ['une clé révoquée', revoked.key_prefix],
      ['une clé regroupée en cohorte', cohort.key_prefix],
      ['un préfixe vide', ''],
      ['aucun préfixe', null],
      ['une forme quelconque', "ifk_' OR 1=1 --"],
    ] as const) {
      const res = await ask(prefix);
      expect(res.status, label).toBe(404);
      expect(await res.text(), label).toBe(reference);
    }

    // Sans session : 401, avant toute lecture de clé.
    const anonymous = await app.request(`/v1/account/keys/report?prefix=${mine.key_prefix}`);
    expect(anonymous.status).toBe(401);
  });

  it('le préfixe voyage en paramètre : ni le chemin journalisé ni la sortie ne le gardent', async () => {
    // Pourquoi un paramètre de requête plutôt qu'un segment de chemin : le
    // journal `request_log` ne garde que le chemin, et la purge des clés
    // résiliées (DPA 4.7) ne lit que la colonne `key_prefix`. Un préfixe dans le
    // chemin y survivrait douze mois.
    const email = 'journal@alpha.example.net';
    const key = generateCreditKey(email, 1000);
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const res = await buildApp().request(
      `https://api.ibanforge.com/v1/account/keys/report?prefix=${key.key_prefix}`,
      { headers: { Cookie: cookieFor(email), 'x-real-ip': '203.0.113.70' } },
    );
    expect(res.status).toBe(200);
    const row = getStatsDB()
      .prepare(
        "SELECT path, key_prefix FROM request_log WHERE path LIKE '/v1/account/%' ORDER BY id DESC LIMIT 1",
      )
      .get() as { path: string; key_prefix: string | null };
    expect(row.path).toBe('/v1/account/keys/report');
    expect(row.key_prefix).toBeNull();
    expect(logged.join('\n')).toContain('prefix=***');
    expect(logged.join('\n')).not.toContain(key.key_prefix);
  });
});
