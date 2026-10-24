/**
 * `/mcp/directory`, l'adresse que l'on inscrit dans les répertoires de
 * connecteurs (Claude, puis ChatGPT) : les mêmes outils et les mêmes données
 * que `/mcp`, sans rien qui vende (src/mcp/directory.ts).
 *
 * Ce fichier tient quatre promesses, et chacune a son bloc :
 *  1. ROUGE SI UNE OFFRE REVIENT : toutes les réponses de l'adresse, découverte,
 *     chaque outil, les refus, passées au crible d'une liste de mots d'offre ;
 *  2. LES MÊMES COMPTEURS que `/mcp`, dans les deux sens, pour les unités et
 *     pour les ouvertures de session : aucune allocation de plus ;
 *  3. LES MÊMES DONNÉES : un résultat de l'adresse est celui de `/mcp`, moins les
 *     champs de prix et l'étape du partenaire ;
 *  4. `/mcp` GARDE SON OFFRE : instructions, ligne de prix, ressource `pricing`,
 *     renvoi du partenaire. La comparaison octet pour octet de `/mcp` avant et
 *     après ce changement a été faite une fois, à la main (description de la PR) :
 *     un instantané figé ici passerait au rouge à chaque rafraîchissement mensuel
 *     des données, dont les descriptions citent les comptes.
 *
 * Passé par `buildApp()` et non par le seul routeur MCP : c'est aussi la preuve
 * que rien, plus haut dans l'application, n'intercepte `/mcp/directory`.
 */
process.env.DEVICE_POLL_WAIT_MS = '200';
process.env.DEVICE_POLL_TICK_MS = '20';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';
import { classifyClient } from '../lib/stats.js';
import { DEVICE_TEXTS } from '../lib/device-grant.js';
import { MCP_SESSIONS_PER_IP_DAY, MCP_WEEKLY_LIMIT } from '../lib/mcp-limits.js';
import { MCP_INSTRUCTIONS } from '../mcp/instructions.js';
import { MCP_TOOLS } from '../mcp/inventory.js';
import {
  DIRECTORY_ACCOUNTING_UNAVAILABLE,
  DIRECTORY_ALLOWANCE_NOTE,
  DIRECTORY_SESSION_REFUSAL,
  MCP_DIRECTORY_INSTRUCTIONS,
  directoryAllowanceRefusal,
  directoryDeviceText,
  directoryKeyRefusalPayload,
  directoryNextSteps,
} from '../mcp/directory.js';

const DIR = '/mcp/directory';
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;
const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'vitest-mcp-directory', version: '1.0.0' },
};
/** Un IBAN allemand public, dont le code banque se résout : il porte les deux étapes visées. */
const DE_IBAN = 'DE89370400440532013000';

/**
 * Les mots d'une offre. Insensibles à la casse, et ajustés aux faux positifs
 * LÉGITIMES de l'adresse, chacun pour une raison écrite :
 *  - `$` seul attrape le mot-clé `"$schema"` des schémas JSON de `tools/list` :
 *    on cherche un montant, `$` suivi d'un chiffre ;
 *  - `credit` seul attrape `creditor` (vocabulaire ISO 20022 et QR-facture) et
 *    « the credit line the Bundesbank asks for », mention de source imposée par
 *    la licence : on cherche `credits`, `credit pack` et `prepaid` ;
 *  - `buy` seul attrape « buyers » dans l'avis de gratuité que les deux banques
 *    centrales imposent sur chaque accès : on cherche le mot `buy` ;
 *  - `pack` seul attrape `package` : on cherche le mot `pack` ou `packs`.
 * `paid` n'y est pas : c'est une valeur de l'énumération `tier` de
 * `poll_api_key` (le palier d'une clé), pas une offre.
 * Pour le partenaire, des motifs neutres d'abord (son code d'étape, toute
 * commande `npx`), puis son nom de domaine, en garde-fou.
 */
