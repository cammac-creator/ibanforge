/**
 * `/mcp/chatgpt`, l'adresse proposée au répertoire d'applications de ChatGPT
 * (src/mcp/chatgpt.ts) : six outils de consultation, aucune clé, aucune offre,
 * les mêmes compteurs que `/mcp` et `/mcp/directory`.
 *
 * Ce fichier tient sept promesses, et chacune a son bloc :
 *  1. L'INVENTAIRE EXACT : six outils dans `tools/list` et dans le `GET`, avec
 *     leurs quatre annotations et la déclaration `noauth` ;
 *  2. LES CINQ EXCLUS REFUSÉS en `tools/call` direct, seuls ou dans un lot,
 *     sans aucun effet : ni unité débitée, ni rapport écrit, ni clé ouverte ;
 *  3. ROUGE SI UNE OFFRE OU UNE CLÉ REVIENT : chaque réponse de l'adresse passe
 *     au crible des mots d'offre, des mots de clé et des recommandations de
 *     fournisseurs tiers, sans interdire les noms de banques et d'éditeurs ;
 *  4. LES MÊMES COMPTEURS que `/mcp` et `/mcp/directory`, dans chaque sens, et
 *     une clé présentée ici ne change rien : l'appel reste débité sur l'adresse ;
 *  5. AUCUNE SESSION ne passe d'une adresse à l'autre ;
 *  6. LES MÊMES DONNÉES que `/mcp/directory`, au seul avertissement près ;
 *  7. LES CAS DU DOSSIER (P1 à P5, N3) rejoués sur leurs invariants stables.
 *
 * Passé par `buildApp()` : c'est aussi la preuve que rien, plus haut dans
 * l'application, n'intercepte `/mcp/chatgpt`.
 */
process.env.DEVICE_POLL_WAIT_MS = '200';
process.env.DEVICE_POLL_TICK_MS = '20';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';
import { classifyClient } from '../lib/stats.js';
import { isDiscoveryPath } from '../lib/business-summary.js';
import { getComplianceMeta } from '../lib/compliance-db.js';
import { generateApiKey, getUsage } from '../lib/api-keys.js';
import { ledgerBucket } from '../lib/ledger-bucket.js';
import { trialWeekStart } from '../lib/trial.js';
import { MCP_SESSIONS_PER_IP_DAY, MCP_WEEKLY_LIMIT } from '../lib/mcp-limits.js';
import { MCP_TOOLS } from '../mcp/inventory.js';
import {
  DIRECTORY_ALLOWANCE_NOTE,
  DIRECTORY_SESSION_REFUSAL,
  directoryToolDescriptions,
} from '../mcp/directory.js';
import {
  CHATGPT_ACCOUNTING_UNAVAILABLE,
  CHATGPT_ALLOWANCE_NOTE,
  CHATGPT_SESSION_REFUSAL,
  CHATGPT_TOOLS,
  DISCLAIMER_VENDORS,
  MCP_CHATGPT_INSTRUCTIONS,
  chatgptAllowanceRefusal,
  chatgptDisclaimer,
} from '../mcp/chatgpt.js';

const CHAT = '/mcp/chatgpt';
const DIR = '/mcp/directory';
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;
const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'vitest-mcp-chatgpt', version: '1.0.0' },
};
/** Les exemples publics du DOSSIER de candidature, aucun n'est une donnée de client. */
const DE_IBAN = 'DE89370400440532013000';
const CH_IBAN = 'CH5204835012345671000';

/** Les cinq outils que l'adresse ChatGPT ne sert pas, nommés ici à la main exprès. */
const EXCLUDED: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['send_feedback', { error_type: 'other', notes: 'test chatgpt', contact: 'acme@example.com' }],
  ['check_postal_address', { scheme: 'sps', address: { ctry: 'CH' } }],
  ['check_swiss_qr_bill', { payload: 'SPC\n0200\n1' }],
  ['request_api_key', { client_name: 'Société Alpha' }],
  ['poll_api_key', {}],
];
const EXCLUDED_NAMES = EXCLUDED.map(([name]) => name);

/**
 * Les mots d'une offre : ceux du test de `/mcp/directory`, avec les mêmes
 * ajustements aux faux positifs légitimes (raisons écrites là-bas).
 */
const OFFER_PATTERNS: readonly RegExp[] = [
  /cz-?agents/i,
  /payqr/i,
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
  /subscri(be|ption)/i,
  /upgrade/i,
  /\bsponsor/i,
];

/**
 * Les formes d'un mécanisme de clé. Pas le mot `key` seul : les schémas et les
 * réponses parlent à bon droit de « the national key inside the BBAN », de la
 * « RIB key », de la clé de contrôle qui « matches », et d'une « exact key »
 * de la carte des codes banque. On cherche ce qui DONNE, DEMANDE ou ENVOIE une
 * clé d'IBANforge.
 */
