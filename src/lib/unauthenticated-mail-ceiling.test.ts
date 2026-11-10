/**
 * Le plafond horaire GLOBAL des mails déclenchés sans compte (C12, SEC-06).
 *
 * Ce que ce fichier prouve, dans l'ordre du brief :
 *  1. au-delà du plafond, `POST /v1/keys/generate` avec adresse rend la clé
 *     SANS envoyer son mail, et le dit ; une demande de code (création,
 *     réclamation, approbation par appareil) répond 503 avec `Retry-After` ;
 *  2. UNE seule alerte d'exploitation pour tout l'épisode, partie à la moitié
 *     du plafond, avant le premier refus ;
 *  3. la livraison d'une clé PAYÉE n'est ni comptée ni retenue ;
 *  4. le plafond se lève de lui-même l'heure suivante.
 *
 * Le relais est remplacé par une doublure qui RETIENT les messages : « aucun
 * mail n'est parti » se lit sur le transport lui-même, pas sur une fonction de
 * plus haut niveau. Pour le mail de clé gratuite, le drapeau VITEST est LEVÉ le
 * temps de l'appel (`asProduction`, idiome de ./email.spy.test.ts) : la route
 * saute cet envoi sous vitest, et un « rien n'est parti » mesuré sans lever le
 * drapeau serait vert pour la mauvaise raison. La moitié « sous le plafond, le
 * mail part » est le garde de ce garde.
 *
 * L'horloge : celle du processus est pilotée (l'épisode d'alerte se compte en
 * heures), celle de SQLite reste réelle ; « l'heure suivante » se simule donc
 * en vieillissant les lignes des deux registres ET en avançant l'horloge du
 * processus, comme ./account.codes.test.ts.
 *
 * Fixtures inventées (dépôt public) : adresses en alpha.example.net, réseaux
 * de documentation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';

const relay = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string }>,
}));
vi.mock('./mail-transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mail-transport.js')>();
  return {
    ...actual,
    deliverViaRelay: async (m: { to: string; subject: string }) => {
      relay.sent.push({ to: m.to, subject: m.subject });
      return { outcome: 'sent' as const };
    },
    sendViaRelay: async (m: { to: string; subject: string }) => {
      relay.sent.push({ to: m.to, subject: m.subject });
      return true;
    },
  };
});
// Sans VITEST, la route interroge un vrai serveur de noms : le test mesurerait le réseau.
vi.mock('./mail-domain.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mail-domain.js')>();
  return { ...actual, domainAcceptsMail: async () => true };
});
// L'alerte d'exploitation, retenue plutôt qu'envoyée : le shell peut porter un vrai jeton.
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

const { apiKeys } = await import('../routes/api-keys.js');
const { deviceGrant } = await import('../routes/device-grant.js');
const { getStatsDB } = await import('./db.js');
const { ACCOUNT_CODES_GLOBAL_PER_HOUR } = await import('./account.js');
const { generateApiKey, getKeyTier, validateApiKey } = await import('./api-keys.js');
const { sendApiKeyEmail } = await import('./email.js');
const {
  UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR,
  UNAUTHENTICATED_MAILS_PER_HOUR_ENV,
  UNAUTHENTICATED_MAIL_CEILING_ALERT,
  createVerificationChallenge,
  keyCreationSource,
  recordKeyCreation,
  resetUnauthenticatedMailCeilingAlert,
  unauthenticatedMailAllowed,
  unauthenticatedMailWarnAt,
  unauthenticatedMailsLastHour,
  unauthenticatedMailsPerHour,
} = await import('./key-creation-guard.js');

const ENV = {
  vitest: process.env.VITEST,
  testKeys: process.env.IBANFORGE_ADMIN_TEST_KEYS,
  ceiling: process.env[UNAUTHENTICATED_MAILS_PER_HOUR_ENV],
};
const ALERT = UNAUTHENTICATED_MAIL_CEILING_ALERT;
const LIMIT = UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR;
const MINUTE = 60_000;

/**
 * Les appels de CETTE alerte seulement : un mail de clé livré referme aussi
 * `mail:key-delivery`, comme en production, et ce n'est pas l'objet ici.
 */