const OFFER_PATTERNS: readonly RegExp[] = [
  /cz-?agents/i,
  /generate_payment_qr/i,
  /\bnpx\b/i,
  /usdc/i,
  /x402/i,
  /\$\s?\d/,
  /pric(e|es|ing)/i,
  /\bpacks?\b/i,
  /\bcredits\b/i,
  /credit pack/i,
  /prepaid/i,
  /\bbuy\b/i,
  /purchase/i,
  /checkout/i,
  /stripe/i,
  /pay-as-an-agent/i,
  /on-chain/i,
];

function offers(label: string, value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return OFFER_PATTERNS.filter((re) => re.test(text)).map((re) => {
    const at = text.search(re);
    return `${label}: ${re} → …${text.slice(Math.max(0, at - 60), at + 60)}…`;
  });
}

type App = ReturnType<typeof buildApp>;
interface Rpc {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

async function parse(res: Response): Promise<Rpc> {
  const text = await res.text();
  const frame = text.match(/^data:\s*(\{.*\})$/m);
  return JSON.parse(frame ? frame[1] : text) as Rpc;
}

async function post(
  app: App,
  path: string,
  ip: string,
  body: unknown,
  sessionId?: string,
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'x-real-ip': ip,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function open(app: App, path: string, ip: string): Promise<{ id: string; init: Rpc }> {
  const res = await post(app, path, ip, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: INIT,
  });
  const id = res.headers.get('mcp-session-id');
  expect(id, `${path} must open a session`).toBeTruthy();
  return { id: id!, init: await parse(res) };
}

let rpcId = 10;
async function rpc(
  app: App,
  path: string,
  ip: string,
  sessionId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Rpc> {
  rpcId += 1;
  return parse(await post(app, path, ip, { jsonrpc: '2.0', id: rpcId, method, params }, sessionId));
}

async function callTool(
  app: App,
  path: string,
  ip: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Rpc> {
  return rpc(app, path, ip, sessionId, 'tools/call', { name, arguments: args });
}

/** Une ouverture de session qui n'en devient jamais une : la franchise du jour se brûle sans rien garder. */
async function burnOpening(app: App, path: string, ip: string): Promise<Rpc> {
  return parse(await post(app, path, ip, { jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
}

/** Les appels d'outils de l'adresse, un par outil, sur des données de test. */
const TOOL_CALLS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['validate_iban', { iban: DE_IBAN }],
  ['batch_validate_iban', { ibans: [DE_IBAN, 'FR1420041010050500013M02606'] }],
  ['lookup_bic', { bic: 'DEUTDEFF' }],
  ['check_compliance', { iban: DE_IBAN }],
  ['validate_payment_reference', { reference: 'RF18539007547034', iban: DE_IBAN }],
  ['check_postal_address', { scheme: 'sps', address: { ctry: 'CH' } }],
  ['check_swiss_qr_bill', { payload: 'SPC\n0200\n1' }],
  ['lookup_ch_clearing', { iid: '230' }],
  ['lookup_ch_clearing', { iid: '99999' }],
  [
    'send_feedback',
    { error_type: 'other', notes: 'test du répertoire', contact: 'acme@example.com' },
  ],
  ['request_api_key', { client_name: 'Société Alpha' }],
  ['poll_api_key', {}],
];

let savedPartner: string | undefined;
beforeAll(() => {
  // Le renvoi du partenaire n'existe que sous cette variable : sans elle, le
  // crible passerait pour rien. Le premier test vérifie qu'il sort bien sur /mcp.
  savedPartner = process.env.PARTNER_PAYQR;
  process.env.PARTNER_PAYQR = '1';
});
afterAll(() => {
  if (savedPartner === undefined) delete process.env.PARTNER_PAYQR;
  else process.env.PARTNER_PAYQR = savedPartner;
});

describe('/mcp/directory — rouge si une offre revient', () => {
  it('/mcp porte bien le renvoi du partenaire sur cet IBAN : le crible ne passe pas pour rien', async () => {
    const app = buildApp();
    const ip = '192.0.2.31';
    const { id } = await open(app, '/mcp', ip);
    const res = await callTool(app, '/mcp', ip, id, 'validate_iban', { iban: DE_IBAN });
    const steps = (res.result?.structuredContent as { next_steps?: Array<{ code: string }> })
      .next_steps;
    expect(steps?.map((s) => s.code)).toContain('generate_payment_qr');
    expect(steps?.map((s) => s.code)).toContain('screen_compliance');
  });

  it('aucune réponse de l’adresse ne nomme un prix, un paiement, une offre ou le partenaire', async () => {
    const app = buildApp();
    const ip = '192.0.2.32';
    const found: string[] = [];

    const discovery = await app.request(DIR, { headers: { 'x-real-ip': ip } });
    expect(discovery.status).toBe(405);
    found.push(...offers('GET', await discovery.json()));

    const { id, init } = await open(app, DIR, ip);
    found.push(...offers('initialize', init));
    for (const method of ['tools/list', 'resources/list', 'prompts/list']) {
      const res = await rpc(app, DIR, ip, id, method);
      expect(res.error, method).toBeUndefined();
      found.push(...offers(method, res));
    }
    found.push(
      ...offers(
        'resources/read countries',
        await rpc(app, DIR, ip, id, 'resources/read', { uri: 'ibanforge://countries' }),
      ),
      ...offers(
        'prompts/get',
        await rpc(app, DIR, ip, id, 'prompts/get', {
          name: 'validate_and_explain',
          arguments: { iban: DE_IBAN },
        }),
      ),
    );

    for (const [name, args] of TOOL_CALLS) {
      const res = await callTool(app, DIR, ip, id, name, args);
      expect(res.error, `${name} ${JSON.stringify(res.error)}`).toBeUndefined();
      found.push(...offers(`tools/call ${name}`, res));
      // Une étape qui envoie hors d'IBANforge est un renvoi, quel que soit son nom.
      const steps = (res.result?.structuredContent as { next_steps?: unknown[] } | undefined)
        ?.next_steps;
      for (const step of steps ?? []) {
        const action = (step as { action?: string }).action;
        if (action && /^https?:/i.test(action)) {
          expect(new URL(action).hostname, `${name}: ${action}`).toMatch(/(^|\.)ibanforge\.com$/);
        }
      }
    }

    // Les refus : allocation de la semaine, franchise des sessions, et ceux
    // qu'on ne peut pas provoquer d'ici, lus à leur source.
    const capped = '192.0.2.33';
    const s2 = await open(app, DIR, capped);
    const weekly = await callTool(app, DIR, capped, s2.id, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT + 1 }, () => DE_IBAN),
    });
    expect(weekly.error?.code).toBe(-32000);
    found.push(...offers('refus hebdomadaire', weekly));

    const crowded = '192.0.2.34';
    let refusal: Rpc = {};
    for (let i = 0; i <= MCP_SESSIONS_PER_IP_DAY; i++)
      refusal = await burnOpening(app, DIR, crowded);
    expect(refusal.error?.message).toBe(DIRECTORY_SESSION_REFUSAL);
    found.push(...offers('refus de session', refusal));

    found.push(...offers('comptabilité indisponible', DIRECTORY_ACCOUNTING_UNAVAILABLE));
    for (const text of Object.values(DEVICE_TEXTS)) {
      found.push(...offers('device grant', directoryDeviceText(text, DEVICE_TEXTS)));
    }
    found.push(
      ...offers(
        'clé épuisée',
        directoryKeyRefusalPayload({
          reason: 'credits_exhausted',
          detail: 'Buy a credit pack: $4 per 1,000 calls, or pay with x402 (USDC).',
          credits: { total: 0, topup: 'https://checkout.stripe.example/acme' },
        }),
      ),
      ...offers(
        'quota épuisé',
        directoryKeyRefusalPayload({
          reason: 'monthly_quota_exhausted',
          detail: 'Upgrade with prepaid packs or x402.',
          quota: { used: 2, limit: 2, month: '2026-10', resets: '2026-11-01' },
        }),
      ),
    );

    expect(found, found.join('\n')).toEqual([]);
  });

  it('les instructions ne citent que des outils enregistrés', () => {
    const named = new Set(MCP_DIRECTORY_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
    const tools = new Set(MCP_TOOLS.map((t) => t.name));
    for (const name of named) expect(tools.has(name), name).toBe(true);
  });

  it('chaque outil de donnée dit la limite sans clé, sans chiffre', async () => {
    const app = buildApp();
    const ip = '192.0.2.35';
    const { id } = await open(app, DIR, ip);
    const list = await rpc(app, DIR, ip, id, 'tools/list');
    const tools = (list.result as { tools: Array<{ name: string; description: string }> }).tools;
    for (const tool of tools) {
      if (['send_feedback', 'request_api_key', 'poll_api_key'].includes(tool.name)) continue;
      expect(tool.description, tool.name).toContain(DIRECTORY_ALLOWANCE_NOTE);
      expect(tool.description, tool.name).not.toContain('COST:');
    }
    expect(DIRECTORY_ALLOWANCE_NOTE).not.toMatch(/\d/);
    // Les deux outils du device grant, écrits entiers pour cette adresse : la
    // ligne à coller est l'en-tête du connecteur, jamais le paquet npm.
    const request = tools.find((t) => t.name === 'request_api_key')?.description ?? '';
    expect(request).not.toContain('npm package');
    expect(request).not.toContain('402');
    expect(request).toContain('Authorization: Bearer <key>');
    const poll = tools.find((t) => t.name === 'poll_api_key')?.description ?? '';
    expect(poll).toContain('config_line is the header "Authorization: Bearer <key>"');
  });
});

describe('/mcp/directory — les mêmes compteurs que /mcp, sans allocation de plus', () => {
  const spendWeek = async (app: App, path: string, ip: string, sessionId: string) =>
    callTool(app, path, ip, sessionId, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => DE_IBAN),
    });

  it('la semaine dépensée sur /mcp est refusée sur /mcp/directory', async () => {
    const app = buildApp();
    const ip = '192.0.2.41';
    const a = await open(app, '/mcp', ip);
    const spent = await spendWeek(app, '/mcp', ip, a.id);
    expect(spent.error, 'the whole week fits in one batch').toBeUndefined();

    const b = await open(app, DIR, ip);
    const refused = await callTool(app, DIR, ip, b.id, 'validate_iban', { iban: DE_IBAN });
    expect(refused.error?.code).toBe(-32000);
    expect(refused.error?.data?.used).toBe(MCP_WEEKLY_LIMIT + 1);
    expect(refused.error?.message).toContain('Weekly keyless allowance reached');
  });

  it('la semaine dépensée sur /mcp/directory est refusée sur /mcp', async () => {
    const app = buildApp();
    const ip = '192.0.2.42';
    const a = await open(app, DIR, ip);
    expect((await spendWeek(app, DIR, ip, a.id)).error).toBeUndefined();

    const b = await open(app, '/mcp', ip);
    const refused = await callTool(app, '/mcp', ip, b.id, 'validate_iban', { iban: DE_IBAN });
    expect(refused.error?.code).toBe(-32000);
    expect(refused.error?.data?.used).toBe(MCP_WEEKLY_LIMIT + 1);
    expect(refused.error?.message).toContain('Weekly MCP free tier limit reached');
  });

  it('les ouvertures du jour faites sur /mcp ferment /mcp/directory', async () => {
    const app = buildApp();
    const ip = '192.0.2.43';
    for (let i = 0; i < MCP_SESSIONS_PER_IP_DAY; i++) await burnOpening(app, '/mcp', ip);
    const res = await post(app, DIR, ip, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: INIT,
    });
    expect(res.headers.get('mcp-session-id'), 'no session past the shared cap').toBeNull();
    expect((await parse(res)).error?.message).toBe(DIRECTORY_SESSION_REFUSAL);
  });

  it('les ouvertures du jour faites sur /mcp/directory ferment /mcp', async () => {
    const app = buildApp();
    const ip = '192.0.2.44';
    for (let i = 0; i < MCP_SESSIONS_PER_IP_DAY; i++) await burnOpening(app, DIR, ip);
    const res = await post(app, '/mcp', ip, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: INIT,
    });
    expect(res.headers.get('mcp-session-id'), 'no session past the shared cap').toBeNull();
    expect((await parse(res)).error?.message).toContain('Daily MCP session limit reached');
  });

