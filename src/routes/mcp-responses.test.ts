/**
 * Des faits, jamais des consignes, dans les RÉPONSES des adresses des
 * répertoires (`/mcp/directory`, `/mcp/chatgpt`), 24.10.2026.
 *
 * Les descriptions de ces deux adresses ne portent plus aucune consigne depuis
 * la PR 433 (`mcp-descriptions.test.ts`). Une revue sévère lit aussi ce que les
 * outils répondent : ce fichier passe le même crible (`src/mcp/directives.ts`)
 * sur tout le JSON que les deux adresses servent, en local (`buildApp()`) :
 *  - chaque outil de chaque adresse, sur un jeu d'appels qui atteint ses
 *    branches de texte (étapes, notes, constats, erreurs de format) ;
 *  - le device grant de bout en bout : attente, poll trop rapide, refus,
 *    expiration, approbation, réseau plein ;
 *  - les refus : semaine, ouvertures de session, session inconnue, appel sans
 *    session, clé inconnue, et le GET de découverte.
 * Puis, en unitaire, ce qu'un appel local n'atteint pas : chaque code d'étape et
 * chacune de ses variantes, chaque texte du device grant, chaque cause de refus
 * d'une clé, chaque constat de la QR-facture, les crédits des registres servis
 * en production seulement.
 *
 * Ce que le crible laisse, et seulement par passage exact, chacun pour sa
 * raison (`directoryVerbatimPassages`) : la citation attribuée des sources du
 * type K, les deux citations de SPS entre guillemets, et l'Important
 * Note de la HBA que sa licence impose en entier. Et les valeurs qui sont des
 * DONNÉES (noms, adresses, IBAN formatés, lignes d'une QR-facture reçue) :
 * `RESPONSE_DATA_KEYS`.
 *
 * `/mcp` ne bouge pas : ses réponses servent ici de corpus, pour prouver que
 * chaque réécriture trouve encore son passage (aucune n'est périmée) et que le
 * crible attrape bien ce que les adresses servaient avant.
 */
process.env.DEVICE_POLL_WAIT_MS = '200';
process.env.DEVICE_POLL_TICK_MS = '20';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';
import { DEVICE_TEXTS, displayToHuman } from '../lib/device-grant.js';
import { DAILY_KEY_CREATION_LIMIT } from '../lib/key-creation-guard.js';
import { MCP_SESSIONS_PER_IP_DAY, MCP_WEEKLY_LIMIT } from '../lib/mcp-limits.js';
import { nextSteps, type NextStep } from '../lib/next-steps.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { checkSwissQrBill } from '../lib/swiss-qr-bill.js';
import { checkPostalAddress } from '../lib/address-conformity.js';
import { buildReferenceCheck, validatePaymentReference } from '../lib/payment-reference.js';
import { checkNationalKey } from '../lib/national-check/index.js';
import { getComplianceMeta } from '../lib/compliance-db.js';
import { grRegisterName } from '../lib/gr-register.js';
import { eeBicSourceName, eeRegisterName } from '../lib/ee-register.js';
import { meCredit, meRegisterName } from '../lib/me-register.js';
import { rsCredit, rsRegisterName } from '../lib/rs-register.js';
import { curatedMapSource } from '../lib/bic-lookup.js';
import type { IBANValidationResult, PaywallCause } from '../types.js';
import { type ResponseCrib, cribResponse, emptyResponseCrib } from '../mcp/directives.js';
import {
  DIRECTORY_RESPONSE_EDITS,
  directoryResponse,
  directoryResponseText,
  directoryStepSentence,
  directoryVerbatimPassages,
} from '../mcp/directory-responses.js';
import {
  DIRECTORY_ACCOUNTING_UNAVAILABLE,
  DIRECTORY_NO_SESSION,
  DIRECTORY_SESSION_REFUSAL,
  DIRECTORY_UNKNOWN_SESSION,
  directoryAllowanceRefusal,
  directoryEndpointMessage,
  directoryKeyRefusalPayload,
  directoryNextSteps,
} from '../mcp/directory.js';
import {
  CHATGPT_ACCOUNTING_UNAVAILABLE,
  CHATGPT_SESSION_REFUSAL,
  CHATGPT_TOOLS,
  chatgptAllowanceRefusal,
} from '../mcp/chatgpt.js';
import { MCP_TOOLS } from '../mcp/inventory.js';

const ROOT = join(import.meta.dirname, '..', '..');

// ── Le crible ────────────────────────────────────────────────────────────────

/**
 * Le crible des réponses (`cribResponse`, src/mcp/directives.ts) et les passages
 * servis mot pour mot exprès (`directoryVerbatimPassages`,
 * src/mcp/directory-responses.ts, chacun avec sa raison) : les mêmes que lit la
 * preuve en ligne de la passation du 24.10.2026.
 */
const VERBATIM = directoryVerbatimPassages().map(([passage]) => passage);
function crib(value: unknown, where: string, read?: ResponseCrib): ResponseCrib {
  return cribResponse(value, where, VERBATIM, read);
}
const emptyRead = emptyResponseCrib;