function ceilingFails(): Array<{ key: string; threshold?: number }> {
  return ops.fails.filter((f) => f.key === ALERT);
}
function ceilingOks(): string[] {
  return ops.oks.filter((k) => k === ALERT);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  relay.sent.length = 0;
  ops.fails.length = 0;
  ops.oks.length = 0;
  // La garde par réseau reste ARMÉE, sinon la branche du code est inatteignable.
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  delete process.env[UNAUTHENTICATED_MAILS_PER_HOUR_ENV];
  // Crée le registre des mails de clé s'il n'existe pas encore, puis repart à vide.
  unauthenticatedMailsLastHour();
  const db = getStatsDB();
  db.prepare('DELETE FROM verification_sends').run();
  db.prepare('DELETE FROM pending_verifications').run();
  db.prepare('DELETE FROM free_key_mail_sends').run();
  resetUnauthenticatedMailCeilingAlert();
});

afterEach(() => {
  vi.restoreAllMocks();
  restore('VITEST', ENV.vitest);
  restore('IBANFORGE_ADMIN_TEST_KEYS', ENV.testKeys);
  restore(UNAUTHENTICATED_MAILS_PER_HOUR_ENV, ENV.ceiling);
});

/** Le comportement de production, drapeau de test levé le temps de l'appel. */
async function asProduction<T>(fn: () => Promise<T>): Promise<T> {
  delete process.env.VITEST;
  try {
    return await fn();
  } finally {
    process.env.VITEST = ENV.vitest ?? 'true';
  }
}

/** Laisse partir l'envoi non attendu de la route avant de lire le relais. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', deviceGrant);
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

/** Une clé gratuite avec adresse, demandée comme en production (mail compris). */
function generateAsProduction(app: Hono, email: string, ip: string): Promise<Response> {
  return asProduction(() => post(app, '/v1/keys/generate', { email }, ip));
}

/** Des lignes de l'heure dans les deux registres, comme si d'autres portes avaient posté. */
function fillCodes(n: number, age = '-5 minutes'): void {
  const insert = getStatsDB().prepare(
    `INSERT INTO verification_sends (ip_hash, email_hash, domain_hash, created_at)
       VALUES (?, ?, NULL, datetime('now', ?))`,
  );
  for (let i = 0; i < n; i++) insert.run(`autre-porte-${i}`, `autre-adresse-${i}`, age);
}
function fillKeyMails(n: number, age = '-5 minutes'): void {
  const insert = getStatsDB().prepare(
    `INSERT INTO free_key_mail_sends (created_at) VALUES (datetime('now', ?))`,
  );
  for (let i = 0; i < n; i++) insert.run(age);
}
function codesInLedger(): number {
  return (
    getStatsDB().prepare('SELECT COUNT(*) AS n FROM verification_sends').get() as { n: number }
  ).n;
}

/** Une clé anonyme qui a servi un appel : ce que `/v1/keys/claim` exige. */
function servedAnonymousKey(): { api_key: string; key_hash: string } {
  const k = generateApiKey(null);
  if (!k) throw new Error('frappe impossible');
  getStatsDB()
    .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 1)')
    .run(k.key_hash, new Date().toISOString().slice(0, 7));
  return k;
}

describe('le réglage du plafond', () => {
  it('le défaut reste au-dessus du plafond de connexion, et l’alerte part avant le plafond', () => {
    // La connexion se compte sur le même registre : elle doit céder la première.
    expect(LIMIT).toBeGreaterThan(ACCOUNT_CODES_GLOBAL_PER_HOUR);
    expect(unauthenticatedMailWarnAt(LIMIT)).toBeLessThan(LIMIT);
    expect(unauthenticatedMailWarnAt(LIMIT)).toBeGreaterThan(0);
  });

  it('la variable se lit à chaque appel, et une valeur mal formée garde le défaut', () => {
    expect(unauthenticatedMailsPerHour()).toBe(LIMIT);
    process.env[UNAUTHENTICATED_MAILS_PER_HOUR_ENV] = ' 500 ';
    expect(unauthenticatedMailsPerHour()).toBe(500);
    for (const bad of ['', '0', '-5', '12.5', 'abc', '1e3', '99999999999999999999']) {
      process.env[UNAUTHENTICATED_MAILS_PER_HOUR_ENV] = bad;
      expect(unauthenticatedMailsPerHour(), `valeur ${JSON.stringify(bad)}`).toBe(LIMIT);
    }
  });

  it('les deux registres s’additionnent, et une ligne de plus d’une heure ne compte plus', () => {
    fillCodes(2);
    fillKeyMails(3);
    fillCodes(4, '-61 minutes');
    fillKeyMails(5, '-61 minutes');
    expect(unauthenticatedMailsLastHour()).toBe(5);
  });
});