  it('les deux adresses écrivent dans le même seau de la semaine', async () => {
    const app = buildApp();
    const ip = '192.0.2.45';
    const a = await open(app, '/mcp', ip);
    const b = await open(app, DIR, ip);
    await callTool(app, '/mcp', ip, a.id, 'validate_iban', { iban: DE_IBAN });
    await callTool(app, DIR, ip, b.id, 'validate_iban', { iban: DE_IBAN });
    // La troisième unité de la semaine, quelle que soit l'adresse : le refus
    // d'un lot trop grand rend le compte du seau, sans rien servir.
    const over = await callTool(app, DIR, ip, b.id, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => DE_IBAN),
    });
    expect(over.error?.data?.used).toBe(MCP_WEEKLY_LIMIT + 2);
  });
});

describe('/mcp/directory — une session ne passe pas d’une adresse à l’autre', () => {
  it('une session de /mcp présentée à /mcp/directory reçoit le 404 « initialize again », et l’inverse', async () => {
    const app = buildApp();
    const ip = '192.0.2.51';
    const onMcp = await open(app, '/mcp', ip);
    const onDir = await open(app, DIR, ip);

    const crossed = await post(
      app,
      DIR,
      ip,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      onMcp.id,
    );
    expect(crossed.status).toBe(404);
    const back = await post(
      app,
      '/mcp',
      ip,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      onDir.id,
    );
    expect(back.status).toBe(404);

    // Et chacune reste servie chez elle.
    expect((await rpc(app, DIR, ip, onDir.id, 'tools/list')).error).toBeUndefined();
    expect((await rpc(app, '/mcp', ip, onMcp.id, 'tools/list')).error).toBeUndefined();

    const del = await app.request(DIR, {
      method: 'DELETE',
      headers: { 'mcp-session-id': onMcp.id, 'x-real-ip': ip },
    });
    expect(del.status).toBe(400);
  });
});

