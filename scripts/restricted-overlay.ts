/**
 * La surcouche privée en ligne de commande : extraire, contrôler, fusionner,
 * retirer, et la chaîne des seeders.
 *
 * Toutes les commandes lisent des COPIES et n'écrivent que le chemin donné, qui
 * doit être hors du dépôt : une surcouche dans le dépôt public serait exactement
 * la redistribution que ce montage évite (décision du 24/09/2026). Aucune
 * commande ne télécharge quoi que ce soit, sauf `seed`, qui lance les seeders
 * publiés et n'est destinée qu'au dépôt privé de rafraîchissement.
 *
 *   extract --bic <base> --compliance <base> --out-dir <dossier> [--allow-shrink]
 *       Écrit <dossier>/restricted-bic.sqlite et restricted-compliance.sqlite à
 *       partir des bases actuelles, sans aucun téléchargement (Geste 4).
 *   check --kind bic|compliance --overlay <fichier>
 *       Les contrôles du chargeur de l'API, sans rien écrire. Code 1 si refus.
 *   merge --kind bic|compliance --public <base> --overlay <fichier> --out <fichier>
 *       La fusion que fait l'API au démarrage, pour la vérifier en local.
 *   strip --kind bic|compliance --in <base> --out <fichier> [--drop-tables]
 *       Une copie de la base sans la famille : la base publique de demain.
 *   seed --kind bic|compliance --out <fichier> [--public <base>] [--bic-directory <base>] [--allow-shrink]
 *       Copie de travail de la base publique sans la famille, seeders de la
 *       famille seulement (SEED_FAMILY=restricted), téléchargements et bases
 *       temporaires dans le dossier de travail (SEED_TMP_DIR, hors du dépôt),
 *       puis extraction vers --out.
 *       Pour la base BIC : chaque seeder dit l'issue de chaque membre
 *       (SEED_REPORT_PATH, scripts/seed-report.ts) ; un membre dont la source est
 *       en panne est repris tel quel de la surcouche précédente au même chemin,
 *       dates d'origine comprises (scripts/restricted-carry-over.ts), annoncé
 *       par une annotation `::warning::` et noté dans le fichier (`carried_over`).
 *       Refus si aucun membre n'est frais, sans surcouche précédente, ou si une
 *       donnée reprise dépasse sa borne.
 *       Pour la conformité : la surcouche précédente au même chemin est fusionnée
 *       d'abord, pour que la reprise d'une liste en panne (ONU) la retrouve.
 *   manifest --dir <dossier> --out <fichier> [--commit <sha>] [--previous <manifeste>] [--allow-shrink]
 *       Le manifeste d'une release du dépôt privé (étape 5) : chaque surcouche
 *       présente dans <dossier>, contrôlée comme le chargeur de l'API, avec son
 *       empreinte, sa taille, sa date de génération, le commit du code public et
 *       les lignes de chaque membre (src/lib/restricted-overlay-manifest.ts).
 *       Avec --previous, la porte de qualité : rien n'est écrit (code 1) si un
 *       fichier ou un membre de la release précédente manque, ou si un membre
 *       baisse de plus de 10 % ; --allow-shrink après contrôle manuel.
 *   verify --manifest <fichier> --dir <dossier>
 *       Chaque fichier que nomme le manifeste est dans <dossier>, avec la taille
 *       et l'empreinte annoncées. Code 1 sinon. Pour la release précédente
 *       téléchargée par le dépôt privé, avant d'en reprendre quoi que ce soit.
 *
 * Usage : npm run overlay -- <commande> [options]
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OverlayKind } from '../src/lib/restricted-family.js';
import {
  buildMergedDatabase,
  extractOverlay,
  inspectOverlay,
  removeFileWithCompanions,
  sha256File,
  stripFamily,
} from '../src/lib/restricted-overlay.js';
import {
  MANIFEST_FORMAT,
  compareManifests,
  manifestEntryFor,
  parseManifest,
  type OverlayManifest,
} from '../src/lib/restricted-overlay-manifest.js';
import {
  applyCarryOver,
  carryOverAnnotation,
  freezePrevious,
  planCarryOver,
} from './restricted-carry-over.js';
import { SEED_REPORT_ENV, readSeedReport } from './seed-report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Noms des fichiers écrits par `extract`, ceux que la documentation cite. */
export const OVERLAY_FILE_NAMES: Record<OverlayKind, string> = {
  bic: 'restricted-bic.sqlite',
  compliance: 'restricted-compliance.sqlite',
};

