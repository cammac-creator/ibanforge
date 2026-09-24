/**
 * Les sessions du compte client (lot C1, relecture de sécurité, points 4 et 9) :
 * ce qui est stocké, combien de temps elles vivent, et les quatre façons d'y
 * mettre fin (déconnexion, déconnexion partout, révocation par
 * l'administration, expiration), plus la purge.
 *
 * Fixtures inventées (dépôt public) : alpha.example.net.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';

const relay = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; text: string; html?: string }>,
}));
vi.mock('./mail-transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mail-transport.js')>();
  return {
    ...actual,
    deliverViaRelay: async (m: { to: string; subject: string; text: string; html?: string }) => {
      relay.sent.push(m);
      return { outcome: 'sent' as const };
    },
  };
});

import { apiKeys } from '../routes/api-keys.js';
import { getStatsDB } from './db.js';
import {
  ACCOUNT_COOKIE,
  ACCOUNT_SESSION_DAYS,
  ACCOUNT_SESSION_SECONDS,
  createSession,
  issueLoginCode,
  purgeAccountTables,
  readSession,
  revokeAllSessions,
  revokeSession,
} from './account.js';

const ENV = { ...process.env };
const ADMIN = 'correct-horse-battery-staple';

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function post(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.60', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Le jeton posé par une réponse, lu dans son en-tête Set-Cookie. */
function tokenFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const m = new RegExp(`${ACCOUNT_COOKIE}=([^;]*)`).exec(header);
  if (!m) throw new Error(`aucun cookie posé : ${header}`);
  return m[1];
}

/** Le vrai parcours : un code par mail, puis la session. Rend le jeton du cookie. */
async function signIn(app: Hono, email: string): Promise<string> {
  const sent = await post(app, '/v1/account/code', { email });
  if (sent.status !== 202) throw new Error(`code refusé : ${sent.status}`);
  const mail = [...relay.sent].reverse().find((m) => m.to === email);
  const code = mail ? /^(\d{6}) /.exec(mail.subject)?.[1] : undefined;
  const res = await post(app, '/v1/account/session', { email, code });
  if (res.status !== 200) throw new Error(`session refusée : ${res.status}`);
  return tokenFrom(res);
}

function overview(app: Hono, token: string): Promise<Response> {
  return Promise.resolve(
    app.request('/v1/account/overview', { headers: { Cookie: `${ACCOUNT_COOKIE}=${token}` } }),
  );
}