describe('/mcp/directory — les mêmes données, moins le prix et le renvoi', () => {
  /** Ce que l'adresse retire : les deux champs de prix et l'étape du partenaire. */
  const strip = (payload: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...payload };
    delete out.cost_usdc;
    delete out.list_price_usdc;
    delete out.processing_ms;
    if (Array.isArray(out.next_steps)) {
      out.next_steps = directoryNextSteps(out.next_steps as never);
    }
    return out;
  };

  it.each([
    ['validate_iban', { iban: DE_IBAN }],
    ['check_compliance', { iban: DE_IBAN }],
    ['lookup_ch_clearing', { iid: '230' }],
    ['lookup_bic', { bic: 'DEUTDEFF' }],
  ] as const)('%s', async (name, args) => {
    const app = buildApp();
    const ip = '192.0.2.61';
    const a = await open(app, '/mcp', ip);
    const b = await open(app, DIR, ip);
    const onMcp = (await callTool(app, '/mcp', ip, a.id, name, args)).result
      ?.structuredContent as Record<string, unknown>;
    const onDir = (await callTool(app, DIR, ip, b.id, name, args)).result
      ?.structuredContent as Record<string, unknown>;
    expect(onDir, `${name} lost its structuredContent`).toBeDefined();
    const dirCopy = { ...onDir };
    delete dirCopy.processing_ms;
    expect(dirCopy).toEqual(strip(onMcp));
    expect(onDir).not.toHaveProperty('cost_usdc');
  });

  it('garde l’étape de criblage, vers l’outil de ce connecteur et non vers la route REST', async () => {
    const app = buildApp();
    const ip = '192.0.2.62';
    const { id } = await open(app, DIR, ip);
    const res = await callTool(app, DIR, ip, id, 'validate_iban', { iban: DE_IBAN });
    const steps = (res.result?.structuredContent as { next_steps: Array<Record<string, string>> })
      .next_steps;
    const screen = steps.find((s) => s.code === 'screen_compliance');
    expect(screen?.action).toBe('check_compliance');
    expect(steps.some((s) => s.code === 'generate_payment_qr')).toBe(false);
  });

  it('un lot garde ses lignes, sans prix dans aucune', async () => {
    const app = buildApp();
    const ip = '192.0.2.63';
    const { id } = await open(app, DIR, ip);
    const res = await callTool(app, DIR, ip, id, 'batch_validate_iban', {
      ibans: [DE_IBAN, DE_IBAN],
    });
    const out = res.result?.structuredContent as {
      results: Array<Record<string, unknown>>;
      count: number;
    };
    expect(out.count).toBe(2);
    for (const row of out.results) {
      expect(row.valid).toBe(true);
      expect(row).not.toHaveProperty('cost_usdc');
      expect(row).not.toHaveProperty('list_price_usdc');
    }
  });
});