/**
 * Le dossier est-il dans un dépôt git (copie de travail, ou dossier `.git`) ?
 * Sans git installé (image de production), la réponse est non et seule la
 * comparaison avec le dépôt courant garde. Les variables `GIT_*` sont retirées :
 * un `GIT_DIR` hérité ferait répondre git pour un autre dossier.
 */
function insideGitRepository(dir: string): boolean {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  const result = spawnSync(
    'git',
    ['-C', dir, 'rev-parse', '--is-inside-work-tree', '--is-inside-git-dir'],
    { env, encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return false;
  return result.stdout.split('\n').some((line) => line.trim() === 'true');
}

/**
 * Refuse toute écriture de la famille là où elle pourrait être commitée
 * (relecture de la PR 252, R19 à R21) :
 * - un chemin relatif ;
 * - une sortie existante qui n'est pas un fichier ordinaire à un seul lien (lien
 *   symbolique, lien dur, dossier) : écrire au travers atteindrait sa cible ;
 * - un lien symbolique pendant dans le chemin ;
 * - le dépôt courant, `data/` compris, comparé sur les chemins RÉELS du disque
 *   (`realpathSync.native` : sur un disque insensible à la casse, `IBANforge/`
 *   et `ibanforge/` sont le même dossier) ;
 * - N'IMPORTE QUEL dépôt git ou copie de travail : les copies de travail voisines
 *   partagent le même dépôt public. Le futur circuit privé (PR 4) écrit donc hors
 *   de son checkout (`$RUNNER_TEMP`).
 */
export function assertOutsideRepository(path: string, root: string = ROOT): void {
  if (!isAbsolute(path)) throw new Error(`Chemin absolu requis : ${path}`);
  let own;
  try {
    own = lstatSync(path);
  } catch {
    own = null;
  }
  if (own && (own.isSymbolicLink() || !own.isFile() || own.nlink > 1))
    throw new Error(`Sortie refusée, ce n'est pas un fichier ordinaire : ${path}`);
  let parent = dirname(path);
  while (!existsSync(parent)) {
    let dangling = false;
    try {
      dangling = lstatSync(parent).isSymbolicLink();
    } catch {
      /* n'existe pas du tout : on remonte */
    }
    if (dangling) throw new Error(`Lien symbolique pendant dans le chemin : ${parent}`);
    parent = dirname(parent);
  }
  const real = realpathSync.native(parent);
  const repo = realpathSync.native(root);
  if (real === repo || real.startsWith(`${repo}/`))
    throw new Error(`Écriture refusée dans le dépôt public : ${path}`);
  if (insideGitRepository(real))
    throw new Error(
      `Écriture refusée dans un dépôt git : ${path}. La surcouche s'écrit hors de tout dépôt.`,
    );
}

/** La garde, puis le dossier de la sortie créé (0700) s'il manque (R14). */
function prepareOutput(path: string): void {
  assertOutsideRepository(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
}

function parseArgs(argv: string[]): { command: string; flags: Map<string, string | true> } {
  const [command = '', ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`Argument inattendu : ${arg}`);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(arg.slice(2), next);
      i++;
    } else flags.set(arg.slice(2), true);
  }
  return { command, flags };
}

function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === true) throw new Error(`--${name} attend une valeur`);
  return value;
}

