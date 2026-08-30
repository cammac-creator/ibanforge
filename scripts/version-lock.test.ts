/**
 * Un seul numéro de version, treize endroits où il est écrit à la main.
 *
 * ## L'accident que ce test empêche
 *
 * 30/07/2026 : npm servait ibanforge-mcp@1.4.1 pendant que le registre MCP
 * pointait 1.4.0, TOUS LES JOBS AU VERT. Deux causes cumulées : `npm version`
 * ne touche pas à git quand l'arbre est sale (et ne le dit pas), et
 * `mcp-publisher` ne lit QUE `mcp/server.json`, qui porte le numéro deux fois.
 * Deux garde-fous ont été posés à chaud — `mcp/src/manifest.test.ts` et
 * `src/routes/server-json.test.ts` — chacun sur une PAIRE de fichiers.
 *
 * ## Pourquoi un test de plus
 *
 * Les deux garde-fous existants verrouillent le noyau par transitivité, mais
 * personne ne tient la LISTE. L'audit A4 (20/08/2026) a trouvé le segment non
 * gardé : les deux SDKs sont à 1.3.3 depuis que le produit est passé en 1.4.x,
 * en violation silencieuse de RELEASING.md depuis ~2 mois. C'est exactement la
 * classe d'accident du 30/07 — un numéro maintenu à la main à côté d'un numéro
 * qui bouge — sur le seul segment que rien ne testait.
 *
 * Ce fichier est la liste. Quand un emplacement s'ajoute, il s'ajoute ICI.
 *
 * ## La doctrine appliquée : lockstep, avec une dette DATÉE et NOMMÉE
 *
 * La règle encodée est celle de `RELEASING.md` — « one number », les SDKs
 * compris. L'alternative (« un SDK a le droit d'être en retard tant qu'il n'est
 * pas en avance ») aurait été verte elle aussi, mais elle bénit la dérive au
 * lieu de l'enregistrer : elle resterait verte pour toujours et ne garderait
 * rien sur ce segment.
 *
 * Un retard assumé s'inscrit donc dans `TOLERATED`, avec sa date, son motif et
 * la VALEUR EXACTE tolérée. Un SDK toléré n'a alors que deux valeurs
 * acceptables : celle du produit, ou celle de l'exception. Toute TROISIÈME
 * valeur — un bump commencé et pas fini — est rouge : c'est précisément la
 * classe d'accident du 30/07, qu'un simple « SDK ≤ produit » aurait laissée
 * passer.
 *
 * Le vidage de la liste, lui, est SIGNALÉ et non imposé (voir le test
 * « signale quand TOLERATED n'a plus d'objet »). L'imposer ferait rougir la CI
 * au moment exact où quelqu'un fait la bonne chose, et dans un fichier qui n'est
 * pas le sien : ce fichier et les SDKs sont deux chantiers distincts, qui
 * n'arrivent pas dans le même commit.
 *
 * État au 21/08/2026 : les deux SDKs viennent d'être republiés en 1.4.3 dans le
 * working tree, donc les treize emplacements sont alignés — mais l'exception
 * reste posée tant que ce bump n'est pas commité. Elle se videra avec lui.
 *
 * ## Ce qui n'est PAS testé, et pourquoi
 *
 * Les surfaces DÉRIVÉES lisent leur package.json à l'exécution et ne peuvent
 * pas dériver : `openapi.generated.json` info.version et `/health`.version
 * (src/routes/openapi.ts), la version annoncée par les deux serveurs MCP.
 * Les tester serait tester `require`.
 *
 * Vérifié le 21/08/2026, pour que personne ne les cherche : `glama.json` et
 * `smithery.yaml` ne portent AUCUN numéro de version (`grep -n version` : zéro
 * occurrence dans les deux). Ils décrivent des outils et une commande de
 * démarrage, pas une release. Une entrée « absente » dans un test de version
 * serait pire que pas d'entrée du tout.
 *
 * `SUBMISSIONS.md` est de la prose de campagne, pas une surface machine — il
 * est signalé en fin de fichier, jamais asserté.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p: string): Record<string, unknown> => JSON.parse(read(p)) as Record<string, unknown>;

/** La version de référence : le package.json racine. Tout se compare à lui. */
const PRODUCT = (readJson('package.json').version as string) ?? '';