/** Toutes les chaînes d'une valeur JSON, texte des blocs compris : le corpus de /mcp. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^\s*[[{]/.test(value)) {
      try {
        return strings(JSON.parse(value), out);
      } catch {
        // Une phrase.
      }
    }
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) strings(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) strings(v, out);
  }
  return out;
}

// ── Les appels ───────────────────────────────────────────────────────────────

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;
const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'vitest-mcp-responses', version: '1.0.0' },
};
const DE = 'DE89370400440532013000';
const CH = 'CH5204835012345671000';
const QR_IBAN = 'CH4431999123000889012';
/** Un QR-IBAN sur un QR-IID que SIX attribue (30700) : il porte l'étape QR-IBAN. */
const QR_IBAN_ALLOCATED = 'CH3130700123000889012';

type App = ReturnType<typeof buildApp>;

async function body(res: Response): Promise<unknown> {
  const text = await res.text();
  const frame = text.match(/^data:\s*(\{.*\})$/m);
  try {
    return JSON.parse(frame ? frame[1] : text);
  } catch {
    return text;
  }
}

function post(
  app: App,
  path: string,
  ip: string,
  payload: unknown,
  sid?: string,
  extra: Record<string, string> = {},
) {
  return app.request(path, {
    method: 'POST',
    headers: { ...HEADERS, 'x-real-ip': ip, ...(sid ? { 'mcp-session-id': sid } : {}), ...extra },
    body: JSON.stringify(payload),
  });
}

async function open(app: App, path: string, ip: string): Promise<string> {
  const res = await post(app, path, ip, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: INIT,
  });
  const sid = res.headers.get('mcp-session-id');
  expect(sid, `${path} ouvre une session depuis ${ip}`).toBeTruthy();
  return sid!;
}

/** Une QR-facture valide, adresses structurées, ligne par ligne. */
const QR_LINES: readonly string[] = [
  'SPC', '0200', '1', 'CH5800791123000889012',
  'S', 'Robert Schneider AG', 'Rue du Lac', '1268', '2501', 'Biel', 'CH',
  '', '', '', '', '', '', '',
  '199.95', 'CHF',
  'S', 'Pia-Maria Rutschmann-Schnyder', 'Grosse Marktgasse', '28', '9400', 'Rorschach', 'CH',
  'SCOR', 'RF18539007547034', '', 'EPD',
]; // prettier-ignore
function qr(changes: Record<number, string> = {}, extra: readonly string[] = []): string {
  const lines = [...QR_LINES, ...extra];
  for (const [i, v] of Object.entries(changes)) lines[Number(i)] = v;
  return lines.join('\n');
}

/** Les QR-factures qui atteignent chaque constat écrit avec une règle. */
const QR_PAYLOADS: readonly string[] = [
  qr(),
  // NPA et localité au répertoire de swisstopo (29.10.2026) : les trois
  // avertissements, lus par le crible comme tout autre constat.
  qr({ 8: '8001', 9: 'Bern' }),
  qr({ 8: '9490', 9: 'Vaduz' }),
  qr({ 8: '8238', 9: 'Büsingen' }),
  'SPC\n0200\n1',
  qr({ 0: 'SPX', 1: '0100', 2: '2' }),
  qr({ 3: 'DE89370400440532013000' }),
  qr({ 3: 'CH5800791123000889013' }),
  qr({ 4: '' }),
  qr({ 4: 'X' }),
  qr({ 10: '1X' }),
  qr({ 4: 'K', 6: 'Rue du Lac 1268', 7: '2501 Biel', 8: '2501', 9: 'Biel' }),
  qr({ 4: 'K', 6: 'Rue du Lac 1268', 7: '2501 Biel', 8: '', 9: '' }),
  qr({ 4: 'K', 6: 'Rue du Lac 1268', 7: 'Biel', 8: '', 9: '' }),
  qr({ 20: 'K', 22: 'Grosse Marktgasse 28', 23: '9400 Rorschach', 24: '', 25: '' }),
  qr({ 11: 'S' }),
  qr({ 18: '12,50', 19: 'USD' }),
  qr({ 27: 'XYZ' }),
  qr({ 30: 'END' }),
  qr({}, ['S1/10/10201409/11/200701']),
  // Les deux règles du 29.10.2026 : la QR-facture en euros (IG 2.4) et le jeu
  // de caractères (ch. 4.1.1), un émoji, du cyrillique et un caractère invisible,
  // que le constat nomme par son point de code, jamais tel quel.
  qr({ 3: QR_IBAN, 19: 'EUR', 27: 'QRR', 28: '210000000003139471430009017' }),
  qr({ 5: `Robert${String.fromCodePoint(0x200b)} Schneider AG`, 29: 'Order \u{1F600} Заказ' }),
];

