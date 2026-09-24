/**
 * « Aucun mail ne part pour une clé anonyme » — le test qui remplace une preuve
 * impossible.
 *
 * Il n'existe AUCUN journal d'envoi dans ce dépôt, aucune route admin qui
 * dirait « voici ce qui est parti », et il ne faut pas en construire une pour
 * ce chantier : le seul voisin est le registre des codes de vérification, qui
 * ne journalise que les codes. La garantie est donc structurelle en production
 * — la sentinelle du palier anonyme n'a pas d'arobase, donc rien ne peut
 * l'atteindre — et c'est ici qu'elle se vérifie.
 *
 * 🚨 Le drapeau VITEST est LEVÉ dans ces tests. La route saute son envoi sous
 * vitest (la suite la pilote avec les adresses d'exemple publiées, et un relais
 * configuré dans le shell posterait de la documentation à de vraies personnes),
 * donc un espion posé sans lever le drapeau serait vert pour la mauvaise
 * raison : il mesurerait la garde de test, pas le comportement de production.
 * Même idiome que ./email-delivery.test.ts.
 *
 * Le résolveur de domaine est remplacé pour la même raison : sans VITEST, la
 * route interroge un vrai serveur de noms, et le test mesurerait le réseau.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

const sendFreeKeyEmail = vi.fn(async () => true);
const sendQuotaWarningEmail = vi.fn(async () => true);
const deliverKeyVerificationEmail = vi.fn(async () => 'sent' as const);

vi.mock('./email.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendFreeKeyEmail: (...args: unknown[]) => sendFreeKeyEmail(...(args as [])),
    sendQuotaWarningEmail: (...args: unknown[]) => sendQuotaWarningEmail(...(args as [])),
    deliverKeyVerificationEmail: (...args: unknown[]) =>
      deliverKeyVerificationEmail(...(args as [])),
  };
});

vi.mock('./mail-domain.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, domainAcceptsMail: async () => true };
});

const { apiKeys } = await import('../routes/api-keys.js');
const { maybeSendQuotaWarning } = await import('./quota-notice.js');
const { ANONYMOUS_CONTACT, FREE_TIER_MONTHLY_LIMIT } = await import('./tiers.js');
const { generateApiKey, validateApiKey, getKeyTier } = await import('./api-keys.js');
const { VERIFICATION_TTL_MINUTES } = await import('./key-creation-guard.js');
const { getStatsDB } = await import('./db.js');

const ENV = { vitest: process.env.VITEST, testKeys: process.env.IBANFORGE_ADMIN_TEST_KEYS };
const RUN = Date.now();

beforeEach(() => {
  sendFreeKeyEmail.mockClear();
  sendQuotaWarningEmail.mockClear();
  deliverKeyVerificationEmail.mockClear();
  process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ENV.vitest === undefined) delete process.env.VITEST;
  else process.env.VITEST = ENV.vitest;
  if (ENV.testKeys === undefined) delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  else process.env.IBANFORGE_ADMIN_TEST_KEYS = ENV.testKeys;
});

/** Le comportement de production, drapeau de test levé le temps de l'appel. */
async function asProduction<T>(fn: () => T | Promise<T>): Promise<T> {
  delete process.env.VITEST;
  try {
    // Attendu DANS le try : restaurer le drapeau au retour synchrone d'une
    // promesse le remettrait avant que l'envoi n'atteigne son chemin.
    return await fn();
  } finally {
    process.env.VITEST = ENV.vitest ?? 'true';
  }
}

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

describe('la branche anonyme n’appelle jamais la fonction d’envoi', () => {
  it('aucun envoi sans adresse, et un envoi avec — les deux moitiés comptent', async () => {
    const app = makeApp();

    const anon = await asProduction(() => app.request('/v1/keys/generate', { method: 'POST' }));
    expect(anon.status).toBe(201);
    const body = (await anon.json()) as Record<string, unknown>;
    expect(body.tier).toBe('anonymous');
    expect(sendFreeKeyEmail).not.toHaveBeenCalled();
    expect(deliverKeyVerificationEmail).not.toHaveBeenCalled();

    // 🚨 Le garde du garde. Sans cette moitié, un vert ne prouverait que
    // l'espion mal branché : c'est ainsi qu'un test « rien n'est parti » reste
    // vert le jour où tout part.
    const withEmail = await asProduction(() =>
      app.request('/v1/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `spy-${RUN}@alpha-corp.example.net` }),
      }),
    );
    expect(withEmail.status).toBe(201);
    expect(sendFreeKeyEmail).toHaveBeenCalledTimes(1);
  });

  it('la sentinelle n’est jamais avertie de son quota : no_contact, sans relais sollicité', async () => {
    // Le cas que ce test NOMME : le seuil d'avertissement est un ratio, donc
    // une clé anonyme le franchit huit fois plus tôt qu'une clé du palier
    // gratuit. Le middleware coupe la branche entière ; ici on vérifie la
    // ceinture — même appelée de force, la notice refuse une sentinelle.
    const anon = generateApiKey(null, undefined, undefined, false, { ipHash: `spy-${RUN}` });
    if (!anon) throw new Error('mint anonyme impossible');
    const { keyHash } = validateApiKey(anon.api_key);
    const outcome = await asProduction(() =>
      maybeSendQuotaWarning({
        keyHash,
        email: ANONYMOUS_CONTACT,
        keyPrefix: anon.key_prefix,
        used: 20,
        limit: 25,
        month: '2030-01',
      }),
    );
    expect(outcome).toBe('no_contact');
    expect(sendQuotaWarningEmail).not.toHaveBeenCalled();
  });
});

