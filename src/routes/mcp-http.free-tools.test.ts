/**
 * Les trois outils de donnée gratuits hors de l'allocation sans clé du
 * transport hébergé (décision de Claude-Alain du 19.11.2026, page « Assistants,
 * quatre pistes », choix 3, « Les trois outils gratuits répondent toujours ») :
 * « Ils ne puisent plus dans l'accès commun, comme ailleurs sur ton service où
 * ils sont déjà gratuits sans quota. […] Les 25 unités des outils payants ne
 * bougent pas. »
 *
 * Ce que ces tests tiennent :
 *   - sans clé, plafond atteint, un outil payant est refusé et chacun des trois
 *     répond, sur `/mcp`, `/mcp/directory` et, pour la référence de paiement,
 *     `/mcp/chatgpt` (les trois adresses partagent un seul compteur) ;
 *   - un appel à ces outils ne débite aucune unité, et les outils payants
 *     comptent comme avant ;
 *   - avec une clé, rien ne change : zéro unité sur la clé, servis même clé
 *     épuisée, comme leurs routes REST gratuites ;
 *   - chaque texte qui nomme ces outils nomme exactement les membres de
 *     `KEYLESS_UNMETERED_TOOLS` : vider la constante fait rougir ce qui reste à
 *     retirer.
 *
 * Adresses : 198.18.40.0/24 (RFC 2544), propres à ce fichier.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mcpHttp, mcpAllowanceRefusal, MCP_WEEKLY_LIMIT } from './mcp-http.js';
import { getStatsDB } from '../lib/db.js';
import { ledgerBucket } from '../lib/ledger-bucket.js';
import { trialWeekStart } from '../lib/trial.js';
import { ANONYMOUS_MONTHLY_LIMIT } from '../lib/tiers.js';
import { checkAndIncrementQuota, generateApiKey, getUsage } from '../lib/api-keys.js';
import { KEYLESS_UNMETERED_TOOLS, MCP_TOOLS, ALLOWANCE_EXEMPT_TOOLS } from '../mcp/inventory.js';
import { MCP_INSTRUCTIONS } from '../mcp/instructions.js';
import {
  DIRECTORY_UNMETERED_NOTE,
  MCP_DIRECTORY_INSTRUCTIONS,
  directoryAllowanceRefusal,
} from '../mcp/directory.js';
import {
  CHATGPT_TOOL_SET,
  CHATGPT_UNMETERED_NOTE,
  MCP_CHATGPT_INSTRUCTIONS,
  chatgptAllowanceRefusal,
} from '../mcp/chatgpt.js';
import type { HonoEnv } from '../types.js';

function makeApp() {
  const app = new Hono<HonoEnv>();
  app.route('/', mcpHttp);
  return app;
}
type App = ReturnType<typeof makeApp>;

const IBAN = 'DE89370400440532013000';

/** Une entrée valide par outil gratuit, reprise des tests de bout en bout. */
const FREE_CALLS: Record<string, Record<string, unknown>> = {
  validate_payment_reference: { reference: 'RF18539007547034' },
  check_postal_address: { scheme: 'sps', address: { twn_nm: 'Zurich', ctry: 'CH' } },
  check_swiss_qr_bill: { payload: 'SPC\n0200\n1' },
};

let rpcId = 100;

async function post(
  app: App,
  path: string,
  ip: string,
  body: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-real-ip': ip,
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

interface Envelope {
  result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

async function envelope(res: Response): Promise<Envelope> {
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (ct.includes('application/json')) return JSON.parse(text) as Envelope;
  const match = text.match(/^data:\s*(\{.*\})$/m);
  if (!match) throw new Error(`no JSON-RPC frame: ${text.slice(0, 200)}`);
  return JSON.parse(match[1]) as Envelope;
}

async function open(
  app: App,
  path: string,
  ip: string,
  extra: Record<string, string> = {},
): Promise<string> {
  const res = await post(
    app,
    path,
    ip,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vitest-mcp-free-tools', version: '1.0.0' },
      },
    },
    extra,
  );
  expect(res.status, path).toBe(200);
  const id = res.headers.get('mcp-session-id');
  expect(id, path).toBeTruthy();
  return id!;
}

