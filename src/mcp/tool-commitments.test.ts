/**
 * Les phrases qui engagent, outil par outil, dans chaque copie du mode d'emploi.
 *
 * Décision de Claude-Alain du 19.11.2026 (« Surveiller plus de phrases ») : les
 * descriptions des onze outils sont écrites à la main dans trois programmes, et
 * jusque-là un contrôle n'en comparait que deux au caractère près (le device
 * grant, scripts/mcp-parity.test.ts) plus quelques phrases des autres. Les
 * retards trouvés le 18.11 étaient tous hors de ces contrôles. Ce fichier tient,
 * pour CHAQUE outil hébergé et dans chaque copie où il existe, les phrases dont
 * un agent tire une conduite :
 *   - ce qui n'est PAS vérifié (et la portée de l'outil) ;
 *   - où va la clé ;
 *   - le prix, lu dans l'inventaire (`MCP_TOOLS`), lui-même tenu égal à ce que
 *     le paywall x402 facture ;
 *   - les plafonds, lus dans les constantes que le code applique.
 *
 * Les copies, lues là où un agent les lit :
 *   A — le paquet npm `ibanforge-mcp` (mcp/src/index.ts). Lu dans sa source :
 *       la CI racine ne construit pas `mcp/dist`, et ses descriptions sont des
 *       chaînes sans interpolation, donc la source EST le texte servi (garde :
 *       ses trois descriptions identiques à celles de C se relisent égales) ;
 *   B — le serveur stdio embarqué, le « serveur de secours » (src/mcp/server.ts,
 *       `npm run mcp`), lancé pour de vrai comme le fait stdio-runtime.test.ts ;
 *   C — le service en ligne, https://api.ibanforge.com/mcp, `tools/list` servi ;
 *   D — l'adresse des répertoires, /mcp/directory, que le service en ligne sert
 *       aussi, avec ses propres mots et sans aucun prix (mcp-directory.test.ts).
 *
 * Une ligne par engagement, une cellule par copie. Les copies ne disent pas les
 * choses avec les mêmes mots (B écrit « Behavior: », D ne donne aucune consigne),
 * donc chaque cellule nomme SES fragments. Un fragment perdu, réécrit ou rendu
 * faux rougit sa cellule et nomme l'outil, l'engagement et la copie.
 *
 * Le paquet npm et le serveur embarqué sont figés tels quels (« rien à
 * publier ») : leurs retards connus ne sont pas corrigés ici, ils sont nommés
 * dans `KNOWN_LAGS`, phrase exacte à l'appui, et la ligne rougit le jour où la
 * copie rattrape, pour qu'on l'efface.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildApp } from '../app.js';
import { closeAll } from '../lib/db.js';
import { BANK_LEVEL_SANCTIONS, frozenBicShare } from '../lib/positioning.js';
import { MCP_WEEKLY_LIMIT } from '../lib/mcp-limits.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';
import { TRIAL_RESET } from '../lib/trial.js';
import {
  BATCH_MAX_IBANS,
  BATCH_PRICE_PER_IBAN,
  batchQuoteFor,
  buildRouteTable,
} from '../middleware/x402.js';
import {
  ALLOWANCE_EXEMPT_TOOLS,
  MCP_TOOLS,
  STDIO_ONLY_TOOLS,
  type InventoryTool,
} from './inventory.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const START_TIMEOUT_MS = 60_000;

type Copy = 'A' | 'B' | 'C' | 'D';
const COPY_NAMES: Record<Copy, string> = {
  A: 'paquet npm (mcp/src/index.ts)',
  B: 'serveur stdio embarqué (src/mcp/server.ts)',
  C: 'service en ligne (/mcp)',
  D: 'adresse des répertoires (/mcp/directory)',
};

interface ServedTool {
  name: string;
  description: string;
  inputSchema?: { properties?: Record<string, { maxItems?: number }> };
}
interface Served {
  instructions: string;
  tools: Map<string, ServedTool>;
}

// ── A : le paquet npm, lu dans sa source ────────────────────────────────────

/**
 * Une concaténation de chaînes (`'…' + "…" + …`), commentaires compris, lue à
 * partir de `from` jusqu'à la virgule qui ferme la propriété. Les gabarits à
 * interpolation ne sont pas lus : aucun outil de MCP_TOOLS n'en a dans le
 * paquet (seul `audit_creditor_file`, hors de ce fichier, en porte un).
 */