const KEY_PATTERNS: readonly RegExp[] = [
  /api[ _-]?keys?/i,
  /\bifk_/i,
  /\bbearer\b/i,
  /authorization:/i,
  /x-api-key/i,
  /\/v1\/keys/i,
  /request_api_key/,
  /poll_api_key/,
  /device[ _-]?code/i,
  /\bwith(?:out)? a key\b/i,
  /\b(?:IBANforge|free|anonymous|your)\s+keys?\b/i,
  /\b(?:tak(?:e|es|ing)|get(?:s|ting)?|claim(?:s|ing)?|generat(?:e|es|ing)|creat(?:e|es|ing)|request(?:s|ing)?|send(?:s|ing)?|us(?:e|es|ing)|present(?:s|ing)?|past(?:e|es|ing))\s+(?:it\s+|an?\s+|your\s+|the\s+|this\s+)?(?:IBANforge\s+|free\s+|API\s+|new\s+)?keys?\b/i,
];
function namesAKey(text: string): boolean {
  return KEY_PATTERNS.some((re) => re.test(text));
}

/**
 * Une recommandation de fournisseur tiers : les éditeurs de criblage nommés
 * jusqu'ici par nos textes, et deux formes de phrase qui en annoncent un
 * (« a provider (X, Y, etc.) », « use X, Y, or Z »). Les noms de banques, de
 * registres et d'éditeurs de sources restent permis : ce sont des données.
 */