async function call(
  app: App,
  path: string,
  session: string,
  ip: string,
  name: string,
  args: Record<string, unknown>,
  extra: Record<string, string> = {},
): Promise<Envelope> {
  const res = await post(
    app,
    path,
    ip,
    { jsonrpc: '2.0', id: (rpcId += 1), method: 'tools/call', params: { name, arguments: args } },
    { 'mcp-session-id': session, ...extra },
  );
  expect(res.status, `${path} ${name}`).toBe(200);
  return envelope(res);
}

/** Les unités de l'allocation sans clé de cette semaine pour cette adresse, ou null sans ligne. */
function weekUnits(ip: string): number | null {
  const row = getStatsDB()
    .prepare('SELECT units FROM trial_weekly WHERE week = ? AND bucket = ?')
    .get(trialWeekStart(), ledgerBucket(ip, '')) as { units: number } | undefined;
  return row?.units ?? null;
}

/** Les noms d'outils de l'inventaire qu'un texte cite. */
function toolsNamedIn(text: string): string[] {
  return MCP_TOOLS.map((t) => t.name).filter((n) => new RegExp(`\\b${n}\\b`).test(text));
}

const sorted = (names: Iterable<string>) => [...names].sort();

describe('la constante : trois outils sans prix, hors des sorties gratuites', () => {
  it('ce sont les trois outils de donnée gratuits, et aucun outil payant', () => {
    for (const name of KEYLESS_UNMETERED_TOOLS) {
      const tool = MCP_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.price, name).toBe('free');
      expect(tool!.readOnly, name).toBe(true);
      // Les sorties gratuites ne sont pas comptées sur une clé ; ces trois-là
      // le restent, comme sur REST : les deux ensembles ne se recouvrent pas.
      expect(ALLOWANCE_EXEMPT_TOOLS.has(name), name).toBe(false);
    }
    expect(sorted(KEYLESS_UNMETERED_TOOLS)).toEqual(
      sorted(['validate_payment_reference', 'check_postal_address', 'check_swiss_qr_bill']),
    );
  });
});