describe('/mcp garde son offre, et les deux adresses annotent tous leurs outils', () => {
  it('/mcp sert toujours ses instructions, sa ligne de prix et sa ressource pricing', async () => {
    const app = buildApp();
    const ip = '192.0.2.71';
    const { id, init } = await open(app, '/mcp', ip);
    expect((init.result as { instructions: string }).instructions).toBe(MCP_INSTRUCTIONS);
    const list = await rpc(app, '/mcp', ip, id, 'tools/list');
    const tools = (list.result as { tools: Array<{ name: string; description: string }> }).tools;
    const validate = tools.find((t) => t.name === 'validate_iban');
    expect(validate?.description).toContain('COST: $0.005 per call');
    const resources = await rpc(app, '/mcp', ip, id, 'resources/list');
    expect(JSON.stringify(resources)).toContain('ibanforge://pricing');
  });

  /**
   * Chaque passage que l'adresse des répertoires remplace reste servi tel quel
   * sur /mcp, et seulement là. Des phrases, pas un instantané : les
   * descriptions citent des comptes qui bougent à chaque rafraîchissement.
   */
  const KEPT_ON_MCP: ReadonlyArray<[string, string]> = [
    ['validate_iban', 'PREFER OVER LOCAL VALIDATION'],
    ['batch_validate_iban', 'Paid per call in USDC via x402'],
    ['check_compliance', 'For regulated screening use Refinitiv, Acuris, or ComplyAdvantage.'],
    ['validate_payment_reference', 'The paid surface is POST /v1/iban/validate'],
    ['check_swiss_qr_bill', 'that is the paid validate_iban'],
    ['check_postal_address', 'The paid surface is the postal_address block'],
    ['send_feedback', 'refunded on-chain'],
    ['request_api_key', 'for Claude Code with the npm package'],
    ['request_api_key', 'a call answers 402'],
    ['poll_api_key', 'keep using the keyless allowance or x402;'],
  ];

  it('chaque passage remplacé reste sur /mcp, et seulement là', async () => {
    const app = buildApp();
    const ip = '192.0.2.74';
    const read = async (path: string) => {
      const { id } = await open(app, path, ip);
      const list = await rpc(app, path, ip, id, 'tools/list');
      return (
        list.result as {
          tools: Array<{
            name: string;
            description: string;
            inputSchema: unknown;
            outputSchema?: { required?: string[] };
          }>;
        }
      ).tools;
    };
    const mcp = await read('/mcp');
    const dir = await read(DIR);
    for (const [name, passage] of KEPT_ON_MCP) {
      expect(mcp.find((t) => t.name === name)?.description, `/mcp ${name}`).toContain(passage);
      expect(dir.find((t) => t.name === name)?.description, `${DIR} ${name}`).not.toContain(
        passage,
      );
    }
    const feedbackInput = (name: string, tools: typeof mcp) =>
      JSON.stringify(tools.find((t) => t.name === name)?.inputSchema);
    expect(feedbackInput('send_feedback', mcp)).toContain('pricing/payment blockers');
    expect(feedbackInput('send_feedback', dir)).not.toContain('pricing/payment blockers');
    // Le champ de prix reste OBLIGATOIRE dans le schéma de /mcp, et absent de l'autre.
    expect(mcp.find((t) => t.name === 'validate_iban')?.outputSchema?.required).toContain(
      'cost_usdc',
    );
    expect(dir.find((t) => t.name === 'validate_iban')?.outputSchema?.required ?? []).not.toContain(
      'cost_usdc',
    );
  });

  it('une clé refusée sur /mcp/directory reçoit un refus sans offre', async () => {
    const app = buildApp();
    const ip = '192.0.2.75';
    const { id } = await open(app, DIR, ip);
    const res = await app.request(DIR, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'x-real-ip': ip,
        'mcp-session-id': id,
        Authorization: 'Bearer ifk_inconnue_acme_0000000000000000',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'validate_iban', arguments: { iban: DE_IBAN } },
      }),
    });
    const body = await parse(res);
    expect(body.result?.isError, JSON.stringify(body)).toBe(true);
    expect(JSON.stringify(body)).toContain('This IBANforge API key cannot serve this call');
    expect(offers('refus de clé', body)).toEqual([]);
  });

  it.each(['/mcp', DIR])('%s : chaque outil déclare ses quatre indications', async (path) => {
    const app = buildApp();
    const ip = path === DIR ? '192.0.2.72' : '192.0.2.73';
    const { id } = await open(app, path, ip);
    const list = await rpc(app, path, ip, id, 'tools/list');
    const tools = (
      list.result as {
        tools: Array<{ name: string; annotations?: Record<string, unknown> }>;
      }
    ).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
    for (const tool of tools) {
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        expect(typeof tool.annotations?.[hint], `${path} ${tool.name} ${hint}`).toBe('boolean');
      }
    }
    const feedback = tools.find((t) => t.name === 'send_feedback');
    expect(feedback?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});