function readConcatenation(src: string, from: number, where: string): string {
  const LITERAL =
    /\s*(?:\/\/[^\n]*\n\s*)*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)\s*/y;
  const parts: string[] = [];
  let i = from;
  for (;;) {
    LITERAL.lastIndex = i;
    const m = LITERAL.exec(src);
    if (!m) throw new Error(`${where} : la description n'est plus une concaténation de chaînes`);
    parts.push(m[1].slice(1, -1).replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c)));
    i = LITERAL.lastIndex;
    if (src[i] !== '+') break;
    i += 1;
  }
  return parts.join('');
}

/** Le bloc de chaque outil du tableau `TOOLS` du paquet, et sa description. */
function npmServed(): Served {
  const src = read('mcp/src/index.ts');
  const start = src.indexOf('const TOOLS: Tool[] = [');
  const end = src.indexOf('\n];', start);
  if (start === -1 || end === -1) throw new Error('mcp/src/index.ts : tableau TOOLS introuvable');
  const body = src.slice(start, end);
  const heads = [...body.matchAll(/^ {4}name: '([a-z_]+)',$/gm)];
  const hosted = new Set(MCP_TOOLS.map((t) => t.name));
  const tools = new Map<string, ServedTool>();
  heads.forEach((head, i) => {
    // Les deux outils réservés au paquet (STDIO_ONLY_TOOLS) ne sont pas lus ici.
    if (!hosted.has(head[1])) return;
    const block = body.slice(head.index, heads[i + 1]?.index ?? body.length);
    const at = block.indexOf('description:');
    const maxItems = block.match(/maxItems: (\d+),/)?.[1];
    tools.set(head[1], {
      name: head[1],
      description: readConcatenation(block, at + 'description:'.length, head[1]),
      inputSchema: maxItems ? { properties: { ibans: { maxItems: Number(maxItems) } } } : {},
    });
  });
  return { instructions: read('mcp/src/stdio-instructions.ts'), tools };
}

// ── B : le serveur stdio embarqué, lancé ────────────────────────────────────

let stdio: Client | undefined;
async function stdioServed(): Promise<Served> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'src/mcp/server.ts')],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), STATS_DB_PATH: process.env.STATS_DB_PATH as string },
    stderr: 'pipe',
  });
  stdio = new Client({ name: 'ibanforge-tool-commitments', version: '0.0.0' });
  await stdio.connect(transport);
  const { tools } = await stdio.listTools();
  return {
    instructions: stdio.getInstructions() ?? '',
    tools: new Map(tools.map((t) => [t.name, t as unknown as ServedTool])),
  };
}

// ── C et D : le service en ligne, servi par l'application ───────────────────

const app = buildApp();
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;

async function rpcBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const frame = text.match(/^data:\s*(\{.*\})$/m);
  return JSON.parse(frame ? frame[1] : text) as Record<string, unknown>;
}

async function httpServed(path: string, ip: string): Promise<Served> {
  const post = (body: unknown, sid?: string) =>
    app.request(path, {
      method: 'POST',
      headers: { ...HEADERS, 'x-real-ip': ip, ...(sid ? { 'mcp-session-id': sid } : {}) },
      body: JSON.stringify(body),
    });
  const opened = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest-tool-commitments', version: '1.0.0' },
    },
  });
  const sid = opened.headers.get('mcp-session-id') ?? undefined;
  const init = (await rpcBody(opened)).result as { instructions: string };
  const listed = (await rpcBody(await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid)))
    .result as { tools: ServedTool[] };
  return { instructions: init.instructions, tools: new Map(listed.tools.map((t) => [t.name, t])) };
}

const SERVED = {} as Record<Copy, Served>;
beforeAll(async () => {
  SERVED.A = npmServed();
  SERVED.B = await stdioServed();
  SERVED.C = await httpServed('/mcp', '198.18.11.1');
  SERVED.D = await httpServed('/mcp/directory', '198.18.11.2');
}, START_TIMEOUT_MS);

afterAll(async () => {
  await stdio?.close();
  closeAll();
});

// ── La table ────────────────────────────────────────────────────────────────

type Kind = 'non vérifié' | 'portée' | 'clé' | 'prix' | 'plafond';

