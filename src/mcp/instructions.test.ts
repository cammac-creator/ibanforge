/**
 * The three MCP surfaces must hand a connecting client the SAME instructions.
 *
 * Until 2026-09-01 only ONE of them did. `initialize` on the remote HTTP
 * transport returned 823 characters of guidance; the npm package
 * `ibanforge-mcp` — the main distribution channel — and the internal stdio
 * server returned nothing at all (audit MCP-11). That block is the only prose
 * an MCP client injects into its model's context before any tool is listed, so
 * missing it on the busiest channel is missing it where it counts.
 *
 * `src/mcp/instructions.ts` is now the single source. `src/mcp/server.ts` and
 * `src/routes/mcp-http.ts` both import it, so for those two the check is that
 * they still pass the constant to their constructor — an import that nothing
 * uses would leave the old text serving. `mcp/src/index.ts` cannot import it —
 * it is a separate npm package with its own dependency tree — so it keeps a
 * verbatim copy, and this file compares that one character for character.
 *
 * Text-scanned rather than imported, for the same reason as
 * `scripts/mcp-parity.test.ts`: neither stdio server is importable (both run at
 * module level), and `mcp/` is outside this package's module graph.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_INSTRUCTIONS } from './instructions.js';
import { MCP_TOOLS } from './inventory.js';
import { MCP_WEEKLY_LIMIT } from '../lib/mcp-limits.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * The concatenated string literals assigned to `name`, with the `+` joins and
 * the interleaved comments removed. Crude on purpose: it has to read three
 * files written in three styles, and a parser here would be a second thing to
 * maintain.
 */