/** Le NOYAU : tout ce qui décrit le serveur MCP publié. Verrouillage strict. */
const CORE: ReadonlyArray<{ where: string; read: () => string }> = [
  { where: 'package.json .version', read: () => readJson('package.json').version as string },
  { where: 'mcp/package.json .version', read: () => readJson('mcp/package.json').version as string },
  { where: 'mcp/server.json .version', read: () => readJson('mcp/server.json').version as string },
  {
    // Le champ que mcp-publisher lit vraiment. Le 30/07, c'est CELUI-CI qui
    // portait l'ancien numéro pendant que npm servait le nouveau.
    where: 'mcp/server.json .packages[0].version',
    read: () => (readJson('mcp/server.json').packages as Array<{ version: string }>)[0].version,
  },
  { where: 'server.json .version', read: () => readJson('server.json').version as string },
  {
    where: 'server.json .packages[0].version',
    read: () => (readJson('server.json').packages as Array<{ version: string }>)[0].version,
  },
  {
    // Le badge du README : la seule version que voit un visiteur GitHub.
    where: 'README.md badge MCP_Registry',
    read: () => read('README.md').match(/MCP_Registry-([0-9]+\.[0-9]+\.[0-9]+)/)?.[1] ?? 'ABSENT',
  },
];

/** Les SDKs : DEUX déclarations chacun, tenues à la main, jamais testées jusqu'ici. */
const SDKS: ReadonlyArray<{ name: string; decls: ReadonlyArray<{ where: string; read: () => string }> }> = [
  {
    name: 'TypeScript (@ibanforge/sdk)',
    decls: [
      { where: 'sdks/typescript/package.json .version', read: () => readJson('sdks/typescript/package.json').version as string },
      {
        // Sert à bâtir le User-Agent (sdks/typescript/src/index.ts) : s'il
        // ment, toute la télémétrie de version côté serveur ment avec lui.
        where: 'sdks/typescript/src/index.ts const VERSION',
        read: () => read('sdks/typescript/src/index.ts').match(/const VERSION\s*=\s*'([^']+)'/)?.[1] ?? 'ABSENT',
      },
    ],
  },
  {
    name: 'Python (ibanforge)',
    decls: [
      {
        where: 'sdks/python/pyproject.toml version',
        read: () => read('sdks/python/pyproject.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? 'ABSENT',
      },
      {
        where: 'sdks/python/ibanforge/_version.py __version__',
        read: () => read('sdks/python/ibanforge/_version.py').match(/__version__\s*=\s*"([^"]+)"/)?.[1] ?? 'ABSENT',
      },
    ],
  },
];

/**
 * ═════════════════ LISTE D'EXCEPTIONS — À VIDER, PAS À RALLONGER ═════════════
 *
 * Chaque ligne est une dette écrite : un emplacement qui NE PORTE PAS le numéro
 * du produit, la valeur exacte qu'il porte à la place, depuis quand, et ce qui
 * la refermera.
 *
 * ⚠️ Ces deux lignes se retirent ENSEMBLE, le jour de la republication des SDKs
 * (geste de Claude-Alain, déjà décidé — ce test ne « répare » surtout pas les
 * SDKs à sa place : republier un paquet est une décision, pas un correctif de
 * CI). Le test refuse à la fois un SDK qui aurait bougé sans que l'exception
 * soit vidée ET une exception restée là après la republication.
 *
 * Ajouter une ligne ici doit coûter une discussion. En retirer une doit être la
 * conséquence naturelle d'un travail fini.
 */
const TOLERATED: ReadonlyArray<{ sdk: string; expected: string; since: string; why: string }> = [
  {
    sdk: 'TypeScript (@ibanforge/sdk)',
    expected: '1.4.3',
    since: '2026-08-30 (noyau MCP republié en 1.4.4)',
    why: "1.4.3 est ce que npm SERT pour ce SDK. Le bump du 30/08 n'a touché que le noyau MCP (septième outil, fail() sur les refus d'entrée, bank_code_check.reason et bic.basis) : le client HTTP n'a pas bougé d'une ligne. Écrire 1.4.4 dans son package.json ferait mentir le dépôt sur ce qui est publié — la dérive exacte que ce fichier existe pour enregistrer plutôt que pour maquiller. Se videra à la prochaine republication.",
  },
  {
    sdk: 'Python (ibanforge)',
    expected: '1.4.3',
    since: '2026-08-30 (noyau MCP republié en 1.4.4)',
    why: 'Idem côté PyPI, et pour la même raison : rien à republier tant que le client ne change pas.',
  },
];

describe('version lock — le noyau MCP porte partout le même numéro', () => {
  it('la version de référence est un semver x.y.z', () => {
    expect(PRODUCT).toMatch(/^\d+\.\d+\.\d+$/);
  });

  for (const loc of CORE) {
    it(`${loc.where} === ${PRODUCT}`, () => {
      // Message explicite : quand ce test casse, on veut savoir QUEL fichier
      // ouvrir sans relire le test.
      expect(loc.read(), `${loc.where} diverge du package.json racine (${PRODUCT})`).toBe(PRODUCT);
    });
  }
});