interface Commitment {
  tool: string;
  kind: Kind;
  /** L'engagement, en mots. Il nomme la ligne dans `KNOWN_LAGS`. */
  what: string;
  /** Les fragments que chaque copie doit porter, mot pour mot. */
  says: Partial<Record<Copy, readonly string[]>>;
  /** Ce qu'aucune copie ne doit dire. */
  never?: RegExp;
  /** Lu dans la ligne du prix seulement : de « COST: » (« Cost: » pour B) à la fin. */
  inCostLine?: boolean;
}

/** Le même fragment dans les quatre copies. */
const all = (...f: string[]): Record<Copy, readonly string[]> => ({ A: f, B: f, C: f, D: f });

const priceOf = (name: string): InventoryTool['price'] => {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} n'est pas dans l'inventaire`);
  return tool.price;
};

/**
 * Le prix de chaque outil, écrit par chaque copie à sa façon, à partir du seul
 * prix de l'inventaire. D n'a aucun prix, par construction (mcp-directory.test.ts).
 */
function priceRow(tool: InventoryTool): Commitment {
  const base = { tool: tool.name, kind: 'prix' as const };
  if (ALLOWANCE_EXEMPT_TOOLS.has(tool.name)) {
    const f = ['This tool is free'];
    return { ...base, what: 'gratuit', says: { A: f, B: f, C: f } };
  }
  if (tool.price === 'free') {
    return {
      ...base,
      what: 'gratuit',
      inCostLine: true,
      // Faux pour la référence de paiement : avec un IBAN, le paquet facture.
      ...(tool.name === 'validate_payment_reference' ? { never: /on every surface/ } : {}),
      says: {
        A: [
          'COST: free',
          // Le paquet envoie l'appel AVEC un IBAN à POST /v1/iban/validate : il
          // le facture comme une validation, et le dit. C ne dit plus « on
          // every surface » depuis le 19.11.2026.
          ...(tool.name === 'validate_payment_reference'
            ? [
                `WITH an iban it is routed to POST /v1/iban/validate and costs ${String(priceOf('validate_iban'))} USDC`,
              ]
            : []),
        ],
        B: ['Cost: free.'],
        // « , on every surface » suit encore ce prix pour l'adresse postale et
        // la QR-facture, où c'est vrai : le paquet les envoie à leurs routes
        // gratuites.
        C: ['COST: $0 per call'],
      },
    };
  }
  const p = tool.price;
  const perIban = tool.name === 'batch_validate_iban';
  return {
    ...base,
    what: `${p} USDC ${perIban ? 'par IBAN' : 'par appel'}`,
    inCostLine: true,
    says: {
      A: [`${p} USDC${perIban ? ' per IBAN' : ''}`],
      B: [`Cost: $${p} USDC per ${perIban ? 'IBAN' : 'call'} via x402`],
      C: [perIban ? `COST: $${p} USDC per IBAN via x402.` : `COST: $${p} per call.`],
    },
  };
}

const FROZEN_MONTH = frozenBicShare().month;

/** Les engagements écrits, outil par outil. Les prix sont ajoutés depuis l'inventaire. */
const WRITTEN: readonly Commitment[] = [
  // validate_iban
  {
    tool: 'validate_iban',
    kind: 'non vérifié',
    what: "ni l'existence du compte ni son titulaire",
    says: {
      A: [
        'it does not confirm that the account exists, is open, or belongs to any particular person',
      ],
      B: ['payee_name, account_exists and payee_sanctions are always not_checked'],
      C: [
        'it does not confirm that the account exists, is open, or belongs to any particular person',
        'payee_name, account_exists and payee_sanctions are always not_checked',
      ],
      D: [
        'the answer does not establish that the account exists, is open or belongs to a given person',
        'payee_name, account_exists and payee_sanctions are not_checked in every answer',
      ],
    },
  },
  {
    tool: 'validate_iban',
    kind: 'non vérifié',
    what: 'hors registre national, le BIC est indicatif',
    says: {
      A: ['outside a national_register pairing the BIC is advisory'],
      B: ['Outside that basis the BIC is ADVISORY'],
      C: ['outside a national_register pairing the BIC is advisory'],
      D: ['outside a national_register pairing the BIC is advisory'],
    },
  },
  {
    tool: 'validate_iban',
    kind: 'non vérifié',
    what: 'une absence de BIC ne dit pas que le code est faux',
    says: {
      A: ['whether the code is denied by a register or whether we simply could not answer'],
      B: ['IMPORTANT — bic: null does not mean the bank code is wrong.'],
      C: ['IMPORTANT — bic: null does not mean the bank code is wrong.'],
      D: ['bic: null does not by itself mean the bank code is wrong'],
    },
  },
  // batch_validate_iban
  {
    tool: 'batch_validate_iban',
    kind: 'plafond',
    what: 'un IBAN du lot compte pour un',
    says: {
      A: ['one request or one credit per IBAN'],
      B: ['1 quota request / 1 prepaid credit per IBAN'],
      C: ['each IBAN uses one request or credit'],
      D: ['Each IBAN counts as one unit'],
    },
  },
  {
    tool: 'batch_validate_iban',
    kind: 'plafond',
    what: `au plus ${BATCH_MAX_IBANS} IBAN par lot`,
    says: all(`up to ${BATCH_MAX_IBANS} IBANs`),
  },
  {
    tool: 'batch_validate_iban',
    kind: 'prix',
    what: "le rabais par IBAN n'existe qu'en USDC par x402",
    says: {
      A: ['Paid per call in USDC via x402'],
      B: ['USDC per IBAN via x402'],
      C: ['Paid per call in USDC via x402'],
    },
    never: /\d+\s*%\s*(?:cheaper|lower|off)/i,
  },
  // lookup_bic
  {
    tool: 'lookup_bic',
    kind: 'non vérifié',
    what: "une partie de l'annuaire est une copie figée",
    says: all(`a public copy of the SWIFT directory frozen in ${FROZEN_MONTH}`),
  },
  // check_compliance
  {
    tool: 'check_compliance',
    kind: 'non vérifié',
    what: 'jamais le nom du bénéficiaire, seulement sa banque',
    says: {
      A: [BANK_LEVEL_SANCTIONS, "the name check itself is done by the payee's bank, never here"],
      B: [
        "It never screens the payee's name.",
        'it does NOT screen the beneficiary/account-holder name',
        'payee_screened is always false',
      ],
      C: [
        BANK_LEVEL_SANCTIONS,
        "the name check itself is done by the payee's bank, never here",
        'payee_screened is always false',
      ],
      D: [
        "the name check itself belongs to the payee's bank and is not made here",
        'payee_screened is false in every answer',
      ],
    },
  },
  {
    tool: 'check_compliance',
    kind: 'non vérifié',
    what: 'pas un produit réglementé de lutte contre le blanchiment',
    says: {
      A: ['NOT A REGULATED AML/CFT PRODUCT'],
      B: ['not a substitute for KYC/AML name screening'],
      C: ['NOT A REGULATED AML/CFT PRODUCT'],
      D: ['not a regulated AML/CFT screening product'],
    },
  },
  // validate_payment_reference
  {
    tool: 'validate_payment_reference',
    kind: 'non vérifié',
    what: 'KID norvégien et OCR suédois reconnus, jamais jugés',
    says: all('valid: null with status', 'unverifiable_without_creditor_config'),
  },
  {
    tool: 'validate_payment_reference',
    kind: 'non vérifié',
    what: 'somme de contrôle et appariement sont deux verdicts',
    says: {
      A: ['valid and pairing are INDEPENDENT'],
      B: ['valid and pairing are INDEPENDENT'],
      C: ['valid and pairing are INDEPENDENT'],
      D: ['valid and pairing are independent'],
    },
  },
  // check_swiss_qr_bill
  {
    tool: 'check_swiss_qr_bill',
    kind: 'non vérifié',
    what: "sans avertissement, la paire code postal et localité n'est pas vérifiée pour autant",
    says: all('the absence of a warning does not mean the pair was verified'),
  },
  {
    tool: 'check_swiss_qr_bill',
    kind: 'portée',
    what: 'ne dit rien de la banque du compte',
    says: {
      A: ['that is the paid validate_iban'],
      B: ['that is the paid validate_iban'],
      C: ['that is the paid validate_iban'],
      D: [
        'the bank holding the account and its payment-rail participation are not part of this answer',
      ],
    },
  },
  // check_postal_address
  {
    tool: 'check_postal_address',
    kind: 'non vérifié',
    what: "aucune rue n'est cherchée",
    says: {
      A: [
        'the findings check conformity with the message format rules, and no street is looked up',
      ],
      B: [
        'the findings check conformity with the message format rules, and no street is looked up',
      ],
      C: [
        'the findings check conformity with the message format rules, and no street is looked up',
      ],
      D: ['The street and the building number are not checked.'],
    },
  },
  {
    tool: 'check_postal_address',
    kind: 'non vérifié',
    what: 'le code postal et la localité ne changent pas le verdict',
    says: {
      A: ['informative, without effect on conforms'],
      B: ['it is informative and does not change conforms'],
      C: ['it is informative and does not change conforms'],
      D: ['it is informative and leaves conforms unchanged'],
    },
  },
  {
    tool: 'check_postal_address',
    kind: 'non vérifié',
    what: 'une règle non applicable ne vaut pas réussite',
    says: {
      A: ['never counts as a pass'],
      B: ['never counts as a pass'],
      C: ['never counts as a pass'],
      D: ['does not count as a pass'],
    },
  },
  {
    tool: 'check_postal_address',
    kind: 'non vérifié',
    what: 'pas de schéma CBPR+, faute de document lisible',
    says: {
      A: ["deliberately NO 'cbpr+' scheme"],
      B: ["deliberately NO 'cbpr+' scheme"],
      C: ["deliberately NO 'cbpr+' scheme"],
      D: ["deliberately no 'cbpr+' scheme"],
    },
  },
  // lookup_ch_clearing
  {
    tool: 'lookup_ch_clearing',
    kind: 'portée',
    what: 'la Suisse et le Liechtenstein seulement',
    says: {
      A: ['Only relevant for CH and LI accounts'],
      B: ['for non-Swiss IBANs, use validate_iban instead'],
      C: ['Only relevant for CH and LI accounts'],
      D: ['Relevant to CH and LI accounts only'],
    },
  },
  // send_feedback, request_api_key, poll_api_key : hors de l'allocation sans clé
  ...[...ALLOWANCE_EXEMPT_TOOLS].map((tool): Commitment => ({
    tool,
    kind: 'plafond',
    what: "ne compte pas dans l'allocation sans clé",
    says: {
      A: ['does NOT count against the free allowance'],
      B: ['does NOT count against the free allowance'],
      C: ['does NOT count against the free allowance'],
      D: ['does not count against the keyless allowance'],
    },
  })),
  {
    tool: 'send_feedback',
    kind: 'portée',
    what: 'un humain lit chaque rapport',
    says: all('A human reads every report'),
  },
  {
    tool: 'request_api_key',
    kind: 'clé',
    what: 'la clé ne sert pas à la session en cours',
    says: {
      A: ['The key does not unlock this session'],
      B: ['The key does not unlock this session'],
      C: ['The key does not unlock this session'],
      D: ['The key does not change the current session'],
    },
  },
  {
    tool: 'request_api_key',
    kind: 'clé',
    what: "où va la clé : l'en-tête, la section en bêta de Claude, pas ChatGPT",
    says: all(
      '"Authorization: Bearer <key>"',
      'Request headers',
      'a beta section Anthropic does not show to every account',
      'removed and added again to take a key',
      'ChatGPT sends no key to a connector',
    ),
  },
  {
    tool: 'request_api_key',
    kind: 'clé',
    what: 'la ligne de configuration rendue par poll_api_key',
    says: {
      A: ['`config_line` (returned by poll_api_key)'],
      B: ['`config_line` (returned by poll_api_key)'],
      C: ['`config_line` (returned by poll_api_key)'],
      D: ['the config_line poll_api_key returns'],
    },
  },
  {
    tool: 'poll_api_key',
    kind: 'clé',
    what: "la clé, remise une seule fois, va dans l'en-tête",
    says: {
      A: ['"Authorization: Bearer <key>"', 'carries the key ONCE'],
      B: ['"Authorization: Bearer <key>"', 'carries the key ONCE'],
      C: ['"Authorization: Bearer <key>"', 'carries the key ONCE'],
      D: ['"Authorization: Bearer <key>"', 'carries the key and config_line, once'],
    },
  },
];

const COMMITMENTS: readonly Commitment[] = [...WRITTEN, ...MCP_TOOLS.map(priceRow)];

/**
 * Les retards connus des copies figées, une phrase exacte chacun. Aucun ne vit
 * sur le service en ligne (C, D) : là, une dérive se corrige.
 */
const KNOWN_LAGS: ReadonlyArray<{
  copy: Copy;
  tool: string;
  what: string;
  /** Ce que la copie dit à la place, ou `null` si elle n'en dit rien. */
  says: string | null;
  since: string;
  why: string;
}> = [
  {
    copy: 'A',
    tool: 'check_swiss_qr_bill',
    what: "sans avertissement, la paire code postal et localité n'est pas vérifiée pour autant",
    says: null,
    since: '2026-11-19',
    why:
      'Le paragraphe du répertoire des localités de swisstopo est entré dans B, C et D, pas dans la ' +
      'description du paquet, qui relaie pourtant POST /v1/ch/qr-bill/check et donc le bloc ' +
      'postcode_locality. Paquet figé jusqu’à sa prochaine version.',
  },
  {
    copy: 'B',
    tool: 'batch_validate_iban',
    what: "le rabais par IBAN n'existe qu'en USDC par x402",
    says: 'at 60% lower cost per IBAN',
    since: '2026-11-19',
    why:
      'Le paquet et le service en ligne ont retiré « 60% » le 24.09.2026 (sur une clé, un IBAN du lot ' +
      'coûte un crédit, comme une validation). Le serveur embarqué le garde dans sa première phrase, ' +
      'même si sa ligne de prix dit bien x402.',
  },
];

/** Les copies où chaque ligne doit être lue : toutes, sauf D pour un prix. */
const copiesOf = (c: Commitment): Copy[] =>
  c.kind === 'prix' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];

function costLine(text: string, copy: Copy): string {
  const at = text.lastIndexOf(copy === 'B' ? 'Cost:' : 'COST:');
  return at === -1 ? '' : text.slice(at);
}

/** Ce qui manque à une copie pour tenir une ligne ; vide quand elle la tient. */
function gaps(c: Commitment, copy: Copy): string[] {
  const tool = SERVED[copy].tools.get(c.tool);
  if (!tool) return [`${c.tool} absent`];
  const text = c.inCostLine ? costLine(tool.description, copy) : tool.description;
  const out = (c.says[copy] ?? []).filter((f) => !text.includes(f)).map((f) => `manque « ${f} »`);
  const bad = c.never ? text.match(c.never) : null;
  if (bad) out.push(`dit « ${bad[0]} »`);
  return out;
}

const lagOf = (c: Commitment, copy: Copy) =>
  KNOWN_LAGS.find((l) => l.copy === copy && l.tool === c.tool && l.what === c.what);

const CELLS = COMMITMENTS.flatMap((c) =>
  copiesOf(c).map((copy) => ({ ...c, copy, label: `${c.tool} · ${c.kind} · ${c.what}` })),
);

describe('les phrases qui engagent, outil par outil, dans chaque copie', () => {
  it('chaque outil hébergé a un prix et au moins un autre engagement, chaque ligne lit toutes ses copies', () => {
    for (const tool of MCP_TOOLS) {
      const rows = COMMITMENTS.filter((c) => c.tool === tool.name);
      expect(rows.filter((c) => c.kind === 'prix').length, `${tool.name} : prix`).toBeGreaterThan(
        0,
      );
      expect(
        rows.filter((c) => c.kind !== 'prix').length,
        `${tool.name} : engagements`,
      ).toBeGreaterThan(0);
    }
    for (const c of COMMITMENTS) {
      expect(
        MCP_TOOLS.map((t) => t.name),
        c.tool,
      ).toContain(c.tool);
      expect(Object.keys(c.says).sort(), `${c.tool} · ${c.what}`).toEqual(copiesOf(c));
      for (const copy of copiesOf(c))
        expect(c.says[copy]?.length, `${c.tool} · ${copy}`).toBeGreaterThan(0);
    }
  });

  it('chaque copie sert les onze outils, et le paquet se lit tel qu’il est servi', () => {
    for (const copy of ['A', 'B', 'C', 'D'] as const) {
      for (const tool of MCP_TOOLS) {
        const served = SERVED[copy].tools.get(tool.name);
        expect(
          served?.description.length ?? 0,
          `${COPY_NAMES[copy]} : ${tool.name}`,
        ).toBeGreaterThan(200);
      }
    }
    // Garde de l'extracteur de A : trois descriptions que C sert au caractère
    // près (scripts/mcp-parity.test.ts) se relisent égales depuis la source.
    for (const name of ['send_feedback', 'request_api_key', 'poll_api_key']) {
      expect(SERVED.A.tools.get(name)?.description, name).toBe(
        SERVED.C.tools.get(name)?.description,
      );
    }
  });

  it.each(CELLS)('$label — copie $copy', (cell) => {
    const lag = lagOf(cell, cell.copy);
    const missing = gaps(cell, cell.copy);
    if (lag) {
      expect(
        missing,
        `${COPY_NAMES[cell.copy]} tient désormais cet engagement : retirer la ligne de KNOWN_LAGS`,
      ).not.toEqual([]);
      if (lag.says) {
        expect(SERVED[cell.copy].tools.get(cell.tool)?.description).toContain(lag.says);
      }
      return;
    }
    expect(missing, `${COPY_NAMES[cell.copy]} : ${missing.join(' ; ')}`).toEqual([]);
  });

  it.each(KNOWN_LAGS)(
    'retard nommé ($copy, $tool, depuis le $since) : il désigne une vraie ligne',
    (lag) => {
      const row = COMMITMENTS.find((c) => c.tool === lag.tool && c.what === lag.what);
      expect(row, 'aucune ligne de la table ne porte cet engagement').toBeDefined();
      expect(copiesOf(row!)).toContain(lag.copy);
      // Le service en ligne ne vit pas avec un retard : il se corrige.
      expect(['A', 'B']).toContain(lag.copy);
    },
  );
});

describe('le prix vient de ce qui facture, le plafond du lot de ce que la route applique', () => {
  const table = buildRouteTable(
    '0x0000000000000000000000000000000000000001',
    'POST',
    '/v1/iban/validate',
  );
  const routeKey = (restRoute: string) => restRoute.replace(/\{(\w+)\}/g, ':$1');

  it.each(MCP_TOOLS.filter((t) => typeof t.price === 'number'))(
    '$name : le prix de l’inventaire est celui du paywall x402',
    (tool) => {
      const route = table[routeKey(tool.restRoute)] as
        { accepts?: { price?: unknown } } | undefined;
      expect(route, `${tool.restRoute} n'est pas payant`).toBeDefined();
      const price = route!.accepts?.price;
      if (typeof price === 'function') {
        // Le lot : un prix par IBAN, coté sur le corps de la requête.
        expect(BATCH_PRICE_PER_IBAN).toBe(tool.price);
        expect(batchQuoteFor({ ibans: ['DE89370400440532013000'] })).toBe(
          `$${(tool.price as number).toFixed(3)}`,
        );
      } else {
        expect(price).toBe(`$${String(tool.price)}`);
      }
    },
  );

  it.each(MCP_TOOLS.filter((t) => t.price === 'free'))(
    '$name : gratuit dans l’inventaire, sa route n’a pas de paywall',
    (tool) => {
      const [methods, path] = tool.restRoute.split(' ');
      for (const method of methods.split('|')) {
        expect(table[`${method} ${routeKey(path)}`], `${method} ${path}`).toBeUndefined();
      }
    },
  );

  it('le lot accepte au plus BATCH_MAX_IBANS IBAN, dans chaque copie', () => {
    for (const copy of ['A', 'B', 'C', 'D'] as const) {
      const batch = SERVED[copy].tools.get('batch_validate_iban');
      expect(batch?.inputSchema?.properties?.ibans?.maxItems, COPY_NAMES[copy]).toBe(
        BATCH_MAX_IBANS,
      );
    }
  });
});

