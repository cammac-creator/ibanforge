/**
 * Les plafonds GLOBAUX des mails déclenchés sans compte (C12, SEC-06) : l'un
 * sur l'heure glissante, l'autre sur 24 heures glissantes, sur le même registre.
 *
 * Ce que ce fichier prouve, dans l'ordre du brief :
 *  1. au-delà de l'un OU de l'autre plafond, `POST /v1/keys/generate` avec
 *     adresse rend la clé SANS envoyer son mail, et le dit ; une demande de
 *     code (création, réclamation, approbation par appareil) répond 503 avec
 *     un `Retry-After` honnête ;
 *  2. une seule alerte d'exploitation par épisode et par plafond, partie à la
 *     moitié, avant le premier refus : un appel à `opsFail` par heure au plus,
 *     l'état persisté d'`ops-alert` faisant du tout un seul message ;
 *  3. la livraison d'une clé PAYÉE n'est comptée par aucun des deux, ni retenue ;
 *  4. chaque plafond se lève de lui-même quand ses lignes sortent de sa fenêtre,
 *     et la purge des registres ne retire rien de moins de 24 heures.
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
 * heures), celle de SQLite reste réelle ; le temps qui passe se simule donc en
 * vieillissant les lignes des deux registres ET en avançant l'horloge du
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
  details: [] as Array<{ key: string; detail: string }>,
  oks: [] as string[],
}));
vi.mock('./ops-alert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ops-alert.js')>();
  return {
    ...actual,
    opsFail: async (key: string, detail: string, threshold?: number) => {
      ops.fails.push({ key, threshold });
      ops.details.push({ key, detail });
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
  UNAUTHENTICATED_MAILS_GLOBAL_PER_DAY,
  UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR,
  UNAUTHENTICATED_MAILS_PER_DAY_ENV,
  UNAUTHENTICATED_MAILS_PER_HOUR_ENV,
  UNAUTHENTICATED_MAIL_DAILY_ALERT,
  UNAUTHENTICATED_MAIL_HOURLY_ALERT,
  createVerificationChallenge,
  keyCreationSource,
  purgeExpiredVerifications,
  recordKeyCreation,
  recordVerificationSend,
  resetUnauthenticatedMailCeilingAlert,
  takeFreeKeyMailSlot,
  unauthenticatedMailAllowed,
  unauthenticatedMailWarnAt,
  unauthenticatedMailsLastDay,
  unauthenticatedMailsLastHour,
  unauthenticatedMailsPerDay,
  unauthenticatedMailsPerHour,
} = await import('./key-creation-guard.js');

const ENV = {
  vitest: process.env.VITEST,
  testKeys: process.env.IBANFORGE_ADMIN_TEST_KEYS,
  hourly: process.env[UNAUTHENTICATED_MAILS_PER_HOUR_ENV],
  daily: process.env[UNAUTHENTICATED_MAILS_PER_DAY_ENV],
};
const ALERT = UNAUTHENTICATED_MAIL_HOURLY_ALERT;
const DAY_ALERT = UNAUTHENTICATED_MAIL_DAILY_ALERT;
const LIMIT = UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR;
const DAY_LIMIT = UNAUTHENTICATED_MAILS_GLOBAL_PER_DAY;
const MINUTE = 60_000;

/**
 * Les appels d'UNE alerte seulement : un mail de clé livré referme aussi
 * `mail:key-delivery`, comme en production, et ce n'est pas l'objet ici.
 */