function literalAfter(source: string, name: string): string {
  const start = source.indexOf(name);
  if (start === -1) throw new Error(`no \`${name}\` in this surface`);
  const rest = source.slice(start);
  // The last chunk ends the statement: `';` in the two stdio surfaces, `',` in
  // the HTTP one where the block is a property of an object literal. Anything
  // in between ends with `' +`, so neither form can cut the scan early.
  const end = rest.search(/'\s*[;,]\s*(\n|$)/);
  if (end === -1) throw new Error(`\`${name}\` is not a plain string literal`);
  const block = rest.slice(0, end + 1);
  // Every single-quoted chunk, comments excluded: line comments are stripped
  // first so an apostrophe inside one cannot open a phantom string.
  const withoutComments = block.replace(/^\s*\/\/.*$/gm, '');
  const chunks = withoutComments.match(/'(?:[^'\\]|\\.)*'/g) ?? [];
  return chunks.map((c) => c.slice(1, -1).replace(/\\'/g, "'")).join('');
}

/**
 * Les écarts permis à la copie du paquet npm jusqu'à sa prochaine publication.
 *
 * 24/09/2026 : l'accès MCP sans clé passe de 10 appels par jour à 25 par
 * SEMAINE (décision de Claude-Alain). La constante partagée le dit ; la copie de
 * `mcp/src/index.ts`, publiée à part, garde l'ancienne phrase jusqu'à la PR qui
 * prépare sa publication (`mcp/` n'est pas touché ici). Chaque paire [texte du
 * paquet, texte de la constante] est remplacée dans la copie AVANT la
 * comparaison au caractère près, et un test vérifie qu'elle y est encore : le
 * jour où la copie est alignée, ce test rougit et l'écart doit partir d'ici.
 *
 * ⚠️ La même PR devra adapter `stdioInstructions` (mcp/src/stdio-instructions.ts),
 * dont l'expression reconnaît l'ancienne phrase de quota et lève sinon.
 */
const PENDING_NPM_RELEASE: ReadonlyArray<readonly [string, string]> = [
  [
    'Free tier: 10 tool calls/IP/day here, no signup.',
    'Free tier: 25 tool calls a week per source address here (ISO week in UTC, reset on Monday 00:00 UTC), no signup.',
  ],
  [
    'both tools keep answering after the daily limit.',
    'both tools keep answering after the free allowance is spent.',
  ],
];

function withPendingRelease(text: string): string {
  return PENDING_NPM_RELEASE.reduce(
    (t, [published, current]) => t.split(published).join(current),
    text,
  );
}

const SURFACES: Array<{ label: string; path: string; anchor: string }> = [
  {
    label: 'stdio publié (npm ibanforge-mcp)',
    path: 'mcp/src/index.ts',
    anchor: 'const INSTRUCTIONS =',
  },
];

/** Les surfaces qui IMPORTENT la constante, donc à vérifier autrement. */
const IMPORTERS: Array<{ label: string; path: string; importLine: string }> = [
  {
    label: 'stdio embarqué (npm run mcp / smithery)',
    path: 'src/mcp/server.ts',
    importLine: "import { MCP_INSTRUCTIONS } from './instructions.js'",
  },
  {
    label: 'HTTP distant (api.ibanforge.com/mcp)',
    path: 'src/routes/mcp-http.ts',
    importLine: "import { MCP_INSTRUCTIONS } from '../mcp/instructions.js'",
  },
];

describe('les trois surfaces MCP servent les mêmes instructions', () => {
  it('le paquet npm adapte le quota du texte commun à son transport REST', () => {
    // Le bloc métier reste identique ; annoncer le quota HTTP distant « ici »
    // dans un client REST était faux. La recette stdio vérifie le texte reçu.
    expect(read('mcp/src/index.ts')).toContain('instructions: stdioInstructions(INSTRUCTIONS)');
  });
  for (const surface of IMPORTERS) {
    it(`${surface.label} injecte la constante partagée`, () => {
      const source = read(surface.path);
      expect(source).toContain(surface.importLine);
      expect(source, 'le bloc doit être PASSÉ au constructeur, pas seulement importé').toContain(
        'instructions: MCP_INSTRUCTIONS',
      );
      // Et l'ancien littéral ne doit pas traîner à côté : deux textes dans un
      // fichier, c'est celui qu'on ne lit pas qui finit servi.
      expect(source, `${surface.path} garde une copie du texte à côté de l'import`).not.toContain(
        'Start with validate_iban on any IBAN-looking string',
      );
    });
  }

  for (const surface of SURFACES) {
    it(`${surface.label} sert le texte au caractère près`, () => {
      expect(withPendingRelease(literalAfter(read(surface.path), surface.anchor))).toBe(
        MCP_INSTRUCTIONS,
      );
    });
  }

  it.each(PENDING_NPM_RELEASE.map(([published]) => [published]))(
    'la copie du paquet dit encore « %s » (sinon retirer l’écart)',
    (published) => {
      expect(literalAfter(read('mcp/src/index.ts'), 'const INSTRUCTIONS =')).toContain(published);
    },
  );

  it('nomme la porte gratuite avec son URL complète, pas seulement son existence', () => {
    // Un agent qui lit « clé gratuite disponible » sans l'adresse ne peut rien
    // en faire. MCP-10 le demandait sur chaque outil ; le dire une fois ici, à
    // la connexion, le dit à tous les outils sans gonfler les descriptions.
    expect(MCP_INSTRUCTIONS).toContain('POST https://api.ibanforge.com/v1/keys/generate');
    expect(MCP_INSTRUCTIONS).toContain('200 REST calls/month');
    expect(MCP_INSTRUCTIONS).toContain('send_feedback');
  });

  /**
   * Les chiffres de ce bloc sont ÉCRITS, et c'est imposé : l'extracteur
   * ci-dessus ne lit que des chaînes entre apostrophes simples, donc un gabarit
   * à backticks interpolant les constantes casserait les trois tests de parité
   * (`spec-06 §3.3`). Ces deux assertions sont la contrepartie : elles relient
   * les chiffres écrits aux constantes qui les appliquent, si bien qu'un
   * réglage de palier fait rougir ce fichier au lieu de laisser le texte mentir.
   */
  it('les chiffres écrits sont ceux que le code applique', () => {
    expect(MCP_INSTRUCTIONS).toContain(
      `Free tier: ${MCP_WEEKLY_LIMIT} tool calls a week per source address here`,
    );
    // Le quota de ce transport et celui de la clé sans e-mail ne partagent pas
    // une phrase : depuis le 24/09/2026 ils portent le même chiffre.
    const sentences = MCP_INSTRUCTIONS.split(/(?<=[.!?])\s+/);
    const quota = sentences.find((x) => x.startsWith('Free tier:'));
    expect(quota).toBeDefined();
    expect(quota).not.toMatch(/month/);
    expect(MCP_INSTRUCTIONS).toContain(`${ANONYMOUS_MONTHLY_LIMIT} REST calls/month`);
    expect(MCP_INSTRUCTIONS).toContain(`${FREE_TIER_MONTHLY_LIMIT} REST calls/month`);
  });

  /**
   * 🚨 Ce bloc est injecté dans le contexte du modèle AVANT `tools/list`.
   *
   * Nommer un outil qui n'existe pas encore y est pire qu'ailleurs : l'agent le
   * cherche dans la liste, ne le trouve pas, et apprend que notre documentation
   * mente.
   *
   * ✅ 15/09/2026 : le device grant (`request_api_key` / `poll_api_key`) est
   * LIVRÉ sur les trois surfaces, et la phrase qui les nomme est entrée dans le
   * bloc le jour où les deux outils ont répondu. Ce test avait interdit de
   * l'annoncer avant ; il l'autorise maintenant parce que les deux noms sont
   * dans `MCP_TOOLS`, PAS parce qu'on l'a desserré. La garde vaut pour le
   * prochain outil décidé et pas encore servi.
   */
  it("ne nomme aucun outil qui n'est pas enregistré", () => {
    const known = new Set(MCP_TOOLS.map((t) => t.name));
    const TOOLISH =
      /\b(?:validate|batch|lookup|check|audit|send|request|poll|list|get|create|claim|generate)_[a-z0-9_]+\b/g;
    const cited = [...new Set(MCP_INSTRUCTIONS.match(TOOLISH) ?? [])];
    // Le bloc CITE des outils : un motif qui n'en trouve aucun passerait au
    // vert en ne vérifiant rien.
    expect(cited.length).toBeGreaterThan(0);
    const unknown = cited.filter((name) => !known.has(name));
    expect(unknown, `outils cités mais non enregistrés : ${unknown.join(', ')}`).toEqual([]);
  });
});