const TOOL_CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ...[
    DE,
    CH,
    QR_IBAN,
    QR_IBAN_ALLOCATED,
    'DE89370400440532013001',
    'DE44999999990532013000',
    'CH8499999012345678901',
    'FR1499999000010123456789A42',
    'FR9620041010050500014M02606',
    'BE34539007548034',
    'ES6421000418450200051333',
    'IT68X0542811102000000123456',
    'GB29NWBK60161331926819',
    'DE43100110010532013000',
    'NL53ETPW0123456789',
    'ES9121000418450200051332',
    'IT60X0542811101000000123456',
    'XX89370400440532013000',
    'DE8937',
    'DEXX370400440532013000',
  ].map((iban) => ['validate_iban', { iban }] as const),
  [
    'batch_validate_iban',
    { ibans: [DE, 'FR1420041010050500013M02606', CH, 'DE89370400440532013001'] },
  ],
  ['lookup_bic', { bic: 'DEUTDEFF' }],
  // 29.10.2026 : l'adresse du siège, désormais servie par l'outil.
  ['lookup_bic', { bic: 'UBSWCHZH80A' }],
  ['lookup_bic', { bic: 'XXXXXX' }],
  ['lookup_bic', { bic: 'ZZZZDEZZ' }],
  ['check_compliance', { iban: DE }],
  ['check_compliance', { iban: 'DE44999999990532013000' }],
  ['check_compliance', { iban: 'DE89370400440532013001' }],
  // check_compliance recopie les étapes de validate_iban (29.10.2026).
  ['check_compliance', { iban: QR_IBAN_ALLOCATED }],
  ['validate_payment_reference', { reference: 'RF18539007547034', iban: CH }],
  ['validate_payment_reference', { reference: 'RF18539007547034', iban: QR_IBAN }],
  ['validate_payment_reference', { reference: '210000000003139471430009017', iban: CH }],
  ['validate_payment_reference', { reference: '+++090/9337/55493+++' }],
  ['validate_payment_reference', { reference: '1234567890', reference_type: 'kid' }],
  ['validate_payment_reference', { reference: 'NOT-A-REFERENCE' }],
  ['check_postal_address', { scheme: 'sps', address: { ctry: 'CH', adr_tp: 'ADDR' } }],
  [
    'check_postal_address',
    { scheme: 'sps', address: { twn_nm: 'Biel', ctry: 'CH', adr_line: ['Biel'] } },
  ],
  ['check_postal_address', { scheme: 'hvps_plus', address: { adr_line: ['Rue du Lac 1268'] } }],
  ['check_postal_address', { scheme: 'fedwire', address: { twn_nm: 'New York', ctry: 'US' } }],
  // Chaque état du bloc postcode_locality qui porte une phrase (29.10.2026).
  ...(
    [
      ['8001', 'Zurich', 'CH'],
      ['8001', 'Bern', 'CH'],
      ['9490', 'Vaduz', 'CH'],
      ['8238', 'Büsingen', 'CH'],
      ['2501', 'Biel', 'CH'],
      ['80011', 'Zürich', 'CH'],
    ] as const
  ).map(
    ([pst_cd, twn_nm, ctry]) =>
      ['check_postal_address', { scheme: 'sps', address: { pst_cd, twn_nm, ctry } }] as const,
  ),
  ...QR_PAYLOADS.map((payload) => ['check_swiss_qr_bill', { payload }] as const),
  ['lookup_ch_clearing', { iid: '230' }],
  // 29.10.2026 : la provenance du QR-IID, la phrase d'un QR-IID et celle d'une
  // fusion, désormais servies par l'outil, passent le crible des directives.
  ['lookup_ch_clearing', { iid: '702' }],
  ['lookup_ch_clearing', { iid: '30700' }],
  ['lookup_ch_clearing', { iid: '04835' }],
  // 29.10.2026 : la garantie de l'État et les notes de la BEKB, de la BCV et de
  // la BCGE passent le même crible.
  ['lookup_ch_clearing', { iid: '790' }],
  ['lookup_ch_clearing', { iid: '767' }],
  ['lookup_ch_clearing', { iid: '788' }],
  ['lookup_ch_clearing', { iid: '700' }],
  ['lookup_ch_clearing', { iid: '99999' }],
  ['lookup_ch_clearing', { iid: 'abc' }],
  [
    'send_feedback',
    { error_type: 'other', notes: 'crible des réponses', contact: 'acme@example.com' },
  ],
  ['nope', {}],
  ['validate_iban', {}],
];

async function approve(userCode: string, deny = false): Promise<void> {
  const app = new Hono();
  const { deviceGrant } = await import('./device-grant.js');
  app.route('/', deviceGrant);
  const lookup = await app.request('/v1/keys/device/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_code: userCode }),
  });
  expect(lookup.status, `lookup ${userCode}`).toBe(200);
  const { approval_token } = (await lookup.json()) as { approval_token: string };
  const res = await app.request(deny ? '/v1/keys/device/deny' : '/v1/keys/device/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_code: userCode, approval_token }),
  });
  expect(res.status, `${deny ? 'deny' : 'approve'} ${userCode}`).toBe(200);
}

interface Served {
  label: string;
  json: unknown;
}

/**
 * Tout ce qu'une adresse répond sur le jeu d'appels, chaque appel depuis une
 * adresse source neuve (l'allocation de la semaine ne coupe rien en route).
 * `n` sépare les adresses sources des trois chemins.
 */
