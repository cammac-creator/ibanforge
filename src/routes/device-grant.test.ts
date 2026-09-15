/**
 * 🚨 LES DEUX RÉGLAGES QUI RENDENT CE FICHIER EXÉCUTABLE.
 *
 * `vitest.config.ts` ne définit AUCUN `testTimeout`, donc le défaut de vitest
 * (5 000 ms) s'applique. Avec l'attente de production (30 s) et le délai
 * anti-force-brute de production (jusqu'à 5 s par 404), tout test qui poll avant
 * approbation ou qui mesure deux 404 expirerait avant la réponse. Les valeurs
 * sont donc posées ici, par les lectures gardées du module — jamais par des
 * constantes figées, ce qui est exactement pourquoi ces lectures existent.
 *
 * 🚨 LE TEMPS SE DÉPLACE PAR SQL, JAMAIS PAR L'HORLOGE DE VITEST : toutes les
 * échéances sont posées et comparées par SQLite. On recule la LIGNE par UPDATE.
 */
process.env.DEVICE_POLL_WAIT_MS = '200';
process.env.DEVICE_POLL_TICK_MS = '20';
process.env.DEVICE_MISS_DELAY_FLOOR_MS = '10';
process.env.DEVICE_MISS_DELAY_MAX_MS = '150';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { apiKeys } from './api-keys.js';
import { deviceGrant } from './device-grant.js';
import { getStatsDB } from '../lib/db.js';
import {
  ANONYMOUS_MONTHLY_LIMIT,
  FREE_TIER_MONTHLY_LIMIT,
  SHIELD_MONTHLY_LIMIT,
} from '../lib/tiers.js';
import { BREAKER_THRESHOLD, evaluateBreakerOnCreation } from '../lib/creation-breaker.js';
import {
  DAILY_KEY_CREATION_LIMIT,
  VERIFICATION_SENDS_PER_SOURCE_DAY,
  createVerificationChallenge,
  keyCreationSource,
} from '../lib/key-creation-guard.js';
import {
  DEVICE_APPROVAL_MISSES_PER_IP_HOUR,
  DEVICE_CODES_PER_IP_HOUR,
  DEVICE_POLL_INTERVAL_SECONDS,
  hashGrantSecret,
} from '../lib/device-grant.js';

/**
 * Le relais de courrier, remplacé par une doublure qui RETIENT le code.
 *
 * Sans elle il n'existe aucun moyen de traverser la branche e-mail de bout en
 * bout : `deliverViaRelay` rend `unconfigured` quand la configuration du relais
 * manque, et la route répond alors 503 à juste titre. Seule cette fonction est
 * remplacée, le reste du module de courrier restant réel : une doublure du
 * module entier casserait tous ses autres appelants du graphe.
 */
