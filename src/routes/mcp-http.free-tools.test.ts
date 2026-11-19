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
 *     répond, sur `/mcp` et `/mcp/directory`, et aussi quand la comptabilité
 *     est indisponible ;
 *   - `/mcp/chatgpt`, que la décision ne couvre pas (elle porte sur Claude),
 *     décompte toujours la référence de paiement et la refuse après le
 *     plafond, avec ses textes d'avant ;
 *   - au-delà du garde-fou horaire (`MCP_UNMETERED_CALLS_PER_SOURCE_HOUR`),
 *     la requête est refusée tout de suite, sans toucher aux unités de la
 *     semaine, avec un texte à elle, et aucun texte
 *     servi ne nomme ce garde-fou ;
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
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';

/**
 * La comptabilité hebdomadaire, rendue indisponible à la demande pour une
 * adresse : le chemin `limit.degraded` du transport, sans casser la base.
 */
const degradedBuckets = vi.hoisted(() => new Set<string>());
vi.mock('../lib/daily-ip-ledger.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/daily-ip-ledger.js')>();
  return {
    ...real,
    countWeeklyTrialUnits: (...args: Parameters<typeof real.countWeeklyTrialUnits>) =>
      degradedBuckets.has(args[0])
        ? { allowed: false, used: args[2] + args[1], remaining: 0, degraded: true as const }
        : real.countWeeklyTrialUnits(...args),
  };
});

import {
  mcpHttp,
  mcpAllowanceRefusal,
  countUnmeteredCalls,
  mcpUnmeteredGuardRefusal,
  MCP_ACCOUNTING_UNAVAILABLE,
  MCP_UNMETERED_CALLS_PER_SOURCE_HOUR,
  MCP_WEEKLY_LIMIT,
} from './mcp-http.js';
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
  directoryUnmeteredGuardRefusal,
} from '../mcp/directory.js';
import {
  CHATGPT_ALLOWANCE_NOTE,
  MCP_CHATGPT_INSTRUCTIONS,
  chatgptAllowanceRefusal,
  chatgptDescription,
} from '../mcp/chatgpt.js';
import { buildApp } from '../app.js';
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

  it('les entrées d’essai de ce fichier couvrent exactement la constante', () => {
    expect(sorted(Object.keys(FREE_CALLS))).toEqual(sorted(KEYLESS_UNMETERED_TOOLS));
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
    // Le refus d'un outil payant après le plafond débite toujours son unité,
    // comme avant ce lot.
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

  it('comptabilité indisponible : un payant reçoit le refus dédié, les trois répondent', async () => {
    const app = makeApp();
    const ip = '198.18.40.7';
    const session = await open(app, '/mcp', ip);
    degradedBuckets.add(ledgerBucket(ip, ''));
    try {
      const paid = await call(app, '/mcp', session, ip, 'validate_iban', { iban: IBAN });
      expect(paid.error?.message).toBe(MCP_ACCOUNTING_UNAVAILABLE);
      for (const [name, args] of Object.entries(FREE_CALLS)) {
        const env = await call(app, '/mcp', session, ip, name, args);
        expect(env.error, `${name} refusé, comptabilité indisponible`).toBeUndefined();
        expect(env.result?.isError, name).toBeFalsy();
      }
    } finally {
      degradedBuckets.delete(ledgerBucket(ip, ''));
    }
  });
});