async function serve(app: App, path: string, n: number): Promise<Served[]> {
  const out: Served[] = [];
  const add = (label: string, json: unknown) => out.push({ label, json });
  const tools = new Set<string>(
    path === '/mcp/chatgpt' ? CHATGPT_TOOLS : MCP_TOOLS.map((t) => t.name),
  );
  let id = 2;
  const call = async (sid: string, ip: string, name: string, args: Record<string, unknown>) =>
    body(
      await post(
        app,
        path,
        ip,
        { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } },
        sid,
      ),
    );

  const get = await app.request(path, { headers: { 'x-real-ip': `198.18.${n}.1` } });
  add(`GET ${get.status}`, await body(get));

  let k = 0;
  for (const [name, args] of TOOL_CALLS) {
    if (name !== 'nope' && !tools.has(name)) continue;
    const ip = `198.18.${n}.${10 + k++}`;
    add(
      `${name} ${JSON.stringify(args).slice(0, 60)}`,
      await call(await open(app, path, ip), ip, name, args),
    );
  }

  if (tools.has('request_api_key')) {
    const ip = `198.19.${n}.1`;
    const sid = await open(app, path, ip);
    add('poll sans demande', await call(sid, ip, 'poll_api_key', {}));
    const opened = (await call(sid, ip, 'request_api_key', { client_name: 'Société Alpha' })) as {
      result?: { structuredContent?: { user_code?: string } };
    };
    add('request ok', opened);
    add('poll en attente', await call(sid, ip, 'poll_api_key', {}));
    add('poll trop rapide', await call(sid, ip, 'poll_api_key', {}));
    add('poll code inconnu', await call(sid, ip, 'poll_api_key', { device_code: 'inconnu' }));
    await approve(opened.result!.structuredContent!.user_code!);
    add('poll approuvé', await call(sid, ip, 'poll_api_key', {}));
    add('poll après retrait', await call(sid, ip, 'poll_api_key', {}));
    const r2 = (await call(sid, ip, 'request_api_key', {})) as {
      result?: { structuredContent?: { user_code?: string } };
    };
    await approve(r2.result!.structuredContent!.user_code!, true);
    add('poll refusé', await call(sid, ip, 'poll_api_key', {}));
    const r3 = (await call(sid, ip, 'request_api_key', {})) as {
      result?: { structuredContent?: { user_code?: string } };
    };
    getStatsDB()
      .prepare(
        "UPDATE device_codes SET expires_at = datetime('now', '-1 minute') WHERE user_code = ?",
      )
      .run(r3.result!.structuredContent!.user_code!);
    add('poll expiré', await call(sid, ip, 'poll_api_key', {}));
    let last: unknown = null;
    for (let i = 0; i <= DAILY_KEY_CREATION_LIMIT; i++) {
      last = await call(sid, ip, 'request_api_key', {});
    }
    add('réseau plein', last);
  }

  // Une clé inconnue (l'adresse ChatGPT n'en lit aucune : l'appel y est servi).
  {
    const ip = `198.19.${n}.2`;
    const sid = await open(app, path, ip);
    add(
      'clé inconnue',
      await body(
        await post(
          app,
          path,
          ip,
          {
            jsonrpc: '2.0',
            id: id++,
            method: 'tools/call',
            params: { name: 'validate_iban', arguments: { iban: DE } },
          },
          sid,
          { Authorization: 'Bearer ifk_inconnue_acme_0000000000000000' },
        ),
      ),
    );
  }

  // Les refus.
  {
    const ip = `198.19.${n}.3`;
    add(
      'refus de la semaine',
      await call(await open(app, path, ip), ip, 'batch_validate_iban', {
        ibans: Array.from({ length: MCP_WEEKLY_LIMIT + 1 }, () => DE),
      }),
    );
  }
  {
    const ip = `198.19.${n}.4`;
    let last: unknown = null;
    for (let i = 0; i <= MCP_SESSIONS_PER_IP_DAY; i++) {
      last = await body(
        await post(app, path, ip, { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }),
      );
    }
    add('refus de session', last);
  }
  const lookup = {
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'validate_iban', arguments: { iban: DE } },
  };
  add(
    'session inconnue',
    await body(
      await post(app, path, `198.19.${n}.5`, lookup, '00000000-0000-0000-0000-000000000000'),
    ),
  );
  add('sans session', await body(await post(app, path, `198.19.${n}.5`, lookup)));
  const del = await app.request(path, {
    method: 'DELETE',
    headers: { 'x-real-ip': `198.19.${n}.5` },
  });
  add(`DELETE ${del.status}`, await body(del));
  return out;
}

// ── Les producteurs, en unitaire ─────────────────────────────────────────────

/** Le résultat minimal d'une validation, comme `next-steps.test.ts` le construit. */
function base(overrides: Record<string, unknown> = {}): IBANValidationResult {
  return {
    iban: 'XX00TEST',
    valid: true,
    country: { code: 'FR', name: 'France' },
    sepa: { member: true, schemes: ['SCT'], vop_required: true },
    cost_usdc: 0,
    ...overrides,
  } as unknown as IBANValidationResult;
}
const VERIFIED = {
  value: '30004',
  status: 'verified',
  match: 'register',
  register: 'Example register',
  authoritative: false,
  as_of: '2026-09',
};
const UNAVAILABLE = {
  value: '99999',
  status: 'unavailable',
  match: null,
  reason: 'absent_from_reference_data',
  register: 'Example register',
  authoritative: false,
  as_of: '2026-09',
};
const NATIONAL_FAIL = {
  country: 'FR',
  scheme: 'fr_rib_key',
  status: 'fail',
  detail: 'The key does not match: this account number cannot have been issued as written.',
};