describe('sans clé, sur /mcp : les trois outils gratuits répondent toujours', () => {
  it(`plafond de ${MCP_WEEKLY_LIMIT} unités atteint : un outil payant est refusé, chacun des trois répond, sans unité de plus`, async () => {
    const app = makeApp();
    const ip = '198.18.40.1';
    const session = await open(app, '/mcp', ip);

    // La semaine entière d'un coup, par le chemin normal.
    const batch = await call(app, '/mcp', session, ip, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => IBAN),
    });
    expect(batch.error).toBeUndefined();
    expect(weekUnits(ip)).toBe(MCP_WEEKLY_LIMIT);

    const paid = await call(app, '/mcp', session, ip, 'validate_iban', { iban: IBAN });
    expect(paid.error?.code).toBe(-32000);
    expect(paid.error?.message).toContain('Weekly MCP free tier limit reached');
    // Le refus compte toujours, comme avant.
    const afterRefusal = weekUnits(ip);
    expect(afterRefusal).toBe(MCP_WEEKLY_LIMIT + 1);

    for (const [name, args] of Object.entries(FREE_CALLS)) {
      const env = await call(app, '/mcp', session, ip, name, args);
      expect(env.error, `${name} refusé après le plafond`).toBeUndefined();
      expect(env.result?.isError, name).toBeFalsy();
      expect(env.result?.structuredContent, name).toBeDefined();
    }
    expect(weekUnits(ip), 'les trois outils gratuits ne débitent rien').toBe(afterRefusal);

    // Et les payants restent fermés après eux.
    const again = await call(app, '/mcp', session, ip, 'lookup_bic', { bic: 'DEUTDEFF' });
    expect(again.error?.code).toBe(-32000);
  });

  it('avant le plafond : les trois ne décomptent rien, les payants comptent comme avant', async () => {
    const app = makeApp();
    const ip = '198.18.40.2';
    const session = await open(app, '/mcp', ip);

    for (const [name, args] of Object.entries(FREE_CALLS)) {
      const env = await call(app, '/mcp', session, ip, name, args);
      expect(env.result?.isError, name).toBeFalsy();
    }
    expect(weekUnits(ip), 'aucune ligne écrite pour trois appels gratuits').toBeNull();

    await call(app, '/mcp', session, ip, 'validate_iban', { iban: IBAN });
    expect(weekUnits(ip)).toBe(1);
    await call(app, '/mcp', session, ip, 'batch_validate_iban', { ibans: [IBAN, IBAN, IBAN] });
    expect(weekUnits(ip), 'un lot compte toujours une unité par IBAN').toBe(4);
    await call(app, '/mcp', session, ip, 'lookup_bic', { bic: 'DEUTDEFF' });
    expect(weekUnits(ip)).toBe(5);
  });

  it('un lot JSON-RPC qui mêle un outil gratuit et un payant paie le payant seul', async () => {
    const app = makeApp();
    const ip = '198.18.40.3';
    const session = await open(app, '/mcp', ip);
    const res = await post(
      app,
      '/mcp',
      ip,
      [
        {
          jsonrpc: '2.0',
          id: 201,
          method: 'tools/call',
          params: {
            name: 'validate_payment_reference',
            arguments: FREE_CALLS.validate_payment_reference,
          },
        },
        {
          jsonrpc: '2.0',
          id: 202,
          method: 'tools/call',
          params: { name: 'validate_iban', arguments: { iban: IBAN } },
        },
      ],
      { 'mcp-session-id': session },
    );
    await res.text();
    expect(weekUnits(ip)).toBe(1);
  });
});

describe('les deux autres adresses partagent le compteur, et la règle', () => {
  it('/mcp/directory : plafond atteint, un payant refusé, les trois répondent', async () => {
    const app = makeApp();
    const ip = '198.18.40.4';
    const session = await open(app, '/mcp/directory', ip);
    await call(app, '/mcp/directory', session, ip, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => IBAN),
    });
    const paid = await call(app, '/mcp/directory', session, ip, 'validate_iban', { iban: IBAN });
    expect(paid.error?.code).toBe(-32000);
    const before = weekUnits(ip);
    for (const [name, args] of Object.entries(FREE_CALLS)) {
      const env = await call(app, '/mcp/directory', session, ip, name, args);
      expect(env.error, `${name} refusé après le plafond`).toBeUndefined();
      expect(env.result?.isError, name).toBeFalsy();
    }
    expect(weekUnits(ip)).toBe(before);
  });

  it('/mcp/chatgpt : plafond atteint sur /mcp, la référence de paiement répond encore', async () => {
    const app = makeApp();
    const ip = '198.18.40.5';
    // Le plafond épuisé sur /mcp : c'est le même seau pour la même adresse.
    const mcp = await open(app, '/mcp', ip);
    await call(app, '/mcp', mcp, ip, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => IBAN),
    });
    const chat = await open(app, '/mcp/chatgpt', ip);
    const paid = await call(app, '/mcp/chatgpt', chat, ip, 'lookup_ch_clearing', { iid: '230' });
    expect(paid.error?.code).toBe(-32000);
    const before = weekUnits(ip);
    const env = await call(
      app,
      '/mcp/chatgpt',
      chat,
      ip,
      'validate_payment_reference',
      FREE_CALLS.validate_payment_reference,
    );
    expect(env.error).toBeUndefined();
    expect(env.result?.isError).toBeFalsy();
    expect(weekUnits(ip)).toBe(before);
  });
});