describe('au-delà du plafond horaire', () => {
  it('la clé est rendue sans son mail, les codes répondent 503 avec Retry-After, une seule alerte', async () => {
    const app = makeApp();
    const warnAt = unauthenticatedMailWarnAt(LIMIT);
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      fillCodes(1, '-61 minutes');
      fillCodes(warnAt - 1);
      expect(unauthenticatedMailsLastHour()).toBe(warnAt - 1);

      // Sous la moitié : la clé part avec son mail (le garde du garde), sans
      // alerte. Le premier mail après un démarrage referme une alerte que
      // l'état persisté aurait gardée ouverte.
      const first = await generateAsProduction(app, 'premiere@alpha.example.net', '198.51.100.10');
      expect(first.status).toBe(201);
      expect(await first.json()).not.toHaveProperty('key_mailed');
      await flush();
      expect(relay.sent.map((m) => m.to)).toEqual(['premiere@alpha.example.net']);
      expect(ceilingFails()).toEqual([]);
      expect(ceilingOks()).toEqual([ALERT]);

      // La moitié est atteinte : l'alerte part AVANT tout refus, et le mail part encore.
      const second = await generateAsProduction(app, 'seconde@alpha.example.net', '198.51.100.11');
      expect(second.status).toBe(201);
      expect(await second.json()).not.toHaveProperty('key_mailed');
      await flush();
      expect(relay.sent).toHaveLength(2);
      expect(ceilingFails()).toEqual([{ key: ALERT, threshold: 1 }]);

      // Le registre est plein : des mails de clé de l'heure le complètent.
      fillKeyMails(LIMIT - unauthenticatedMailsLastHour());
      expect(unauthenticatedMailsLastHour()).toBe(LIMIT);
      const mailed = relay.sent.length;

      // 1. La clé est rendue, SANS son mail, et la réponse le dit.
      const capped = await generateAsProduction(app, 'plafond@alpha.example.net', '198.51.100.12');
      expect(capped.status).toBe(201);
      const body = (await capped.json()) as Record<string, unknown>;
      expect(body.api_key).toMatch(/^ifk_/);
      expect(validateApiKey(String(body.api_key)).valid).toBe(true);
      expect(body.tier).toBe('email');
      expect(body.key_mailed).toBe(false);
      expect(body.mail_notice).toMatch(/not sent by e-mail/);
      expect(body.mail_notice).toMatch(/only copy/);
      expect(body.message).toBe('Save this key — it will not be shown again.');
      await flush();
      expect(relay.sent).toHaveLength(mailed);
      expect(unauthenticatedMailsLastHour()).toBe(LIMIT);

      // 2. Le code de la deuxième clé d'un réseau : 503, Retry-After, rien
      //    d'inscrit, et le défi en cours de cette adresse reste intact (un refus
      //    n'est pas une remise à zéro gratuite des essais).
      const ip = '198.51.100.13';
      const source = keyCreationSource(ip)!;
      recordKeyCreation(source);
      const address = 'deuxieme-cle@alpha.example.net';
      createVerificationChallenge(address, source);
      const db = getStatsDB();
      db.prepare('UPDATE pending_verifications SET attempts = 2 WHERE email = ?').run(address);
      const challenge = () =>
        db
          .prepare('SELECT code_hash, attempts FROM pending_verifications WHERE email = ?')
          .get(address);
      const pending = challenge();
      const codes = codesInLedger();

      const refused = await post(app, '/v1/keys/generate', { email: address }, ip);
      expect(refused.status).toBe(503);
      const retryAfter = Number(refused.headers.get('Retry-After'));
      const refusal = (await refused.json()) as Record<string, unknown>;
      expect(refusal.error).toBe('verification_unavailable');
      expect(refusal.retry_after).toBe(retryAfter);
      expect(refusal.message).toMatch(/Retry-After/);
      // La plus ancienne ligne de l'heure a cinq minutes : une place se libère
      // dans cinquante-cinq minutes, pas dans « quelques minutes ».
      expect(retryAfter).toBeGreaterThanOrEqual(55 * 60 - 10);
      expect(retryAfter).toBeLessThanOrEqual(55 * 60);
      expect(codesInLedger()).toBe(codes);
      expect(challenge()).toEqual(pending);
      expect(relay.sent).toHaveLength(mailed);

      // 3. La réclamation d'une clé anonyme : 503, la clé garde son palier.
      const anon = servedAnonymousKey();
      const claim = await post(
        app,
        '/v1/keys/claim',
        { email: 'reclamation@alpha.example.net' },
        '198.51.100.14',
        { Authorization: `Bearer ${anon.api_key}` },
      );
      expect(claim.status).toBe(503);
      expect(Number(claim.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(((await claim.json()) as { error: string }).error).toBe('verification_unavailable');
      expect(getKeyTier(anon.key_hash)!.tier).toBe('anonymous');

      // 4. L'approbation par appareil avec adresse : 503 ; sans adresse, la
      //    clé part quand même, comme le dit le texte du refus.
      const opened = await post(app, '/v1/keys/device', {}, '198.51.100.15');
      expect(opened.status).toBe(201);
      const { user_code } = (await opened.json()) as { user_code: string };
      const look = await post(app, '/v1/keys/device/lookup', { user_code }, '198.51.100.16');
      expect(look.status).toBe(200);
      const { approval_token } = (await look.json()) as { approval_token: string };
      const withMail = await post(
        app,
        '/v1/keys/device/approve',
        { user_code, approval_token, email: 'appareil@alpha.example.net' },
        '198.51.100.16',
      );
      expect(withMail.status).toBe(503);
      expect(Number(withMail.headers.get('Retry-After'))).toBeGreaterThan(0);
      const deviceRefusal = (await withMail.json()) as { error: string; message: string };
      expect(deviceRefusal.error).toBe('verification_unavailable');
      expect(deviceRefusal.message).toMatch(/without an address/);
      const without = await post(
        app,
        '/v1/keys/device/approve',
        { user_code, approval_token },
        '198.51.100.16',
      );
      expect(without.status).toBe(200);

      // Aucun courrier n'est parti pendant tout ce temps, et rien n'est inscrit.
      expect(relay.sent).toHaveLength(mailed);
      expect(codesInLedger()).toBe(codes);
      expect(unauthenticatedMailsLastHour()).toBe(LIMIT);

      // 5. UNE alerte pour tout l'épisode, refus compris, même une demi-heure plus tard.
      clock += 30 * MINUTE;
      expect(
        (await generateAsProduction(app, 'encore@alpha.example.net', '198.51.100.17')).status,
      ).toBe(201);
      expect(ceilingFails()).toEqual([{ key: ALERT, threshold: 1 }]);
      expect(ceilingOks()).toEqual([ALERT]);
    } finally {
      now.mockRestore();
    }
  });

  it('le plafond se lève de lui-même l’heure suivante, et l’alerte se referme (horloge simulée)', async () => {
    const app = makeApp();
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      fillCodes(LIMIT / 2);
      fillKeyMails(LIMIT - LIMIT / 2);
      const capped = await generateAsProduction(app, 'avant@alpha.example.net', '198.51.100.20');
      expect(((await capped.json()) as { key_mailed?: boolean }).key_mailed).toBe(false);
      expect(ceilingFails()).toEqual([{ key: ALERT, threshold: 1 }]);
      await flush();
      expect(relay.sent).toHaveLength(0);

      // Une heure passe : les lignes des deux registres vieillissent d'autant
      // (l'horloge de SQLite n'est pas pilotable), l'horloge du processus aussi.
      const db = getStatsDB();
      db.prepare(
        "UPDATE verification_sends SET created_at = datetime(created_at, '-61 minutes')",
      ).run();
      db.prepare(
        "UPDATE free_key_mail_sends SET created_at = datetime(created_at, '-61 minutes')",
      ).run();
      clock += 61 * MINUTE;
      expect(unauthenticatedMailsLastHour()).toBe(0);

      // Le mail de clé repart, sans `key_mailed`, et l'alerte se referme une fois.
      const after = await generateAsProduction(app, 'apres@alpha.example.net', '198.51.100.21');
      expect(after.status).toBe(201);
      expect(await after.json()).not.toHaveProperty('key_mailed');
      await flush();
      expect(relay.sent.map((m) => m.to)).toEqual(['apres@alpha.example.net']);
      expect(ceilingOks()).toEqual([ALERT]);

      // Et un code repart aussi : la réclamation fait son 202.
      const anon = servedAnonymousKey();
      const claim = await post(
        app,
        '/v1/keys/claim',
        { email: 'apres-code@alpha.example.net' },
        '198.51.100.22',
        { Authorization: `Bearer ${anon.api_key}` },
      );
      expect(claim.status).toBe(202);
      expect(relay.sent.map((m) => m.to)).toContain('apres-code@alpha.example.net');
      expect(ceilingFails()).toHaveLength(1);
      expect(ceilingOks()).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });
});

describe('la livraison d’une clé payée', () => {
  it('n’est ni comptée ni retenue, même plafond atteint', async () => {
    fillCodes(LIMIT);
    expect(unauthenticatedMailAllowed().ok).toBe(false);
    const delivered = await sendApiKeyEmail({
      to: 'acme@example.com',
      rawKey: 'ifk_test_paid_delivery_not_counted',
      credits: 1000,
      bundle: '1k',
    });
    expect(delivered).toBe(true);
    expect(relay.sent.map((m) => m.to)).toEqual(['acme@example.com']);
    expect(unauthenticatedMailsLastHour()).toBe(LIMIT);
  });

  it('seules les portes sans compte lisent le plafond : aucun rail payant n’y passe', () => {
    // La garantie est structurelle : le plafond n'est appelé que par les
    // routes de création, de réclamation et d'approbation, jamais par les
    // rails qui livrent une clé payée (Stripe, crédits, abonnements).
    const root = join(import.meta.dirname, '..');
    const CALL = /\b(unauthenticatedMailAllowed|takeFreeKeyMailSlot)\(/;
    const callers: string[] = [];
    for (const dir of ['lib', 'routes', 'middleware', 'mcp']) {
      for (const f of readdirSync(join(root, dir))) {
        if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
        if (CALL.test(readFileSync(join(root, dir, f), 'utf8'))) callers.push(`${dir}/${f}`);
      }
    }
    expect(callers.sort()).toEqual([
      'lib/key-creation-guard.ts',
      'routes/api-keys.ts',
      'routes/device-grant.ts',
    ]);

    // Dans api-keys.ts, chaque appel vit dans /generate ou dans /claim.
    const src = readFileSync(join(root, 'routes', 'api-keys.ts'), 'utf8');
    const handler = (path: string): [number, number] => {
      const start = src.indexOf(`apiKeys.post('${path}'`);
      expect(start, `${path} introuvable`).toBeGreaterThan(-1);
      const end = src.indexOf('\napiKeys.', start + 10);
      return [start, end === -1 ? src.length : end];
    };
    const ranges = [handler('/v1/keys/generate'), handler('/v1/keys/claim')];
    const calls = [...src.matchAll(/\b(unauthenticatedMailAllowed|takeFreeKeyMailSlot)\(/g)];
    expect(calls.map((m) => m[1]).sort()).toEqual([
      'takeFreeKeyMailSlot',
      'unauthenticatedMailAllowed',
      'unauthenticatedMailAllowed',
    ]);
    for (const m of calls) {
      expect(ranges.some(([a, b]) => m.index! > a && m.index! < b)).toBe(true);
    }
  });
});