/** Chaque code d'étape, chaque variante de sa phrase ou de son `because`. */
const STEP_CASES: ReadonlyArray<readonly [string, IBANValidationResult]> = [
  [
    'code refusé par le registre',
    base({
      bank_code_check: {
        ...UNAVAILABLE,
        status: 'not_in_register',
        reason: 'not_allocated',
        authoritative: true,
      },
    }),
  ],
  ['code non confirmé', base({ bank_code_check: UNAVAILABLE })],
  [
    'code non confirmé, registre UE',
    base({
      bank_code_check: UNAVAILABLE,
      psd_registration: {
        registered: true,
        entity_type: 'emi',
        name: 'Société Alpha',
        country: 'FR',
        competent_authority: 'ACPR',
        source: 'EBA register',
        as_of: '2026-09',
      },
    }),
  ],
  [
    'contrôle britannique',
    base({ bank_code_check: VERIFIED, modulus_check: { checked: true, passed: false } }),
  ],
  [
    'clé nationale fausse',
    base({ bank_code_check: VERIFIED, national_check_digits: NATIONAL_FAIL }),
  ],
  [
    'clé allemande douteuse',
    base({
      bank_code_check: VERIFIED,
      national_check_digits: {
        ...NATIONAL_FAIL,
        country: 'DE',
        scheme: 'de_pruefziffer',
        method: '13',
        verified_by: 'independent_implementation',
      },
    }),
  ],
  [
    'code radié avec successeur',
    base({
      bank_code_check: {
        ...VERIFIED,
        retired: true,
        retired_on: '2017-02-19',
        superseded_by: '03069',
      },
    }),
  ],
  [
    'code radié sans successeur',
    base({ bank_code_check: { ...VERIFIED, retired: true, retired_on: '2017-02-19' } }),
  ],
  [
    'code en retrait avec successeur',
    base({ bank_code_check: { ...VERIFIED, retired: true, superseded_by: '10020' } }),
  ],
  ['code en retrait sans successeur', base({ bank_code_check: { ...VERIFIED, retired: true } })],
  [
    'BIC parmi plusieurs',
    base({ bank_code_check: { ...VERIFIED, match: 'prefix', candidates: 3 } }),
  ],
  ['BIC de test', base({ bank_code_check: VERIFIED, risk_indicators: { test_bic: true } })],
  [
    'IBAN virtuel',
    base({
      bank_code_check: VERIFIED,
      issuer: { type: 'emi', name: 'Société Alpha', classification: 'curated' },
    }),
  ],
  [
    'émetteur inconnu',
    base({
      bank_code_check: VERIFIED,
      issuer: {
        type: 'bank',
        name: 'Société Alpha',
        classification: 'default',
        iban_issuer: 'not_listed',
      },
    }),
  ],
  ['code confirmé', base({ bank_code_check: VERIFIED })],
  [
    'code confirmé, détenteur déduit',
    base({ bank_code_check: VERIFIED, bank_code_holder: 'inferred' }),
  ],
  [
    'QR-IBAN',
    base({
      country: { code: 'CH', name: 'Switzerland' },
      bban: { bank_code: '30700', account_number: '123000889012' },
      bank_code_check: VERIFIED,
      clearing: {
        iid: '00700',
        name: 'Société Alpha',
        type: 'cantonal_bank',
        town: null,
        sic: true,
        instant_payments_chf: true,
        eurosic: true,
        qr_iid: '30700',
        qr_iid_source: 'register',
        is_qr_iid: true,
      },
    }),
  ],
];