describe('où va la clé, dit une fois au branchement', () => {
  it.each([
    ['A', 'Configure a saved key as IBANFORGE_API_KEY and reconnect this MCP server'],
    [
      'A',
      'a key sent to it in the Authorization header is counted there exactly as on the REST API',
    ],
    ['B', 'send that key as "Authorization: Bearer ifk_..." (or X-API-Key) on every request'],
    ['C', 'send that key as "Authorization: Bearer ifk_..." (or X-API-Key) on every request'],
    ['D', 'sent as "Authorization: Bearer ifk_..." (or X-API-Key), are counted on that key'],
  ] as const)('copie %s : « %s »', (copy, fragment) => {
    expect(SERVED[copy].instructions).toContain(fragment);
  });
});

// ── La notice : README.md et mcp/README.md ──────────────────────────────────

/** Le texte sans ses retours à la ligne : la notice coupe ses phrases à 100 colonnes. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** Les lignes du tableau qui suit le titre `## Tools` : nom de l'outil → cellule du prix. */
function toolsTable(rel: string): Map<string, string> {
  const text = read(rel);
  const start = text.indexOf('\n## Tools\n');
  if (start === -1) throw new Error(`${rel} : pas de titre « ## Tools »`);
  const rows = new Map<string, string>();
  for (const line of text.slice(start).split('\n').slice(2)) {
    if (line.startsWith('## ')) break;
    const cells = line.split('|').map((c) => c.trim());
    const name = cells[1]?.match(/^`([a-z_]+)`$/)?.[1];
    if (name) rows.set(name, cells[cells.length - 2]);
  }
  return rows;
}