describe(`le garde-fou : ${MCP_UNMETERED_CALLS_PER_SOURCE_HOUR} appels à zéro unité par heure et par source`, () => {
  it('au-delà : refus sec, avec son texte, et les unités de la semaine intactes ; un payant reste servi', async () => {
    const app = makeApp();
    const ip = '198.18.40.8';
    const session = await open(app, '/mcp', ip);
    await call(app, '/mcp', session, ip, 'validate_iban', { iban: IBAN });
    expect(weekUnits(ip)).toBe(1);
    // L'heure remplie jusqu'au garde-fou, sans six mille appels.
    expect(countUnmeteredCalls(ledgerBucket(ip, ''), MCP_UNMETERED_CALLS_PER_SOURCE_HOUR)).toBe(
      true,
    );

    for (const [name, args] of Object.entries(FREE_CALLS)) {
      const refused = await call(app, '/mcp', session, ip, name, args);
      expect(refused.error?.code, name).toBe(-32000);
      expect(refused.error?.message, name).toBe(mcpUnmeteredGuardRefusal());
    }
    expect(weekUnits(ip), 'le refus du garde-fou ne touche pas à la semaine').toBe(1);

    const paid = await call(app, '/mcp', session, ip, 'lookup_bic', { bic: 'DEUTDEFF' });
    expect(
      paid.error,
      'un outil payant reste servi tant que la semaine a des unités',
    ).toBeUndefined();
    expect(weekUnits(ip)).toBe(2);
  });

  it('/mcp/directory : le même refus, dit comme un fait, sans toucher à la semaine', async () => {
    const app = makeApp();
    const ip = '198.18.40.10';
    const session = await open(app, '/mcp/directory', ip);
    expect(countUnmeteredCalls(ledgerBucket(ip, ''), MCP_UNMETERED_CALLS_PER_SOURCE_HOUR)).toBe(
      true,
    );
    const refused = await call(
      app,
      '/mcp/directory',
      session,
      ip,
      'check_swiss_qr_bill',
      FREE_CALLS.check_swiss_qr_bill,
    );
    expect(refused.error?.code).toBe(-32000);
    expect(refused.error?.message).toBe(directoryUnmeteredGuardRefusal());
    expect(weekUnits(ip)).toBeNull();
  });

  it('un lot de cent appels gratuits compte cent au garde-fou', async () => {
    const app = makeApp();
    const ip = '198.18.40.9';
    const session = await open(app, '/mcp', ip);
    expect(
      countUnmeteredCalls(ledgerBucket(ip, ''), MCP_UNMETERED_CALLS_PER_SOURCE_HOUR - 100),
    ).toBe(true);
    const batch = Array.from({ length: 100 }, (_, i) => ({
      jsonrpc: '2.0',
      id: 300 + i,
      method: 'tools/call',
      params: {
        name: 'validate_payment_reference',
        arguments: FREE_CALLS.validate_payment_reference,
      },
    }));
    const served = await (await post(app, '/mcp', ip, batch, { 'mcp-session-id': session })).text();
    expect(served, 'le lot tient pile dans le garde-fou').not.toContain('Too many');
    const next = await call(
      app,
      '/mcp',
      session,
      ip,
      'validate_payment_reference',
      FREE_CALLS.validate_payment_reference,
    );
    expect(next.error?.message, 'l’appel suivant le dépasse').toBe(mcpUnmeteredGuardRefusal());
    expect(weekUnits(ip)).toBeNull();
  });

  it('le texte du refus : la clé gratuite, sans chiffre ni nom du garde-fou', () => {
    for (const text of [mcpUnmeteredGuardRefusal(), directoryUnmeteredGuardRefusal()]) {
      // Les chiffres d'une adresse (« /v1/ ») ne sont pas un plafond.
      expect(text.replace(/https?:\/\/\S+/g, '')).not.toMatch(/\d/);
      expect(text).not.toMatch(/MCP_UNMETERED|guard|per hour|hourly/i);
      expect(sorted(toolsNamedIn(text))).toEqual(sorted(KEYLESS_UNMETERED_TOOLS));
    }
    expect(mcpUnmeteredGuardRefusal()).toContain('/v1/keys/generate');
    expect(directoryUnmeteredGuardRefusal()).toContain('counted on that key');
  });

  it('aucun texte servi ne nomme le garde-fou', async () => {
    const figure = new RegExp(
      `\\b${MCP_UNMETERED_CALLS_PER_SOURCE_HOUR}\\b|${MCP_UNMETERED_CALLS_PER_SOURCE_HOUR.toLocaleString('en-US')}`,
    );
    const discovery = await (await makeApp().request('/mcp')).text();
    for (const [name, text] of Object.entries({
      MCP_INSTRUCTIONS,
      MCP_DIRECTORY_INSTRUCTIONS,
      mcpAllowanceRefusal: mcpAllowanceRefusal(MCP_WEEKLY_LIMIT + 1).message,
      directoryAllowanceRefusal: directoryAllowanceRefusal(
        MCP_WEEKLY_LIMIT + 1,
        MCP_WEEKLY_LIMIT,
        'x',
      ).message,
      discovery,
    })) {
      expect(text, name).not.toMatch(figure);
      expect(text, name).not.toMatch(/per hour|an hour|hourly/i);
    }
  });
});