/** Un IBAN dont les chiffres de contrôle ISO sont recalculés sur ce BBAN. */
function iso(country: string, bban: string): string {
  const digits = `${bban}${country}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return `${country}${String(98 - r).padStart(2, '0')}${bban}`;
}

/**
 * Un compte allemand de la méthode 13 qui la rate : l'avertissement, jamais le
 * refus. L'exemple du registre (0532013000) avec un seul chiffre changé.
 */
function germanSuspect(): string {
  const account = '0532013000';
  for (let i = 0; i < account.length; i++) {
    for (let d = 0; d <= 9; d++) {
      const twin = account.slice(0, i) + String(d) + account.slice(i + 1);
      const iban = iso('DE', `37040044${twin}`);
      const check = checkNationalKey(iban);
      if (check?.status === 'fail' && check.verified_by === 'independent_implementation')
        return iban;
    }
  }
  throw new Error('aucun compte de la méthode 13 qui échoue : le cas a changé');
}

/** Ce que les producteurs de src/lib/ servent, brut, hors des appels locaux. */
function produced(): Array<{ label: string; raw: unknown }> {
  const out: Array<{ label: string; raw: unknown }> = [];
  const add = (label: string, raw: unknown) => out.push({ label, raw });
  process.env.PARTNER_PAYQR = '1';
  for (const [label, r] of STEP_CASES) add(`étapes : ${label}`, { ...r, next_steps: nextSteps(r) });
  delete process.env.PARTNER_PAYQR;
  for (const [key, text] of Object.entries(DEVICE_TEXTS)) {
    // `opened` est la réponse de la route REST POST /v1/keys/device, jamais d'un outil.
    if (key !== 'opened') add(`device : ${key}`, { message: text });
  }
  add('display_to_human ok', {
    display_to_human: displayToHuman({
      status: 'ok',
      userCode: 'WDJB-MJHT',
      verificationUriComplete: 'https://ibanforge.com/device?code=WDJB-MJHT',
    }),
  });
  add('display_to_human réseau plein', {
    display_to_human: displayToHuman({ status: 'device_rate_limited' }),
  });
  add('display_to_human indisponible', {
    display_to_human: displayToHuman({ status: 'device_unavailable' }),
  });
  for (const payload of QR_PAYLOADS)
    add(`QR-facture ${payload.slice(0, 30)}`, checkSwissQrBill(payload));
  add('adresse : AdrTp fourni', checkPostalAddress('sps', { ctry: 'CH', adr_tp: 'ADDR' }));
  add(
    'adresse : ligne répétée',
    checkPostalAddress('sps', { twn_nm: 'Biel', ctry: 'CH', adr_line: ['Biel'] }),
  );
  add(
    'adresse : T2 sur ligne libre',
    checkPostalAddress('hvps_plus', { adr_line: ['Rue du Lac 1268'] }),
  );
  add('référence KID', validatePaymentReference('1234567890', 'kid'));
  add('référence OCR', validatePaymentReference('1234567890', 'ocr'));
  add('référence non reconnue', validatePaymentReference('NOT-A-REFERENCE', null));
  add('référence ambiguë', validatePaymentReference('090933755493', null));
  add('référence autre que demandée', validatePaymentReference('RF18539007547034', 'qrr'));
  add(
    'QRR sur IBAN ordinaire',
    buildReferenceCheck(validateIBAN(CH), '210000000003139471430009017', null),
  );
  add('SCOR sur QR-IBAN', buildReferenceCheck(validateIBAN(QR_IBAN), 'RF18539007547034', null));
  for (const iban of [
    'DE89 3704 0044 0532 0130 0X',
    'DE8937',
    'DE893704004405320130000000000000000000',
    'DEXX370400440532013000',
    'XX89370400440532013000',
    'DE89370400440532013001',
    iso('FR', '2004101005050001AM02606'),
    iso('DE', '3704004405320130A0'),
  ]) {
    add(`iban-core ${iban}`, validateIBAN(iban));
  }
  for (const iban of [
    'FR9620041010050500014M02606',
    'BE34539007548034',
    'IT68X0542811102000000123456',
    'ES6421000418450200051333',
    germanSuspect(),
  ]) {
    const r = validateIBAN(iban);
    enrichResult(r);
    add(`clé nationale ${iban}`, r);
  }
  // Les crédits des registres servis en production seulement (fichiers privés).
  add('registres privés', {
    register: [
      grRegisterName('2026-10', '2026-10-01'),
      eeRegisterName('credit_institutions', '2026-09-30', '2026-10-01'),
      eeRegisterName('payment_institutions', '2026-09-30', '2026-10-01'),
      meRegisterName('2026-10-01'),
      rsRegisterName('2026-09-30', '2026-10-01'),
    ],
    source: [
      eeBicSourceName('2026-10-01'),
      meCredit('2026-10-01'),
      rsCredit('2026-09-30', '2026-10-01'),
      curatedMapSource('SE'),
      curatedMapSource('SI'),
    ],
  });
  return out;
}

/** Les codes d'étape que `src/lib/next-steps.ts` sait émettre, lus dans son source. */
function stepCodesInSource(): Set<string> {
  const src = readFileSync(join(ROOT, 'src/lib/next-steps.ts'), 'utf8');
  return new Set([...src.matchAll(/\bcode: '([a-z_]+)'/g)].map((m) => m[1]!));
}

const REASONS: readonly PaywallCause['reason'][] = [
  'monthly_quota_exhausted',
  'monthly_quota_insufficient',
  'credits_exhausted',
  'credits_insufficient',
  'invalid_api_key',
  'key_revoked_burst',
  'trial_exhausted',
  'trial_unavailable',
];

afterEach(() => {
  delete process.env.PARTNER_PAYQR;
});

// ── Les tests ────────────────────────────────────────────────────────────────

describe('le crible des réponses ne passe pas pour rien', () => {
  it('il attrape ce que /mcp répond, et que les deux adresses répondaient', () => {
    const raw = produced();
    const flagged = (label: string) => {
      const item = raw.find((r) => r.label === label);
      expect(item, label).toBeDefined();
      return crib(item!.raw, label).hits;
    };
    for (const label of [
      'étapes : code refusé par le registre',
      'étapes : code non confirmé',
      'étapes : IBAN virtuel',
      'étapes : code confirmé',
      'étapes : code confirmé, détenteur déduit',
      'device : authorization_pending',
      'device : access_denied',
      'device : saved',
      'display_to_human ok',
      'référence KID',
      'QRR sur IBAN ordinaire',
    ]) {
      expect(flagged(label), label).not.toEqual([]);
    }
    // Les QR-factures : au moins une étape et un constat sont des consignes sur /mcp.
    const qrHits = raw
      .filter((r) => r.label.startsWith('QR-facture'))
      .flatMap((r) => crib(r.raw, r.label).hits);
    expect(qrHits.some((h) => h.includes('.next_steps['))).toBe(true);
    expect(qrHits.some((h) => h.includes('.detail'))).toBe(true);
  });

  it('il laisse les données et les passages exemptés, et rien de plus', () => {
    expect(
      crib(
        { name: 'Do not send Bank', address: 'Never Street 1', iban: 'DE89370400440532013000' },
        'données',
      ).hits,
    ).toEqual([]);
    expect(crib({ note: 'Do not send.' }, 'note').hits).not.toEqual([]);
    // Un mot de plus autour d'un passage exempté est lu.
    const quoted = 'Status: "N — Must not be sent"';
    expect(crib({ quoted }, 'exempté').hits).toEqual([]);
    expect(crib({ quoted: `${quoted} Call send_feedback.` }, 'exempté').hits).not.toEqual([]);
    // L'avertissement partagé n'est plus exempté (décision du 24.10.2026) : tel
    // que `/mcp` le sert, le crible le relève ; réécrit, il passe.
    const disclaimer = getComplianceMeta().disclaimer;
    expect(crib({ disclaimer }, 'avertissement').hits).not.toEqual([]);
    expect(crib({ disclaimer: directoryResponseText(disclaimer) }, 'avertissement').hits).toEqual(
      [],
    );
  });
});

describe.each([
  ['/mcp/directory', 1],
  ['/mcp/chatgpt', 2],
] as const)('%s — aucune consigne dans une réponse', (path, n) => {
  it('ni dans un outil, un refus, le device grant, une erreur, ni le GET', async () => {
    const served = await serve(buildApp(), path, n);
    const read = emptyRead();
    for (const { label, json } of served) crib(json, `${path} ${label}`, read);
    // Le crible lit bien chaque étage.
    const expected = ['do', 'because', 'message', 'note', 'detail', 'error_detail', 'source'];
    // La QR-facture (ses `next_steps` en phrases) et le device grant : pas sur ChatGPT.
    if (path === '/mcp/directory') expected.push('next_steps', 'display_to_human');
    for (const key of expected) expect(read.keys.has(key), `${path} : aucun ${key} lu`).toBe(true);
    expect(read.count).toBeGreaterThan(300);
    expect(read.hits, read.hits.join('\n')).toEqual([]);
  }, 60_000);

  it('chaque outil de l’adresse a été appelé', async () => {
    const tools = path === '/mcp/chatgpt' ? [...CHATGPT_TOOLS] : MCP_TOOLS.map((t) => t.name);
    const called = new Set(TOOL_CALLS.map(([name]) => name));
    if (path === '/mcp/directory') {
      called.add('request_api_key');
      called.add('poll_api_key');
    }
    for (const tool of tools) expect(called.has(tool), tool).toBe(true);
  });

  // Le crible vert ne prouve rien si l'étape a été filtrée en route : ici elle
  // doit être servie, avec sa phrase des répertoires, par validate_iban ET par
  // check_compliance, qui recopie toute la réponse de validate_iban (29.10.2026).
  it.each(['validate_iban', 'check_compliance'])(
    '%s sur un QR-IBAN attribué sert l’étape QR-IBAN avec sa phrase des répertoires',
    async (tool) => {
      const app = buildApp();
      const ip = `198.20.${n}.${tool === 'validate_iban' ? 1 : 2}`;
      const sid = await open(app, path, ip);
      const res = (await body(
        await post(
          app,
          path,
          ip,
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: tool, arguments: { iban: QR_IBAN_ALLOCATED } },
          },
          sid,
        ),
      )) as {
        result?: { structuredContent?: { next_steps?: NextStep[] }; content?: { text: string }[] };
      };
      const served = res.result?.structuredContent;
      const step = served?.next_steps?.find((s) => s.code === 'qr_iban_requires_qr_reference');
      expect(step, `${path} ${tool} : étape absente`).toBeDefined();
      expect(step!.do).toBe(directoryStepSentence(step!, served as never));
      expect(step!.do).not.toContain('pay it only');
      // Le bloc texte dit la même chose que structuredContent.
      expect(res.result?.content?.[0]?.text).toContain(step!.do);
      expect(crib(res, `${path} ${tool} QR-IBAN`).hits).toEqual([]);
    },
  );
});

describe('ce qu’un appel local n’atteint pas, en unitaire', () => {
  it('chaque code d’étape a sa phrase, et chacune de ses variantes passe le crible', () => {
    const raw = produced().filter((r) => r.label.startsWith('étapes : '));
    const codes = new Set<string>();
    const sentences = new Map<string, Set<string>>();
    for (const { label, raw: result } of raw) {
      const steps = (result as { next_steps: NextStep[] }).next_steps;
      for (const step of steps) {
        codes.add(step.code);
        if (step.code === 'generate_payment_qr') continue;
        const sentence = directoryStepSentence(step, result as never);
        expect(
          sentence,
          `${label} : ${step.code} sans phrase sur les adresses des répertoires`,
        ).toBeDefined();
        sentences.set(step.code, (sentences.get(step.code) ?? new Set()).add(sentence!));
      }
      const served = directoryResponse({
        ...(result as object),
        next_steps: directoryNextSteps(steps),
      });
      expect(crib(served, label).hits, label).toEqual([]);
      // Le renvoi du partenaire ne passe jamais sur ces adresses.
      expect(JSON.stringify(served)).not.toContain('generate_payment_qr');
    }
    // Chaque code que next-steps.ts sait émettre a été produit ici.
    expect([...codes].sort()).toEqual([...stepCodesInSource()].sort());
    // Et chaque variante a sa phrase à elle.
    expect(sentences.get('bank_code_retired')?.size).toBe(4);
    expect(sentences.get('verify_payee_name')?.size).toBe(2);
  });

  it('les textes du device grant, chaque refus d’une clé et chaque refus de l’adresse', () => {
    const found: string[] = [];
    for (const { label, raw } of produced().filter((r) =>
      /^(device|display_to_human)/.test(r.label),
    )) {
      found.push(...crib(directoryResponse(raw), label).hits);
    }
    for (const reason of REASONS) {
      for (const quota of [
        undefined,
        { used: 25, limit: 25, month: '2026-10', resets: '2026-11-01' },
      ]) {
        const payload = directoryKeyRefusalPayload({
          reason,
          detail: 'Buy a credit pack: $4 per 1,000 calls, or pay with x402 (USDC).',
          ...(quota ? { quota } : {}),
        });
        found.push(...crib(directoryResponse(payload), `clé ${reason}`).hits);
      }
    }
    for (const [label, text] of [
      ['semaine', directoryAllowanceRefusal(26, MCP_WEEKLY_LIMIT, '2026-10-26T00:00:00Z').message],
      ['comptabilité', DIRECTORY_ACCOUNTING_UNAVAILABLE],
      ['sessions', DIRECTORY_SESSION_REFUSAL],
      ['session inconnue', DIRECTORY_UNKNOWN_SESSION],
      ['sans session', DIRECTORY_NO_SESSION],
      ['GET', directoryEndpointMessage('connector directories')],
      [
        'semaine ChatGPT',
        chatgptAllowanceRefusal(26, MCP_WEEKLY_LIMIT, '2026-10-26T00:00:00Z').message,
      ],
      ['comptabilité ChatGPT', CHATGPT_ACCOUNTING_UNAVAILABLE],
      ['sessions ChatGPT', CHATGPT_SESSION_REFUSAL],
    ] as const) {
      found.push(...crib({ message: text }, label).hits);
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  it('les deux constats du 29.10.2026 sont bien dans le corpus, et passent tels quels', () => {
    const qrResults = produced()
      .filter((r) => r.label.startsWith('QR-facture'))
      .map((r) => r.raw as ReturnType<typeof checkSwissQrBill>);
    for (const code of ['qr_iban_chf_only_ig24', 'character_not_permitted']) {
      const findings = qrResults.flatMap((r) => r.findings).filter((f) => f.code === code);
      expect(findings.length, code).toBeGreaterThan(0);
      // Aucune réécriture ne les touche : le texte de /mcp passe déjà le crible.
      for (const f of findings) {
        expect(directoryResponse(f), code).toEqual(f);
        expect(crib(f, code).hits, code).toEqual([]);
      }
    }
  });

  it('les constats, notes et erreurs de src/lib/, et les crédits des registres privés', () => {
    const found = produced()
      .filter((r) => !/^(étapes|device|display_to_human)/.test(r.label))
      .flatMap(({ label, raw }) => crib(directoryResponse(raw), label).hits);
    expect(found, found.join('\n')).toEqual([]);
  });
});

describe('les réécritures des réponses', () => {
  it('chacune trouve son passage dans ce que /mcp et src/lib/ servent : aucune n’est périmée', async () => {
    const corpus = [
      ...(await serve(buildApp(), '/mcp', 3)).flatMap(({ json }) => strings(json)),
      ...produced().flatMap(({ raw }) => strings(raw)),
    ];
    for (const [from] of DIRECTORY_RESPONSE_EDITS) {
      const found =
        typeof from === 'string'
          ? corpus.some((t) => t.includes(from))
          : corpus.some((t) => new RegExp(from.source, from.flags.replace('g', '')).test(t));
      expect(found, `passage introuvable : ${String(from)}`).toBe(true);
    }
  }, 60_000);

  it('se réappliquent sans rien changer, et ne touchent pas aux données', () => {
    for (const { label, raw } of produced()) {
      const once = directoryResponse(raw);
      expect(directoryResponse(once), label).toEqual(once);
    }
    expect(directoryResponseText('Commerzbank, Frankfurt am Main')).toBe(
      'Commerzbank, Frankfurt am Main',
    );
  });
});