const mail = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; code: string }>,
  outcome: 'sent' as 'sent' | 'undeliverable' | 'unconfigured',
}));
vi.mock('../lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/email.js')>();
  return {
    ...actual,
    deliverKeyVerificationEmail: async (p: { to: string; code: string }) => {
      mail.sent.push(p);
      return mail.outcome;
    },
  };
});

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', deviceGrant);
  // Monté à côté, comme dans `buildApp()`, parce que la réservation est
  // PARTAGÉE entre les deux portes et que c'est un test de ce fichier.
  app.route('/', apiKeys);
  return app;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function post(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

interface Opened {
  device_code: string;
  user_code: string;
  expires_in: number;
  interval: number;
  verification_uri_complete: string;
}

async function open(
  app: Hono,
  headers: Record<string, string> = {},
  body: unknown = {},
): Promise<Opened> {
  const res = await post(app, '/v1/keys/device', body, headers);
  expect(res.status, `ouverture refusée : ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as Opened;
}

/** Le jeton d'approbation, obtenu comme la page l'obtient. */
async function tokenFor(app: Hono, userCode: string): Promise<string> {
  const res = await post(app, '/v1/keys/device/lookup', { user_code: userCode });
  expect(res.status).toBe(200);
  return ((await res.json()) as { approval_token: string }).approval_token;
}

/** Ouvre puis approuve en anonyme, et rend le secret de l'agent. */
async function openAndApprove(
  app: Hono,
  headers: Record<string, string> = {},
): Promise<{ deviceCode: string; userCode: string }> {
  const opened = await open(app, headers);
  const token = await tokenFor(app, opened.user_code);
  const res = await post(app, '/v1/keys/device/approve', {
    user_code: opened.user_code,
    approval_token: token,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return { deviceCode: opened.device_code, userCode: opened.user_code };
}

function rewindGrant(deviceCode: string, clause: string): void {
  getStatsDB()
    .prepare(`UPDATE device_codes SET expires_at = datetime('now', ?) WHERE device_code_hash = ?`)
    .run(clause, hashGrantSecret(deviceCode));
}

const originalEnv = { ...process.env };
beforeEach(() => {
  // Les domaines de la suite sont des noms de documentation : ce drapeau les
  // autorise, exactement comme dans les tests de /v1/keys/generate.
  process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
  mail.sent.length = 0;
  mail.outcome = 'sent';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('le parcours nominal', () => {
  it('ouvre, affiche, approuve en anonyme, et remet la clé une fois', async () => {
    const app = makeApp();
    const opened = await open(app, {}, { client_name: 'Claude Code', reason: 'validate IBANs' });
    expect(opened.device_code).toMatch(/^ifd_[0-9a-f]{64}$/);
    expect(opened.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(opened.interval).toBe(DEVICE_POLL_INTERVAL_SECONDS);
    expect(opened.verification_uri_complete).toContain(opened.user_code);

    const look = await post(app, '/v1/keys/device/lookup', { user_code: opened.user_code });
    const shown = (await look.json()) as Record<string, unknown>;
    expect(shown.client_name).toBe('Claude Code');
    expect(shown.anonymous_monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(shown.claimed_monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);

    const approved = await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: shown.approval_token,
    });
    expect(approved.status).toBe(200);
    const approvedBody = await approved.text();
    // 🚨 La clé n'est JAMAIS rendue à la page. C'est ce qui empêche un tiers qui
    // a deviné un code court de repartir avec la clé : au mieux il fait recevoir
    // une clé anonyme à l'agent légitime.
    expect(approvedBody).not.toContain('ifk_');
    expect(approvedBody).not.toContain('api_key');

    const got = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    expect(got.status).toBe(200);
    const key = (await got.json()) as Record<string, unknown>;
    expect(key.api_key).toMatch(/^ifk_/);
    expect(key.tier).toBe('anonymous');
    expect(key.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    // 🚨 Le champ `email` est ABSENT, pas null et pas la sentinelle.
    expect(key).not.toHaveProperty('email');
    expect(key.config_line).toBe(
      `claude mcp add ibanforge -e IBANFORGE_API_KEY=${String(key.api_key)} -- npx -y ibanforge-mcp`,
    );
  });

  it("frappe une clé de palier e-mail quand l'humain prouve une boîte, et pose claimed_at", async () => {
    const app = makeApp();
    const email = 'acme@example.com';
    const opened = await open(app);
    const token = await tokenFor(app, opened.user_code);

    const asked = await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
      email,
    });
    expect(asked.status).toBe(202);
    const sentBody = (await asked.json()) as Record<string, unknown>;
    expect(sentBody.status).toBe('code_sent');
    expect(mail.sent.at(-1)?.to).toBe(email);
    const code = mail.sent.at(-1)!.code;

    const approved = await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
      email,
      code,
    });
    expect(approved.status, await approved.clone().text()).toBe(200);
    const verdict = (await approved.json()) as Record<string, unknown>;
    // 🚨 `email` et non `claimed` : cette clé est NÉE avec une adresse vérifiée,
    // rien n'a été « réclamé ». `claimed` est réservé à une clé née anonyme puis
    // montée par POST /v1/keys/claim.
    expect(verdict.tier).toBe('email');
    expect(verdict.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);

    const got = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    const key = (await got.json()) as Record<string, unknown>;
    expect(key.tier).toBe('email');
    expect(key.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(key.email).toBe(email);

    // 🚨 Sans `claimed_at`, une clé device née d'un code VÉRIFIÉ serait dégradée
    // par le bouclier du disjoncteur, et rien ne le dirait : le prédicat de
    // dégradation est `claimed_at IS NULL`, pas `tier === 'anonymous'`.
    const row = getStatsDB()
      .prepare('SELECT claimed_at, claim_method, tier FROM api_keys WHERE key_prefix = ?')
      .get(key.key_prefix) as {
      claimed_at: string | null;
      claim_method: string | null;
      tier: string;
    };
    expect(row.claimed_at).not.toBeNull();
    expect(row.claim_method).toBe('email_code');
    expect(row.tier).toBe('email');
  });

  it('est atteignable sur la vraie application, sans aucune clé', async () => {
    // Le montage est le vrai risque de régression : monté APRÈS le middleware de
    // clé, la route exigerait le Bearer que l'appelant vient précisément chercher.
    const res = await post(buildApp() as unknown as Hono, '/v1/keys/device', {});
    expect(res.status).toBe(201);
  });
});

describe("l'invariant de naissance", () => {
  it('écrit EXACTEMENT une ligne key_creations, portant l’empreinte du créateur', async () => {
    const app = makeApp();
    const creatorIp = '203.0.113.31';
    const opened = await open(app, { 'x-real-ip': creatorIp, 'user-agent': 'agent-A/1.0' });
    const token = await tokenFor(app, opened.user_code);
    // L'humain approuve depuis un AUTRE appareil, avec un autre navigateur.
    await post(
      app,
      '/v1/keys/device/approve',
      { user_code: opened.user_code, approval_token: token },
      { 'x-real-ip': '198.51.100.55', 'user-agent': 'navigateur-B/2.0' },
    );
    const got = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    const key = (await got.json()) as { key_prefix: string };

    const rows = getStatsDB()
      .prepare('SELECT ip_hash, user_agent FROM key_creations WHERE key_prefix = ?')
      .all(key.key_prefix) as Array<{ ip_hash: string; user_agent: string | null }>;
    // 🚨 « ni 2 » est l'assertion qui compte : c'est elle qui attrape le retour
    // d'un `recordKeyCreation` ajouté ici, dont le double comptage armerait le
    // disjoncteur à la moitié du volume réel.
    expect(rows).toHaveLength(1);
    // L'empreinte est celle de l'AGENT qui a ouvert le grant, pas celle du
    // navigateur qui a cliqué : sinon toutes les clés device honnêtes forment
    // une fausse cohorte de navigateurs, et la ferme qui approuve en curl
    // disparaît.
    expect(rows[0].ip_hash).toBe(keyCreationSource(creatorIp));
    expect(rows[0].user_agent).toBe('agent-A/1.0');
  });

  it('journalise une adresse INCONNUE plutôt que de l’oublier', async () => {
    const app = makeApp();
    // Aucun en-tête d'adresse : le plafond par réseau ne mord pas (fail-open),
    // mais le compteur global n'a besoin d'aucune ancre pour compter. Sans cette
    // sentinelle, la porte redevient invisible au disjoncteur dès que l'en-tête
    // d'adresse change de nom.
    const { deviceCode } = await openAndApprove(app);
    const got = await post(app, '/v1/keys/device/token', { device_code: deviceCode });
    const key = (await got.json()) as { key_prefix: string };
    const row = getStatsDB()
      .prepare('SELECT ip_hash FROM key_creations WHERE key_prefix = ?')
      .get(key.key_prefix) as { ip_hash: string | null };
    expect(row.ip_hash).toBe('unknown');
  });

  it("écrit l'attribution du parcours", async () => {
    const app = makeApp();
    const opened = await open(app, {}, { source: 'mcp-device' });
    const token = await tokenFor(app, opened.user_code);
    await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
    });
    const got = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    const key = (await got.json()) as { key_prefix: string };
    const row = getStatsDB()
      .prepare('SELECT src FROM signup_attribution WHERE key_prefix = ?')
      .get(key.key_prefix) as { src: string };
    expect(row.src).toBe('mcp-device');
  });
});

describe('le retrait', () => {
  it('ne rend la clé qu’une fois', async () => {
    const app = makeApp();
    const { deviceCode } = await openAndApprove(app);
    expect((await post(app, '/v1/keys/device/token', { device_code: deviceCode })).status).toBe(
      200,
    );
    const again = await post(app, '/v1/keys/device/token', { device_code: deviceCode });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe('invalid_grant');
    const row = getStatsDB()
      .prepare('SELECT raw_key_once FROM device_codes WHERE device_code_hash = ?')
      .get(hashGrantSecret(deviceCode)) as { raw_key_once: string | null };
    expect(row.raw_key_once).toBeNull();
  });

  it('rend UNE clé à deux retraits concurrents', async () => {
    const app = makeApp();
    const { deviceCode } = await openAndApprove(app);
    const [a, b] = await Promise.all([
      post(app, '/v1/keys/device/token', { device_code: deviceCode }),
      post(app, '/v1/keys/device/token', { device_code: deviceCode }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(((await loser.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('répond authorization_pending avant toute approbation, et jamais une clé', async () => {
    const app = makeApp();
    const opened = await open(app);
    const res = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('authorization_pending');
    expect(body.interval).toBe(DEVICE_POLL_INTERVAL_SECONDS);
    expect(JSON.stringify(body)).not.toContain('ifk_');
  });

  it('répond slow_down, immédiatement, à deux appels trop rapprochés', async () => {
    const app = makeApp();
    const opened = await open(app);
    await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    const started = performance.now();
    const res = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    const elapsed = performance.now() - started;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('slow_down');
    // Sans attente : la contre-pression du grant se met DEVANT le limiteur
    // global de requêtes par minute.
    expect(elapsed).toBeLessThan(100);
  });

  it('répond access_denied après un refus, et aucune clé n’a été frappée', async () => {
    const app = makeApp();
    const before = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }
    ).n;
    const opened = await open(app);
    const token = await tokenFor(app, opened.user_code);
    const denied = await post(app, '/v1/keys/device/deny', {
      user_code: opened.user_code,
      approval_token: token,
    });
    expect(denied.status).toBe(200);
    const res = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('access_denied');
    expect(
      (getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }).n,
    ).toBe(before);
  });

  it('répond expired_token, et la page répond 404', async () => {
    const app = makeApp();
    const opened = await open(app);
    rewindGrant(opened.device_code, '-1 second');
    const res = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('expired_token');
    const look = await post(app, '/v1/keys/device/lookup', { user_code: opened.user_code });
    expect(look.status).toBe(404);
  });

  it('accepte le form-encodé, comme une bibliothèque OAuth existante', async () => {
    const app = makeApp();
    const { deviceCode } = await openAndApprove(app);
    const res = await app.request('/v1/keys/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });
    expect(res.status).toBe(200);
  });

  it('refuse un grant_type qui n’est pas celui de la RFC', async () => {
    const app = makeApp();
    const opened = await open(app);
    const res = await post(app, '/v1/keys/device/token', {
      device_code: opened.device_code,
      grant_type: 'authorization_code',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_grant_type');
  });
});

describe('le long-polling', () => {
  it('rend la main dès l’approbation, nettement avant la fin de l’attente', async () => {
    const app = makeApp();
    process.env.DEVICE_POLL_WAIT_MS = '2000';
    const opened = await open(app);
    const token = await tokenFor(app, opened.user_code);
    const started = performance.now();
    const polling = post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    await new Promise((r) => setTimeout(r, 60));
    await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
    });
    const res = await polling;
    const elapsed = performance.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(1_500);
  });

  it('un navigateur n’attend JAMAIS', async () => {
    // Trois lignes de script sur une page fréquentée feraient tenir trente
    // secondes de serveur à chacun de ses visiteurs, depuis autant d'adresses
    // résidentielles qu'elle a de lecteurs — et la route acceptant le
    // form-encodé, c'est une requête simple, sans preflight.
    const app = makeApp();
    process.env.DEVICE_POLL_WAIT_MS = '600';
    const browserHeaders: Array<Record<string, string>> = [
      { Origin: 'https://ailleurs.example' },
      { 'Sec-Fetch-Mode': 'cors' },
    ];
    for (const header of browserHeaders) {
      const opened = await open(app);
      const started = performance.now();
      const res = await post(
        app,
        '/v1/keys/device/token',
        { device_code: opened.device_code },
        header,
      );
      const elapsed = performance.now() - started;
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('authorization_pending');
      expect(elapsed, `en-tête ${JSON.stringify(header)}`).toBeLessThan(200);
    }
    // Et sans en-tête, la même requête attend bien : sans cette moitié, une
    // règle qui ne ferait jamais attendre personne passerait le test.
    const opened = await open(app);
    const started = performance.now();
    await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    expect(performance.now() - started).toBeGreaterThan(300);
  });

  it('le sous-plafond par empreinte mord avant le global', async () => {
    const app = makeApp();
    process.env.DEVICE_POLL_WAIT_MS = '600';
    process.env.DEVICE_POLLS_IN_FLIGHT_PER_IP = '1';
    const ip = '203.0.113.90';
    const held = await open(app, { 'x-real-ip': '203.0.113.91' });
    const second = await open(app, { 'x-real-ip': '203.0.113.92' });
    const elsewhere = await open(app, { 'x-real-ip': '203.0.113.93' });

    // Une attente RETENUE depuis cette empreinte.
    const first = post(
      app,
      '/v1/keys/device/token',
      { device_code: held.device_code },
      {
        'x-real-ip': ip,
      },
    );
    await new Promise((r) => setTimeout(r, 40));
    const startedSame = performance.now();
    const refused = await post(
      app,
      '/v1/keys/device/token',
      { device_code: second.device_code },
      {
        'x-real-ip': ip,
      },
    );
    const sameElapsed = performance.now() - startedSame;
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe('authorization_pending');
    expect(sameElapsed).toBeLessThan(200);

    // 🚨 Et une attente ouverte depuis une AUTRE adresse attend bien, elle :
    // sans cette moitié, un sous-plafond posé trop bas passerait pour correct.
    const startedOther = performance.now();
    await post(
      app,
      '/v1/keys/device/token',
      { device_code: elsewhere.device_code },
      {
        'x-real-ip': '203.0.113.99',
      },
    );
    expect(performance.now() - startedOther).toBeGreaterThan(300);
    await first;
  });

  it('le plafond global rend la main tout de suite', async () => {
    const app = makeApp();
    process.env.DEVICE_POLL_WAIT_MS = '600';
    process.env.DEVICE_POLLS_IN_FLIGHT_MAX = '1';
    const held = await open(app, { 'x-real-ip': '203.0.113.81' });
    const other = await open(app, { 'x-real-ip': '203.0.113.82' });
    const first = post(
      app,
      '/v1/keys/device/token',
      { device_code: held.device_code },
      {
        'x-real-ip': '203.0.113.85',
      },
    );
    await new Promise((r) => setTimeout(r, 40));
    const started = performance.now();
    const res = await post(
      app,
      '/v1/keys/device/token',
      { device_code: other.device_code },
      {
        'x-real-ip': '203.0.113.86',
      },
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(performance.now() - started).toBeLessThan(200);
    expect(body.error).toBe('authorization_pending');
    // Le corps porte l'intervalle : le client conforme repasse à sa cadence.
    expect(body.interval).toBe(DEVICE_POLL_INTERVAL_SECONDS);
    await first;
  });
});

describe('les gardes de la page', () => {
  it('refuse une approbation sans jeton, sans rien changer', async () => {
    const app = makeApp();
    const opened = await open(app);
    const res = await post(app, '/v1/keys/device/approve', { user_code: opened.user_code });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('approval_token_required');
    const row = getStatsDB()
      .prepare('SELECT status, key_hash FROM device_codes WHERE device_code_hash = ?')
      .get(hashGrantSecret(opened.device_code)) as { status: string; key_hash: string | null };
    expect(row.status).toBe('pending');
    expect(row.key_hash).toBeNull();
    // Et le parcours complet reste vert derrière : sans cette moitié, une garde
    // qui refuse TOUT passerait le test.
    const token = await tokenFor(app, opened.user_code);
    expect(
      (
        await post(app, '/v1/keys/device/approve', {
          user_code: opened.user_code,
          approval_token: token,
        })
      ).status,
    ).toBe(200);
  });

  it('refuse un refus sans jeton', async () => {
    const app = makeApp();
    const opened = await open(app);
    const res = await post(app, '/v1/keys/device/deny', { user_code: opened.user_code });
    expect(res.status).toBe(403);
    const token = await tokenFor(app, opened.user_code);
    expect(
      (
        await post(app, '/v1/keys/device/deny', {
          user_code: opened.user_code,
          approval_token: token,
        })
      ).status,
    ).toBe(200);
  });

  it('refuse un Content-Type autre que JSON, corps JSON valide compris', async () => {
    // C'est ce qui force le preflight, donc ce qui fait que CORS s'applique
    // vraiment : une requête « simple » au sens du fetch part sans preflight.
    const app = makeApp();
    const opened = await open(app);
    for (const path of ['/v1/keys/device/approve', '/v1/keys/device/deny']) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ user_code: opened.user_code, approval_token: 'ifa_x' }),
      });
      expect(res.status, path).toBe(415);
      expect(((await res.json()) as { error: string }).error).toBe('unsupported_media_type');
    }
  });

  it('refuse une Origin qui n’est pas dans la liste, et ignore son absence', async () => {
    const app = makeApp();
    process.env.CORS_ORIGIN = 'https://ibanforge.com';
    const opened = await open(app);
    const res = await post(
      app,
      '/v1/keys/device/approve',
      { user_code: opened.user_code, approval_token: 'ifa_x' },
      { Origin: 'https://ailleurs.example' },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden_origin');
    // Absente, elle n'est jamais contrôlée : sinon `curl` cesse de fonctionner
    // et la recette de vérification avec lui.
    const token = await tokenFor(app, opened.user_code);
    expect(
      (
        await post(app, '/v1/keys/device/approve', {
          user_code: opened.user_code,
          approval_token: token,
        })
      ).status,
    ).toBe(200);
  });

  it('nettoie ce que l’agent déclare avant de le montrer à un humain', async () => {
    const app = makeApp();
    const opened = await open(
      app,
      {},
      {
        client_name: '<script>alert(1)</script>',
        reason: 'ligne\nsuivante et https://autre.example/x',
      },
    );
    const look = await post(app, '/v1/keys/device/lookup', { user_code: opened.user_code });
    const shown = await look.text();
    expect(shown).not.toContain('<script');
    expect(shown).not.toContain('\\n');
    expect(shown).not.toContain('://');
    expect(shown.toLowerCase()).not.toContain('http');
  });

  it('un jeton périmé par un lookup plus récent ne vaut plus rien', async () => {
    // Deux onglets ouverts sur le même code : c'est le DERNIER chargé qui peut
    // approuver, et l'autre doit recharger.
    const app = makeApp();
    const opened = await open(app);
    const stale = await tokenFor(app, opened.user_code);
    const fresh = await tokenFor(app, opened.user_code);
    expect(stale).not.toBe(fresh);
    const res = await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: stale,
    });
    expect(res.status).toBe(403);
    expect(
      (
        await post(app, '/v1/keys/device/approve', {
          user_code: opened.user_code,
          approval_token: fresh,
        })
      ).status,
    ).toBe(200);
  });
});

describe('le 404 uniforme, en corps ET en temps', () => {
  it('sert un code expiré et un code inexistant à la même vitesse', async () => {
    const app = makeApp();
    const guesser = '198.51.100.77';
    // 🚨 L'ORDRE est load-bearing : il faut D'ABORD brûler le budget `hit = 0`
    // de cette empreinte, sinon les deux 404 reviennent au plancher et
    // l'assertion passe AVEC l'oracle intact.
    for (let i = 0; i < DEVICE_APPROVAL_MISSES_PER_IP_HOUR + 5; i++) {
      await post(
        app,
        '/v1/keys/device/approve',
        { user_code: 'ZZZZ-ZZZZ', approval_token: 'ifa_x' },
        { 'x-real-ip': guesser },
      );
    }

    const opened = await open(app);
    rewindGrant(opened.device_code, '-1 second');

    // Un code EXPIRÉ : la ligne existe, donc `hit = 1`.
    const startedHit = performance.now();
    const hit = await post(
      app,
      '/v1/keys/device/approve',
      { user_code: opened.user_code, approval_token: 'ifa_x' },
      { 'x-real-ip': guesser },
    );
    const hitMs = performance.now() - startedHit;

    // Un code INEXISTANT : `hit = 0`.
    const startedMiss = performance.now();
    const miss = await post(
      app,
      '/v1/keys/device/approve',
      { user_code: 'XXXX-XXXX', approval_token: 'ifa_x' },
      { 'x-real-ip': guesser },
    );
    const missMs = performance.now() - startedMiss;

    expect(hit.status).toBe(404);
    expect(miss.status).toBe(404);
    // Corps strictement identiques : aucun oracle de contenu.
    expect(await hit.text()).toBe(await miss.text());
    // Et durées du même ordre : aucun oracle temporel. Un code expiré est un
    // parcours qui n'aboutit pas ; rien ne justifie de le servir plus vite.
    const ratio = Math.max(hitMs, missMs) / Math.max(1, Math.min(hitMs, missMs));
    expect(ratio, `hit ${hitMs.toFixed(0)} ms vs miss ${missMs.toFixed(0)} ms`).toBeLessThan(1.6);
  });

  it('retarde, mais ne refuse JAMAIS : le 404 reste un 404', async () => {
    // Un 429 au dépassement des budgets rendrait le module fermable au monde
    // entier pour deux cents requêtes par heure.
    const app = makeApp();
    const guesser = '198.51.100.78';
    for (let i = 0; i < DEVICE_APPROVAL_MISSES_PER_IP_HOUR + 10; i++) {
      const res = await post(
        app,
        '/v1/keys/device/approve',
        { user_code: 'WWWW-WWWW', approval_token: 'ifa_x' },
        { 'x-real-ip': guesser },
      );
      expect(res.status).toBe(404);
    }
  });
});

describe('les plafonds', () => {
  it('borne les ouvertures par réseau et par heure, et ne se contourne pas par `source`', async () => {
    const app = makeApp();
    const ip = '203.0.113.40';
    // Chaque grant est REFUSÉ juste après son ouverture : un refus rend la place
    // de réservation, donc seul le plafond horaire de LIGNES borne encore le
    // brassage (ouvrir, refuser, rouvrir).
    for (let i = 0; i < DEVICE_CODES_PER_IP_HOUR; i++) {
      const opened = await open(app, { 'x-real-ip': ip }, { source: `src-${i}` });
      getStatsDB()
        .prepare("UPDATE device_codes SET status = 'denied' WHERE device_code_hash = ?")
        .run(hashGrantSecret(opened.device_code));
    }
    const refused = await post(
      app,
      '/v1/keys/device',
      { source: 'src-final' },
      { 'x-real-ip': ip },
    );
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe('device_rate_limited');
  });

  it('partage le budget de /v1/keys/generate : deux clés plus un grant ouvert ferment la porte', async () => {
    const app = makeApp();
    // 🚨 Le drapeau des tests DÉSARME la garde par réseau de /v1/keys/generate :
    // c'est exactement ce que ce test mesure, donc il le retire.
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const ip = '203.0.113.50';
    for (let i = 0; i < DAILY_KEY_CREATION_LIMIT - 1; i++) {
      const res = await post(app, '/v1/keys/generate', {}, { 'x-real-ip': ip });
      expect(res.status, await res.clone().text()).toBe(201);
    }
    // La troisième place est libre : le grant passe.
    expect((await post(app, '/v1/keys/device', {}, { 'x-real-ip': ip })).status).toBe(201);
    // Un grant en attente est une clé PROMISE : la place est prise.
    const refused = await post(app, '/v1/keys/device', {}, { 'x-real-ip': ip });
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe('device_rate_limited');
  });

  it('partage le budget dans les DEUX sens : trois grants ouverts ferment /v1/keys/generate', async () => {
    // 🚨 Le jumeau du test précédent, et c'est lui qui manquait : la garde du
    // jour de /v1/keys/generate lisait `key_creations` SEUL, où un grant en
    // attente ne figure pas. Mesuré le 15/09/2026 sur base neuve, un seul
    // réseau : trois grants ouverts, puis trois clés par /v1/keys/generate,
    // puis les trois approbations — six clés pour un budget de trois, avec
    // l'invariant de naissance intact (six lignes pour six clés).
    const app = makeApp();
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const ip = '203.0.113.51';
    const opened: Opened[] = [];
    for (let i = 0; i < DAILY_KEY_CREATION_LIMIT; i++)
      opened.push(await open(app, { 'x-real-ip': ip }));

    // Trois clés PROMISES : la porte /v1/keys/generate est fermée à ce réseau.
    const refused = await post(app, '/v1/keys/generate', {}, { 'x-real-ip': ip });
    expect(refused.status, await refused.clone().text()).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe('key_creation_limit');

    // Les trois approbations frappent trois clés, et trois seulement.
    for (const grant of opened) {
      const token = await tokenFor(app, grant.user_code);
      const res = await post(app, '/v1/keys/device/approve', {
        user_code: grant.user_code,
        approval_token: token,
      });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    const stillRefused = await post(app, '/v1/keys/generate', {}, { 'x-real-ip': ip });
    expect(stillRefused.status).toBe(429);
    const born = getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM key_creations WHERE ip_hash = ?')
      .get(keyCreationSource(ip)) as { n: number };
    expect(born.n).toBe(DAILY_KEY_CREATION_LIMIT);
  });

  it("plafonne les envois de code sur l'APPROBATEUR, pas sur le créateur du grant", async () => {
    // 🚨 Sans cela, le plafond serait indexé sur une adresse que l'attaquant
    // renouvelle à chaque grant, alors qu'il existe pour borner l'envoi DEPUIS
    // UN RÉSEAU. Les grants sont donc ouverts sans adresse, et c'est l'adresse
    // de l'approbateur qui est constante.
    const app = makeApp();
    const approver = '198.51.100.120';
    let last: Response | null = null;
    for (let i = 0; i <= VERIFICATION_SENDS_PER_SOURCE_DAY; i++) {
      const opened = await open(app);
      const token = await tokenFor(app, opened.user_code);
      last = await post(
        app,
        '/v1/keys/device/approve',
        {
          user_code: opened.user_code,
          approval_token: token,
          email: `dest-${i}@alpha.example.net`,
        },
        { 'x-real-ip': approver },
      );
      if (i < VERIFICATION_SENDS_PER_SOURCE_DAY) expect(last.status, `envoi ${i}`).toBe(202);
    }
    expect(last!.status).toBe(429);
    expect(((await last!.json()) as { error: string }).error).toBe('verification_rate_limited');
  });

  it('branche la garde du jour, et laisse la clé anonyme comme issue', async () => {
    const app = makeApp();
    const email = 'repeat@alpha.example.net';
    const first = await open(app);
    const firstToken = await tokenFor(app, first.user_code);
    await post(app, '/v1/keys/device/approve', {
      user_code: first.user_code,
      approval_token: firstToken,
      email,
    });
    const firstCode = mail.sent.at(-1)!.code;
    expect(
      (
        await post(app, '/v1/keys/device/approve', {
          user_code: first.user_code,
          approval_token: firstToken,
          email,
          code: firstCode,
        })
      ).status,
    ).toBe(200);

    // Un second grant, la MÊME adresse dans les vingt-quatre heures.
    const second = await open(app);
    const secondToken = await tokenFor(app, second.user_code);
    await post(app, '/v1/keys/device/approve', {
      user_code: second.user_code,
      approval_token: secondToken,
      email,
    });
    const secondCode = mail.sent.at(-1)!.code;
    const refused = await post(app, '/v1/keys/device/approve', {
      user_code: second.user_code,
      approval_token: secondToken,
      email,
      code: secondCode,
    });
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe('key_rate_limited');
    // Le grant RESTE pending, rien n'a été écrit : ni la clé, ni la fenêtre de
    // retrait.
    const row = getStatsDB()
      .prepare('SELECT status, key_hash FROM device_codes WHERE device_code_hash = ?')
      .get(hashGrantSecret(second.device_code)) as { status: string; key_hash: string | null };
    expect(row.status).toBe('pending');
    expect(row.key_hash).toBeNull();
    // 🚨 Et l'issue proposée à l'humain existe VRAIMENT : le même bouton, sans
    // adresse, rend une clé. La branche anonyme ne peut pas être refusée par la
    // garde du jour, qui ne s'exécute que si une adresse est fournie.
    const anonymous = await post(app, '/v1/keys/device/approve', {
      user_code: second.user_code,
      approval_token: secondToken,
    });
    expect(anonymous.status, await anonymous.clone().text()).toBe(200);
    expect(((await anonymous.json()) as { tier: string }).tier).toBe('anonymous');
  });
});

describe('les deux horloges', () => {
  it('rallonge le grant à l’envoi du code, et une seule fois', async () => {
    const app = makeApp();
    const opened = await open(app);
    const token = await tokenFor(app, opened.user_code);
    // Le grant n'a plus que deux minutes : un humain qui met cinq minutes à
    // ouvrir le lien puis demande la voie e-mail recevrait un code valable
    // quinze minutes contre un grant qui meurt dans dix.
    rewindGrant(opened.device_code, '+120 seconds');
    const asked = await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
      email: 'clock@alpha.example.net',
    });
    expect(asked.status).toBe(202);
    expect(((await asked.json()) as { expires_in: number }).expires_in).toBeGreaterThan(600);

    const afterFirst = getStatsDB()
      .prepare('SELECT expires_at, email_extended FROM device_codes WHERE device_code_hash = ?')
      .get(hashGrantSecret(opened.device_code)) as { expires_at: string; email_extended: number };
    expect(afterFirst.email_extended).toBe(1);

    // Une deuxième demande ne repousse plus rien.
    await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
      email: 'clock2@alpha.example.net',
    });
    const afterSecond = getStatsDB()
      .prepare('SELECT expires_at, email_extended FROM device_codes WHERE device_code_hash = ?')
      .get(hashGrantSecret(opened.device_code)) as { expires_at: string; email_extended: number };
    expect(afterSecond.expires_at).toBe(afterFirst.expires_at);
    expect(afterSecond.email_extended).toBe(1);
  });

  it('frappe la clé quand un code JUSTE arrive sur un grant qui allait mourir', async () => {
    const app = makeApp();
    const email = 'twoclocks@alpha.example.net';
    const opened = await open(app);
    const token = await tokenFor(app, opened.user_code);
    rewindGrant(opened.device_code, '+120 seconds');
    // Un défi planté à la main, comme le font les tests de /v1/keys/generate :
    // cela prouve la branche du code JUSTE sans dépendre de l'envoi.
    const challenge = createVerificationChallenge(email, null);
    if (typeof challenge !== 'string') throw new Error('challenge refused');
    const res = await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
      email,
      code: challenge,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { tier: string }).tier).toBe('email');
  });

  it('approuve à la dernière seconde et la clé reste retirable', async () => {
    const app = makeApp();
    const opened = await open(app);
    const token = await tokenFor(app, opened.user_code);
    rewindGrant(opened.device_code, '+10 seconds');
    await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
    });
    // 🚨 L'approbation ouvre une fenêtre de retrait : sans elle, l'humain voit
    // « c'est fait » pendant que l'agent reçoit expired_token au poll suivant —
    // une clé active que personne ne détient.
    const got = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    expect(got.status).toBe(200);
  });
});

describe('le rail du secret', () => {
  it('refuse un nonce de paiement sans rien consommer', async () => {
    const app = makeApp();
    const nonce = 'ifn_from_the_other_rail';
    getStatsDB()
      .prepare(
        `INSERT INTO device_codes
           (device_code_hash, user_code, grant_type, status, raw_key_once, key_hash, expires_at)
         VALUES (?, NULL, 'checkout', 'approved', 'ifk_paid_key', 'paid-hash',
                 datetime('now','+7 days'))`,
      )
      .run(hashGrantSecret(nonce));
    const before = getStatsDB()
      .prepare(
        'SELECT raw_key_once, status, poll_count, last_polled_at FROM device_codes WHERE device_code_hash = ?',
      )
      .get(hashGrantSecret(nonce));

    const res = await post(app, '/v1/keys/device/token', { device_code: nonce });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
    // Ni poll_count, ni last_polled_at, ni le clair : rien n'a bougé.
    expect(
      getStatsDB()
        .prepare(
          'SELECT raw_key_once, status, poll_count, last_polled_at FROM device_codes WHERE device_code_hash = ?',
        )
        .get(hashGrantSecret(nonce)),
    ).toEqual(before);
  });
});

describe('les corps illisibles', () => {
  it('gardent leur 400 sur les cinq routes', async () => {
    const app = makeApp();
    for (const path of [
      '/v1/keys/device',
      '/v1/keys/device/token',
      '/v1/keys/device/lookup',
      '/v1/keys/device/approve',
      '/v1/keys/device/deny',
    ]) {
      const res = await app.request(path, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{ pas du json',
      });
      expect(res.status, path).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_json');
    }
  });

  it('un POST sans corps du tout ouvre bien un grant', async () => {
    const app = makeApp();
    const res = await app.request('/v1/keys/device', { method: 'POST' });
    expect(res.status).toBe(201);
  });
});

/**
 * 🚨 LE DERNIER BLOC DU FICHIER, ET IL DOIT LE RESTER : il ARME le disjoncteur
 * global, état qui vit dans `kv_state` et survivrait aux tests suivants. Son
 * nettoyage retire les deux, la rafale injectée et l'état.
 */
describe('une clé device née pendant une alerte du disjoncteur', () => {
  afterEach(() => {
    const db = getStatsDB();
    db.prepare("DELETE FROM key_creations WHERE ip_hash LIKE 'rafale-%'").run();
    db.prepare("DELETE FROM kv_state WHERE key LIKE 'creation_breaker:%'").run();
  });

  it('sort dégradée, marquée par son hash, et l’épisode est inscrit', async () => {
    const app = makeApp();
    const db = getStatsDB();
    // Une rafale : assez de créations ET assez de réseaux distincts. La
    // diversité est obligatoire — sans elle le disjoncteur serait un déni de
    // service à cinq adresses, et c'est la clause qui ne doit jamais sauter.
    const insert = db.prepare('INSERT INTO key_creations (ip_hash, key_prefix) VALUES (?, ?)');
    for (let i = 0; i < BREAKER_THRESHOLD + 2; i++) {
      insert.run(`rafale-${i}`, `ifk_rafale${i}`);
    }
    expect(evaluateBreakerOnCreation().armed).toBe(true);

    const { deviceCode } = await openAndApprove(app);
    const got = await post(app, '/v1/keys/device/token', { device_code: deviceCode });
    const key = (await got.json()) as Record<string, unknown>;
    // Le plafond réduit est passé À LA FRAPPE, jamais par un UPDATE
    // d'après-coup : la colonne ne doit pas porter une valeur que la réponse
    // contredit. Le retrait relit donc la COLONNE, et il lit 5.
    expect(key.monthly_limit).toBe(SHIELD_MONTHLY_LIMIT);

    // 🚨 L'assertion qui compte. Une révision antérieure appelait
    // `markShieldBirth(key_prefix, …)`, et `api_keys.key_prefix` n'a AUCUNE
    // contrainte d'unicité : l'UPDATE ne touchait alors AUCUNE ligne. La clé
    // sortait bien à cinq unités (le plafond passe par `generateApiKey`) mais
    // SANS `no_recredit` et SANS épisode — elle se rechargeait tous les mois,
    // échappait à la remontée automatique du désarmement, et restait
    // inauditable. Le défaut était donc invisible à toute assertion posée sur
    // la seule réponse HTTP.
    const row = db
      .prepare(
        'SELECT no_recredit, shield_episode, monthly_limit FROM api_keys WHERE key_prefix = ?',
      )
      .get(key.key_prefix) as {
      no_recredit: number;
      shield_episode: string | null;
      monthly_limit: number;
    };
    expect(row.no_recredit).toBe(1);
    expect(row.shield_episode).not.toBeNull();
    expect(row.monthly_limit).toBe(SHIELD_MONTHLY_LIMIT);

    // Et la ligne de naissance reste UNIQUE : la dégradation n'ajoute pas un
    // second comptage.
    const births = db
      .prepare('SELECT COUNT(*) AS n FROM key_creations WHERE key_prefix = ?')
      .get(key.key_prefix) as { n: number };
    expect(births.n).toBe(1);
  });

  it('ne dégrade PAS une clé qui a prouvé une boîte', async () => {
    // 🚨 Le prédicat est « alerte armée ET pas de boîte prouvée », jamais
    // « alerte armée ET palier anonyme ». Une clé née d'un code à six chiffres
    // vérifié porte `claimed_at`, donc elle n'est pas dégradée : c'est la
    // doctrine « une clé qui prouve une boîte n'est pas dégradée ».
    const app = makeApp();
    const db = getStatsDB();
    const insert = db.prepare('INSERT INTO key_creations (ip_hash, key_prefix) VALUES (?, ?)');
    for (let i = 0; i < BREAKER_THRESHOLD + 2; i++) {
      insert.run(`rafale-${i}`, `ifk_rafale${i}`);
    }
    expect(evaluateBreakerOnCreation().armed).toBe(true);

    const email = 'shielded@alpha.example.net';
    const opened = await open(app);
    const token = await tokenFor(app, opened.user_code);
    const challenge = createVerificationChallenge(email, null);
    if (typeof challenge !== 'string') throw new Error('challenge refused');
    const approved = await post(app, '/v1/keys/device/approve', {
      user_code: opened.user_code,
      approval_token: token,
      email,
      code: challenge,
    });
    expect(approved.status, await approved.clone().text()).toBe(200);
    const verdict = (await approved.json()) as Record<string, unknown>;
    expect(verdict.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(verdict).not.toHaveProperty('notice');

    const got = await post(app, '/v1/keys/device/token', { device_code: opened.device_code });
    const key = (await got.json()) as Record<string, unknown>;
    expect(key.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    const row = db
      .prepare('SELECT no_recredit, claimed_at FROM api_keys WHERE key_prefix = ?')
      .get(key.key_prefix) as { no_recredit: number; claimed_at: string | null };
    expect(row.no_recredit).toBe(0);
    expect(row.claimed_at).not.toBeNull();
  });
});
