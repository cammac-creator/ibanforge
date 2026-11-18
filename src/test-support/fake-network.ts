import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Lance un script de `scripts/` comme le robot le lance (`tsx`, processus à part), avec un
 * réseau simulé : un module chargé par `NODE_OPTIONS=--import` dans le processus ENFANT
 * seulement remplace `fetch` et répond selon une table adresse → réponse ; toute autre
 * adresse répond 503. Aucune requête ne sort (même procédé que
 * scripts/restricted-seeders-offline.test.ts).
 *
 * L'enfant ne reçoit aucune variable `GITHUB_*` du test : sous le robot, la suite tourne
 * dans le job de travail, et un `GITHUB_OUTPUT` hérité écrirait dans les sorties du vrai
 * passage. Sa sortie est capturée : une annotation `::warning::` reste dans le test.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

/** Une réponse simulée : un statut, et un corps tiré d'un fichier ou d'un texte. */
export interface FakeAnswer {
  status?: number;
  file?: string;
  text?: string;
}

const PRELOAD = `
import { readFileSync } from 'node:fs';
const answers = JSON.parse(readFileSync(process.env.FAUX_RESEAU_REPONSES, 'utf8'));
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const answer = answers[url];
  if (!answer) return new Response('indisponible', { status: 503 });
  const body = answer.file ? readFileSync(answer.file) : (answer.text ?? '');
  return new Response(body, { status: answer.status ?? 200 });
};
`;

/**
 * `script` est relatif à `scripts/` ; `dir`, un dossier temporaire du test, reçoit le
 * module de remplacement et la table des réponses ; `env` s'ajoute à l'environnement
 * de l'enfant (le chemin du fichier écrit, `GITHUB_OUTPUT`).
 */
export function runScriptOffline(
  script: string,
  answers: Record<string, FakeAnswer>,
  env: Record<string, string>,
  dir: string,
  args: string[] = [],
): SpawnSyncReturns<string> {
  const preload = join(dir, 'reseau-simule.mjs');
  const table = join(dir, 'reponses-simulees.json');
  writeFileSync(preload, PRELOAD);
  writeFileSync(table, JSON.stringify(answers));
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GITHUB_') && k !== 'NODE_OPTIONS'),
  );
  return spawnSync(TSX, [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    env: {
      ...inherited,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      FAUX_RESEAU_REPONSES: table,
      ...env,
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
}
