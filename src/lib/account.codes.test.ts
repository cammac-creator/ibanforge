/**
 * Les codes de connexion au compte client (lot C1) : leur durée, leurs essais,
 * le budget d'envoi qu'ils partagent avec la création et la réclamation de clé,
 * et l'étanchéité avec les défis de ces deux chemins.
 *
 * Le relais de courrier est remplacé par une doublure qui RETIENT les messages :
 * c'est le seul moyen de lire le code comme le destinataire le lirait. Seule
 * `deliverViaRelay` est remplacée ; tous les gabarits restent réels.
 *
 * Fixtures inventées (dépôt public) : adresses en alpha.example.net.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

const relay = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; text: string; html?: string }>,
  outcome: 'sent' as 'sent' | 'undeliverable' | 'refused',
}));
vi.mock('./mail-transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mail-transport.js')>();
  return {
    ...actual,
    deliverViaRelay: async (m: { to: string; subject: string; text: string; html?: string }) => {
      relay.sent.push(m);
      return { outcome: relay.outcome };
    },
  };
});
// L'alerte d'exploitation, retenue plutôt qu'envoyée : on vérifie qu'elle part
// (et le shell de la machine peut porter un vrai jeton Telegram).
const ops = vi.hoisted(() => ({
  fails: [] as Array<{ key: string; threshold?: number }>,
  oks: [] as string[],
}));
vi.mock('./ops-alert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ops-alert.js')>();
  return {
    ...actual,
    opsFail: async (key: string, _detail: string, threshold?: number) => {
      ops.fails.push({ key, threshold });
    },
    opsOk: async (key: string) => {
      ops.oks.push(key);
    },
  };
});

import { apiKeys } from '../routes/api-keys.js';
import { getStatsDB } from './db.js';
import {
  ACCOUNT_CODES_GLOBAL_PER_HOUR,
  ACCOUNT_CODE_CEILING_ALERT,
  checkLoginCode,
  issueLoginCode,
  resetAccountCodeCeilingAlert,
} from './account.js';
import {
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_SENDS_PER_EMAIL_DAY,
  VERIFICATION_TTL_MINUTES,
  checkVerificationCode,
  createVerificationChallenge,
  keyCreationSource,
  recordKeyCreation,
  verificationDelivery,
} from './key-creation-guard.js';
import { generateApiKey, getKeyTier } from './api-keys.js';

const ENV = { testKeys: process.env.IBANFORGE_ADMIN_TEST_KEYS };

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

function post(
  app: Hono,
  path: string,
  body: Record<string, unknown>,
  ip: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Le dernier code reçu par cette adresse, lu dans l'objet du mail. */
function lastCodeFor(to: string): string {
  const mail = [...relay.sent].reverse().find((m) => m.to === to);
  const code = mail ? /^(\d{6}) /.exec(mail.subject)?.[1] : undefined;
  if (!code) throw new Error(`aucun code reçu par ${to}`);
  return code;
}

/** Une clé anonyme qui a servi un appel : ce que `/v1/keys/claim` exige. */
function servedAnonymousKey(): { api_key: string; key_hash: string; key_prefix: string } {
  const k = generateApiKey(null);
  if (!k) throw new Error('frappe impossible');
  getStatsDB()
    .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 1)')
    .run(k.key_hash, new Date().toISOString().slice(0, 7));
  return k;
}

beforeEach(() => {
  relay.sent.length = 0;
  relay.outcome = 'sent';
  ops.fails.length = 0;
  ops.oks.length = 0;
  // La garde des domaines fictifs reste ARMÉE : les adresses de ce fichier
  // sont en alpha.example.net, qu'elle laisse passer, comme en production.
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  const db = getStatsDB();
  db.prepare('DELETE FROM verification_sends').run();
  db.prepare('DELETE FROM account_login_codes').run();
  db.prepare('DELETE FROM pending_verifications').run();
});

afterEach(() => {
  if (ENV.testKeys === undefined) delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  else process.env.IBANFORGE_ADMIN_TEST_KEYS = ENV.testKeys;
});

