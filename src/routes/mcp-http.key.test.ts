/**
 * Une clé IBANforge sur le transport MCP hébergé (décision de Claude-Alain du
 * 07.10.2026, point 7) : les mêmes quotas et le même comptage que l'API REST
 * pour cette clé, aucune exception, et une session qui ne garde jamais la clé
 * d'un client pour un autre.
 *
 * Ce que ces tests tiennent :
 *   - la clé se lit dans `Authorization: Bearer` et `X-API-Key`, jamais dans
 *     l'adresse ;
 *   - un appel payé avec une clé se compte sur la clé, à l'unité près comme
 *     REST (un par appel, un par IBAN d'un lot, zéro sur les outils sans prix,
 *     rien sur une entrée que REST refuse en 400), et jamais sur l'allocation
 *     sans clé ;
 *   - une clé épuisée, inconnue ou révoquée reçoit le texte de REST, ne retombe
 *     pas sur l'allocation sans clé, et inconnue ou révoquée se lisent pareil ;
 *   - deux requêtes d'une même session, l'une après l'autre ou en même temps,
 *     paient chacune sur sa propre clé, ou sur l'allocation sans clé.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mcpHttp, mcpSessions } from './mcp-http.js';
import { ibanValidate } from './iban-validate.js';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import {
  checkAndIncrementQuota,
  generateApiKey,
  generateCreditKey,
  getUsage,
  revokeApiKey,
  validateApiKey,
} from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { ledgerBucket } from '../lib/ledger-bucket.js';
import { trialWeekStart } from '../lib/trial.js';
import { ANONYMOUS_MONTHLY_LIMIT } from '../lib/tiers.js';
import { ALLOWANCE_EXEMPT_TOOLS, MCP_TOOLS } from '../mcp/inventory.js';
import { MCP_LIVE_SESSIONS_PER_KEY, MCP_SESSIONS_PER_IP_DAY } from '../lib/mcp-limits.js';
import { KEY_METERED_TOOLS, restEquivalent } from '../mcp/key-meter.js';
import type { HonoEnv } from '../types.js';

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', mcpHttp);
  return app;
}

/** L'API REST telle que /v1/* la monte, sans le rail x402 : un refus rend sa cause. */
function makeRestApp() {
  const app = new Hono<HonoEnv>();
  app.use('/v1/*', apiKeyMiddleware());
  app.use('/v1/*', async (c, next) => {
    if (!c.get('apiKeyAuthenticated')) return c.json(c.get('paywallCause') ?? {}, 402);
    await next();
  });
  app.route('/', ibanValidate);
  return app;
}

type App = ReturnType<typeof makeApp>;

