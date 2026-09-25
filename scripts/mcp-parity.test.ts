/**
 * Les trois surfaces MCP exposent-elles le même produit ?
 *
 * ## Ce qu'il fallait savoir avant d'écrire ce fichier (audit B3, 20/08/2026)
 *
 * IBANforge n'a pas deux transports MCP, il en a TROIS :
 *   A — mcp/src/index.ts        → npm `ibanforge-mcp`, registre MCP, Docker Glama
 *   B — src/mcp/server.ts       → `npm run mcp`, dist/mcp/server.js, smithery.yaml
 *   C — src/routes/mcp-http.ts  → https://api.ibanforge.com/mcp
 *
 * A et B exposaient 5 outils, C en exposait 6 : `send_feedback` n'existait que
 * sur le transport HTTP — c'est-à-dire pas sur le canal de distribution
 * principal, npm. L'agent qui s'y heurtait au mur du quota ou au préfinancement
 * x402 n'avait aucun moyen de dire « je n'ai pas pu vous payer ». Décision prise
 * le 21/08/2026 : généraliser aux trois. Les trois sont donc à 6.
 *
 * Deux tests VERTS encodaient jusque-là des contrats contradictoires :
 * `mcp/src/index.test.ts` affirmait 5 outils, `src/routes/mcp-http.test.ts` en
 * affirmait 6, et aucun ne regardait l'autre. Chacun avait raison sur son
 * fichier ; la divergence n'était visible d'aucun des deux. C'est ce trou-là que
 * ce fichier ferme.
 *
 * ## Pourquoi un balayage de texte et pas un import
 *
 * Aucune surface n'est importable : `src/mcp/server.ts` appelle main() au
 * niveau module (l'importer démarrerait un serveur stdio dans le runner) et
 * `createMcpServer` n'est pas exporté de `mcp-http.ts`. Même contrainte, même
 * remède et même motif que `src/mcp/tool-contracts.test.ts`. Moins élégant
 * qu'un import, et c'est la seule chose qui marche.
 *
 * ## Pourquoi il fige les écarts restants au lieu d'exiger l'égalité partout
 *
 * Un test « les trois doivent correspondre en tout » serait rouge à la pose (A
 * n'a ni resource ni prompt), serait relâché au premier passage, et ne
 * garderait plus rien. Celui-ci exige l'égalité sur les OUTILS — le contrat que
 * lit un agent — et déclare les écarts restants, connus et datés, dans des
 * tables. Il casse sur tout écart NOUVEAU.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STDIO_ONLY_TOOLS } from '../src/mcp/inventory.js';
import { BANK_LEVEL_SANCTIONS, frozenBicShare } from '../src/lib/positioning.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const SURFACES = {
  A: { label: 'stdio publié (npm ibanforge-mcp)', path: 'mcp/src/index.ts' },
  B: { label: 'stdio embarqué (npm run mcp / smithery)', path: 'src/mcp/server.ts' },
  C: { label: 'HTTP distant (api.ibanforge.com/mcp)', path: 'src/routes/mcp-http.ts' },
} as const;
type SurfaceId = keyof typeof SURFACES;
const IDS = Object.keys(SURFACES) as SurfaceId[];

const SRC: Record<SurfaceId, string> = {
  A: read(SURFACES.A.path),
  B: read(SURFACES.B.path),
  C: read(SURFACES.C.path),
};

/**
 * Les noms d'outils d'une surface.
 *
 * A déclare un tableau `TOOLS: Tool[]` (`name: 'x',`), B et C appellent
 * `server.registerTool('x', {…})`. Deux formes, deux extracteurs — et on
 * vérifie plus bas qu'aucun extracteur ne renvoie un compte inattendu, sinon un
 * refactor de style rendrait ce test vert en ne voyant plus rien (ou en voyant
 * trop).
 */
