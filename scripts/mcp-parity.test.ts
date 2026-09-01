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
  'lookup_bic',
  'lookup_ch_clearing',
  'send_feedback',
  'validate_iban',
  'validate_payment_reference',
];

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
      "demande un relais et pas une simple copie. À traiter dans une session dédiée.",
  },
];

describe('parité MCP — les extracteurs voient exactement ce qu\'il faut', () => {
  // Garde-fou du garde-fou, dans les DEUX sens : une regex qui ne matche plus
  // rendrait tout le reste vert en ne comparant que des tableaux vides ; une
  // regex qui matche trop (un champ `name:` imbriqué pris pour un outil)
  // fabriquerait des outils fantômes.
  for (const id of IDS) {
    it(`surface ${id} (${SURFACES[id].label}) : ${CONTRACT_TOOLS.length} outils détectés, ni plus ni moins`, () => {
      expect(
        toolNames(id),
        `l'extracteur de ${SURFACES[id].path} ne voit plus la bonne liste — regex à revoir, ou outil ajouté/retiré`,
      ).toEqual(CONTRACT_TOOLS);
    });
  }
});

describe('parité MCP — aucun écart entre les trois listes d\'outils', () => {
  it('A, B et C exposent la MÊME liste', () => {
    const [a, b, c] = IDS.map((id) => toolNames(id));
    expect(b, `${SURFACES.B.path} ne sert pas la même liste que ${SURFACES.A.path}`).toEqual(a);
    expect(c, `${SURFACES.C.path} ne sert pas la même liste que ${SURFACES.A.path}`).toEqual(a);
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
    expect(SRC.B, 'le plafond de src/mcp/server.ts ne refuse plus rien').toContain('feedback_rate_limited');
  });

  it('les catégories de A sont le miroir exact de FEEDBACK_ERROR_TYPES', () => {
    // A est un paquet publié à part : il ne peut pas importer src/, donc sa
    // liste est recopiée. C'est le seul endroit du contrat qui se maintient à
    // la main — donc le seul qui puisse diverger en silence.
    const source = read('src/routes/feedback.ts');
    const truth = [...(source.match(/FEEDBACK_ERROR_TYPES\s*=\s*\[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(truth.length, 'FEEDBACK_ERROR_TYPES introuvable dans src/routes/feedback.ts').toBeGreaterThan(0);
    const mirrored = [
      ...(SRC.A.match(/enum:\s*\[((?:\s*'[a-z_]+',?)+)\],\s*\n\s*description:\s*'Category of the report/)?.[1] ?? '').matchAll(
        /'([a-z_]+)'/g,
      ),
    ].map((m) => m[1]);
    expect(
      mirrored,
      "la copie de FEEDBACK_ERROR_TYPES dans mcp/src/index.ts a divergé de src/routes/feedback.ts — un agent enverrait une catégorie que la route refuse.",
    ).toEqual(truth);
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
    expect(SRC.A, `mcp/src/index.ts annonce un autre compte que ses ${n} outils`).toContain(`Exposes ${n} tools`);
    expect(SRC.A, `la bannière stderr de mcp/src/index.ts n'annonce pas ${n} outils`).toContain(`${n} tools exposed.`);
  });
});