let ipCounter = 0;
/** RFC 5737 TEST-NET-3 : une adresse par test, donc une allocation sans clé par test. */
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 250) + 1}`;
}

const VALID_IBAN = 'DE89370400440532013000';

async function post(
  app: App,
  body: unknown,
  o: { ip: string; session?: string; headers?: Record<string, string>; path?: string },
): Promise<Response> {
  return app.request(o.path ?? '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-real-ip': o.ip,
      ...(o.session ? { 'mcp-session-id': o.session } : {}),
      ...(o.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

async function envelope(res: Response): Promise<{
  result?: {
    isError?: boolean;
    content?: Array<{ text: string }>;
    structuredContent?: Record<string, unknown>;
  };
  error?: { code: number; message: string };
}> {
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (ct.includes('application/json')) return JSON.parse(text);
  const match = text.match(/^data:\s*(\{.*\})$/m);
  if (!match) throw new Error(`no JSON-RPC frame: ${text.slice(0, 200)}`);
  return JSON.parse(match[1]);
}

async function open(app: App, ip: string, headers?: Record<string, string>): Promise<string> {
  const res = await post(
    app,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest-mcp-key', version: '1.0.0' },
      },
    },
    { ip, headers },
  );
  expect(res.status).toBe(200);
  const id = res.headers.get('mcp-session-id');
  expect(id).toBeTruthy();
  return id!;
}

let rpcId = 1;

async function call(
  app: App,
  session: string,
  ip: string,
  name: string,
  args: Record<string, unknown>,
  headers?: Record<string, string>,
  path?: string,
) {
  const res = await post(
    app,
    // Un identifiant par appel, comme un vrai client : deux requêtes en vol
    // sous le même identifiant se disputeraient le même flux de réponse.
    { jsonrpc: '2.0', id: (rpcId += 1), method: 'tools/call', params: { name, arguments: args } },
    { ip, session, headers, path },
  );
  expect(res.status).toBe(200);
  return envelope(res);
}

/** Les unités de l'allocation sans clé débitées cette semaine pour cette adresse. */
function keylessUnits(ip: string): number {
  const row = getStatsDB()
    .prepare('SELECT units FROM trial_weekly WHERE week = ? AND bucket = ?')
    .get(trialWeekStart(), ledgerBucket(ip, '')) as { units: number } | undefined;
  return row?.units ?? 0;
}

function freshKey(): { key: string; hash: string } {
  const minted = generateApiKey(null);
  if (!minted) throw new Error('could not mint a key');
  return { key: minted.api_key, hash: minted.key_hash };
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
const used = (hash: string) => getUsage(hash).used;
const refusal = (env: Awaited<ReturnType<typeof call>>) =>
  JSON.parse(env.result!.content![0].text) as { error: string; message: string; note: string };

describe('clé sur /mcp : lue dans les en-têtes, comptée sur la clé', () => {
  it('Authorization: Bearer : un validate_iban se compte sur la clé, rien sur l’allocation sans clé', async () => {
    const app = makeApp();
    const ip = freshIp();
    const { key, hash } = freshKey();
    const session = await open(app, ip, bearer(key));

    const env = await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(key));
    expect(env.result?.isError).toBeFalsy();
    expect(env.result?.structuredContent?.valid).toBe(true);
    expect(used(hash)).toBe(1);
    expect(keylessUnits(ip)).toBe(0);
  });

  it('X-API-Key : même lecture que sur REST', async () => {
    const app = makeApp();
    const ip = freshIp();
    const { key, hash } = freshKey();
    const session = await open(app, ip);

    const env = await call(
      app,
      session,
      ip,
      'validate_iban',
      { iban: VALID_IBAN },
      { 'X-API-Key': key },
    );
    expect(env.result?.isError).toBeFalsy();
    expect(used(hash)).toBe(1);
    expect(keylessUnits(ip)).toBe(0);
  });

  it('une clé dans l’adresse (?api_key=) n’est pas lue : l’appel reste sur l’allocation sans clé', async () => {
    const app = makeApp();
    const ip = freshIp();
    const { key, hash } = freshKey();
    const session = await open(app, ip);

    const env = await call(
      app,
      session,
      ip,
      'validate_iban',
      { iban: VALID_IBAN },
      undefined,
      `/mcp?api_key=${key}`,
    );
    expect(env.result?.isError).toBeFalsy();
    expect(used(hash)).toBe(0);
    expect(keylessUnits(ip)).toBe(1);
  });

  it('un lot se compte un par IBAN, comme POST /v1/iban/batch', async () => {
    const app = makeApp();
    const ip = freshIp();
    const { key, hash } = freshKey();
    const session = await open(app, ip);

    const ibans = [VALID_IBAN, 'CH9300762011623852957', 'GB82WEST12345698765432'];
    const env = await call(app, session, ip, 'batch_validate_iban', { ibans }, bearer(key));
    expect(env.result?.isError).toBeFalsy();
    expect(used(hash)).toBe(3);
    expect(keylessUnits(ip)).toBe(0);
  });

  it('les outils sans prix ne coûtent rien à la clé, comme leurs routes REST gratuites', async () => {
    const app = makeApp();
    const ip = freshIp();
    const { key, hash } = freshKey();
    const session = await open(app, ip);

    const env = await call(
      app,
      session,
      ip,
      'validate_payment_reference',
      { reference: 'RF18539007547034' },
      bearer(key),
    );
    expect(env.result?.isError).toBeFalsy();
    const addr = await call(
      app,
      session,
      ip,
      'check_postal_address',
      { scheme: 'sps', address: { twn_nm: 'Zurich', ctry: 'CH' } },
      bearer(key),
    );
    expect(addr.result?.isError).toBeFalsy();
    expect(used(hash)).toBe(0);
    expect(keylessUnits(ip)).toBe(0);
  });

  it('une entrée que REST refuse en 400 n’est pas débitée ; un BIC introuvable se paie, comme sur REST', async () => {
    const app = makeApp();
    const ip = freshIp();
    const { key, hash } = freshKey();
    const session = await open(app, ip);

    await call(app, session, ip, 'lookup_bic', { bic: 'NOT-A-BIC' }, bearer(key));
    await call(app, session, ip, 'lookup_ch_clearing', { iid: 'abc' }, bearer(key));
    await call(app, session, ip, 'validate_iban', { iban: '   ' }, bearer(key));
    expect(used(hash), 'trois refus d’entrée : rien de débité').toBe(0);

    const found = await call(app, session, ip, 'lookup_bic', { bic: 'DEUTDEFF' }, bearer(key));
    expect(found.result?.isError).toBeFalsy();
    expect(used(hash)).toBe(1);
  });
});

describe('clé sur /mcp : le même comptage que REST', () => {
  it('N appels REST et N appels MCP laissent le même compteur du mois', async () => {
    const rest = makeRestApp();
    const app = makeApp();
    const ip = freshIp();
    const a = freshKey();
    const b = freshKey();
    const session = await open(app, ip);

    for (let i = 0; i < 3; i += 1) {
      const res = await rest.request('/v1/iban/validate', {
        method: 'POST',
        headers: { ...bearer(a.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ iban: VALID_IBAN }),
      });
      expect(res.status).toBe(200);
      await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(b.key));
    }
    expect(used(b.hash)).toBe(used(a.hash));
    expect(used(b.hash)).toBe(3);
  });

  it('une clé de crédits perd un crédit par appel, sur REST comme sur MCP', async () => {
    const rest = makeRestApp();
    const app = makeApp();
    const ip = freshIp();
    const a = generateCreditKey(null, 10);
    const b = generateCreditKey(null, 10);
    const session = await open(app, ip);

    await rest.request('/v1/iban/validate', {
      method: 'POST',
      headers: { ...bearer(a.api_key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: VALID_IBAN }),
    });
    await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(b.api_key));

    const left = (k: string) => validateApiKey(k).creditsRemaining;
    expect(left(b.api_key)).toBe(left(a.api_key));
    expect(left(b.api_key)).toBe(9);
  });

  it('clé épuisée : le texte de REST pour cette clé, et aucun repli sur l’allocation sans clé', async () => {
    const rest = makeRestApp();
    const app = makeApp();
    const ip = freshIp();
    const { key, hash } = freshKey();
    checkAndIncrementQuota(hash, ANONYMOUS_MONTHLY_LIMIT, ANONYMOUS_MONTHLY_LIMIT);
    const before = used(hash);

    const restRes = await rest.request('/v1/iban/validate', {
      method: 'POST',
      headers: { ...bearer(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: VALID_IBAN }),
    });
    expect(restRes.status).toBe(402);
    const restCause = (await restRes.json()) as { reason: string; detail: string };

    const session = await open(app, ip);
    const env = await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(key));
    expect(env.result?.isError).toBe(true);
    const payload = refusal(env);
    expect(payload.error).toBe('monthly_quota_exhausted');
    expect(payload.error).toBe(restCause.reason);
    expect(payload.message).toBe(restCause.detail);
    expect(used(hash)).toBe(before);
    expect(keylessUnits(ip), 'jamais l’allocation par adresse pour une clé épuisée').toBe(0);
  });

  it('clé inconnue et clé révoquée : la même réponse, celle de REST, qui ne dit pas si la clé a existé', async () => {
    const rest = makeRestApp();
    const app = makeApp();
    const ip = freshIp();
    const unknown = `ifk_${'0123456789abcdef'.repeat(4)}`;
    const revoked = freshKey();
    expect(revokeApiKey(revoked.key)).toBe(true);
    const session = await open(app, ip);

    const a = await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(unknown));
    const b = await call(
      app,
      session,
      ip,
      'validate_iban',
      { iban: VALID_IBAN },
      bearer(revoked.key),
    );
    expect(a.result?.isError).toBe(true);
    expect(b.result?.isError).toBe(true);
    expect(refusal(a)).toEqual(refusal(b));
    expect(refusal(a).error).toBe('invalid_api_key');

    const restRes = await rest.request('/v1/iban/validate', {
      method: 'POST',
      headers: { ...bearer(unknown), 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: VALID_IBAN }),
    });
    const restCause = (await restRes.json()) as { detail: string };
    expect(refusal(a).message).toBe(restCause.detail);
    expect(keylessUnits(ip), 'une clé présentée ne retombe jamais sur l’allocation sans clé').toBe(
      0,
    );

    // Les sorties restent ouvertes : un outil sans prix, et la demande de clé.
    const free = await call(
      app,
      session,
      ip,
      'check_postal_address',
      { scheme: 'sps', address: { twn_nm: 'Zurich', ctry: 'CH' } },
      bearer(unknown),
    );
    expect(free.result?.isError).toBeFalsy();
    const door = await call(app, session, ip, 'request_api_key', {}, bearer(unknown));
    expect(door.result?.isError).toBeFalsy();
    expect(typeof door.result?.structuredContent?.status).toBe('string');
  });
});

describe('clé sur /mcp : la télémétrie', () => {
  it('un appel avec clé ne se compte pas dans l’activité sans clé du MCP distant', async () => {
    const app = makeApp();
    const ip = freshIp();
    const { key } = freshKey();
    const session = await open(app, ip);
    const toolCalls = () =>
      (
        getStatsDB()
          .prepare("SELECT tool_calls FROM mcp_remote_daily WHERE day = date('now')")
          .get() as { tool_calls: number } | undefined
      )?.tool_calls ?? 0;

    const before = toolCalls();
    await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(key));
    expect(toolCalls(), 'un appel attribué à sa clé n’est pas une activité anonyme').toBe(before);
    await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN });
    expect(toolCalls()).toBe(before + 1);
  });
});

describe('clé sur /mcp : la session ne garde aucune clé', () => {
  it('clé A, puis aucune clé, puis clé B sur la même session : chaque appel paie sur sa propre porte', async () => {
    const app = makeApp();
    const ip = freshIp();
    const a = freshKey();
    const b = freshKey();
    const session = await open(app, ip, bearer(a.key));

    await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(a.key));
    expect(used(a.hash)).toBe(1);

    await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN });
    expect(used(a.hash), 'la clé A ne reste pas dans la session').toBe(1);
    expect(keylessUnits(ip)).toBe(1);

    await call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(b.key));
    expect(used(a.hash)).toBe(1);
    expect(used(b.hash)).toBe(1);
    expect(keylessUnits(ip)).toBe(1);
  });

  it('deux requêtes simultanées de la même session, deux clés : chacune débite la sienne', async () => {
    const app = makeApp();
    const ip = freshIp();
    const a = freshKey();
    const b = freshKey();
    const session = await open(app, ip);

    await Promise.all([
      call(
        app,
        session,
        ip,
        'batch_validate_iban',
        { ibans: [VALID_IBAN, VALID_IBAN] },
        bearer(a.key),
      ),
      call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }, bearer(b.key)),
      call(app, session, ip, 'validate_iban', { iban: VALID_IBAN }),
    ]);
    expect(used(a.hash)).toBe(2);
    expect(used(b.hash)).toBe(1);
    expect(keylessUnits(ip)).toBe(1);
  });
});

/**
 * L'ouverture d'une session avec une clé valide (08.10.2026). Les connecteurs
 * Claude sortent tous des adresses d'Anthropic : le plafond quotidien par
 * adresse refusait un client muni d'une clé à cause de tous les autres. Une
 * clé valide n'est plus comptée sur l'adresse ni refusée ; une clé inconnue ou
 * absente garde le plafond par adresse.
 *
 * Le budget de l'adresse est brûlé par des `ping` sans session : chacun
 * construit un transport (la mémoire que le plafond compte) qui n'est jamais
 * rangé, ce qui garde l'empreinte du test à plat.
 */
describe('clé sur /mcp : l’ouverture de session', () => {
  /** Une adresse à elle, hors de la plage que `freshIp` fait tourner. */
  const SHARED_IP = '192.0.2.231';

  async function ping(app: App, ip: string, headers?: Record<string, string>) {
    return post(app, { jsonrpc: '2.0', id: 1, method: 'ping', params: {} }, { ip, headers });
  }

  function openingsToday(ip: string): number {
    const row = getStatsDB()
      .prepare("SELECT units FROM trial_ledger WHERE day = date('now') AND bucket = ?")
      .get(ledgerBucket(ip, 'init:')) as { units: number } | undefined;
    return row?.units ?? 0;
  }

  it(`une clé valide ouvre au-delà des ${MCP_SESSIONS_PER_IP_DAY} ouvertures de son adresse ; sans clé ou avec une clé inconnue, refusé`, async () => {
    const app = makeApp();
    const a = freshKey();
    const b = freshKey();

    // Les autres clients de la même adresse épuisent son plafond du jour.
    for (let i = 0; i < MCP_SESSIONS_PER_IP_DAY; i++) {
      const res = await ping(app, SHARED_IP);
      expect(res.headers.get('X-MCP-Outcome')).not.toBe('session_rate_limited');
    }
    expect(openingsToday(SHARED_IP)).toBe(MCP_SESSIONS_PER_IP_DAY);

    // Le défaut : un client muni d'une clé, depuis cette adresse.
    for (let i = 0; i <= MCP_SESSIONS_PER_IP_DAY; i++) {
      const res = await ping(app, SHARED_IP, bearer(a.key));
      expect(res.headers.get('X-MCP-Outcome'), `ouverture ${i + 1} avec clé`).not.toBe(
        'session_rate_limited',
      );
    }
    // Une vraie session, par chaque en-tête que REST lit.
    const viaBearer = await open(app, SHARED_IP, bearer(a.key));
    const viaHeader = await open(app, SHARED_IP, { 'X-API-Key': b.key });
    expect(viaBearer).not.toBe(viaHeader);
    expect(openingsToday(SHARED_IP), 'rien de tout cela sur le compte de l’adresse').toBe(
      MCP_SESSIONS_PER_IP_DAY,
    );

    // Et la session ouverte avec la clé sert ses appels, sur la clé.
    const env = await call(
      app,
      viaBearer,
      SHARED_IP,
      'validate_iban',
      { iban: VALID_IBAN },
      bearer(a.key),
    );
    expect(env.result?.isError).toBeFalsy();
    expect(used(a.hash)).toBe(1);

    // Sans clé : le comportement d'avant, inchangé.
    const keyless = await ping(app, SHARED_IP);
    expect(keyless.headers.get('X-MCP-Outcome')).toBe('session_rate_limited');
    const refusal = (await keyless.json()) as { error: { message: string } };
    expect(refusal.error.message).toContain('Daily MCP session limit reached');
    expect(refusal.error.message).toContain('valid IBANforge key');

    // Une clé inconnue, ou révoquée, n'est pas une clé valide : le plafond de l'adresse.
    const unknown = await ping(app, SHARED_IP, bearer(`ifk_${'0'.repeat(48)}`));
    expect(unknown.headers.get('X-MCP-Outcome')).toBe('session_rate_limited');
    const revoked = freshKey();
    expect(revokeApiKey(revoked.key)).toBe(true);
    const refusedRevoked = await post(
      app,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'vitest-mcp-key', version: '1.0.0' },
        },
      },
      { ip: SHARED_IP, headers: bearer(revoked.key) },
    );
    expect(refusedRevoked.headers.get('X-MCP-Outcome')).toBe('session_rate_limited');
    expect(refusedRevoked.headers.get('mcp-session-id')).toBeNull();
  });

  it('la session ouverte avec une clé valide est rangée sous cette clé, pas une session sans clé', async () => {
    const app = makeApp();
    const ip = freshIp();
    const k = freshKey();
    expect(mcpSessions.ownerCount(k.hash)).toBe(0);
    await open(app, ip, bearer(k.key));
    await open(app, ip, bearer(k.key));
    await open(app, ip);
    expect(mcpSessions.ownerCount(k.hash)).toBe(2);
    expect(MCP_LIVE_SESSIONS_PER_KEY).toBeGreaterThan(2);
  });
});

describe('clé sur /mcp : chaque outil de donnée a sa route REST', () => {
  it('les outils comptés et les trois sorties gratuites couvrent tout l’inventaire, sans double', () => {
    const names = MCP_TOOLS.map((t) => t.name).sort();
    expect([...KEY_METERED_TOOLS, ...ALLOWANCE_EXEMPT_TOOLS].sort()).toEqual(names);
  });

  it.each(KEY_METERED_TOOLS)('%s : la requête rejouée est la route de l’inventaire', (tool) => {
    const listed = MCP_TOOLS.find((t) => t.name === tool)!;
    const eq = restEquivalent(tool, {
      iban: VALID_IBAN,
      ibans: [VALID_IBAN],
      bic: 'DEUTDEFF',
      iid: '230',
    })!;
    const [methods, route] = listed.restRoute.split(' ');
    expect(methods.split('|')).toContain(eq.method);
    const pattern = new RegExp(`^${route.replace(/\{\w+\}/g, '[^/]+')}$`);
    expect(eq.path).toMatch(pattern);
    expect(eq.free).toBe(listed.price === 'free');
  });
});
