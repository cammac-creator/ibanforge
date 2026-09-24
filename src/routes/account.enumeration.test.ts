/**
 * L'anti-énumération du compte client (lot C1, relecture de sécurité, point 1).
 *
 * La protection est STRUCTURELLE : les routes `code` et `session` ne lisent pas
 * `api_keys`, donc elles ne peuvent rien trahir. Ce fichier le prouve de trois
 * façons : la table des clés est RETIRÉE le temps des appels et ils répondent
 * quand même, aucune requête préparée ne la nomme, et les réponses, les mails
 * et les durées sont les mêmes pour une adresse qui porte des clés et pour une
 * adresse qui n'en porte pas.
 *
 * Le relais est une doublure qui retient les messages (voir
 * `src/lib/account.codes.test.ts`). Fixtures inventées : alpha.example.net.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

const relay = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; text: string; html?: string }>,
  /** Latence simulée du relais, posée par le seul test chronométré. */
  delayMs: 0,
}));
vi.mock('../lib/mail-transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/mail-transport.js')>();
  return {
    ...actual,
    deliverViaRelay: async (m: { to: string; subject: string; text: string; html?: string }) => {
      if (relay.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, relay.delayMs));
      relay.sent.push(m);
      return { outcome: 'sent' as const };
    },
  };
});
const mailDomain = vi.hoisted(() => ({ accepts: true }));
vi.mock('../lib/mail-domain.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/mail-domain.js')>();
  return { ...actual, domainAcceptsMail: async () => mailDomain.accepts };
});

import { apiKeys } from './api-keys.js';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';
import { generateApiKey, generateCreditKey } from '../lib/api-keys.js';
import { VERIFICATION_SENDS_PER_EMAIL_DAY } from '../lib/key-creation-guard.js';

const ENV = { ...process.env };

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

type Requester = { request: Hono['request'] };