describe('avec une clé, rien ne change : zéro unité, comme les routes REST gratuites', () => {
  it('une clé épuisée appelle les trois outils : servis, son compteur ne bouge pas, l’allocation sans clé non plus', async () => {
    const app = makeApp();
    const ip = '198.18.40.6';
    const minted = generateApiKey(null);
    if (!minted) throw new Error('could not mint a key');
    checkAndIncrementQuota(minted.key_hash, ANONYMOUS_MONTHLY_LIMIT, ANONYMOUS_MONTHLY_LIMIT);
    const before = getUsage(minted.key_hash).used;
    const bearer = { Authorization: `Bearer ${minted.api_key}` };
    const session = await open(app, '/mcp', ip, bearer);

    const paid = await call(app, '/mcp', session, ip, 'validate_iban', { iban: IBAN }, bearer);
    expect(paid.result?.isError, 'la clé est bien épuisée pour un outil payant').toBe(true);

    for (const [name, args] of Object.entries(FREE_CALLS)) {
      const env = await call(app, '/mcp', session, ip, name, args, bearer);
      expect(env.error, name).toBeUndefined();
      expect(env.result?.isError, name).toBeFalsy();
    }
    expect(getUsage(minted.key_hash).used).toBe(before);
    expect(weekUnits(ip)).toBeNull();
  });
});

describe('chaque texte nomme exactement les outils de la constante', () => {
  it('le refus de /mcp nomme les trois, sans chiffre dans leur phrase, et garde la clé gratuite', () => {
    const message = mcpAllowanceRefusal(MCP_WEEKLY_LIMIT + 1).message;
    const sentence = message.split(/(?<=\.)\s+/).find((s) => s.includes('cost no unit')) ?? '';
    expect(sorted(toolsNamedIn(sentence))).toEqual(sorted(KEYLESS_UNMETERED_TOOLS));
    expect(sentence).not.toMatch(/\d/);
    expect(message).toContain('/v1/keys/generate');
    expect(message).toContain('https://ibanforge.com/docs/api-keys?src=mcp-refusal');
  });

  it('les instructions de branchement de /mcp nomment les trois, et rien d’autre dans leur phrase', () => {
    const sentence =
      MCP_INSTRUCTIONS.split(/(?<=\.)\s+/).find((s) => s.includes('cost no unit')) ?? '';
    // Constante vidée : cette phrase écrite à la main est la dernière à retirer.
    expect(sentence, 'phrase des outils hors allocation introuvable').not.toBe('');
    expect(sorted(toolsNamedIn(sentence))).toEqual(sorted(KEYLESS_UNMETERED_TOOLS));
  });

  it('/mcp/directory : instructions, refus et descriptions', () => {
    for (const text of [
      MCP_DIRECTORY_INSTRUCTIONS,
      directoryAllowanceRefusal(MCP_WEEKLY_LIMIT + 1, MCP_WEEKLY_LIMIT, 'x').message,
    ]) {
      const sentence =
        text.split(/(?<=\.)\s+/).find((s) => s.includes('not counted against this allowance')) ??
        '';
      expect(sorted(toolsNamedIn(sentence))).toEqual(sorted(KEYLESS_UNMETERED_TOOLS));
    }
    expect(DIRECTORY_UNMETERED_NOTE).toContain('does not count against the keyless allowance');
  });

  it('/mcp/chatgpt : seul l’outil servi là est nommé, sans le mot « key »', () => {
    const served = [...KEYLESS_UNMETERED_TOOLS].filter((n) => CHATGPT_TOOL_SET.has(n));
    for (const text of [
      MCP_CHATGPT_INSTRUCTIONS,
      chatgptAllowanceRefusal(MCP_WEEKLY_LIMIT + 1, MCP_WEEKLY_LIMIT, 'x').message,
    ]) {
      const sentence =
        text.split(/(?<=\.)\s+/).find((s) => s.includes('not counted against this allowance')) ??
        '';
      expect(sorted(toolsNamedIn(sentence))).toEqual(sorted(served));
    }
    expect(CHATGPT_UNMETERED_NOTE).not.toMatch(/\bkey/i);
  });
});