describe('la réclamation en deux temps, avec un relais qui répond', () => {
  it('le temps 1 rend 202 et poste le code, le temps 2 promeut la clé', async () => {
    // C'est le SEUL endroit de la suite où le 202 est réellement atteint :
    // ailleurs aucun relais n'est configuré et la route répond 503
    // fail-CLOSED, ce qui est le comportement réel de production sans relais.
    // Ici le relais est remplacé, donc le contrat des deux temps se vérifie.
    const app = makeApp();
    const k = generateApiKey(null, undefined, undefined, false, { ipHash: `spy-202-${RUN}` });
    if (!k) throw new Error('mint anonyme impossible');
    // La clé doit avoir servi : la condition d'entrée transforme « une clé
    // gratuite obtenue n'importe où ouvre un mail vers une adresse arbitraire »
    // en « chaque mail coûte un appel réellement servi ».
    getStatsDB()
      .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 1)')
      .run(k.key_hash, new Date().toISOString().slice(0, 7));

    const email = `claim-202-${RUN}@alpha-corp.example.net`;
    const first = await asProduction(() =>
      app.request('/v1/keys/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
        body: JSON.stringify({ email }),
      }),
    );
    expect(first.status).toBe(202);
    const sent = (await first.json()) as Record<string, unknown>;
    expect(sent.status).toBe('code_sent');
    expect(sent.key_prefix).toBe(k.key_prefix);
    expect(sent.expires_in_minutes).toBe(VERIFICATION_TTL_MINUTES);
    expect(deliverKeyVerificationEmail).toHaveBeenCalledTimes(1);
    // L'envoi est journalisé, et il ne compte PAS contre le plafond de
    // réclamations par réseau, qui ne lit que les succès.
    const sends = getStatsDB()
      .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE event = 'send' AND key_hash = ?")
      .get(k.key_hash) as { n: number };
    expect(sends.n).toBe(1);

    // Le code posté est celui que l'espion a reçu : la route ne le rend jamais.
    const code = (deliverKeyVerificationEmail.mock.calls[0] as unknown as [{ code: string }])[0]
      .code;
    expect(code).toMatch(/^\d{6}$/);

    const second = await asProduction(() =>
      app.request('/v1/keys/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
        body: JSON.stringify({ email, code }),
      }),
    );
    expect(second.status).toBe(200);
    const claimed = (await second.json()) as Record<string, unknown>;
    expect(claimed.claimed).toBe(true);
    expect(claimed.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    const row = getKeyTier(k.key_hash)!;
    expect(row.tier).toBe('claimed');
    expect(row.claim_method).toBe('email_code');
    // Le rail de l'adresse EFFACE la dégradation : la réclamation est la preuve
    // que celle-ci ne visait pas cette clé.
    expect(row.no_recredit).toBe(0);
    expect(row.shield_episode).toBeNull();
  });
});

describe('une adresse qui en nomme plusieurs', () => {
  // Une seule adresse simple (src/lib/email-shape.ts) : une liste, un nom
  // affiché ou des guillemets sont refusés AVANT tout envoi, sur les deux
  // routes qui postent un mail à l'adresse saisie.
  const LISTS = [
    'liste+x,autre@alpha-corp.example.net',
    'liste@alpha-corp.example.net;autre@alpha-corp.example.net',
    'Acme <liste@alpha-corp.example.net>',
  ];

  it.each(LISTS)('la génération la refuse sans rien envoyer : %j', async (email) => {
    const res = await asProduction(() =>
      makeApp().request('/v1/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_email');
    expect(sendFreeKeyEmail).not.toHaveBeenCalled();
  });

  it.each(LISTS)('la réclamation la refuse sans poster de code : %j', async (email) => {
    const k = generateApiKey(null, undefined, undefined, false, {
      ipHash: `spy-liste-${RUN}-${LISTS.indexOf(email)}`,
    });
    if (!k) throw new Error('mint anonyme impossible');
    getStatsDB()
      .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 1)')
      .run(k.key_hash, new Date().toISOString().slice(0, 7));
    const res = await asProduction(() =>
      makeApp().request('/v1/keys/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
        body: JSON.stringify({ email }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_email');
    expect(deliverKeyVerificationEmail).not.toHaveBeenCalled();
    expect(getKeyTier(k.key_hash)!.tier).toBe('anonymous');
  });
});