describe('la notice tient les mêmes faits', () => {
  const NOTICES = [
    { rel: 'README.md', tools: MCP_TOOLS.map((t) => t.name), dollar: true },
    {
      rel: 'mcp/README.md',
      tools: [...MCP_TOOLS.map((t) => t.name), ...STDIO_ONLY_TOOLS],
      dollar: false,
    },
  ];

  it.each(NOTICES)(
    '$rel : le tableau des outils nomme chaque outil, et lui seul',
    ({ rel, tools }) => {
      expect([...toolsTable(rel).keys()].sort()).toEqual([...tools].sort());
    },
  );

  it.each(NOTICES)('$rel : chaque prix du tableau est celui de l’inventaire', ({ rel, dollar }) => {
    const table = toolsTable(rel);
    for (const tool of MCP_TOOLS) {
      const cell = table.get(tool.name) ?? '';
      if (tool.price === 'free') expect(cell, `${rel} · ${tool.name}`).toMatch(/\bfree\b/i);
      else
        expect(cell, `${rel} · ${tool.name}`).toContain(
          `${dollar ? '$' : ''}${String(tool.price)}`,
        );
    }
    for (const name of STDIO_ONLY_TOOLS) {
      if (table.has(name)) expect(table.get(name), `${rel} · ${name}`).toMatch(/\bfree\b/i);
    }
  });

  it('README.md : les plafonds sont ceux que le code applique', () => {
    const text = flat(read('README.md'));
    for (const fragment of [
      `${MCP_WEEKLY_LIMIT} tool units a week per source address, one per tool call and one per IBAN in a batch, reset on ${TRIAL_RESET}`,
      `a key that needs no e-mail: ${ANONYMOUS_MONTHLY_LIMIT} requests a month, raised to ${FREE_TIER_MONTHLY_LIMIT} a month once claimed`,
      `Up to ${BATCH_MAX_IBANS} IBANs in one call`,
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it('mcp/README.md : sans chiffre de quota, elle renvoie aux clés que rate-limits.yml sert vraiment', async () => {
    const text = flat(read('mcp/README.md'));
    const res = await app.request('https://api.ibanforge.com/.well-known/rate-limits.yml');
    expect(res.status).toBe(200);
    const served = await res.text();
    for (const key of ['mcp_anonymous', 'rest_anonymous_trial', 'anonymous_key', 'free_tier']) {
      expect(text, `la notice ne cite plus ${key}`).toContain(`\`${key}\``);
      expect(served, `rate-limits.yml ne sert plus ${key}`).toMatch(
        new RegExp(`^\\s*${key}:`, 'm'),
      );
    }
    expect(text).toContain('a batch counting one per IBAN');
    expect(text).toContain('each IBAN in a batch counts as one unit');
    expect(text).toContain(`Validate up to ${BATCH_MAX_IBANS} IBANs in one call`);
  });

  it.each([
    ['README.md', 'set `IBANFORGE_API_KEY=ifk_...` in `env`'],
    ['README.md', 'Authorization: Bearer ifk_your_key'],
    [
      'README.md',
      'With a key (`Authorization: Bearer` or `X-API-Key`), the tool calls count against that key exactly as on the REST API',
    ],
    ['README.md', 'a beta Anthropic does not open to every account'],
    ['README.md', 'an existing connector is removed and created again to take a key'],
    ['README.md', 'ChatGPT sends no key to a connector'],
    ['README.md', 'the npm package ibanforge-mcp reads it from IBANFORGE_API_KEY'],
    ['mcp/README.md', "add it as `IBANFORGE_API_KEY` in the MCP server's `env` object"],
    [
      'mcp/README.md',
      'With a key sent as `Authorization: Bearer ifk_...` (or `X-API-Key`), tool calls count against that key exactly as on the REST API',
    ],
    ['mcp/README.md', 'A key in the URL is not read.'],
    ['mcp/README.md', 'add the key under **Request headers**'],
    ['mcp/README.md', 'Anthropic keeps it in beta and does not open it to every account'],
    ['mcp/README.md', 'An existing connector is removed and added again to take a key.'],
    ['mcp/README.md', 'ChatGPT sends no key to a connector'],
  ] as const)('%s dit où va la clé : « %s »', (rel, fragment) => {
    expect(flat(read(rel))).toContain(fragment);
  });
});