describe('les codes de connexion', () => {
  it('un code expire après 15 minutes', () => {
    const norm = 'expire@alpha.example.net';
    const code = issueLoginCode(norm);
    expect(code).toMatch(/^\d{6}$/);
    const age = getStatsDB()
      .prepare(
        'SELECT (julianday(expires_at) - julianday(created_at)) * 1440 AS minutes FROM account_login_codes WHERE email_norm = ?',
      )
      .get(norm) as { minutes: number };
    expect(Math.round(age.minutes)).toBe(VERIFICATION_TTL_MINUTES);
    expect(VERIFICATION_TTL_MINUTES).toBe(15);

    // Le quart d'heure passé : la ligne est vieillie, le code juste est refusé.
    getStatsDB()
      .prepare(
        "UPDATE account_login_codes SET expires_at = datetime('now', '-1 second') WHERE email_norm = ?",
      )
      .run(norm);
    expect(checkLoginCode(norm, code)).toEqual({ ok: false, reason: 'expired' });
    // Et la ligne expirée est retirée : rien ne reste à deviner.
    expect(checkLoginCode(norm, code)).toEqual({ ok: false, reason: 'no_code' });
  });

  it('cinq essais puis nouveau code exigé', async () => {
    const norm = 'essais@alpha.example.net';
    const code = issueLoginCode(norm);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < VERIFICATION_MAX_ATTEMPTS; i++) {
      expect(checkLoginCode(norm, wrong)).toEqual({ ok: false, reason: 'wrong_code' });
    }
    // 🚨 Le sixième essai échoue même avec le BON code.
    expect(checkLoginCode(norm, code)).toEqual({ ok: false, reason: 'too_many_attempts' });

    // La même chose par la route, qui ne le dit PAS autrement : le code épuisé
    // rend exactement la réponse d'un code faux (voir aussi
    // `src/routes/account.enumeration.test.ts`).
    const app = makeApp();
    const email = 'essais-route@alpha.example.net';
    expect((await post(app, '/v1/account/code', { email }, '203.0.113.10')).status).toBe(202);
    const good = lastCodeFor(email);
    const bad = good === '000000' ? '111111' : '000000';
    const wrongBodies: string[] = [];
    for (let i = 0; i < VERIFICATION_MAX_ATTEMPTS; i++) {
      const r = await post(app, '/v1/account/session', { email, code: bad }, '203.0.113.10');
      expect(r.status).toBe(400);
      wrongBodies.push(await r.text());
    }
    expect(new Set(wrongBodies).size).toBe(1);
    expect(JSON.parse(wrongBodies[0]).error).toBe('invalid_code');
    const locked = await post(app, '/v1/account/session', { email, code: good }, '203.0.113.10');
    expect(locked.status).toBe(400);
    expect(await locked.text()).toBe(wrongBodies[0]);
    expect(locked.headers.get('set-cookie')).toBeNull();

    // Un nouveau code rouvre la porte.
    expect((await post(app, '/v1/account/code', { email }, '203.0.113.10')).status).toBe(202);
    const fresh = await post(
      app,
      '/v1/account/session',
      { email, code: lastCodeFor(email) },
      '203.0.113.10',
    );
    expect(fresh.status).toBe(200);
  });

  it('un nouveau code remet les essais à zéro et invalide l’ancien', () => {
    const norm = 'renouvele@alpha.example.net';
    const first = issueLoginCode(norm);
    const wrong = first === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) checkLoginCode(norm, wrong);
    const attempts = () =>
      (
        getStatsDB()
          .prepare('SELECT attempts FROM account_login_codes WHERE email_norm = ?')
          .get(norm) as { attempts: number }
      ).attempts;
    expect(attempts()).toBe(3);

    // Un million de codes possibles : on retire tant que le tirage retombe sur
    // le même, pour que « l'ancien est invalidé » se mesure vraiment.
    let second = issueLoginCode(norm);
    while (second === first) second = issueLoginCode(norm);
    expect(attempts()).toBe(0);
    expect(checkLoginCode(norm, first)).toEqual({ ok: false, reason: 'wrong_code' });
    expect(checkLoginCode(norm, second)).toEqual({ ok: true });
    // Usage unique : le code consommé ne sert pas deux fois.
    expect(checkLoginCode(norm, second)).toEqual({ ok: false, reason: 'no_code' });
  });

  it('le budget d’envoi est partagé avec /v1/keys/generate et /v1/keys/claim', async () => {
    const app = makeApp();

    // (a) La réclamation dépense le créneau (adresse, réseau), la connexion le trouve plein.
    const claimed = 'budget-claim@alpha.example.net';
    const anon = servedAnonymousKey();
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      const r = await post(app, '/v1/keys/claim', { email: claimed }, '203.0.113.21', {
        Authorization: `Bearer ${anon.api_key}`,
      });
      expect(r.status, `réclamation ${i + 1}`).toBe(202);
    }
    const afterClaim = await post(app, '/v1/account/code', { email: claimed }, '203.0.113.21');
    expect(afterClaim.status).toBe(429);
    expect(((await afterClaim.json()) as { error: string }).error).toBe('code_rate_limited');

    // (b) Dans l'autre sens : la connexion dépense, la réclamation trouve plein.
    const signin = 'budget-signin@alpha.example.net';
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      const r = await post(app, '/v1/account/code', { email: signin }, '203.0.113.22');
      expect(r.status, `connexion ${i + 1}`).toBe(202);
    }
    const anon2 = servedAnonymousKey();
    const afterSignin = await post(app, '/v1/keys/claim', { email: signin }, '203.0.113.22', {
      Authorization: `Bearer ${anon2.api_key}`,
    });
    expect(afterSignin.status).toBe(429);
    expect(((await afterSignin.json()) as { error: string }).error).toBe(
      'verification_rate_limited',
    );

    // (c) La création : une clé est déjà née sur ce réseau, donc chaque nouvelle
    // demande poste un code de vérification, et dépense le même budget.
    const created = 'budget-generate@alpha.example.net';
    const source = keyCreationSource('203.0.113.23');
    if (!source) throw new Error('source introuvable');
    recordKeyCreation(source);
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      const r = await post(app, '/v1/keys/generate', { email: created }, '203.0.113.23');
      expect(r.status, `création ${i + 1}`).toBe(403);
      expect(((await r.json()) as { error: string }).error).toBe('verification_required');
    }
    const afterGenerate = await post(app, '/v1/account/code', { email: created }, '203.0.113.23');
    expect(afterGenerate.status).toBe(429);
    expect(((await afterGenerate.json()) as { error: string }).error).toBe('code_rate_limited');
  });

  it('une demande de connexion n’écrase pas un défi de création', async () => {
    const app = makeApp();
    const email = 'defi@alpha.example.net';
    const creation = createVerificationChallenge(email, 'une-source');
    if (typeof creation !== 'string') throw new Error('défi refusé');
    const read = () =>
      getStatsDB()
        .prepare(
          'SELECT code_hash, attempts, created_at, expires_at, key_prefix FROM pending_verifications WHERE email = ?',
        )
        .get(email);
    const before = read();

    expect((await post(app, '/v1/account/code', { email }, '203.0.113.30')).status).toBe(202);
    expect(read(), 'le défi de création est intact').toEqual(before);
    expect(checkVerificationCode(email, creation)).toEqual({ ok: true });

    // Et l'inverse : un défi de création posé après n'efface pas le code de connexion.
    const signin = lastCodeFor(email);
    createVerificationChallenge(email, 'une-source');
    const session = await post(app, '/v1/account/session', { email, code: signin }, '203.0.113.30');
    expect(session.status).toBe(200);
  });

  it('un code de connexion ne crée ni ne réclame une clé', async () => {
    const app = makeApp();
    const email = 'etanche@alpha.example.net';
    expect((await post(app, '/v1/account/code', { email }, '203.0.113.40')).status).toBe(202);
    const code = lastCodeFor(email);
    const keysOf = () =>
      (
        getStatsDB()
          .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE email_norm = ?')
          .get(email) as { n: number }
      ).n;

    // Création : une clé est déjà née sur ce réseau, donc le code est EXIGÉ,
    // et celui de la connexion n'est pas un défi de création.
    const source = keyCreationSource('203.0.113.40');
    if (!source) throw new Error('source introuvable');
    recordKeyCreation(source);
    const gen = await post(app, '/v1/keys/generate', { email, code }, '203.0.113.40');
    expect(gen.status).toBe(403);
    expect(((await gen.json()) as { error: string }).error).toBe('verification_failed');
    expect(keysOf()).toBe(0);

    // Réclamation : la clé anonyme le reste.
    const anon = servedAnonymousKey();
    const claim = await post(app, '/v1/keys/claim', { email, code }, '203.0.113.40', {
      Authorization: `Bearer ${anon.api_key}`,
    });
    expect(claim.status).toBe(403);
    expect(((await claim.json()) as { error: string }).error).toBe('verification_failed');
    expect(getKeyTier(anon.key_hash)?.tier).toBe('anonymous');

    // Le code de connexion, lui, n'a pas été touché : il ouvre toujours une session.
    const session = await post(app, '/v1/account/session', { email, code }, '203.0.113.40');
    expect(session.status).toBe(200);
  });

  it('relais en panne : 503 et alerte ; adresse refusée : 400 sans alerte ; les deux comptés', async () => {
    const app = makeApp();
    const before = verificationDelivery(24);

    relay.outcome = 'refused';
    const down = await post(
      app,
      '/v1/account/code',
      { email: 'panne@alpha.example.net' },
      '203.0.113.45',
    );
    expect(down.status).toBe(503);
    expect(((await down.json()) as { error: string }).error).toBe('code_unavailable');
    expect(ops.fails).toEqual([{ key: 'mail:verification', threshold: 3 }]);

    relay.outcome = 'undeliverable';
    const refused = await post(
      app,
      '/v1/account/code',
      { email: 'inconnu@alpha.example.net' },
      '203.0.113.45',
    );
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe('undeliverable_email');
    // L'adresse est à corriger par l'appelant : personne n'est réveillé pour elle.
    expect(ops.fails).toHaveLength(1);

    // Le taux de refus du relais reste lisible, connexion comprise.
    const after = verificationDelivery(24);
    expect(after.attempted - before.attempted).toBe(2);
    expect(after.refused - before.refused).toBe(2);
  });

  it('au-delà de trente codes dans l’heure, la connexion cède : 503, une alerte par heure', async () => {
    const app = makeApp();
    const db = getStatsDB();
    resetAccountCodeCeilingAlert();
    // L'horloge du processus est pilotée (l'alerte se compte par heure) ; celle
    // de SQLite reste réelle, donc le registre garde ses lignes.
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      // Le registre ne dit pas quelle porte a posté un code : des lignes
      // quelconques de l'heure le remplissent, une ligne plus vieille ne compte plus.
      const insert = db.prepare(
        `INSERT INTO verification_sends (ip_hash, email_hash, domain_hash, created_at)
           VALUES (?, ?, NULL, datetime('now', ?))`,
      );
      insert.run('autre-porte-ancienne', 'autre-adresse-ancienne', '-61 minutes');
      for (let i = 0; i < ACCOUNT_CODES_GLOBAL_PER_HOUR - 1; i++) {
        insert.run(`autre-porte-${i}`, `autre-adresse-${i}`, '-5 minutes');
      }
      const registry = () =>
        (db.prepare('SELECT COUNT(*) AS n FROM verification_sends').get() as { n: number }).n;
      const ask = (email: string, ip: string) => post(app, '/v1/account/code', { email }, ip);
      expect(ACCOUNT_CODES_GLOBAL_PER_HOUR).toBe(30);

      // Vingt-neuf codes dans l'heure : le trentième part. Le premier code parti
      // après un démarrage referme une alerte que l'état persisté aurait gardée.
      expect((await ask('plafond-a@alpha.example.net', '203.0.113.46')).status).toBe(202);
      expect(relay.sent).toHaveLength(1);
      expect(ops.oks).toEqual([ACCOUNT_CODE_CEILING_ALERT]);
      const full = registry();

      // Trente : la connexion cède, sans rien envoyer ni rien inscrire.
      const refused = await ask('plafond-b@alpha.example.net', '203.0.113.47');
      expect(refused.status).toBe(503);
      const body = (await refused.json()) as { error: string; message: string };
      expect(body.error).toBe('code_unavailable');
      expect(body.message).toMatch(/paste an API key/);
      expect(relay.sent).toHaveLength(1);
      expect(registry()).toBe(full);
      expect(ops.fails).toEqual([{ key: ACCOUNT_CODE_CEILING_ALERT, threshold: 1 }]);

      // Un autre refus dans la même heure : aucune seconde alerte.
      clock += 30 * 60_000;
      expect((await ask('plafond-c@alpha.example.net', '203.0.113.48')).status).toBe(503);
      expect(ops.fails).toHaveLength(1);

      // L'heure suivante, le premier refus alerte de nouveau.
      clock += 31 * 60_000;
      expect((await ask('plafond-d@alpha.example.net', '203.0.113.49')).status).toBe(503);
      expect(ops.fails).toHaveLength(2);
      expect(ops.oks).toHaveLength(1);

      // Deux places se libèrent : les codes repartent, mais l'alerte ne se
      // referme qu'après une heure sans refus.
      db.prepare(
        "UPDATE verification_sends SET created_at = datetime('now', '-2 hours') WHERE ip_hash IN ('autre-porte-0', 'autre-porte-1')",
      ).run();
      clock += 10 * 60_000;
      expect((await ask('plafond-e@alpha.example.net', '203.0.113.50')).status).toBe(202);
      expect(ops.oks).toHaveLength(1);
      clock += 61 * 60_000;
      expect((await ask('plafond-f@alpha.example.net', '203.0.113.51')).status).toBe(202);
      expect(ops.oks).toEqual([ACCOUNT_CODE_CEILING_ALERT, ACCOUNT_CODE_CEILING_ALERT]);
      expect(ops.fails).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });
});
