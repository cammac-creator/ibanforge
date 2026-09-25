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
 *       famille seulement (SEED_FAMILY=restricted), puis extraction vers --out.
 *       Pour la conformité : la surcouche précédente au même chemin est fusionnée
 *       d'abord, pour que la reprise d'une liste en panne (ONU) la retrouve.
 *
 * Usage : npm run overlay -- <commande> [options]
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { OverlayKind } from '../src/lib/restricted-family.js';
import {
  buildMergedDatabase,
  extractOverlay,
  inspectOverlay,
  sha256File,
  stripFamily,
} from '../src/lib/restricted-overlay.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Noms des fichiers écrits par `extract`, ceux que la documentation cite. */
export const OVERLAY_FILE_NAMES: Record<OverlayKind, string> = {
  bic: 'restricted-bic.sqlite',
  compliance: 'restricted-compliance.sqlite',
};

/**
 * Refuse toute écriture dans le dépôt, `data/` compris, et tout chemin relatif :
 * le chemin réel du dossier parent est comparé à celui du dépôt.
 */
export function assertOutsideRepository(path: string, root: string = ROOT): void {
  if (!isAbsolute(path)) throw new Error(`Chemin absolu requis : ${path}`);
  let parent = dirname(path);
  while (!existsSync(parent)) parent = dirname(parent);
  const real = realpathSync(parent);
  const repo = realpathSync(root);
  if (real === repo || real.startsWith(`${repo}/`))
    throw new Error(`Écriture refusée dans le dépôt public : ${path}`);
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
      assertOutsideRepository(out);
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

export function commandSeed(flags: Map<string, string | true>): unknown {
  const kind = kindFlag(flags);
  const out = required(flags, 'out');
  assertOutsideRepository(out);
  const scratch = mkdtempSync(join(tmpdir(), 'ibanforge-overlay-seed-'));
  try {
    if (kind === 'bic') {
      const publicBase = resolve(
        stringFlag(flags, 'public') ?? process.env.BIC_DB_PATH ?? join(ROOT, 'data/bic.sqlite'),
      );
      const work = copyToScratch(publicBase, scratch, 'bic.sqlite');
      // Partir d'une copie SANS la famille, comme la reconstruction mensuelle part
      // d'une table vide : sinon l'INSERT OR IGNORE garderait à jamais les lignes
      // EBA STEP2, NBP ou OeNB disparues de leur source.
      stripFamily(work, 'bic');
      const env = { BIC_DB_PATH: work, SEED_FAMILY: 'restricted' };
      runSeeder('enrich-bic-database.ts', env);
      runSeeder('seed-national.ts', env);
      runSeeder('seed-pra-banks.ts', env);
      return extractOverlay({
        kind,
        sourcePath: work,
        outPath: out,
        generator: 'seed',
        allowShrink: flags.has('allow-shrink'),
      });
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
      assertOutsideRepository(out);
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
      assertOutsideRepository(out);
      copyFileSync(required(flags, 'in'), out);
      stripFamily(out, kindFlag(flags), { dropTables: flags.has('drop-tables') });
      return { code: 0, output: { path: out, sha256: sha256File(out) } };
    }
    case 'seed':
      return { code: 0, output: commandSeed(flags) };
    default:
      throw new Error('Commande : extract | check | merge | strip | seed');
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
