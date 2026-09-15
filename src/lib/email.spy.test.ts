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
const { ANONYMOUS_CONTACT } = await import('./tiers.js');
const { generateApiKey, validateApiKey } = await import('./api-keys.js');

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