const VENDOR_PATTERNS: readonly RegExp[] = [
  /refinitiv/i,
  /complyadvantage/i,
  /acuris/i,
  /world-?check/i,
  /lexisnexis/i,
  /dow jones/i,
  /sanction scanner/i,
  /\b(?:provider|vendor|service)s?\s*\(\s*[A-Z][\w-]*(?:\s+[A-Z][\w-]*)*(?:,\s*[A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)+/,
  /\buse\s+[A-Z][\w-]+,\s*[A-Z][\w-]+,?\s+or\s+[A-Z][\w-]+/,
];
function recommendsVendor(text: string): boolean {
  return VENDOR_PATTERNS.some((re) => re.test(text));
}

/** Ce que le crible relève dans une réponse, avec le passage en cause. */
function findings(label: string, value: unknown, allowExcludedNames = false): string[] {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  // Le refus du SDK pour un outil exclu répète son nom (« Tool request_api_key
  // not found ») : seul ce nom est toléré, et seulement là.
  const text = allowExcludedNames
    ? EXCLUDED_NAMES.reduce((t, name) => t.split(name).join('<exclu>'), raw)
    : raw;
  const hits: string[] = [];
  const at = (re: RegExp) => {
    const i = text.search(re);
    return `…${text.slice(Math.max(0, i - 60), i + 60)}…`;
  };
  for (const re of [...OFFER_PATTERNS, ...KEY_PATTERNS, ...VENDOR_PATTERNS]) {
    if (re.test(text)) hits.push(`${label}: ${re} → ${at(re)}`);
  }
  for (const name of EXCLUDED_NAMES) {
    if (text.includes(name)) hits.push(`${label}: outil exclu ${name}`);
  }
  return hits;
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

/** Toutes les trames d'une réponse, pour un lot JSON-RPC. */
async function parseAll(res: Response): Promise<Rpc[]> {
  const text = await res.text();
  const frames = [...text.matchAll(/^data:\s*(.+)$/gm)].map((m) => JSON.parse(m[1]) as unknown);
  const flat = frames.length > 0 ? frames : [JSON.parse(text) as unknown];
  return flat.flatMap((f) => (Array.isArray(f) ? f : [f])) as Rpc[];
}

async function post(
  app: App,
  path: string,
  ip: string,
  body: unknown,
  sessionId?: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'x-real-ip': ip,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

async function open(
  app: App,
  path: string,
  ip: string,
  extra: Record<string, string> = {},
): Promise<{ id: string; init: Rpc }> {
  const res = await post(
    app,
    path,
    ip,
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT },
    undefined,
    extra,
  );
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
  extra: Record<string, string> = {},
): Promise<Rpc> {
  rpcId += 1;
  return parse(
    await post(app, path, ip, { jsonrpc: '2.0', id: rpcId, method, params }, sessionId, extra),
  );
}

async function callTool(
  app: App,
  path: string,
  ip: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  extra: Record<string, string> = {},
): Promise<Rpc> {
  return rpc(app, path, ip, sessionId, 'tools/call', { name, arguments: args }, extra);
}

/** Une ouverture de session qui n'en devient jamais une : la franchise du jour se brûle sans rien garder. */
async function burnOpening(
  app: App,
  path: string,
  ip: string,
  extra: Record<string, string> = {},
): Promise<Rpc> {
  return parse(
    await post(
      app,
      path,
      ip,
      { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
      undefined,
      extra,
    ),
  );
}

/** Les unités de la semaine débitées sur l'adresse, lues dans le registre. */
function weekUnits(ip: string): number {
  const row = getStatsDB()
    .prepare('SELECT units FROM trial_weekly WHERE week = ? AND bucket = ?')
    .get(trialWeekStart(), ledgerBucket(ip, '')) as { units: number } | undefined;
  return row?.units ?? 0;
}
const countRows = (table: string): number =>
  (getStatsDB().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const toolsOf = (list: Rpc) =>
  (
    list.result as {
      tools: Array<{
        name: string;
        description: string;
        annotations?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
      }>;
    }
  ).tools;

const structured = (res: Rpc): Record<string, unknown> =>
  res.result?.structuredContent as Record<string, unknown>;

let savedPartner: string | undefined;
beforeAll(() => {
  // Le renvoi du partenaire n'existe que sous cette variable : sans elle, le
  // crible passerait pour rien.
  savedPartner = process.env.PARTNER_PAYQR;
  process.env.PARTNER_PAYQR = '1';
});
afterAll(() => {
  if (savedPartner === undefined) delete process.env.PARTNER_PAYQR;
  else process.env.PARTNER_PAYQR = savedPartner;
});

describe('/mcp/chatgpt — l’inventaire exact', () => {
  it('les six outils sont dans l’inventaire, les cinq autres en sont les exclus', () => {
    const all = MCP_TOOLS.map((t) => t.name);
    for (const name of CHATGPT_TOOLS) expect(all, name).toContain(name);
    expect(all.filter((n) => !(CHATGPT_TOOLS as readonly string[]).includes(n)).sort()).toEqual(
      [...EXCLUDED_NAMES].sort(),
    );
  });

  it('tools/list et le GET listent exactement les six, avec leurs annotations et noauth', async () => {
    const app = buildApp();
    const ip = '203.0.113.1';
    const discovery = await app.request(CHAT, { headers: { 'x-real-ip': ip } });
    expect(discovery.status).toBe(405);
    const body = (await discovery.json()) as { tools: string[]; authentication: string };
    expect([...body.tools].sort()).toEqual([...CHATGPT_TOOLS].sort());
    expect(body.authentication).toBe('none');

    const { id } = await open(app, CHAT, ip);
    const tools = toolsOf(await rpc(app, CHAT, ip, id, 'tools/list'));
    expect(tools.map((t) => t.name).sort()).toEqual([...CHATGPT_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool._meta, tool.name).toEqual({ securitySchemes: [{ type: 'noauth' }] });
    }

    // Les deux autres adresses gardent leurs onze outils, dans le GET aussi.
    for (const path of ['/mcp', DIR]) {
      const res = await app.request(path, { headers: { 'x-real-ip': ip } });
      expect(((await res.json()) as { tools: string[] }).tools.length, path).toBe(MCP_TOOLS.length);
    }
  });
});

describe('/mcp/chatgpt — les cinq exclus refusés, sans effet', () => {
  it('chaque appel direct reçoit « not found », sans unité, sans rapport, sans clé ouverte', async () => {
    const app = buildApp();
    const ip = '203.0.113.11';
    const { id } = await open(app, CHAT, ip);
    const feedback = countRows('feedback');
    const grants = countRows('device_codes');

    for (const [name, args] of EXCLUDED) {
      const res = await callTool(app, CHAT, ip, id, name, args);
      expect(res.result?.isError, `${name} ${JSON.stringify(res)}`).toBe(true);
      expect(JSON.stringify(res.result), name).toContain(`Tool ${name} not found`);
    }
    expect(weekUnits(ip), 'aucune unité débitée').toBe(0);
    expect(countRows('feedback'), 'aucun rapport écrit').toBe(feedback);
    expect(countRows('device_codes'), 'aucune clé ouverte').toBe(grants);

    // La semaine entière reste disponible : un lot de la taille du plafond passe.
    const whole = await callTool(app, CHAT, ip, id, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => DE_IBAN),
    });
    expect(whole.error, JSON.stringify(whole.error)).toBeUndefined();
    expect(weekUnits(ip)).toBe(MCP_WEEKLY_LIMIT);
  });

  it('un lot JSON-RPC mêlant un outil servi et les exclus ne débite que l’outil servi', async () => {
    const app = buildApp();
    const ip = '203.0.113.12';
    const { id } = await open(app, CHAT, ip);
    const feedback = countRows('feedback');
    const grants = countRows('device_codes');
    const res = await post(
      app,
      CHAT,
      ip,
      [
        {
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/call',
          params: { name: 'validate_iban', arguments: { iban: DE_IBAN } },
        },
        ...EXCLUDED.map(([name, args], i) => ({
          jsonrpc: '2.0',
          id: 101 + i,
          method: 'tools/call',
          params: { name, arguments: args },
        })),
      ],
      id,
    );
    const frames = await parseAll(res);
    expect(frames.length).toBe(1 + EXCLUDED.length);
    const served = frames.filter((f) => f.result && !f.result.isError);
    expect(served.length, JSON.stringify(frames)).toBe(1);
    expect(weekUnits(ip)).toBe(1);
    expect(countRows('feedback')).toBe(feedback);
    expect(countRows('device_codes')).toBe(grants);
    const found = frames.flatMap((f) => findings('lot', f, true));
    expect(found, found.join('\n')).toEqual([]);
  });

  it('une session ouverte ailleurs ne rend pas un outil exclu', async () => {
    const app = buildApp();
    const ip = '203.0.113.13';
    const onMcp = await open(app, '/mcp', ip);
    const res = await post(
      app,
      CHAT,
      ip,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'request_api_key', arguments: {} },
      },
      onMcp.id,
    );
    expect(res.status).toBe(404);
  });
});

describe('/mcp/chatgpt — rouge si une offre, une clé ou un fournisseur revient', () => {
  it('le crible attrape ce qu’il doit, et laisse les banques et les éditeurs', () => {
    // Positifs : les deux recommandations que nos textes ont portées.
    expect(recommendsVendor(getComplianceMeta().disclaimer)).toBe(true);
    expect(
      recommendsVendor('For regulated screening use Refinitiv, Acuris, or ComplyAdvantage.'),
    ).toBe(true);
    expect(
      recommendsVendor('Use a regulated provider (Acme Screening, Alpha Check, etc.) for KYC.'),
    ).toBe(true);
    // Les phrases de clé que servent les deux autres adresses.
    for (const keyed of [
      'Send your IBANforge key on this transport.',
      'Without a key, a fair-use weekly allowance per source address applies.',
      'You can take a key without giving anyone an e-mail',
      'use an IBANforge API key from ibanforge.com',
      'creating a key does not unlock this ChatGPT connection',
    ]) {
      expect(namesAKey(keyed), keyed).toBe(true);
    }
    // Négatifs : des noms de banques, de registres et d'éditeurs de sources, et
    // le vocabulaire bancaire des clés de contrôle.
    for (const legit of [
      'Deutsche Bundesbank Bankleitzahlendatei, Commerzbank',
      'UBS Switzerland AG, SIX BankMaster, GLEIF',
      'Finance Finland; ISO 11649 itself is a paid ISO standard; both cited documents publish the rule free of charge.',
      'For regulated screening, use a regulated AML/CFT screening provider.',
      'the national key inside the BBAN; the check key a country keeps; the RIB key',
      'A key may be added later; a key is never removed. pass (the key matches); exact key',
      'it never gives the expected key',
    ]) {
      expect(recommendsVendor(legit), legit).toBe(false);
      expect(namesAKey(legit), legit).toBe(false);
    }
  });

  it('aucune réponse de l’adresse ne nomme un prix, une clé, un outil exclu ou un fournisseur', async () => {
    const app = buildApp();
    const ip = '203.0.113.21';
    const found: string[] = [];

    found.push(
      ...findings('GET', await (await app.request(CHAT, { headers: { 'x-real-ip': ip } })).json()),
    );
    const { id, init } = await open(app, CHAT, ip);
    expect((init.result as { instructions: string }).instructions).toBe(MCP_CHATGPT_INSTRUCTIONS);
    found.push(...findings('initialize', init));
    for (const method of ['tools/list', 'resources/list', 'prompts/list']) {
      const res = await rpc(app, CHAT, ip, id, method);
      expect(res.error, method).toBeUndefined();
      found.push(...findings(method, res));
    }
    const countries = await rpc(app, CHAT, ip, id, 'resources/read', {
      uri: 'ibanforge://countries',
    });
    expect(countries.error).toBeUndefined();
    found.push(...findings('resources/read countries', countries));
    const prompt = await rpc(app, CHAT, ip, id, 'prompts/get', {
      name: 'validate_and_explain',
      arguments: { iban: DE_IBAN },
    });
    expect(JSON.stringify(prompt)).toContain('does not confirm that the account exists');
    found.push(...findings('prompts/get', prompt));

    // La grille des prix n'existe pas ici, même lue directement.
    const pricing = await rpc(app, CHAT, ip, id, 'resources/read', {
      uri: 'ibanforge://pricing',
    });
    expect(pricing.error?.message).toContain('not found');

    for (const [name, args] of [
      ['validate_iban', { iban: DE_IBAN }],
      ['batch_validate_iban', { ibans: [DE_IBAN, 'FR1420041010050500013M02606'] }],
      ['lookup_bic', { bic: 'DEUTDEFF' }],
      ['lookup_ch_clearing', { iid: '230' }],
      ['lookup_ch_clearing', { iid: '99999' }],
      ['validate_payment_reference', { reference: 'RF18539007547034', iban: CH_IBAN }],
      ['check_compliance', { iban: DE_IBAN }],
    ] as const) {
      const res = await callTool(app, CHAT, ip, id, name, args);
      expect(res.error, `${name} ${JSON.stringify(res.error)}`).toBeUndefined();
      expect(res.result?.isError, name).toBeFalsy();
      found.push(...findings(`tools/call ${name}`, res));
    }

    // Les erreurs : outil inconnu, schéma refusé.
    found.push(...findings('outil inconnu', await callTool(app, CHAT, ip, id, 'nope', {})));
    const schema = await callTool(app, CHAT, ip, id, 'validate_iban', {});
    expect(schema.result?.isError).toBe(true);
    found.push(...findings('schéma', schema));
    // Les exclus : le SDK répète leur nom, rien d'autre.
    for (const [name, args] of EXCLUDED) {
      found.push(...findings(`exclu ${name}`, await callTool(app, CHAT, ip, id, name, args), true));
    }

    // Les refus : la semaine, les sessions, la comptabilité indisponible.
    const capped = '203.0.113.22';
    const s2 = await open(app, CHAT, capped);
    const weekly = await callTool(app, CHAT, capped, s2.id, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT + 1 }, () => DE_IBAN),
    });
    expect(weekly.error?.message).toBe(chatgptAllowanceRefusal(0, MCP_WEEKLY_LIMIT, 'x').message);
    found.push(...findings('refus hebdomadaire', weekly));
    const crowded = '203.0.113.23';
    let refusal: Rpc = {};
    for (let i = 0; i <= MCP_SESSIONS_PER_IP_DAY; i++)
      refusal = await burnOpening(app, CHAT, crowded);
    expect(refusal.error?.message).toBe(CHATGPT_SESSION_REFUSAL);
    found.push(...findings('refus de session', refusal));
    found.push(...findings('comptabilité indisponible', CHATGPT_ACCOUNTING_UNAVAILABLE));

    expect(found, found.join('\n')).toEqual([]);
  });

  it('les descriptions : le texte de /mcp/directory, fini par la note de cette adresse, sans déclencheur large', async () => {
    const app = buildApp();
    const ip = '203.0.113.24';
    const { id } = await open(app, CHAT, ip);
    const tools = toolsOf(await rpc(app, CHAT, ip, id, 'tools/list'));
    const directory = directoryToolDescriptions(DIRECTORY_ALLOWANCE_NOTE);
    for (const tool of tools) {
      // Une seule différence avec l'adresse des répertoires : la note de la limite.
      expect(tool.description, tool.name).toBe(
        directory[tool.name]!.split(DIRECTORY_ALLOWANCE_NOTE).join(CHATGPT_ALLOWANCE_NOTE),
      );
    }
    for (const tool of tools) {
      expect(tool.description, tool.name).toContain(CHATGPT_ALLOWANCE_NOTE);
      for (const gone of ['pastes any string', 'with or without a key', 'Without a key', 'COST:']) {
        expect(tool.description, `${tool.name}: ${gone}`).not.toContain(gone);
      }
    }
    expect(CHATGPT_ALLOWANCE_NOTE).not.toMatch(/\d/);
  });

  it('les instructions et les refus ne citent que les six outils, et jamais le chiffre', () => {
    const named = new Set(MCP_CHATGPT_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
    for (const name of named) expect(CHATGPT_TOOLS as readonly string[], name).toContain(name);
    const figure = new RegExp(`\\b(${MCP_WEEKLY_LIMIT}|${MCP_SESSIONS_PER_IP_DAY})\\b`);
    for (const text of [
      MCP_CHATGPT_INSTRUCTIONS,
      chatgptAllowanceRefusal(MCP_WEEKLY_LIMIT + 1, MCP_WEEKLY_LIMIT, 'x').message,
      CHATGPT_SESSION_REFUSAL,
      CHATGPT_ACCOUNTING_UNAVAILABLE,
    ]) {
      expect(text).not.toMatch(figure);
    }
    // Le chiffre voyage dans `data`, comme sur les deux autres adresses.
    expect(chatgptAllowanceRefusal(MCP_WEEKLY_LIMIT + 1, MCP_WEEKLY_LIMIT, 'x').data).toEqual({
      used: MCP_WEEKLY_LIMIT + 1,
      limit: MCP_WEEKLY_LIMIT,
      remaining: 0,
      period: 'week',
      resets_at: 'x',
    });
  });

  it('meta.disclaimer : seuls les fournisseurs partent, et seulement ici', async () => {
    const app = buildApp();
    const ip = '203.0.113.25';
    const shared = getComplianceMeta().disclaimer;
    expect(shared, 'le passage réécrit existe dans l’avertissement partagé').toContain(
      DISCLAIMER_VENDORS,
    );
    const disclaimerOn = async (path: string) => {
      const { id } = await open(app, path, ip);
      const res = await callTool(app, path, ip, id, 'check_compliance', { iban: DE_IBAN });
      return (structured(res).meta as { disclaimer: string }).disclaimer;
    };
    const onChat = await disclaimerOn(CHAT);
    expect(onChat).toBe(chatgptDisclaimer(shared));
    expect(onChat).not.toBe(shared);
    for (const kept of [
      'NOT a regulated AML/CFT product',
      'NOT the beneficiary / account-holder name',
      'Most sanctions designations target persons and companies, which this does not screen.',
      'Use a regulated provider for name-level KYC/AML obligations.',
    ]) {
      expect(onChat, kept).toContain(kept);
    }
    expect(recommendsVendor(onChat)).toBe(false);
    expect(await disclaimerOn('/mcp')).toBe(shared);
    expect(await disclaimerOn(DIR)).toBe(shared);
  });
});