describe('/mcp/directory — le tableau de bord le compte comme /mcp', () => {
  const lastRow = (): { path: string; tool_name: string | null } =>
    getStatsDB()
      .prepare(
        "SELECT path, tool_name FROM request_log WHERE path LIKE '/mcp%' ORDER BY id DESC LIMIT 1",
      )
      .get() as { path: string; tool_name: string | null };

  it('« Agents sans clé », appels sous /mcp:tools-call, refus sous leur chemin', async () => {
    expect(classifyClient(DIR, 'Claude-User')).toBe('mcp_http');
    const app = buildApp();
    const ip = '192.0.2.81';
    const { id } = await open(app, DIR, ip);
    expect(lastRow().path).toBe(DIR);

    await callTool(app, DIR, ip, id, 'lookup_ch_clearing', { iid: '230' });
    expect(lastRow()).toEqual({ path: '/mcp:tools-call', tool_name: 'lookup_ch_clearing' });

    await callTool(app, DIR, ip, id, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => DE_IBAN),
    });
    expect(lastRow().path).toBe('/mcp:tools-call:refused');
  });

  it('le refus de la semaine porte les mêmes données que celui de /mcp', () => {
    const refusal = directoryAllowanceRefusal(MCP_WEEKLY_LIMIT + 1, MCP_WEEKLY_LIMIT, 'x');
    expect(refusal.data).toEqual({
      used: MCP_WEEKLY_LIMIT + 1,
      limit: MCP_WEEKLY_LIMIT,
      remaining: 0,
      period: 'week',
      resets_at: 'x',
    });
    // Le chiffre voyage dans `data`, jamais dans la phrase.
    expect(refusal.message).not.toContain(String(MCP_WEEKLY_LIMIT));
  });
});