function toolNames(id: SurfaceId): string[] {
  const src = SRC[id];
  const names =
    id === 'A'
      ? [...src.matchAll(/^\s*name:\s*'([a-z_]+)',/gm)].map((m) => m[1])
      : [...src.matchAll(/registerTool\(\s*\n?\s*'([a-z_]+)'/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

function countOf(id: SurfaceId, kind: 'registerResource' | 'registerPrompt'): number {
  return [...SRC[id].matchAll(new RegExp(`${kind}\\(`, 'g'))].length;
}

/**
 * Les outils que les TROIS surfaces doivent exposer. C'est le contrat produit.
 * Ajouter un outil quelque part sans l'ajouter ici (et partout) casse le test.
 */
const CONTRACT_TOOLS = [
  'batch_validate_iban',
  'check_compliance',
  'check_postal_address',
  'check_swiss_qr_bill',
  'lookup_bic',
  'lookup_ch_clearing',
  // Le device grant, livré le 15/09/2026 sur les TROIS surfaces d'emblée,
  // précisément pour ne pas refaire le coup de `send_feedback` resté HTTP-only
  // pendant des mois : l'agent qui se heurte au plafond doit trouver la sortie
  // sur le canal qu'il utilise, pas sur celui qu'on préfère.
  'poll_api_key',
  'request_api_key',
  'send_feedback',
  'validate_iban',
  'validate_payment_reference',
];

/**
 * Outils ajoutés SEULEMENT à la surface A (le paquet npm), en connaissance de
 * cause — voir l'en-tête de mcp/src/index.ts pour le motif complet. Datés et
 * nommés pour que l'écart ne soit jamais silencieux : même idiome que
 * KNOWN_GAPS ci-dessous, mais côté outils plutôt que resources/prompts.
 */
const A_ONLY_TOOLS: ReadonlyArray<{ tool: string; since: string; why: string }> = [
  {
    tool: 'audit_creditor_file',
    since: '2026-09-07',
    why:
      "Enveloppe l'audit de fichier créanciers, payé par une session Stripe Checkout " +
      'ponctuelle (pas x402/clé API comme tous les autres outils de ce fichier) avec une ' +
      'charge utile de fichier en base64. Le propager à B (src/mcp/server.ts, écritures Stripe ' +
      'en direct dans le process) et à C (src/routes/mcp-http.ts, qui force src/mcp/inventory.ts ' +
      'et chaque document de découverte qui en dépend) est un chantier séparé, plus large.',
  },
  {
    tool: 'audit_status',
    since: '2026-09-07',
    why: 'Lecture compagne de audit_creditor_file — même écart, même motif.',
  },
];
const A_ONLY_NAMES = A_ONLY_TOOLS.map((t) => t.tool);

// La liste que /llms.txt cite pour `npx -y ibanforge-mcp` vient de
// src/mcp/inventory.ts : elle doit être exactement celle-ci, sinon le texte
// servi nommerait un outil que le paquet n'a pas (ou en oublierait un).
describe('parité MCP : STDIO_ONLY_TOOLS suit A_ONLY_TOOLS', () => {
  it('src/mcp/inventory.ts nomme les mêmes outils réservés au paquet npm', () => {
    expect([...STDIO_ONLY_TOOLS].sort()).toEqual([...A_ONLY_NAMES].sort());
  });
});

/**
 * Écarts connus et ASSUMÉS entre surfaces, hors outils. Toute ligne ici est une
 * dette écrite : elle dit quel écart existe, et pourquoi il n'est pas refermé.
 */
const KNOWN_GAPS: ReadonlyArray<{ what: string; why: string }> = [
  {
    what: "A (le paquet npm) n'expose ni resource ni prompt, là où B et C en ont 2 + 1",
    why:
      'Le canal de distribution principal est le plus pauvre des trois. Écart antérieur à ' +
      "l'audit B3 (20/08/2026), non refermé : les resources de A devraient être servies par " +
      "l'API distante (elles le sont déjà : GET /v1/iban/structure, /v1/credits/bundles), ce qui " +
      'demande un relais et pas une simple copie. À traiter dans une session dédiée.',
  },
];

describe("parité MCP — les extracteurs voient exactement ce qu'il faut", () => {
  // Garde-fou du garde-fou, dans les DEUX sens : une regex qui ne matche plus
  // rendrait tout le reste vert en ne comparant que des tableaux vides ; une
  // regex qui matche trop (un champ `name:` imbriqué pris pour un outil)
  // fabriquerait des outils fantômes.
  for (const id of IDS) {
    // A porte aussi les A_ONLY_TOOLS (voir juste au-dessus) : B et C restent
    // strictement sur CONTRACT_TOOLS.
    const expected = id === 'A' ? [...CONTRACT_TOOLS, ...A_ONLY_NAMES].sort() : CONTRACT_TOOLS;
    it(`surface ${id} (${SURFACES[id].label}) : ${expected.length} outils détectés, ni plus ni moins`, () => {
      expect(
        toolNames(id),
        `l'extracteur de ${SURFACES[id].path} ne voit plus la bonne liste — regex à revoir, ou outil ajouté/retiré`,
      ).toEqual(expected);
    });
  }
});

describe("parité MCP — aucun écart entre les trois listes d'outils", () => {
  it('A (hors A_ONLY_TOOLS), B et C exposent la MÊME liste', () => {
    const [a, b, c] = IDS.map((id) => toolNames(id));
    const aShared = a.filter((t) => !A_ONLY_NAMES.includes(t));
    expect(b, `${SURFACES.B.path} ne sert pas la même liste que ${SURFACES.A.path}`).toEqual(
      aShared,
    );
    expect(c, `${SURFACES.C.path} ne sert pas la même liste que ${SURFACES.A.path}`).toEqual(
      aShared,
    );
  });

  for (const tool of CONTRACT_TOOLS) {
    it(`${tool} est sur les trois surfaces`, () => {
      for (const id of IDS) {
        expect(
          toolNames(id),
          `${SURFACES[id].path} n'expose pas ${tool}.\n` +
            `Soit il manque sur cette surface (le propager), soit l'écart est voulu — et alors il faut ` +
            `l'écrire ici avec son motif, jamais le laisser silencieux : c'est exactement comme ça que ` +
            `send_feedback est resté HTTP-only pendant des mois.`,
        ).toContain(tool);
      }
    });
  }
});

describe('parité MCP — la limite de taille du fichier audit ne dépasse jamais celle de la route', () => {
  /**
   * `mcp/src/index.ts` copie AUDIT_MAX_BYTES pour refuser un fichier trop
   * gros AVANT tout appel réseau (ce paquet ne peut pas importer src/lib/
   * audit-file.ts, publié séparément). Même risque que FEEDBACK_ERROR_TYPES
   * plus bas : un nombre recopié à la main à côté d'un nombre qui bouge finit
   * par diverger en silence.
   *
   * 🚨 La règle était l'ÉGALITÉ jusqu'au 22/09/2026, et elle était fausse dans
   * un sens. `file_base64` traverse stdio : un fichier de 10 Mo pèse ~13,4 Mo
   * sur le fil, et mesuré ce jour-là contre le serveur construit, 8 Mo et
   * au-delà tuent le transport (« Connection closed ») au lieu de rendre une
   * erreur. Le paquet doit donc pouvoir refuser PLUS TÔT que la route, et la
   * seule divergence dangereuse est l'autre : un plafond MCP plus HAUT que
   * celui de la route ne refuse plus rien et laisse la route décider après
   * avoir déjà tout transporté. C'est cette inégalité-là qui est gardée.
   */
  const parse = (expr: string | undefined): number | undefined =>
    expr?.split('*').reduce<number>((acc, part) => acc * Number(part.trim()), 1);

  it('mcp/src/index.ts AUDIT_MAX_BYTES <= src/lib/audit-file.ts AUDIT_MAX_BYTES', () => {
    const routeValue = parse(
      read('src/lib/audit-file.ts')
        .match(/export const AUDIT_MAX_BYTES\s*=\s*([^;]+);/)?.[1]
        ?.trim(),
    );
    const mcpValue = parse(SRC.A.match(/const AUDIT_MAX_BYTES\s*=\s*([^;]+);/)?.[1]?.trim());
    expect(routeValue, 'AUDIT_MAX_BYTES introuvable dans src/lib/audit-file.ts').toBeDefined();
    expect(mcpValue, 'AUDIT_MAX_BYTES introuvable dans mcp/src/index.ts').toBeDefined();
    expect(Number.isFinite(routeValue!) && Number.isFinite(mcpValue!)).toBe(true);
    expect(
      mcpValue!,
      'mcp/src/index.ts refuse PLUS HAUT que la route : le garde-fou local ne garde plus rien.',
    ).toBeLessThanOrEqual(routeValue!);
  });
});

describe('parité MCP — send_feedback écrit, donc il est plafonné partout', () => {
  /**
   * Le seul outil qui ÉCRIT en base, et il est gratuit et ouvert. Chaque
   * surface a sa serrure, parce qu'elles n'ont pas la même porte :
   *   A relaie POST /v1/feedback → hérite du quota par source de la route ;
   *   B écrit en direct sans HTTP → compteur glissant sur le MÊME nombre ;
   *   C est derrière le limiteur global par IP de l'application.
   * Ce bloc vérifie que la serrure de chacune est toujours là.
   */
  it('A passe par la route publique (et hérite donc de son quota par source)', () => {
    expect(
      SRC.A,
      "mcp/src/index.ts n'appelle plus POST /v1/feedback : s'il écrit désormais autrement, il a perdu le quota par source de la route.",
    ).toContain("apiCall('POST', '/v1/feedback'");
  });

  it('B plafonne ses écritures sur le même nombre que la route publique', () => {
    expect(
      SRC.B,
      'src/mcp/server.ts écrit en base sans HTTP au-dessus : sans plafond, send_feedback y est une boîte à spam.',
    ).toContain('FEEDBACK_INSERTS_PER_SOURCE_HOUR');
    expect(SRC.B, 'le plafond de src/mcp/server.ts ne refuse plus rien').toContain(
      'feedback_rate_limited',
    );
  });

  it('les catégories de A sont le miroir exact de FEEDBACK_ERROR_TYPES', () => {
    // A est un paquet publié à part : il ne peut pas importer src/, donc sa
    // liste est recopiée. C'est le seul endroit du contrat qui se maintient à
    // la main — donc le seul qui puisse diverger en silence.
    const source = read('src/routes/feedback.ts');
    const truth = [
      ...(source.match(/FEEDBACK_ERROR_TYPES\s*=\s*\[([^\]]+)\]/)?.[1] ?? '').matchAll(
        /'([a-z_]+)'/g,
      ),
    ].map((m) => m[1]);
    expect(
      truth.length,
      'FEEDBACK_ERROR_TYPES introuvable dans src/routes/feedback.ts',
    ).toBeGreaterThan(0);
    const mirrored = [
      ...(
        SRC.A.match(
          /enum:\s*\[((?:\s*'[a-z_]+',?)+)\],\s*\n\s*description:\s*'Category of the report/,
        )?.[1] ?? ''
      ).matchAll(/'([a-z_]+)'/g),
    ].map((m) => m[1]);
    expect(
      mirrored,
      'la copie de FEEDBACK_ERROR_TYPES dans mcp/src/index.ts a divergé de src/routes/feedback.ts — un agent enverrait une catégorie que la route refuse.',
    ).toEqual(truth);
  });
});

describe('parité MCP — les descriptions du device grant sont identiques au caractère près', () => {
  /**
   * 🚨 La seule chose qu'un agent lit avant de choisir un outil, et elle est
   * recopiée TROIS fois à la main.
   *
   * Les longues descriptions vivent dans les trois serveurs, par décision
   * assumée (voir l'en-tête de `src/mcp/inventory.ts` : la table de découverte
   * ne porte que ce qu'un document de découverte a besoin de savoir). Mais un
   * texte recopié trois fois est un texte dont deux copies dérivent, et
   * celles-ci disent à l'agent quoi FAIRE du résultat : lire `status` d'abord,
   * ne pas ouvrir le lien, ne jamais inventer d'adresse, ne pas boucler serré.
   * Une copie qui perdrait une de ces phrases donnerait un comportement
   * différent selon le transport, sans que rien ne le dise.
   *
   * Même remède que `AUDIT_MAX_BYTES`, `FEEDBACK_ERROR_TYPES` et
   * `MCP_INSTRUCTIONS` : recopié, mais gardé.
   */
  const DEVICE_TOOLS = ['request_api_key', 'poll_api_key'] as const;

  /** Le bloc d'un outil, coupé avant le suivant. Deux formes, deux découpes. */
  function toolBlock(id: SurfaceId, tool: string): string {
    const src = SRC[id];
    let start: number;
    let nextRe: RegExp;
    if (id === 'A') {
      // A déclare un tableau d'objets : `name: 'x',`.
      start = src.indexOf(`name: '${tool}',`);
      nextRe = /\n\s*name: '[a-z_]+',/;
    } else {
      // B et C appellent `registerTool('x', {…})` : on remonte à l'appel.
      const at = src.indexOf(`'${tool}',`);
      start = at === -1 ? -1 : src.lastIndexOf('registerTool(', at);
      nextRe = /registerTool\(/;
    }
    if (start === -1) throw new Error(`${SURFACES[id].path} ne déclare pas ${tool}`);
    const rest = src.slice(start);
    const next = nextRe.exec(rest.slice(1));
    return next === null ? rest : rest.slice(0, next.index + 1);
  }

  /**
   * La description d'un outil, concaténation de chaînes à apostrophes simples
   * rejointe et commentaires retirés.
   *
   * Le balayage démarre À `description:` et pas au début du bloc : sinon les
   * chaînes de `name:` et `title:` entreraient dans le texte comparé, et la
   * comparaison passerait au vert sur deux préfixes identiques.
   */
  function descriptionOf(id: SurfaceId, tool: string): string {
    const block = toolBlock(id, tool);
    const at = block.indexOf('description:');
    if (at === -1) throw new Error(`${SURFACES[id].path} : ${tool} n'a pas de description`);
    const rest = block.slice(at);
    // Le dernier morceau termine la propriété : `',`. Tous les autres finissent
    // par `' +`, donc le balayage ne peut pas s'arrêter trop tôt.
    const end = /'\s*,\s*\n/.exec(rest);
    if (end === null)
      throw new Error(`${SURFACES[id].path} : ${tool} n'est pas un littéral simple`);
    const chunk = rest.slice(0, end.index + end[0].length);
    const withoutComments = chunk.replace(/^\s*\/\/.*$/gm, '');
    const pieces = withoutComments.match(/'(?:[^'\\]|\\.)*'/g) ?? [];
    return pieces.map((p) => p.slice(1, -1).replace(/\\'/g, "'")).join('');
  }

  for (const tool of DEVICE_TOOLS) {
    // Garde-fou du garde-fou : un extracteur qui ne trouve plus rien rendrait
    // la comparaison verte en comparant trois chaînes vides.
    it(`${tool} : les trois extracteurs voient un texte réel`, () => {
      for (const id of IDS) {
        expect(
          descriptionOf(id, tool).length,
          `l'extracteur de description de ${SURFACES[id].path} ne voit plus rien pour ${tool} — regex à revoir, sinon la comparaison suivante ne mesure plus rien`,
        ).toBeGreaterThan(200);
      }
    });

    it(`${tool} : A, B et C servent le MÊME texte`, () => {
      const a = descriptionOf('A', tool);
      expect(
        descriptionOf('B', tool),
        `${SURFACES.B.path} a divergé de ${SURFACES.A.path} sur la description de ${tool} : un agent suivrait des consignes différentes selon le transport.`,
      ).toBe(a);
      expect(
        descriptionOf('C', tool),
        `${SURFACES.C.path} a divergé de ${SURFACES.A.path} sur la description de ${tool}.`,
      ).toBe(a);
    });

    // Les phrases qui changent le COMPORTEMENT de l'agent, nommées une par une :
    // une divergence les emporterait ensemble, mais une réécriture bien
    // intentionnée n'en perdrait qu'une, et c'est ce cas-là qu'on veut voir.
    it(`${tool} : les consignes qui engagent l'agent sont toutes là`, () => {
      const text = descriptionOf('A', tool);
      expect(text, 'la gratuité doit être dite, sinon un agent au plafond ne tente rien').toContain(
        'does NOT count against the free allowance',
      );
      if (tool === 'request_api_key') {
        expect(text, '« lire status d’abord » est la première consigne').toContain(
          'read `status` first',
        );
        expect(text, "l'agent ne doit JAMAIS ouvrir le lien").toContain('Do NOT open the link');
        expect(text, 'ni inventer une adresse').toContain('do NOT invent an e-mail address');
        expect(text, 'le bloc se montre mot pour mot').toContain('VERBATIM');
      } else {
        expect(text, 'ne jamais boucler serré : la maison a déjà payé ce défaut').toContain(
          'never in a tight loop',
        );
        expect(text, 'la clé est remise UNE fois').toContain('carries the key ONCE');
        expect(text, 'un refus redemande l’accord de l’humain').toContain(
          'ask THEM whether to try again',
        );
      }
    });
  }
});

describe("parité MCP — l'attente du client dépasse celle du serveur", () => {
  /**
   * 🚨 Le piège que rien ne nommait, et qui aurait cassé `poll_api_key` sur les
   * deux surfaces stdio en production sans rien casser en test.
   *
   * `POST /v1/keys/device/token` fait du long-polling : il retient la requête
   * jusqu'à `DEVICE_POLL_WAIT_MS`, 30 s par défaut. Or le défaut de
   * `mcp/src/api-client.ts` valait EXACTEMENT 30 s aussi : le client abandonnait
   * à l'instant où le serveur répondait, `poll_api_key` rendait une erreur de
   * transport au premier tour, et l'agent renonçait avant que l'humain n'ait
   * cliqué.
   *
   * Les deux surfaces posent donc un délai plus large, et ce nombre est recopié
   * (aucune des deux ne peut lire la constante : A est un paquet publié à part,
   * B pourrait l'importer mais son relais est du `fetch` nu). Même risque, même
   * remède que `AUDIT_MAX_BYTES` ci-dessus : recopié, mais gardé.
   */
  const serverWait = Number(
    read('src/lib/device-grant.ts')
      .match(/readPositiveEnv\('DEVICE_POLL_WAIT_MS',\s*([\d_]+)\)/)?.[1]
      ?.replace(/_/g, '') ?? NaN,
  );

  it('la valeur de repli du serveur est bien lisible (sinon ce bloc ne mesure rien)', () => {
    expect(
      serverWait,
      "le repli de DEVICE_POLL_WAIT_MS n'est plus lisible dans src/lib/device-grant.ts — la regex de ce test est à revoir, sinon les deux assertions suivantes passent en ne comparant rien.",
    ).toBeGreaterThan(0);
  });

  for (const [surface, path, name] of [
    ['A', 'mcp/src/index.ts', 'DEVICE_POLL_TIMEOUT_MS'],
    ['B', 'src/mcp/server.ts', 'DEVICE_RELAY_TIMEOUT_MS'],
  ] as const) {
    it(`surface ${surface} attend plus longtemps que le serveur`, () => {
      const raw = read(path).match(new RegExp(`const ${name}\\s*=\\s*([\\d_]+);`))?.[1];
      expect(raw, `${name} introuvable dans ${path}`).toBeDefined();
      expect(
        Number(raw!.replace(/_/g, '')),
        `${name} (${path}) doit dépasser le DEVICE_POLL_WAIT_MS du serveur (${serverWait} ms), sinon le client abandonne pendant que le serveur répond et poll_api_key rend une panne au premier tour.`,
      ).toBeGreaterThan(serverWait);
    });
  }
});

describe('parité MCP — le device grant frappe des clés, donc il est plafonné partout', () => {
  /**
   * Le bloc jumeau de celui de `send_feedback`, et pour un enjeu plus lourd :
   * ces deux outils FRAPPENT UNE CLÉ API. Chaque surface a sa serrure, parce
   * qu'elles n'ont pas la même porte :
   *   A et B relaient POST /v1/keys/device → héritent de la réservation par
   *     réseau que `openGrant()` porte DANS la route ;
   *   C appelle le module en direct, sans HTTP → doit donc citer `openGrant`
   *     elle-même, sinon elle serait une porte sans plafond et sans journal.
   *
   * 🚨 Ne PAS chercher `recordKeyCreation` ici. Cet appel a migré dans
   * `generateApiKey`, qui écrit la ligne de naissance dans sa propre
   * transaction ; un second appel armerait le disjoncteur à la moitié du volume
   * réel. Un test qui chercherait encore ce nom serait rouge pour la bonne
   * raison écrite au mauvais endroit.
   */
  it('A relaie la route publique (et hérite donc de sa réservation par réseau)', () => {
    expect(
      SRC.A,
      "mcp/src/index.ts n'appelle plus POST /v1/keys/device : s'il ouvre désormais des grants autrement, il a perdu la réservation par réseau de la route.",
    ).toContain("'/v1/keys/device'");
    expect(SRC.A, 'mcp/src/index.ts ne vient plus chercher la clé sur la route').toContain(
      "'/v1/keys/device/token'",
    );
  });

  it('B relaie la route publique, et ne frappe rien dans sa base locale', () => {
    expect(
      SRC.B,
      "src/mcp/server.ts n'appelle plus /v1/keys/device : une clé frappée dans son data/stats.sqlite local n'existe pas en production, et répondrait 401 à l'humain qui la colle.",
    ).toContain("'/v1/keys/device'");
    expect(SRC.B, 'src/mcp/server.ts ne vient plus chercher la clé sur la route').toContain(
      "'/v1/keys/device/token'",
    );
    // 🚨 La propriété testée est « B ne TOUCHE PAS le module », pas « le mot
    // openGrant est absent du fichier » : le commentaire qui explique pourquoi
    // B relaie nomme forcément `openGrant()`, et un test sur le mot serait
    // rouge à cause de sa propre explication. C'est l'IMPORT qui prouve
    // l'accès à la base locale.
    expect(
      SRC.B,
      "src/mcp/server.ts importe src/lib/device-grant.js : il frapperait des clés dans son data/stats.sqlite local, pas dans celui de la production, et l'humain collerait une clé qui répond 401.",
    ).not.toMatch(/from '\.\.\/lib\/device-grant\.js'/);
  });

  it('C passe par le module, et cite donc openGrant', () => {
    expect(
      SRC.C,
      "src/routes/mcp-http.ts n'appelle plus openGrant() : la réservation par réseau, le plafond horaire et la capture d'empreinte vivent LÀ-DEDANS, et cette surface écrit sans passer par HTTP. Sans cet appel, elle est une porte sans plafond et sans journal.",
    ).toContain('openGrant(');
  });

  /**
   * 🚨 LA GARDE DE RAIL, et c'est la seule chose qui relie le device grant au
   * rail de paiement.
   *
   * `device_codes` porte deux rails sous `grant_type` : le grant gratuit de
   * quinze minutes, et le nonce d'un paiement, payé, retrait ouvert sept jours.
   * `consumeGrantKey(hash)` sans son second argument servirait l'un à la place
   * de l'autre — un nonce de paiement présenté sur la porte device rendrait la
   * clé payée, et la purge du rail gratuit détruirait une clé achetée.
   */
  it('consumeGrantKey est TOUJOURS appelée avec son rail, partout dans src/', () => {
    const offenders: string[] = [];
    for (const rel of [
      'src/routes/device-grant.ts',
      'src/routes/mcp-http.ts',
      'src/mcp/server.ts',
    ]) {
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          for (const call of line.matchAll(/consumeGrantKey\(([^)]*)\)/g)) {
            // Le rail est le SECOND argument. Un appel à un seul argument (ou
            // à zéro) est le défaut qu'on cherche.
            if (!call[1].includes(',')) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
          }
        });
    }
    expect(
      offenders,
      'consumeGrantKey appelée sans son rail :\n' +
        offenders.join('\n') +
        "\nLe second argument n'a PAS de valeur par défaut, et c'est voulu : un défaut servirait un rail à la place de l'autre en silence.",
    ).toEqual([]);
  });
});

/**
 * La carte de découverte que le serveur HTTP sert LUI-MÊME.
 *
 * src/routes/mcp-card.ts sert /.well-known/mcp/server-card.json — le document
 * qu'un agent lit AVANT de se connecter — en déclarant url=api.ibanforge.com/mcp
 * et transport=streamable-http, c'est-à-dire la surface C exactement. Sa liste
 * d'outils DOIT donc être celle de C, sinon le même serveur annonce une chose à
 * la découverte et en sert une autre à l'exécution.
 *
 * ✅ Écart du 21/08/2026 refermé le 01/09/2026, et la comparaison a changé de
 * point d'appui. La carte n'écrit plus ses outils à la main : elle les dérive
 * de `src/mcp/inventory.ts`, la table unique dont dérivent aussi la carte A2A,
 * le document x402, agents.json, mcp.json et /llms.txt (audit 2026-09-01,
 * DX-01). Lire la carte au texte ne mesurait donc plus rien.
 *
 * Les deux fichiers se lisent en paire, et ensemble ils ferment la boucle :
 *  - `src/mcp/inventory.test.ts` joint l'inventaire aux six documents servis ;
 *  - ce test-ci joint l'inventaire aux trois transports MCP réels. C'est la
 *    seule jointure que rien d'autre ne couvre, et c'est celle qui compte : un
 *    outil ajouté à un serveur sans passer par l'inventaire resterait invisible
 *    de toute découverte, ce qui est exactement le défaut du 26/08.
 *
 * `CARD_MISSING_TOOLS` reste en place, vide : le jour où un écart doit être
 * toléré, il se déclare ici plutôt que de se taire.
 */
const CARD_MISSING_TOOLS: string[] = [];

describe('parité MCP — la carte de découverte ne peut pas mentir sur tools/list', () => {
  const CARD = read('src/routes/mcp-card.ts');
  const cardTools = [...read('src/mcp/inventory.ts').matchAll(/^\s*name:\s*'([a-z_]+)',/gm)]
    .map((m) => m[1])
    .sort();

  it("la carte décrit bien la surface HTTP (sinon la comparaison n'a pas de sens)", () => {
    expect(CARD).toContain("url: 'https://api.ibanforge.com/mcp'");
    expect(CARD).toContain("transport: 'streamable-http'");
  });

  it('la carte énumère les outils du transport HTTP, aux écarts déclarés près', () => {
    const missing = toolNames('C').filter((t) => !cardTools.includes(t));
    if (missing.length === 0 && CARD_MISSING_TOOLS.length > 0) {
      expect.fail(
        `✅ src/routes/mcp-card.ts est à jour (${cardTools.length} outils, comme le transport HTTP).\n` +
          `Vide CARD_MISSING_TOOLS dans scripts/mcp-parity.test.ts : à partir de là, la carte et tools/list ` +
          `sont verrouillées l'une sur l'autre.`,
      );
    }
    expect(
      missing.sort(),
      `La carte de découverte et tools/list ne s'accordent pas sur un outil NON déclaré.\n` +
        `Carte : [${cardTools.join(', ')}]\nHTTP  : [${toolNames('C').join(', ')}]\n` +
        `Écart accepté aujourd'hui : [${CARD_MISSING_TOOLS.join(', ')}].`,
    ).toEqual([...CARD_MISSING_TOOLS].sort());
    // Dans l'autre sens il n'y a pas d'indulgence : la carte ne doit JAMAIS
    // annoncer un outil que le serveur ne sert pas.
    expect(
      cardTools.filter((t) => !toolNames('C').includes(t)),
      'la carte annonce un outil que le transport HTTP ne sert pas',
    ).toEqual([]);
  });
});

describe('parité MCP — resources et prompts', () => {
  it('B et C exposent 2 resources et 1 prompt', () => {
    for (const id of ['B', 'C'] as SurfaceId[]) {
      expect(countOf(id, 'registerResource'), `${SURFACES[id].path}`).toBe(2);
      expect(countOf(id, 'registerPrompt'), `${SURFACES[id].path}`).toBe(1);
    }
  });

  it('A (le paquet npm) n’en a toujours aucun — écart connu, à refermer', () => {
    // Figé pour que l'écart reste une dette VISIBLE et non une surprise. Son
    // motif est dans KNOWN_GAPS ci-dessus.
    expect(KNOWN_GAPS.some((g) => g.what.includes('resource'))).toBe(true);
    expect(countOf('A', 'registerResource')).toBe(0);
    expect(countOf('A', 'registerPrompt')).toBe(0);
  });
});

describe('parité MCP — les compteurs annoncés suivent la réalité', () => {
  /**
   * « 6 tools » est écrit dans l'en-tête et dans la bannière stderr du paquet
   * npm. Le jour où un 7ᵉ outil arrive sur A, ces deux phrases deviennent
   * fausses en silence — et la bannière est ce que lit un humain qui débogue.
   */
  it("l'en-tête et la bannière de la surface A annoncent son vrai nombre d'outils", () => {
    const n = toolNames('A').length;
    expect(SRC.A, `mcp/src/index.ts annonce un autre compte que ses ${n} outils`).toContain(
      `Exposes ${n} tools`,
    );
    expect(SRC.A, `la bannière stderr de mcp/src/index.ts n'annonce pas ${n} outils`).toContain(
      `${n} tools exposed.`,
    );
  });
});

/**
 * Les phrases de positionnement des outils de donnée, entre A et C.
 *
 * 25/09/2026 : la PR 231 a réécrit ces descriptions sur le transport HTTP (C),
 * et le paquet npm (A) disait encore « THE DEEPEST SWISS CLEARING DATA IN ANY
 * PUBLIC API », « 121k+ … 38k+ LEI-enriched … refreshed monthly », des
 * sanctions « bank sanctions (OFAC) » sans le pays ni les deux autres listes,
 * et « a European IBAN » pour un service qui en valide dans tous les pays IBAN.
 * Un paquet publié garde ses phrases jusqu'à la version suivante : ce bloc
 * compare, au caractère près, les fragments que A doit servir comme C.
 *
 * Seuls des fragments, et pas des descriptions entières : C construit les
 * siennes avec des chiffres lus en direct (`datasetFacts()`,
 * `bicDirectorySentence()`), que A, figé à la publication, ne recopie pas.
 */
describe('parité MCP — les phrases de positionnement des outils de donnée', () => {
  const SHARED: Array<{ tool: string; fragment: string }> = [
    {
      tool: 'lookup_bic',
      fragment:
        'Resolve a BIC / SWIFT code into the underlying bank: name, country, city, LEI, and registered head-office address (where available). ',
    },
    {
      tool: 'lookup_ch_clearing',
      fragment:
        'EVERY IID OF THE SIX BANKMASTER, with its full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus QR-IID allocation, not just a name lookup. ',
    },
    {
      tool: 'check_compliance',
      fragment:
        'Run a pre-flight compliance triage on an IBAN before sending a SEPA / cross-border payment. ',
    },
    {
      tool: 'check_compliance',
      fragment:
        "asks whether the payee's bank or its country is under sanctions, asks if a SEPA Instant transfer can reach the bank, ",
    },
    {
      tool: 'check_compliance',
      fragment: "the name check itself is done by the payee's bank, never here. ",
    },
  ];

  it.each(SHARED)('$tool : A et C servent « $fragment »', ({ fragment }) => {
    expect(SRC.C, 'le transport HTTP a changé sa phrase : réaligner le paquet').toContain(fragment);
    expect(SRC.A, 'le paquet npm ne suit plus le transport HTTP').toContain(fragment);
  });

  it('check_compliance : A recopie mot pour mot la portée des sanctions que C importe', () => {
    expect(SRC.C).toContain('${BANK_LEVEL_SANCTIONS}');
    expect(SRC.A).toContain(`CHECKS: IBAN validity + ${BANK_LEVEL_SANCTIONS} + FATF status`);
  });

  it('lookup_bic : A date la copie figée de l’annuaire SWIFT du même mois que la base', () => {
    const { month } = frozenBicShare();
    expect(month, 'la base ne date plus sa copie figée : relire la phrase de A').not.toBeNull();
    expect(SRC.A).toContain(`a public copy of the SWIFT directory frozen in ${month}`);
  });

  it.each([
    [/THE DEEPEST SWISS CLEARING DATA/i, 'every IID of the SIX BankMaster'],
    [/\b38k\+ LEI/i, 'only the GLEIF rows carry an LEI, counts at llms.txt'],
    [/bank sanctions \(OFAC\)/i, 'BANK_LEVEL_SANCTIONS'],
    [/a European IBAN/i, 'an IBAN from any IBAN country'],
    [/from the GLEIF database/i, 'the BIC directory has several sources'],
  ] as const)('A ne sert plus %s (remplacé par : %s)', (retired, _instead) => {
    expect(SRC.A).not.toMatch(retired);
  });
});