describe('/mcp/directory partage la règle', () => {
  it('plafond atteint, un payant refusé, les trois répondent', async () => {
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
});

describe('/mcp/chatgpt garde son comportement d’avant (la décision porte sur Claude)', () => {
  it('la référence de paiement y coûte une unité, et y est refusée après le plafond', async () => {
    const app = makeApp();
    const ip = '198.18.40.5';
    const chat = await open(app, '/mcp/chatgpt', ip);
    const first = await call(
      app,
      '/mcp/chatgpt',
      chat,
      ip,
      'validate_payment_reference',
      FREE_CALLS.validate_payment_reference,
    );
    expect(first.error).toBeUndefined();
    expect(weekUnits(ip)).toBe(1);

    await call(app, '/mcp/chatgpt', chat, ip, 'batch_validate_iban', {
      ibans: Array.from({ length: MCP_WEEKLY_LIMIT - 1 }, () => IBAN),
    });
    expect(weekUnits(ip)).toBe(MCP_WEEKLY_LIMIT);
    const refused = await call(
      app,
      '/mcp/chatgpt',
      chat,
      ip,
      'validate_payment_reference',
      FREE_CALLS.validate_payment_reference,
    );
    expect(refused.error?.code).toBe(-32000);
    expect(refused.error?.message).toContain('Weekly usage allowance reached');
  });

  it('ses textes ne nomment aucun outil hors de l’allocation', () => {
    expect(chatgptDescription('validate_payment_reference')).toContain(CHATGPT_ALLOWANCE_NOTE);
    for (const text of [
      MCP_CHATGPT_INSTRUCTIONS,
      chatgptAllowanceRefusal(MCP_WEEKLY_LIMIT + 1, MCP_WEEKLY_LIMIT, 'x').message,
      chatgptDescription('validate_payment_reference') ?? '',
    ]) {
      expect(text).not.toMatch(/not counted|does not count|cost no unit|cost none/);
    }
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

  it('les quatre textes de règle nomment les trois, sans chiffre dans leur incise', async () => {
    const app = buildApp();
    const discovery = JSON.parse(await (await makeApp().request('/mcp')).text()) as {
      free_tier: { mcp_weekly_limit_unit: string };
    };
    const yml = await (await app.request('/.well-known/rate-limits.yml')).text();
    const llms = await (await app.request('/llms.txt')).text();
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const incises = {
      free_tier: discovery.free_tier.mcp_weekly_limit_unit.split('; ')[1] ?? '',
      yml:
        (yml.split('\n').find((l) => l.includes('unit: one per tool call')) ?? '').split('; ')[1] ??
        '',
      llms:
        llms
          .split(/(?<=\.)\s+/)
          .find((s) => s.includes('are not counted in this weekly allowance')) ?? '',
      readme: readme.split(/(?<=\.)\s+/).find((s) => s.includes('QR-bill checks')) ?? '',
    };
    for (const [name, text] of Object.entries(incises)) {
      expect(sorted(toolsNamedIn(text)), name).toEqual(sorted(KEYLESS_UNMETERED_TOOLS));
      expect(text, name).not.toMatch(/\d/);
    }
  });
});