beforeEach(() => {
  relay.sent.length = 0;
  process.env.ADMIN_SECRET = ADMIN;
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  const db = getStatsDB();
  db.prepare('DELETE FROM verification_sends').run();
  db.prepare('DELETE FROM account_login_codes').run();
  db.prepare('DELETE FROM account_sessions').run();
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('les sessions du compte', () => {
  it('seule l’empreinte du jeton est stockée', async () => {
    const { token } = createSession('store@alpha.example.net', 'store@alpha.example.net');
    // 256 bits d'aléa derrière le préfixe, jamais le préfixe d'une clé.
    expect(token).toMatch(/^ifs_[0-9a-f]{64}$/);
    const rows = getStatsDB()
      .prepare('SELECT * FROM account_sessions WHERE email_norm = ?')
      .all('store@alpha.example.net') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha256(token));
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(token.slice(4));

    // Par la route : le jeton part dans le cookie, jamais dans le corps.
    const app = makeApp();
    await post(app, '/v1/account/code', { email: 'route@alpha.example.net' });
    const mail = relay.sent.find((m) => m.to === 'route@alpha.example.net');
    const code = /^(\d{6}) /.exec(mail?.subject ?? '')?.[1];
    const res = await post(app, '/v1/account/session', {
      email: 'route@alpha.example.net',
      code,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('ifs_');
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['expires_at', 'signed_in']);
    const cookieToken = tokenFrom(res);
    expect(
      getStatsDB()
        .prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE token_hash = ?')
        .get(sha256(cookieToken)),
    ).toEqual({ n: 1 });
  });

  it('un jeton neuf à chaque connexion, jamais celui que présente la requête', async () => {
    const app = makeApp();
    const email = 'fixation@alpha.example.net';
    const first = await signIn(app, email);
    const second = await signIn(app, email);
    expect(second).not.toBe(first);
    // Un jeton choisi par un tiers et glissé dans le cookie n'est jamais repris.
    const chosen = `ifs_${'a'.repeat(64)}`;
    await post(app, '/v1/account/code', { email });
    const mail = [...relay.sent].reverse().find((m) => m.to === email);
    const res = await post(
      app,
      '/v1/account/session',
      { email, code: /^(\d{6}) /.exec(mail?.subject ?? '')?.[1] },
      { Cookie: `${ACCOUNT_COOKIE}=${chosen}` },
    );
    expect(res.status).toBe(200);
    expect(tokenFrom(res)).not.toBe(chosen);
    expect(readSession(chosen)).toBeNull();
  });

  it('expirée au-delà de 7 jours', () => {
    const norm = 'duree@alpha.example.net';
    const { token } = createSession(norm, norm);
    const span = getStatsDB()
      .prepare(
        'SELECT (julianday(expires_at) - julianday(created_at)) AS days FROM account_sessions WHERE email_norm = ?',
      )
      .get(norm) as { days: number };
    expect(Math.round(span.days * 24)).toBe(ACCOUNT_SESSION_DAYS * 24);
    expect(ACCOUNT_SESSION_DAYS).toBe(7);
    expect(ACCOUNT_SESSION_SECONDS).toBe(604_800);
    expect(readSession(token)?.emailNorm).toBe(norm);

    // Le septième jour passé : la même session ne lit plus rien.
    getStatsDB()
      .prepare(
        "UPDATE account_sessions SET expires_at = datetime('now', '-1 second') WHERE email_norm = ?",
      )
      .run(norm);
    expect(readSession(token)).toBeNull();
  });

  it('la déconnexion révoque', async () => {
    const app = makeApp();
    const token = await signIn(app, 'logout@alpha.example.net');
    expect((await overview(app, token)).status).toBe(200);

    const out = await post(app, '/v1/account/logout', {}, { Cookie: `${ACCOUNT_COOKIE}=${token}` });
    expect(out.status).toBe(204);
    // Le cookie est effacé chez le navigateur…
    expect(out.headers.get('set-cookie')).toMatch(new RegExp(`${ACCOUNT_COOKIE}=;.*Max-Age=0`));
    // … ET la session est morte côté serveur : l'ancien jeton rejoué ne lit plus rien.
    const replay = await overview(app, token);
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { error: string }).error).toBe('signed_out');
    expect(readSession(token)).toBeNull();
  });

  it('se déconnecter partout révoque toutes les sessions de l’adresse', async () => {
    const app = makeApp();
    const phone = await signIn(app, 'partout@alpha.example.net');
    const laptop = await signIn(app, 'partout@alpha.example.net');
    // Même personne, étiquette « + » : même adresse normalisée, donc révoquée aussi.
    const tagged = await signIn(app, 'partout+bureau@alpha.example.net');
    const neighbour = await signIn(app, 'voisin@alpha.example.net');

    const out = await post(
      app,
      '/v1/account/logout',
      { all: true },
      { Cookie: `${ACCOUNT_COOKIE}=${phone}` },
    );
    expect(out.status).toBe(204);
    for (const t of [phone, laptop, tagged]) expect((await overview(app, t)).status).toBe(401);
    expect((await overview(app, neighbour)).status, 'une autre adresse garde sa session').toBe(200);
  });

  it('la révocation par l’administration coupe tout', async () => {
    const app = makeApp();
    const email = 'support@alpha.example.net';
    const a = await signIn(app, email);
    const b = await signIn(app, email);
    issueLoginCode(email);

    // Sans le secret : rien ne bouge.
    const refused = await post(app, '/v1/admin/account/revoke', { email });
    expect(refused.status).toBe(401);
    expect((await overview(app, a)).status).toBe(200);

    const res = await post(app, '/v1/admin/account/revoke', { email }, { 'X-Admin-Secret': ADMIN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: 2 });
    expect((await overview(app, a)).status).toBe(401);
    expect((await overview(app, b)).status).toBe(401);
    // Le code en cours, s'il y en avait un, est oublié aussi.
    expect(
      getStatsDB()
        .prepare('SELECT COUNT(*) AS n FROM account_login_codes WHERE email_norm = ?')
        .get(email),
    ).toEqual({ n: 0 });
  });

  it('revokeSession et revokeAllSessions ne comptent que ce qui vivait', () => {
    const norm = 'compte@alpha.example.net';
    const live = createSession(norm, norm).token;
    const expired = createSession(norm, norm).token;
    getStatsDB()
      .prepare(
        "UPDATE account_sessions SET expires_at = datetime('now', '-1 hour') WHERE token_hash = ?",
      )
      .run(sha256(expired));
    expect(revokeAllSessions(norm)).toBe(1);
    expect(revokeSession(live)).toBe(false);
    expect(revokeSession('ifk_pas-un-jeton')).toBe(false);
  });

  it('last_seen_at s’écrit au plus une fois par heure', () => {
    const norm = 'vu@alpha.example.net';
    const { token } = createSession(norm, norm);
    const seen = () =>
      (
        getStatsDB()
          .prepare('SELECT last_seen_at FROM account_sessions WHERE email_norm = ?')
          .get(norm) as { last_seen_at: string | null }
      ).last_seen_at;
    expect(seen()).toBeNull();
    readSession(token);
    const first = seen();
    expect(first).not.toBeNull();
    // Posé dix minutes plus tôt : une lecture dans l'heure n'écrit rien.
    getStatsDB()
      .prepare(
        "UPDATE account_sessions SET last_seen_at = datetime('now', '-10 minutes') WHERE email_norm = ?",
      )
      .run(norm);
    const tenMinutesAgo = seen();
    readSession(token);
    expect(seen()).toBe(tenMinutesAgo);
    // Au-delà d'une heure, la lecture suivante le remet à jour.
    getStatsDB()
      .prepare(
        "UPDATE account_sessions SET last_seen_at = datetime('now', '-2 hours') WHERE email_norm = ?",
      )
      .run(norm);
    const twoHoursAgo = seen();
    readSession(token);
    expect(seen()).not.toBe(twoHoursAgo);
  });

  it('la purge retire les codes expirés et les sessions mortes depuis plus d’un jour', () => {
    const db = getStatsDB();
    issueLoginCode('purge-code-vivant@alpha.example.net');
    issueLoginCode('purge-code-mort@alpha.example.net');
    db.prepare(
      "UPDATE account_login_codes SET expires_at = datetime('now', '-1 minute') WHERE email_norm = ?",
    ).run('purge-code-mort@alpha.example.net');

    const norm = 'purge@alpha.example.net';
    const alive = createSession(norm, norm).token;
    const expiredLongAgo = createSession(norm, norm).token;
    const expiredRecently = createSession(norm, norm).token;
    const revokedLongAgo = createSession(norm, norm).token;
    const revokedRecently = createSession(norm, norm).token;
    const set = (sql: string, token: string) =>
      db.prepare(`UPDATE account_sessions SET ${sql} WHERE token_hash = ?`).run(sha256(token));
    set("expires_at = datetime('now', '-2 days')", expiredLongAgo);
    set("expires_at = datetime('now', '-1 hour')", expiredRecently);
    set("revoked_at = datetime('now', '-2 days')", revokedLongAgo);
    set("revoked_at = datetime('now', '-1 hour')", revokedRecently);

    expect(purgeAccountTables()).toBe(3);
    const left = (
      db
        .prepare('SELECT token_hash FROM account_sessions WHERE email_norm = ?')
        .all(norm) as Array<{
        token_hash: string;
      }>
    ).map((r) => r.token_hash);
    expect(left.sort()).toEqual(
      [alive, expiredRecently, revokedRecently].map((t) => sha256(t)).sort(),
    );
    expect(
      db
        .prepare('SELECT email_norm FROM account_login_codes WHERE email_norm LIKE ?')
        .all('purge-code-%'),
    ).toEqual([{ email_norm: 'purge-code-vivant@alpha.example.net' }]);
  });
});
