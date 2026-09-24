/**
 * Ce qui protège les écritures du compte client contre un site tiers, et le
 * cookie lui-même (lot C1, relecture de sécurité, points 5, 6, 7, 15 et 16).
 *
 * Le CSRF de CONNEXION est le cas qui compte : un site tiers qui connecterait la
 * victime à la session de l'attaquant lui ferait ensuite « recharger » la clé de
 * l'attaquant en croyant recharger la sienne. Deux gardes l'arrêtent :
 * `Content-Type: application/json` obligatoire (ce qui force le preflight CORS)
 * et l'`Origin` contrôlé quand il est présent.
 *
 * Fixtures inventées (dépôt public) : alpha.example.net.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const relay = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; text: string; html?: string }>,
}));
vi.mock('../lib/mail-transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/mail-transport.js')>();
  return {
    ...actual,
    deliverViaRelay: async (m: { to: string; subject: string; text: string; html?: string }) => {
      relay.sent.push(m);
      return { outcome: 'sent' as const };
    },
  };
});

import { apiKeys } from './api-keys.js';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';
import { ACCOUNT_COOKIE, ACCOUNT_SESSION_SECONDS } from '../lib/account.js';
import { RATE_LIMIT } from '../middleware/rate-limit.js';

const ENV = { ...process.env };
const SITE = 'https://ibanforge.com';
const EVIL = 'https://evil.example';

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

function send(
  app: { request: Hono['request'] },
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  return Promise.resolve(
    app.request(`https://api.ibanforge.com${path}`, {
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.90', ...headers },
      body,
    }),
  );
}

function lastCodeFor(to: string): string {
  const mail = [...relay.sent].reverse().find((m) => m.to === to);
  const code = mail ? /^(\d{6}) /.exec(mail.subject)?.[1] : undefined;
  if (!code) throw new Error(`aucun code pour ${to}`);
  return code;
}

function count(sql: string, ...args: unknown[]): number {
  return (
    getStatsDB()
      .prepare(sql)
      .get(...args) as { n: number }
  ).n;
}

beforeEach(() => {
  relay.sent.length = 0;
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  process.env.CORS_ORIGIN = `${SITE},https://www.ibanforge.com`;
  const db = getStatsDB();
  db.prepare('DELETE FROM verification_sends').run();
  db.prepare('DELETE FROM account_login_codes').run();
  db.prepare('DELETE FROM account_sessions').run();
});

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

const WRITES = ['/v1/account/code', '/v1/account/session', '/v1/account/logout'];

describe('CSRF : les trois routes qui écrivent', () => {
  it('Content-Type texte : 415', async () => {
    const app = makeApp();
    const body = JSON.stringify({ email: 'texte@alpha.example.net', code: '123456' });
    for (const path of WRITES) {
      for (const type of [
        'text/plain',
        'text/plain;charset=UTF-8',
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
      ]) {
        const res = await send(app, path, body, { 'Content-Type': type });
        expect(res.status, `${path} en ${type}`).toBe(415);
        expect(((await res.json()) as { error: string }).error).toBe('unsupported_media_type');
      }
      const none = await send(app, path, body, {});
      expect(none.status, `${path} sans Content-Type`).toBe(415);
    }
    // Refusé avant tout : aucun envoi compté, aucun mail, aucune session.
    expect(count('SELECT COUNT(*) AS n FROM verification_sends')).toBe(0);
    expect(relay.sent).toHaveLength(0);
    expect(count('SELECT COUNT(*) AS n FROM account_sessions')).toBe(0);
  });

  it('Origin étrangère : 403', async () => {
    const app = makeApp();
    const email = 'origine@alpha.example.net';
    for (const path of WRITES) {
      for (const origin of [EVIL, 'null', 'https://ibanforge.com.evil.example']) {
        const res = await send(app, path, JSON.stringify({ email }), {
          'Content-Type': 'application/json',
          Origin: origin,
        });
        expect(res.status, `${path} depuis ${origin}`).toBe(403);
        expect(((await res.json()) as { error: string }).error).toBe('forbidden_origin');
      }
    }
    expect(relay.sent).toHaveLength(0);

    // Le site lui-même passe, et `curl` (sans Origin) aussi.
    const fromSite = await send(app, '/v1/account/code', JSON.stringify({ email }), {
      'Content-Type': 'application/json',
      Origin: SITE,
    });
    expect(fromSite.status).toBe(202);
    const fromCurl = await send(app, '/v1/account/code', JSON.stringify({ email }), {
      'Content-Type': 'application/json',
    });
    expect(fromCurl.status).toBe(202);

    // En production, la tolérance localhost du poste de développement tombe.
    process.env.NODE_ENV = 'production';
    const local = await send(app, '/v1/account/code', JSON.stringify({ email }), {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
    });
    expect(local.status).toBe(403);
  });

  it('un formulaire d’un site tiers ne connecte personne', async () => {
    const app = makeApp();
    // L'attaquant tient un code valable pour SA propre adresse.
    const attacker = 'attaquant@alpha.example.net';
    expect(
      (
        await send(app, '/v1/account/code', JSON.stringify({ email: attacker }), {
          'Content-Type': 'application/json',
        })
      ).status,
    ).toBe(202);
    const code = lastCodeFor(attacker);

    // Ce qu'un formulaire HTML peut poster sans preflight : form-encodé, ou le
    // classique `text/plain` dont le corps a l'air d'un JSON. Et le fetch d'un
    // site tiers qui aurait passé le preflight : son Origin le trahit.
    const attempts: Array<[string, Record<string, string>]> = [
      [
        `email=${encodeURIComponent(attacker)}&code=${code}`,
        { 'Content-Type': 'application/x-www-form-urlencoded', Origin: EVIL },
      ],
      [JSON.stringify({ email: attacker, code }), { 'Content-Type': 'text/plain', Origin: EVIL }],
      [
        JSON.stringify({ email: attacker, code }),
        { 'Content-Type': 'application/json', Origin: EVIL },
      ],
    ];
    for (const [body, headers] of attempts) {
      const res = await send(app, '/v1/account/session', body, headers);
      expect([403, 415], headers['Content-Type']).toContain(res.status);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect(count('SELECT COUNT(*) AS n FROM account_sessions')).toBe(0);
    // Le code n'a même pas été entamé : aucun essai compté, toujours valable.
    expect(
      count('SELECT attempts AS n FROM account_login_codes WHERE email_norm = ?', attacker),
    ).toBe(0);
    const own = await send(app, '/v1/account/session', JSON.stringify({ email: attacker, code }), {
      'Content-Type': 'application/json',
      Origin: SITE,
    });
    expect(own.status).toBe(200);
  });

  it('cookie SameSite=Strict, HttpOnly, Path=/v1/account', async () => {
    const app = makeApp();
    const email = 'cookie@alpha.example.net';
    await send(app, '/v1/account/code', JSON.stringify({ email }), {
      'Content-Type': 'application/json',
    });
    const res = await send(
      app,
      '/v1/account/session',
      JSON.stringify({ email, code: lastCodeFor(email) }),
      { 'Content-Type': 'application/json', Origin: SITE },
    );
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie') ?? '';
    const [pair, ...attributes] = header.split(';').map((s) => s.trim());
    expect(pair).toMatch(new RegExp(`^${ACCOUNT_COOKIE}=ifs_[0-9a-f]{64}$`));
    const attrs = attributes.map((a) => a.toLowerCase());
    expect(attrs).toContain('httponly');
    expect(attrs).toContain('secure');
    expect(attrs).toContain('samesite=strict');
    expect(attrs).toContain('path=/v1/account');
    expect(attrs).toContain(`max-age=${ACCOUNT_SESSION_SECONDS}`);
    expect(ACCOUNT_SESSION_SECONDS).toBe(604_800);
    // Hôte seul : jamais de Domain, qui l'étendrait à tout ibanforge.com.
    expect(attrs.some((a) => a.startsWith('domain='))).toBe(false);
    // Un nom distinct du cookie d'administration du site.
    expect(ACCOUNT_COOKIE).not.toBe('ibanforge_session');

    // L'effacement porte les mêmes attributs, sinon le navigateur garderait l'autre.
    const out = await send(app, '/v1/account/logout', '{}', {
      'Content-Type': 'application/json',
      Cookie: pair,
    });
    const cleared = (out.headers.get('set-cookie') ?? '').toLowerCase();
    expect(cleared).toContain(`${ACCOUNT_COOKIE}=;`);
    expect(cleared).toContain('max-age=0');
    expect(cleared).toContain('path=/v1/account');
    expect(cleared).toContain('samesite=strict');
  });
});

describe('CORS avec credentials', () => {
  it('seulement pour les origines exactes, jamais *', async () => {
    process.env.NODE_ENV = 'production';
    const app = buildApp();
    const preflight = (origin: string) =>
      app.request('https://api.ibanforge.com/v1/account/session', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
          'x-real-ip': '203.0.113.91',
        },
      });
    const ok = await preflight(SITE);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');

    const evil = await preflight(EVIL);
    expect(evil.headers.get('access-control-allow-origin')).not.toBe(EVIL);
    expect(evil.headers.get('access-control-allow-origin')).not.toBe('*');

    // La lecture connectée : l'origine exacte revient, avec les credentials.
    const read = await app.request('https://api.ibanforge.com/v1/account/overview', {
      headers: { Origin: SITE, 'x-real-ip': '203.0.113.91' },
    });
    expect(read.status).toBe(401);
    expect(read.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(read.headers.get('access-control-allow-credentials')).toBe('true');

    // Et la production refuse toujours de démarrer sur un joker.
    process.env.CORS_ORIGIN = '*';
    expect(() => buildApp()).toThrow(/CORS_ORIGIN/);
  });

  it('aucune autre route ne lit de cookie', () => {
    // `credentials: true` est global : il ne donne rien de plus aux autres routes
    // tant qu'aucune d'elles ne lit de cookie. Ce balayage le garde vrai.
    const src = fileURLToPath(new URL('..', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(path);
      }
    };
    walk(src);
    const readers = files
      .filter((f) =>
        /hono\/cookie|getCookie\(|getSignedCookie\(|header\(\s*['"]cookie['"]|headers\.get\(\s*['"]cookie['"]/i.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => relative(src, f).split('\\').join('/'));
    expect(readers).toEqual(['routes/account.ts']);
  });
});

describe('ce que les journaux gardent', () => {
  it('ni l’adresse, ni le code, ni le jeton', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    const app = buildApp();
    const email = 'journaux@alpha.example.net';
    const headers = { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.92' };
    const firstRow = count('SELECT COALESCE(MAX(id), 0) AS n FROM request_log');

    expect((await send(app, '/v1/account/code', JSON.stringify({ email }), headers)).status).toBe(
      202,
    );
    const code = lastCodeFor(email);
    const session = await send(
      app,
      '/v1/account/session',
      JSON.stringify({ email, code }),
      headers,
    );
    expect(session.status).toBe(200);
    const pair = (session.headers.get('set-cookie') ?? '').split(';')[0];
    const token = pair.split('=')[1];
    expect(token.startsWith('ifs_')).toBe(true);
    const view = await app.request('https://api.ibanforge.com/v1/account/overview', {
      headers: { Cookie: pair, 'x-real-ip': '203.0.113.92' },
    });
    expect(view.status).toBe(200);

    const out = lines.join('\n');
    expect(out).toContain('/v1/account/session');
    for (const secret of [email, code, token, token.slice(4)]) {
      expect(out, 'sortie standard').not.toContain(secret);
    }
    const rows = JSON.stringify(
      getStatsDB().prepare('SELECT * FROM request_log WHERE id > ?').all(firstRow),
    );
    expect(rows).toContain('/v1/account/code');
    for (const secret of [email, code, token.slice(4)]) {
      expect(rows, 'request_log').not.toContain(secret);
    }
  });

  it('le limiteur global s’applique aussi aux routes du compte', async () => {
    const app = buildApp();
    const headers = { 'x-real-ip': '203.0.113.93' };
    let last: Response | null = null;
    for (let i = 0; i <= RATE_LIMIT; i++) {
      last = await app.request('https://api.ibanforge.com/v1/account/overview', { headers });
      if (i < RATE_LIMIT) expect(last.status, `appel ${i + 1}`).toBe(401);
    }
    expect(last?.status).toBe(429);
  });
});