describe('/mcp/chatgpt — les mêmes compteurs que /mcp et /mcp/directory', () => {
  const PAIRS: ReadonlyArray<[string, string]> = [
    ['/mcp', CHAT],
    [CHAT, '/mcp'],
    [DIR, CHAT],
    [CHAT, DIR],
  ];
  const WEEK_REFUSAL: Record<string, string> = {
    [CHAT]: 'Weekly usage allowance reached',
    [DIR]: 'Weekly keyless allowance reached',
    '/mcp': 'Weekly MCP free tier limit reached',
  };
  const SESSION_REFUSAL: Record<string, string> = {
    [CHAT]: CHATGPT_SESSION_REFUSAL,
    [DIR]: DIRECTORY_SESSION_REFUSAL,
    '/mcp': 'Daily MCP session limit reached',
  };

  it.each(PAIRS.map(([from, to], i) => [from, to, i] as const))(
    'la semaine dépensée sur %s est refusée sur %s',
    async (from, to, i) => {
      const app = buildApp();
      const ip = `203.0.113.${40 + i}`;
      const a = await open(app, from, ip);
      const spent = await callTool(app, from, ip, a.id, 'batch_validate_iban', {
        ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => DE_IBAN),
      });
      expect(spent.error, 'the whole week fits in one batch').toBeUndefined();
      const b = await open(app, to, ip);
      const refused = await callTool(app, to, ip, b.id, 'validate_iban', { iban: DE_IBAN });
      expect(refused.error?.code).toBe(-32000);
      expect(refused.error?.data?.used).toBe(MCP_WEEKLY_LIMIT + 1);
      expect(refused.error?.message).toContain(WEEK_REFUSAL[to]);
    },
  );

  it.each(PAIRS.map(([from, to], i) => [from, to, i] as const))(
    'les ouvertures du jour faites sur %s ferment %s',
    async (from, to, i) => {
      const app = buildApp();
      const ip = `203.0.113.${50 + i}`;
      for (let n = 0; n < MCP_SESSIONS_PER_IP_DAY; n++) await burnOpening(app, from, ip);
      const res = await post(app, to, ip, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: INIT,
      });
      expect(res.headers.get('mcp-session-id'), 'no session past the shared cap').toBeNull();
      expect((await parse(res)).error?.message).toContain(SESSION_REFUSAL[to]);
    },
  );

  it('les trois adresses écrivent dans le même seau de la semaine', async () => {
    const app = buildApp();
    const ip = '203.0.113.60';
    for (const path of ['/mcp', DIR, CHAT]) {
      const { id } = await open(app, path, ip);
      await callTool(app, path, ip, id, 'validate_iban', { iban: DE_IBAN });
    }
    expect(weekUnits(ip)).toBe(3);
    const { id } = await open(app, CHAT, ip);
    const over = await callTool(app, CHAT, ip, id, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => DE_IBAN),
    });
    expect(over.error?.data?.used).toBe(MCP_WEEKLY_LIMIT + 3);
  });

  it('une clé présentée ici est ignorée : l’appel reste débité sur l’adresse', async () => {
    const app = buildApp();
    const ip = '203.0.113.61';
    const minted = generateApiKey(null);
    if (!minted) throw new Error('could not mint a key');
    const before = getUsage(minted.key_hash).used;
    const bearer = { Authorization: `Bearer ${minted.api_key}` };

    const { id } = await open(app, CHAT, ip, bearer);
    const served = await callTool(app, CHAT, ip, id, 'validate_iban', { iban: DE_IBAN }, bearer);
    expect(served.result?.isError, JSON.stringify(served)).toBeFalsy();
    expect(structured(served).valid).toBe(true);
    expect(weekUnits(ip), 'débité sur l’adresse').toBe(1);
    expect(getUsage(minted.key_hash).used, 'rien sur la clé').toBe(before);

    // Une clé inconnue ne reçoit pas de refus de clé : elle n'est pas lue.
    const unknown = await callTool(
      app,
      CHAT,
      ip,
      id,
      'lookup_bic',
      { bic: 'DEUTDEFF' },
      { Authorization: 'Bearer ifk_inconnue_acme_0000000000000000' },
    );
    expect(unknown.result?.isError).toBeFalsy();
    expect(findings('clé inconnue', unknown)).toEqual([]);
    expect(weekUnits(ip)).toBe(2);
  });

  it('une clé valide n’exempte pas les ouvertures de session de la franchise du jour', async () => {
    const app = buildApp();
    const ip = '203.0.113.62';
    const minted = generateApiKey(null);
    if (!minted) throw new Error('could not mint a key');
    const header = { 'X-API-Key': minted.api_key };
    for (let n = 0; n < MCP_SESSIONS_PER_IP_DAY; n++) await burnOpening(app, CHAT, ip, header);
    const res = await post(
      app,
      CHAT,
      ip,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT },
      undefined,
      header,
    );
    expect(res.headers.get('mcp-session-id')).toBeNull();
    expect((await parse(res)).error?.message).toBe(CHATGPT_SESSION_REFUSAL);
  });
});