function post(app: Requester, path: string, body: unknown, ip: string): Promise<Response> {
  return Promise.resolve(
    app.request(`https://api.ibanforge.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify(body),
    }),
  );
}

function lastMailTo(to: string): { subject: string; text: string; html?: string } {
  const mail = [...relay.sent].reverse().find((m) => m.to === to);
  if (!mail) throw new Error(`aucun mail pour ${to}`);
  return mail;
}

function codeOf(mail: { subject: string }): string {
  const code = /^(\d{6}) /.exec(mail.subject)?.[1];
  if (!code) throw new Error('code introuvable');
  return code;
}

/** Une adresse qui porte plusieurs clés, de plusieurs sortes. */
const HOLDER = 'holder@alpha.example.net';
/** Une adresse qui n'en porte aucune. */
const NOBODY = 'nobody@alpha.example.net';

beforeEach(() => {
  relay.sent.length = 0;
  relay.delayMs = 0;
  mailDomain.accepts = true;
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  const db = getStatsDB();
  db.prepare('DELETE FROM verification_sends').run();
  db.prepare('DELETE FROM account_login_codes').run();
  if (
    !(db.prepare('SELECT 1 AS one FROM api_keys WHERE email_norm = ?').get(HOLDER) as
      { one: number } | undefined)
  ) {
    generateApiKey(HOLDER);
    for (let i = 0; i < 20; i++) generateCreditKey(HOLDER, 1000);
  }
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('anti-énumération : POST /v1/account/code et /v1/account/session', () => {
  it('même statut, même corps et même mail avec ou sans clé', async () => {
    const app = makeApp();
    const a = await post(app, '/v1/account/code', { email: HOLDER }, '203.0.113.50');
    const b = await post(app, '/v1/account/code', { email: NOBODY }, '203.0.113.51');
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const bodyA = await a.text();
    expect(bodyA).toBe(await b.text());
    expect(JSON.parse(bodyA)).toEqual({ status: 'code_sent', expires_in: 900 });
    for (const h of ['content-type', 'cache-control', 'set-cookie']) {
      expect(a.headers.get(h), h).toBe(b.headers.get(h));
    }

    // Le même mail, au code près : rien n'y dépend des clés de l'adresse.
    const mailA = lastMailTo(HOLDER);
    const mailB = lastMailTo(NOBODY);
    const mask = (m: { subject: string; text: string; html?: string }) => {
      const code = codeOf(m);
      return {
        subject: m.subject.split(code).join('CODE'),
        text: m.text.split(code).join('CODE'),
        html: (m.html ?? '').split(code).join('CODE'),
      };
    };
    expect(mask(mailA)).toEqual(mask(mailB));

    // Et la session s'ouvre de la même façon.
    const sa = await post(
      app,
      '/v1/account/session',
      { email: HOLDER, code: codeOf(mailA) },
      '203.0.113.50',
    );
    const sb = await post(
      app,
      '/v1/account/session',
      { email: NOBODY, code: codeOf(mailB) },
      '203.0.113.51',
    );
    expect(sa.status).toBe(200);
    expect(sb.status).toBe(200);
    const ja = (await sa.json()) as Record<string, unknown>;
    const jb = (await sb.json()) as Record<string, unknown>;
    expect(Object.keys(ja).sort()).toEqual(Object.keys(jb).sort());
    expect(ja.signed_in).toBe(true);
    expect(jb.signed_in).toBe(true);
  });

  it('les routes code et session ne lisent pas api_keys', async () => {
    const db = getStatsDB();
    const spy = vi.spyOn(db, 'prepare');
    let statements: string[] = [];
    // 🚨 La table des clés est RETIRÉE le temps des appels. Une lecture, même par
    // une requête préparée plus tôt et gardée en cache, échouerait alors en 500.
    db.exec('ALTER TABLE api_keys RENAME TO api_keys_hidden_for_test');
    try {
      for (const app of [makeApp(), buildApp()] as Requester[]) {
        for (const [email, ip] of [
          [HOLDER, '203.0.113.52'],
          [NOBODY, '203.0.113.53'],
        ] as const) {
          const code = await post(app, '/v1/account/code', { email }, ip);
          expect(code.status, `code pour ${email}`).toBe(202);
          const session = await post(
            app,
            '/v1/account/session',
            { email, code: codeOf(lastMailTo(email)) },
            ip,
          );
          expect(session.status, `session pour ${email}`).toBe(200);
          // Un mauvais code aussi : la branche d'échec ne lit rien de plus.
          const wrong = await post(app, '/v1/account/session', { email, code: '000000' }, ip);
          expect(wrong.status).toBe(400);
        }
      }
    } finally {
      // Relevé AVANT la restauration, qui efface l'historique du témoin.
      statements = spy.mock.calls.map((call) => String(call[0]));
      spy.mockRestore();
      db.exec('ALTER TABLE api_keys_hidden_for_test RENAME TO api_keys');
    }
    expect(statements.length, 'le témoin a bien vu passer des requêtes').toBeGreaterThan(0);
    expect(statements.some((s) => s.includes('verification_sends'))).toBe(true);
    expect(statements.filter((s) => /\bapi_keys\b/.test(s))).toEqual([]);
  });

  it('429 identique avec ou sans clé', async () => {
    const app = makeApp();
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      expect((await post(app, '/v1/account/code', { email: HOLDER }, '203.0.113.54')).status).toBe(
        202,
      );
      expect((await post(app, '/v1/account/code', { email: NOBODY }, '203.0.113.54')).status).toBe(
        202,
      );
    }
    const a = await post(app, '/v1/account/code', { email: HOLDER }, '203.0.113.54');
    const b = await post(app, '/v1/account/code', { email: NOBODY }, '203.0.113.54');
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    const bodyA = await a.text();
    expect(bodyA).toBe(await b.text());
    expect(JSON.parse(bodyA).error).toBe('code_rate_limited');
    // Le refus compte des codes, il ne parle jamais de clés.
    expect(bodyA).not.toMatch(/\bkeys?\b/i);
  });

  it('domaine jetable : 400 qui ne parle pas des clés', async () => {
    const app = makeApp();
    const sendsBefore = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM verification_sends').get() as { n: number }
    ).n;
    for (const email of ['someone@mailinator.com', 'someone@example.com']) {
      const res = await post(app, '/v1/account/code', { email }, '203.0.113.55');
      expect(res.status, email).toBe(400);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('disposable_email');
      expect(body.message).not.toMatch(/\bkeys?\b/i);
    }
    // Refusé AVANT le registre : rien de compté, rien d'envoyé.
    const sendsAfter = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM verification_sends').get() as { n: number }
    ).n;
    expect(sendsAfter).toBe(sendsBefore);
    expect(relay.sent).toHaveLength(0);
  });

  it('domaine sans serveur de courrier : 400 qui ne parle pas des clés', async () => {
    // Le contrôle du domaine est sauté sous vitest (un test ne dépend pas d'un
    // résolveur) : le drapeau est levé le temps de l'appel, le résolveur est une
    // doublure qui répond « aucun serveur ».
    mailDomain.accepts = false;
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const res = await post(
        makeApp(),
        '/v1/account/code',
        { email: 'someone@nomail.alpha.example.net' },
        '203.0.113.56',
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('undeliverable_email');
      expect(body.message).not.toMatch(/\bkeys?\b/i);
    } finally {
      process.env.VITEST = vitest ?? 'true';
    }
    expect(relay.sent).toHaveLength(0);
  });

  it('durée identique avec ou sans clé (écart sous le bruit)', async () => {
    // La preuve de fond est le test « ne lisent pas api_keys » ci-dessus. Celui-ci
    // mesure ce qu'un attaquant mesurerait : la durée de la réponse. L'adresse
    // témoin porte vingt et une clés, pour qu'un travail par clé, s'il existait,
    // se voie. Appels ALTERNÉS pour que la charge de la machine pèse autant sur
    // les deux séries, et médianes pour qu'un ramasse-miettes isolé ne décide
    // rien. Le registre d'envois est vidé entre deux appels, hors chronomètre :
    // sans cela, les plafonds répondraient 429 dès le quatrième.
    //
    // Le relais simulé prend quelques millisecondes, comme un vrai relais en
    // prend des centaines : c'est ce qui rend visible l'implémentation écartée
    // par le plan (ne rien envoyer aux adresses sans clé). Avec un relais
    // instantané, ce test ne pourrait rien voir.
    relay.delayMs = 8;
    const app = makeApp();
    const db = getStatsDB();
    const timeOne = async (email: string): Promise<number> => {
      db.prepare('DELETE FROM verification_sends').run();
      const t0 = performance.now();
      const res = await post(app, '/v1/account/code', { email }, '203.0.113.57');
      const dt = performance.now() - t0;
      expect(res.status).toBe(202);
      return dt;
    };
    for (let i = 0; i < 5; i++) {
      await timeOne(HOLDER);
      await timeOne(NOBODY);
    }
    const withKeys: number[] = [];
    const withoutKeys: number[] = [];
    for (let i = 0; i < 40; i++) {
      withKeys.push(await timeOne(HOLDER));
      withoutKeys.push(await timeOne(NOBODY));
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    const a = median(withKeys);
    const b = median(withoutKeys);
    expect(Math.abs(a - b), `médianes ${a.toFixed(3)} ms contre ${b.toFixed(3)} ms`).toBeLessThan(
      Math.max(3, 0.5 * Math.min(a, b)),
    );
  });
});