function failsOf(key: string): Array<{ key: string; threshold?: number }> {
  return ops.fails.filter((f) => f.key === key);
}
function oksOf(key: string): string[] {
  return ops.oks.filter((k) => k === key);
}
/** L'alerte du plafond horaire. */
function ceilingFails(): Array<{ key: string; threshold?: number }> {
  return failsOf(ALERT);
}
function ceilingOks(): string[] {
  return oksOf(ALERT);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  relay.sent.length = 0;
  ops.fails.length = 0;
  ops.details.length = 0;
  ops.oks.length = 0;
  // La garde par réseau reste ARMÉE, sinon la branche du code est inatteignable.
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  delete process.env[UNAUTHENTICATED_MAILS_PER_HOUR_ENV];
  delete process.env[UNAUTHENTICATED_MAILS_PER_DAY_ENV];
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
  restore(UNAUTHENTICATED_MAILS_PER_HOUR_ENV, ENV.hourly);
  restore(UNAUTHENTICATED_MAILS_PER_DAY_ENV, ENV.daily);
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

describe('le réglage des plafonds', () => {
  it('l’horaire reste au-dessus de la connexion, le journalier au-dessus de l’horaire, les alertes avant les plafonds', () => {
    // La connexion se compte sur le même registre : elle doit céder la première.
    expect(LIMIT).toBeGreaterThan(ACCOUNT_CODES_GLOBAL_PER_HOUR);
    // Un plafond de la journée sous celui de l'heure rendrait l'horaire sans objet.
    expect(DAY_LIMIT).toBeGreaterThan(LIMIT);
    for (const limit of [LIMIT, DAY_LIMIT]) {
      expect(unauthenticatedMailWarnAt(limit)).toBeLessThan(limit);
      expect(unauthenticatedMailWarnAt(limit)).toBeGreaterThan(0);
    }
  });

  it.each([
    [UNAUTHENTICATED_MAILS_PER_HOUR_ENV, () => unauthenticatedMailsPerHour(), LIMIT],
    [UNAUTHENTICATED_MAILS_PER_DAY_ENV, () => unauthenticatedMailsPerDay(), DAY_LIMIT],
  ] as const)(
    '%s se lit à chaque appel, et une valeur invalide retombe sur le défaut',
    (name, read, fallback) => {
      expect(read()).toBe(fallback);
      process.env[name] = ' 500 ';
      expect(read()).toBe(500);
      for (const bad of ['', '   ', '0', '-5', '12.5', 'abc', '1e3', '99999999999999999999']) {
        process.env[name] = bad;
        expect(read(), `valeur ${JSON.stringify(bad)}`).toBe(fallback);
      }
    },
  );

  it('les deux registres s’additionnent ; chaque fenêtre ne compte que ses lignes', () => {
    fillCodes(2);
    fillKeyMails(3);
    fillCodes(4, '-61 minutes');
    fillKeyMails(5, '-3 hours');
    fillCodes(6, '-1441 minutes');
    fillKeyMails(7, '-25 hours');
    expect(unauthenticatedMailsLastHour()).toBe(5);
    expect(unauthenticatedMailsLastDay()).toBe(14);
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
      // dans cinquante-cinq minutes, ni dans « quelques minutes », ni dans une
      // heure pleine. La borne basse laisse de la marge à une machine chargée.
      expect(retryAfter).toBeGreaterThanOrEqual(50 * 60);
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

      // 5. Un seul appel d'alerte dans l'heure, refus compris, même une
      //    demi-heure plus tard.
      clock += 30 * MINUTE;
      expect(
        (await generateAsProduction(app, 'encore@alpha.example.net', '198.51.100.17')).status,
      ).toBe(201);
      expect(ceilingFails()).toEqual([{ key: ALERT, threshold: 1 }]);
      expect(ceilingOks()).toEqual([ALERT]);

      // 6. Toujours chaud une heure après le premier appel : l'alerte est
      //    reproposée une fois, comme celle de la connexion. C'est l'état
      //    persisté d'`ops-alert` (`firing`) qui garantit un seul message par
      //    épisode ; ce rappel ne sert qu'à retenter un envoi perdu (Telegram
      //    muet, fenêtre anti-tempête d'un épisode précédent encore fermée).
      clock += 31 * MINUTE;
      expect(
        (await generateAsProduction(app, 'toujours@alpha.example.net', '198.51.100.18')).status,
      ).toBe(201);
      expect(ceilingFails()).toEqual([
        { key: ALERT, threshold: 1 },
        { key: ALERT, threshold: 1 },
      ]);
      expect(ceilingOks()).toEqual([ALERT]);

      // Le texte nomme le plafond en cause, et la journée, loin de sa moitié,
      // n'a jamais alerté.
      expect(ops.details.find((d) => d.key === ALERT)?.detail).toMatch(
        /hourly ceiling of 60 an hour/,
      );
      expect(failsOf(DAY_ALERT)).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it('le plafond se lève de lui-même l’heure suivante ; l’alerte ne se referme qu’après une heure calme (horloge simulée)', async () => {
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

      // L'heure du registre passe : les lignes des deux registres vieillissent
      // d'une heure (l'horloge de SQLite n'est pas pilotable). L'horloge du
      // processus, elle, n'avance que de dix minutes depuis le dernier refus.
      const db = getStatsDB();
      db.prepare(
        "UPDATE verification_sends SET created_at = datetime(created_at, '-61 minutes')",
      ).run();
      db.prepare(
        "UPDATE free_key_mail_sends SET created_at = datetime(created_at, '-61 minutes')",
      ).run();
      clock += 10 * MINUTE;
      expect(unauthenticatedMailsLastHour()).toBe(0);

      // Le plafond est levé : le mail de clé repart, sans `key_mailed`. Mais
      // l'alerte reste ouverte : moins d'une heure depuis la dernière lecture
      // chaude.
      const during = await generateAsProduction(app, 'pendant@alpha.example.net', '198.51.100.23');
      expect(during.status).toBe(201);
      expect(await during.json()).not.toHaveProperty('key_mailed');
      await flush();
      expect(relay.sent.map((m) => m.to)).toEqual(['pendant@alpha.example.net']);
      expect(ceilingOks()).toEqual([]);

      // Une heure entière sans lecture chaude : le premier mail referme l'alerte, une fois.
      clock += 51 * MINUTE;
      const after = await generateAsProduction(app, 'apres@alpha.example.net', '198.51.100.21');
      expect(after.status).toBe(201);
      expect(await after.json()).not.toHaveProperty('key_mailed');
      await flush();
      expect(relay.sent.map((m) => m.to)).toEqual([
        'pendant@alpha.example.net',
        'apres@alpha.example.net',
      ]);
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

describe('au-delà du plafond sur 24 heures', () => {
  it('atteint quand l’heure est calme : la clé sans son mail, un code en 503 jusqu’à la sortie de la fenêtre, sa seule alerte', async () => {
    const app = makeApp();
    const warnAt = unauthenticatedMailWarnAt(DAY_LIMIT);
    // Horloge figée : tout ce test tient dans le même instant du processus.
    const clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      // Des lignes de plus d'une heure et de moins de 24 : elles ne comptent
      // que pour le plafond de la journée.
      fillCodes(warnAt, '-3 hours');
      fillKeyMails(DAY_LIMIT - warnAt - 1, '-3 hours');
      expect(unauthenticatedMailsLastHour()).toBe(0);
      expect(unauthenticatedMailsLastDay()).toBe(DAY_LIMIT - 1);

      // Une place reste : le mail part. La journée a passé sa moitié, donc SON
      // alerte part, avant tout refus ; celle de l'heure, non.
      const last = await generateAsProduction(app, 'derniere@alpha.example.net', '198.51.100.30');
      expect(last.status).toBe(201);
      expect(await last.json()).not.toHaveProperty('key_mailed');
      await flush();
      expect(relay.sent.map((m) => m.to)).toEqual(['derniere@alpha.example.net']);
      expect(failsOf(DAY_ALERT)).toEqual([{ key: DAY_ALERT, threshold: 1 }]);
      expect(ops.details.find((d) => d.key === DAY_ALERT)?.detail).toMatch(
        /24-hour ceiling of 150/,
      );
      expect(ceilingFails()).toEqual([]);
      expect(unauthenticatedMailsLastHour()).toBe(1);

      // Plein sur la journée, presque vide sur l'heure : la clé est rendue sans son mail.
      const capped = await generateAsProduction(app, 'journee@alpha.example.net', '198.51.100.31');
      expect(capped.status).toBe(201);
      const body = (await capped.json()) as Record<string, unknown>;
      expect(String(body.api_key)).toMatch(/^ifk_/);
      expect(body.key_mailed).toBe(false);
      await flush();
      expect(relay.sent).toHaveLength(1);

      // Une demande de code : 503. Le Retry-After honnête est le temps jusqu'à
      // ce que la plus ancienne ligne comptée ait 24 heures, soit environ
      // vingt et une heures ici, et non une heure.
      const anon = servedAnonymousKey();
      const claim = await post(
        app,
        '/v1/keys/claim',
        { email: 'journee-code@alpha.example.net' },
        '198.51.100.32',
        { Authorization: `Bearer ${anon.api_key}` },
      );
      expect(claim.status).toBe(503);
      const retryAfter = Number(claim.headers.get('Retry-After'));
      expect(((await claim.json()) as { retry_after: number }).retry_after).toBe(retryAfter);
      expect(retryAfter).toBeGreaterThanOrEqual(21 * 3600 - 10 * 60);
      expect(retryAfter).toBeLessThanOrEqual(21 * 3600);
      expect(relay.sent).toHaveLength(1);
      expect(getKeyTier(anon.key_hash)!.tier).toBe('anonymous');

      // Une seule alerte de la journée pour tout cela, aucune de l'heure.
      expect(failsOf(DAY_ALERT)).toHaveLength(1);
      expect(ceilingFails()).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it('se lève de lui-même quand les lignes sortent des 24 heures, et son alerte se referme', async () => {
    const app = makeApp();
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      fillCodes(DAY_LIMIT / 2, '-3 hours');
      fillKeyMails(DAY_LIMIT / 2, '-3 hours');
      const capped = await generateAsProduction(app, 'veille@alpha.example.net', '198.51.100.33');
      expect(((await capped.json()) as { key_mailed?: boolean }).key_mailed).toBe(false);
      expect(failsOf(DAY_ALERT)).toHaveLength(1);
      await flush();
      expect(relay.sent).toHaveLength(0);

      // Vingt et une heures passent : les lignes (nées il y a trois heures)
      // sortent de la fenêtre de 24 heures, l'horloge du processus avance d'autant.
      const db = getStatsDB();
      db.prepare(
        "UPDATE verification_sends SET created_at = datetime(created_at, '-1261 minutes')",
      ).run();
      db.prepare(
        "UPDATE free_key_mail_sends SET created_at = datetime(created_at, '-1261 minutes')",
      ).run();
      clock += 1261 * MINUTE;
      expect(unauthenticatedMailsLastDay()).toBe(0);

      // Le mail de clé repart, et l'alerte de la journée se referme, une fois.
      const after = await generateAsProduction(app, 'lendemain@alpha.example.net', '198.51.100.34');
      expect(after.status).toBe(201);
      expect(await after.json()).not.toHaveProperty('key_mailed');
      await flush();
      expect(relay.sent.map((m) => m.to)).toEqual(['lendemain@alpha.example.net']);
      expect(oksOf(DAY_ALERT)).toEqual([DAY_ALERT]);

      // Et un code repart aussi.
      const anon = servedAnonymousKey();
      const claim = await post(
        app,
        '/v1/keys/claim',
        { email: 'lendemain-code@alpha.example.net' },
        '198.51.100.35',
        { Authorization: `Bearer ${anon.api_key}` },
      );
      expect(claim.status).toBe(202);
      expect(failsOf(DAY_ALERT)).toHaveLength(1);
      expect(ceilingFails()).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });
});

describe('la purge des registres', () => {
  it('ne retire rien de moins de 24 heures, dans aucun des deux registres', () => {
    fillCodes(2, '-23 hours');
    fillCodes(3, '-1439 minutes');
    fillCodes(4, '-3 days');
    fillKeyMails(5, '-23 hours');
    fillKeyMails(6, '-1439 minutes');
    fillKeyMails(7, '-3 days');
    expect(unauthenticatedMailsLastDay()).toBe(16);

    // Les trois purges : celle du jour, et les deux qui suivent chaque envoi.
    purgeExpiredVerifications();
    recordVerificationSend('purge-src', 'purge@alpha.example.net');
    expect(takeFreeKeyMailSlot()).toBe(true);

    // Les seize lignes de moins de 24 heures sont toutes là, plus les deux neuves.
    expect(unauthenticatedMailsLastDay()).toBe(16 + 2);
    // Ce qui avait plus de deux jours, lui, est parti.
    const older = (table: string) =>
      (
        getStatsDB()
          .prepare(
            `SELECT COUNT(*) AS n FROM ${table} WHERE created_at < datetime('now', '-2 days')`,
          )
          .get() as { n: number }
      ).n;
    expect(older('verification_sends')).toBe(0);
    expect(older('free_key_mail_sends')).toBe(0);
  });
});

describe('la livraison d’une clé payée', () => {
  it('n’est comptée par aucun des deux plafonds ni retenue, même les deux atteints', async () => {
    fillCodes(LIMIT);
    fillKeyMails(DAY_LIMIT - LIMIT, '-3 hours');
    expect(unauthenticatedMailsLastHour()).toBe(LIMIT);
    expect(unauthenticatedMailsLastDay()).toBe(DAY_LIMIT);
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
    expect(unauthenticatedMailsLastDay()).toBe(DAY_LIMIT);
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