describe('/mcp/chatgpt — une session ne passe pas d’une adresse à l’autre', () => {
  it('une session de chaque adresse reçoit le 404 « initialize again » sur les deux autres', async () => {
    const app = buildApp();
    const ip = '203.0.113.70';
    const paths = ['/mcp', DIR, CHAT];
    const sessions = new Map<string, string>();
    for (const path of paths) sessions.set(path, (await open(app, path, ip)).id);
    for (const home of paths) {
      for (const other of paths.filter((p) => p !== home)) {
        const crossed = await post(
          app,
          other,
          ip,
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          sessions.get(home),
        );
        expect(crossed.status, `${home} → ${other}`).toBe(404);
        const del = await app.request(other, {
          method: 'DELETE',
          headers: { 'mcp-session-id': sessions.get(home)!, 'x-real-ip': ip },
        });
        expect(del.status, `DELETE ${home} → ${other}`).toBe(400);
      }
      // Et chacune reste servie chez elle.
      expect((await rpc(app, home, ip, sessions.get(home)!, 'tools/list')).error).toBeUndefined();
    }
  });
});

describe('/mcp/chatgpt — les mêmes données que /mcp/directory, au seul avertissement près', () => {
  /** Sans `processing_ms`, à tous les niveaux : les lignes d'un lot portent le leur. */
  const withoutTiming = (payload: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(
      JSON.stringify(payload, (key, value: unknown) =>
        key === 'processing_ms' ? undefined : value,
      ),
    ) as Record<string, unknown>;

  it.each([
    ['validate_iban', { iban: DE_IBAN }],
    [
      'batch_validate_iban',
      { ibans: ['CH9300762011623852957', 'GB29NWBK60161331926819', 'DE89370400440532013001'] },
    ],
    ['lookup_bic', { bic: 'UBSWCHZH80A' }],
    ['lookup_ch_clearing', { iid: '230' }],
    ['validate_payment_reference', { reference: 'RF18539007547034', iban: CH_IBAN }],
    ['check_compliance', { iban: DE_IBAN }],
  ] as const)('%s', async (name, args) => {
    const app = buildApp();
    const ip = '203.0.113.80';
    const a = await open(app, DIR, ip);
    const b = await open(app, CHAT, ip);
    const onDir = withoutTiming(structured(await callTool(app, DIR, ip, a.id, name, args)));
    const onChat = withoutTiming(structured(await callTool(app, CHAT, ip, b.id, name, args)));
    expect(onChat, `${name} lost its structuredContent`).toBeDefined();
    const expected =
      name === 'check_compliance'
        ? {
            ...onDir,
            meta: {
              ...(onDir.meta as Record<string, unknown>),
              disclaimer: chatgptDisclaimer((onDir.meta as { disclaimer: string }).disclaimer),
            },
          }
        : onDir;
    expect(onChat).toEqual(expected);
    expect(onChat).not.toHaveProperty('cost_usdc');
  });
});

describe('/mcp/chatgpt — les cas du dossier, sur leurs invariants stables', () => {
  /**
   * Les valeurs exactes (dates, QR-IID, verdict suisse du code 00762) changent
   * au rafraîchissement mensuel des données : elles sont relevées dans la
   * passation, pas figées ici.
   */
  it('P1 à P5 et N3', async () => {
    const app = buildApp();
    const ip = '203.0.113.90';
    const { id } = await open(app, CHAT, ip);
    const call = async (name: string, args: Record<string, unknown>) =>
      structured(await callTool(app, CHAT, ip, id, name, args));

    const p1 = await call('validate_iban', { iban: DE_IBAN });
    expect(p1.valid).toBe(true);
    expect(p1.checks).toMatchObject({ account_exists: 'not_checked', payee_name: 'not_checked' });
    expect((p1.bic as { bic8: string }).bic8).toBe('COBADEFF');
    expect(JSON.stringify(p1)).toContain('Bundesbank');

    const p2 = (await call('batch_validate_iban', {
      ibans: ['CH9300762011623852957', 'GB29NWBK60161331926819', 'DE89370400440532013001'],
    })) as { results: Array<Record<string, unknown>>; count: number; valid_count: number };
    expect(p2.count).toBe(3);
    // `valid_count`, comme POST /v1/iban/batch (24.10.2026) : deux IBAN valides sur trois.
    expect(p2.valid_count).toBe(2);
    expect(p2.results.map((r) => r.valid)).toEqual([true, true, false]);
    expect(p2.results[2].error).toBe('checksum_failed');
    expect((p2.results[1].bic as { authoritative: boolean }).authoritative).toBe(false);

    const p3a = await call('lookup_bic', { bic: 'UBSWCHZH80A' });
    const p3b = await call('lookup_ch_clearing', { iid: '230' });
    expect(p3a.found).toBe(true);
    expect(p3b.found).toBe(true);
    expect(p3b.iid).toBe('00230');
    expect(p3b.bic).toBe('UBSWCHZH80A');
    expect((p3b.institution as { name: string }).name).toBe(p3a.institution);

    const p4 = await call('validate_payment_reference', {
      reference: 'RF18539007547034',
      iban: CH_IBAN,
    });
    expect(p4).toMatchObject({ scheme: 'rf', valid: true, pairing: 'ok' });

    const p5 = await call('check_compliance', { iban: DE_IBAN });
    expect((p5.meta as { scope: string }).scope).toBe('bank_bic_only');
    expect(
      (p5.compliance as { sanctions: { payee_screened: boolean } }).sanctions.payee_screened,
    ).toBe(false);
    expect(recommendsVendor(JSON.stringify(p5))).toBe(false);

    const n3 = await call('validate_payment_reference', {
      reference: '210000000003139471430009017',
      iban: CH_IBAN,
    });
    expect(n3).toMatchObject({ scheme: 'qrr', valid: true, pairing: 'qrr_requires_qr_iban' });
  });
});

describe('/mcp/chatgpt — le tableau de bord le compte comme /mcp', () => {
  const lastRow = (): { path: string; tool_name: string | null } =>
    getStatsDB()
      .prepare(
        "SELECT path, tool_name FROM request_log WHERE path LIKE '/mcp%' ORDER BY id DESC LIMIT 1",
      )
      .get() as { path: string; tool_name: string | null };

  it('« Agents sans clé », appels sous /mcp:tools-call, refus sous leur chemin, poignée de main en découverte', async () => {
    expect(classifyClient(CHAT, 'ChatGPT-User')).toBe('mcp_http');
    expect(isDiscoveryPath(CHAT)).toBe(true);
    const app = buildApp();
    const ip = '203.0.113.95';
    const { id } = await open(app, CHAT, ip);
    expect(lastRow().path).toBe(CHAT);

    await callTool(app, CHAT, ip, id, 'lookup_ch_clearing', { iid: '230' });
    expect(lastRow()).toEqual({ path: '/mcp:tools-call', tool_name: 'lookup_ch_clearing' });

    await callTool(app, CHAT, ip, id, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT }, () => DE_IBAN),
    });
    expect(lastRow().path).toBe('/mcp:tools-call:refused');
  });
});