describe('version lock — les SDKs', () => {
  for (const sdk of SDKS) {
    it(`${sdk.name} : ses deux déclarations sont d'accord`, () => {
      // La classe d'accident la plus vicieuse : un package.json bumpé et une
      // constante VERSION oubliée à côté. Vraie quel que soit le mode.
      const values = sdk.decls.map((d) => d.read());
      const [first] = values;
      for (let i = 1; i < values.length; i++) {
        expect(values[i], `${sdk.decls[i].where} (${values[i]}) ≠ ${sdk.decls[0].where} (${first})`).toBe(first);
      }
      expect(first).toMatch(/^\d+\.\d+\.\d+$/);
    });

    const waiver = TOLERATED.find((t) => t.sdk === sdk.name);

    if (!waiver) {
      it(`${sdk.name} : aligné sur le produit (RELEASING.md « one number »)`, () => {
        expect(sdk.decls[0].read(), `${sdk.decls[0].where} doit valoir ${PRODUCT}`).toBe(PRODUCT);
      });
    } else {
      it(`${sdk.name} : soit aligné sur ${PRODUCT}, soit au retard TOLÉRÉ de ${waiver.expected} — rien d'autre`, () => {
        // DEUX valeurs acceptées, pas une seule.
        //
        // Exiger EXACTEMENT `waiver.expected` rendrait ce test rouge le jour où
        // quelqu'un fait la bonne chose (republier le SDK), dans un fichier qui
        // n'est pas le sien. La réparation la plus probable serait alors de
        // supprimer l'assertion — et le segment redeviendrait non gardé, ce qui
        // est exactement l'accident qu'on essaie d'empêcher.
        //
        // Ce que ce test attrape quand même, et qui est tout ce qui compte :
        // une TROISIÈME valeur. Un SDK à 1.4.0, ou bougé à moitié, veut dire
        // que quelqu'un a commencé un bump sans le finir — la classe d'accident
        // du 30/07. Le nettoyage de la liste, lui, est gardé par le test
        // « TOLERATED n'a plus d'objet » plus bas.
        const actual = sdk.decls[0].read();
        expect(
          [PRODUCT, waiver.expected],
          `${sdk.name} vaut ${actual}.\n` +
            `Deux valeurs sont acceptables : ${PRODUCT} (aligné sur le produit, l'état visé) ou ` +
            `${waiver.expected} (retard tracé dans TOLERATED depuis ${waiver.since} — ${waiver.why}).\n` +
            `Une autre valeur veut dire qu'un bump a été commencé sans être fini : aligner ${sdk.decls[0].where} ` +
            `sur ${PRODUCT}, ou mettre l'exception à jour en connaissance de cause.`,
        ).toContain(actual);
      });
    }
  }

  it("signale quand TOLERATED n'a plus d'objet — sans jamais casser la CI pour ça", () => {
    // ⚠️ AVERTISSEMENT, PAS ASSERTION — et le motif est l'inverse du réflexe.
    //
    // Cette ligne se déclenche quand quelqu'un fait la BONNE chose : republier
    // les SDKs. En faire un échec ferait rougir `main` au moment précis où le
    // travail aboutit, dans un fichier qui n'appartient pas à celui qui l'a
    // fait — et la réparation la plus probable serait de supprimer l'assertion,
    // ce qui laisserait le segment sans garde du tout.
    //
    // Le couplage est réel : ce fichier et les SDKs sont deux chantiers
    // séparés, qui ne sont pas commités ensemble. Si ce test exigeait que les
    // deux soient d'accord, le premier des deux à arriver casserait le dépôt.
    //
    // Ce qui reste gardé, et qui suffit : un SDK ne peut valoir QUE le numéro
    // du produit ou celui de son exception. Une troisième valeur est rouge.
    const stale = TOLERATED.filter((t) => {
      const sdk = SDKS.find((s) => s.name === t.sdk);
      return sdk ? sdk.decls[0].read() === PRODUCT : false;
    });
    if (TOLERATED.length > 0 && stale.length === TOLERATED.length) {
      console.warn(
        `[version-lock] ✅ Les ${TOLERATED.length} SDKs tolérés sont tous à ${PRODUCT} : la republication a eu lieu. ` +
          `TOLERATED peut être vidé (${TOLERATED.map((t) => t.sdk).join(', ')}) — à faire dans le commit qui porte le bump, ` +
          `pas dans un autre, sinon le premier des deux à arriver casse la CI.`,
      );
    }
    expect(TOLERATED.every((t) => /^\d+\.\d+\.\d+$/.test(t.expected))).toBe(true);
  });
});

describe('version lock — surfaces de prose (signalées, non bloquantes)', () => {
  it('SUBMISSIONS.md : un décalage est noté mais ne casse pas la CI', () => {
    const claimed = read('SUBMISSIONS.md').match(/version publiée[^0-9]*([0-9]+\.[0-9]+\.[0-9]+)/i)?.[1];
    if (claimed && claimed !== PRODUCT) {
      console.warn(
        `[version-lock] SUBMISSIONS.md annonce ${claimed}, le produit est en ${PRODUCT} — texte de campagne, à rafraîchir à l'occasion.`,
      );
    }
    expect(true).toBe(true);
  });
});