function required(flags: Map<string, string | true>, name: string): string {
  const value = stringFlag(flags, name);
  if (!value) throw new Error(`--${name} est obligatoire`);
  return resolve(value);
}

function kindFlag(flags: Map<string, string | true>): OverlayKind {
  const kind = stringFlag(flags, 'kind');
  if (kind !== 'bic' && kind !== 'compliance') throw new Error('--kind bic|compliance');
  return kind;
}

/** Copie d'une base dans un dossier temporaire : jamais de compagnon WAL à côté de l'original. */
function copyToScratch(source: string, scratch: string, name: string): string {
  if (!existsSync(source)) throw new Error(`Base introuvable : ${source}`);
  const target = join(scratch, name);
  copyFileSync(source, target);
  return target;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function runSeeder(script: string, env: Record<string, string>): void {
  const tsx = resolve(ROOT, 'node_modules/.bin/tsx');
  const result = spawnSync(tsx, [resolve(ROOT, 'scripts', script)], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`${script} a échoué (code ${result.status})`);
}

export function commandExtract(flags: Map<string, string | true>): unknown {
  const outDir = required(flags, 'out-dir');
  const sources: Array<[OverlayKind, string | undefined]> = [
    ['bic', stringFlag(flags, 'bic')],
    ['compliance', stringFlag(flags, 'compliance')],
  ];
  if (!sources.some(([, s]) => s)) throw new Error('--bic et/ou --compliance');
  const scratch = mkdtempSync(join(tmpdir(), 'ibanforge-overlay-'));
  try {
    const written = [];
    for (const [kind, source] of sources) {
      if (!source) continue;
      const out = join(outDir, OVERLAY_FILE_NAMES[kind]);
      prepareOutput(out);
      const copy = copyToScratch(resolve(source), scratch, `${kind}.sqlite`);
      written.push(
        extractOverlay({
          kind,
          sourcePath: copy,
          outPath: out,
          generator: 'extract',
          allowShrink: flags.has('allow-shrink'),
        }),
      );
    }
    return written;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Ce que `seed` emprunte au monde : les tests en passent des doublures (seeders
 * sans réseau, horloge fixe, journal capturé) ; la ligne de commande, jamais.
 */
export interface SeedDependencies {
  /** Lance scripts/<script> avec ces variables ; lève une erreur s'il échoue. */
  runSeeder?: (script: string, env: Record<string, string>) => void;
  /** L'horloge du passage : début du passage et âge des données reprises. */
  now?: () => Date;
  /** Où annoncer un membre repris (une annotation GitHub par ligne). */
  log?: (line: string) => void;
}

export function commandSeed(
  flags: Map<string, string | true>,
  dependencies: SeedDependencies = {},
): unknown {
  const kind = kindFlag(flags);
  const out = required(flags, 'out');
  prepareOutput(out);
  const launch = dependencies.runSeeder ?? runSeeder;
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? ((line: string) => console.log(line));
  const scratch = mkdtempSync(join(tmpdir(), 'ibanforge-overlay-seed-'));
  try {
    if (kind === 'bic') {
      // Avant tout téléchargement : les sources des membres frais sont lues après.
      const startedAt = now();
      // La surcouche précédente que le dépôt privé pose à la sortie, figée AVANT
      // les seeders : la source d'une reprise, et la date d'origine de ce qu'elle
      // reprend (scripts/restricted-carry-over.ts).
      const previous = freezePrevious(out, scratch, kind);
      const publicBase = resolve(
        stringFlag(flags, 'public') ?? process.env.BIC_DB_PATH ?? join(ROOT, 'data/bic.sqlite'),
      );
      const work = copyToScratch(publicBase, scratch, 'bic.sqlite');
      // Partir d'une copie SANS la famille, comme la reconstruction mensuelle part
      // d'une table vide : sinon l'INSERT OR IGNORE garderait à jamais les lignes
      // EBA STEP2, NBP ou OeNB disparues de leur source.
      stripFamily(work, 'bic');
      const reportPath = join(scratch, 'rapport-seeders.jsonl');
      const env = {
        BIC_DB_PATH: work,
        SEED_FAMILY: 'restricted',
        SEED_TMP_DIR: join(scratch, 'tmp'),
        [SEED_REPORT_ENV]: reportPath,
      };
      launch('enrich-bic-database.ts', env);
      launch('seed-national.ts', env);
      launch('seed-pra-banks.ts', env);
      const plan = planCarryOver({
        kind,
        workPath: work,
        report: readSeedReport(reportPath),
        previous,
        now: now(),
      });
      if (previous && plan.carried.length > 0)
        applyCarryOver({
          kind,
          workPath: work,
          previousPath: previous.path,
          members: plan.carried.map((c) => c.member),
        });
      const result = extractOverlay({
        kind,
        sourcePath: work,
        outPath: out,
        generator: 'seed',
        allowShrink: flags.has('allow-shrink'),
        refresh: {
          seedStartedAt: startedAt.toISOString(),
          carriedOver: Object.fromEntries(
            plan.carried.map((c) => [c.member, { source_date: c.source_date, cause: c.cause }]),
          ),
        },
      });
      for (const carried of plan.carried) log(carryOverAnnotation(kind, carried));
      return { ...result, carried_over: plan.carried };
    }
    const publicBase = resolve(
      stringFlag(flags, 'public') ??
        process.env.COMPLIANCE_DB_PATH ??
        join(ROOT, 'data/compliance.sqlite'),
    );
    const work = join(scratch, 'compliance.sqlite');
    if (existsSync(out)) {
      // La reprise d'une liste en panne relit la base « précédente » : ici, la
      // base publique fusionnée avec la surcouche précédente, qui porte l'ONU.
      const merged = buildMergedDatabase({
        kind,
        publicPath: copyToScratch(publicBase, scratch, 'public-compliance.sqlite'),
        overlayPath: out,
        outputPath: work,
      });
      if (!merged.path) copyToScratch(publicBase, scratch, 'compliance.sqlite');
    } else copyToScratch(publicBase, scratch, 'compliance.sqlite');
    const bicDirectory = stringFlag(flags, 'bic-directory');
    runSeeder('refresh-compliance.ts', {
      COMPLIANCE_DB_PATH: work,
      SEED_TMP_DIR: join(scratch, 'tmp'),
      ...(bicDirectory ? { BIC_DB_PATH: resolve(bicDirectory) } : {}),
    });
    return extractOverlay({
      kind,
      sourcePath: work,
      outPath: out,
      generator: 'seed',
      allowShrink: flags.has('allow-shrink'),
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const KINDS: readonly OverlayKind[] = ['bic', 'compliance'];

function readManifest(path: string): OverlayManifest {
  const parsed = parseManifest(readFileSync(path, 'utf8'));
  if (!parsed.ok) throw new Error(`Manifeste illisible (${parsed.error}) : ${path}`);
  return parsed.manifest;
}

/**
 * Le manifeste d'une release (voir l'en-tête). La porte de qualité passe AVANT
 * toute écriture : une release refusée ne laisse aucun manifeste derrière elle,
 * et le dépôt privé ne publie rien sans manifeste.
 */
export function commandManifest(flags: Map<string, string | true>): unknown {
  const dir = required(flags, 'dir');
  const out = required(flags, 'out');
  // Avant le moindre travail, comme les autres commandes.
  assertOutsideRepository(out);
  const commit = stringFlag(flags, 'commit') ?? null;
  if (commit !== null && !/^[0-9a-f]{7,40}$/.test(commit))
    throw new Error('--commit attend une empreinte git (hexadécimal, 7 à 40 caractères)');
  const previousPath = stringFlag(flags, 'previous');
  const previous = previousPath ? readManifest(resolve(previousPath)) : null;
  const files: OverlayManifest['files'] = {};
  for (const kind of KINDS) {
    const path = join(dir, OVERLAY_FILE_NAMES[kind]);
    if (!existsSync(path)) continue;
    files[kind] = manifestEntryFor({
      kind,
      path,
      publicCommit: commit,
      previous: previous?.files[kind],
    });
  }
  if (Object.keys(files).length === 0) throw new Error(`Aucune surcouche dans ${dir}`);
  const manifest: OverlayManifest = {
    format: MANIFEST_FORMAT,
    generated_at: new Date().toISOString(),
    public_commit: commit,
    files,
  };
  if (previous) {
    const problems = compareManifests(previous, manifest, {
      allowShrink: flags.has('allow-shrink'),
    });
    if (problems.length > 0)
      throw new Error(
        `Porte de qualité : release refusée face à la précédente (${problems.join(', ')}). ` +
          'Rien n’est écrit. Contrôle manuel requis (--allow-shrink).',
      );
  }
  prepareOutput(out);
  const temporary = `${out}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, out);
  } finally {
    rmSync(temporary, { force: true });
  }
  return manifest;
}

/** Les fichiers d'une release téléchargée sont-ils ceux que son manifeste annonce ? */
export function commandVerify(flags: Map<string, string | true>): {
  code: number;
  output: unknown;
} {
  const manifest = readManifest(required(flags, 'manifest'));
  const dir = required(flags, 'dir');
  const files = KINDS.flatMap((kind) => {
    const entry = manifest.files[kind];
    if (!entry) return [];
    const path = join(dir, entry.name);
    if (!existsSync(path)) return [{ kind, name: entry.name, state: 'missing' }];
    const same = statSync(path).size === entry.bytes && sha256File(path) === entry.sha256;
    return [{ kind, name: entry.name, state: same ? 'ok' : 'mismatch' }];
  });
  return { code: files.every((f) => f.state === 'ok') ? 0 : 1, output: files };
}

export function runCommand(argv: string[]): { code: number; output: unknown } {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'extract':
      return { code: 0, output: commandExtract(flags) };
    case 'check': {
      const report = inspectOverlay(required(flags, 'overlay'), kindFlag(flags));
      const refused = !report.ok || report.members.some((m) => m.state !== 'applied');
      return { code: refused ? 1 : 0, output: report };
    }
    case 'merge': {
      const out = required(flags, 'out');
      prepareOutput(out);
      const result = buildMergedDatabase({
        kind: kindFlag(flags),
        publicPath: required(flags, 'public'),
        overlayPath: required(flags, 'overlay'),
        outputPath: out,
      });
      return { code: result.path ? 0 : 1, output: result };
    }
    case 'strip': {
      const out = required(flags, 'out');
      prepareOutput(out);
      // Un voisin puis un renommage, comme l'extraction et la fusion : le
      // renommage remplace l'entrée du dossier, il n'écrit jamais au travers
      // d'un lien (R19).
      const temporary = `${out}.tmp-${randomUUID()}`;
      try {
        copyFileSync(required(flags, 'in'), temporary);
        stripFamily(temporary, kindFlag(flags), { dropTables: flags.has('drop-tables') });
        renameSync(temporary, out);
      } finally {
        removeFileWithCompanions(temporary);
      }
      return { code: 0, output: { path: out, sha256: sha256File(out) } };
    }
    case 'seed':
      return { code: 0, output: commandSeed(flags) };
    case 'manifest':
      return { code: 0, output: commandManifest(flags) };
    case 'verify':
      return commandVerify(flags);
    default:
      throw new Error('Commande : extract | check | merge | strip | seed | manifest | verify');
  }
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const { code, output } = runCommand(process.argv.slice(2));
    print(output);
    process.exitCode = code;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
