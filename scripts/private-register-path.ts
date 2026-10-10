/**
 * Où les registres estonien et monténégrin s'écrivent : un fichier PRIVÉ, jamais
 * dans une partie suivie du dépôt.
 *
 * La permission de la Finantsinspektsioon et celle de la Banque centrale du
 * Monténégro portent sur les réponses de l'API, « one entry per request » : la
 * table entière n'entre pas dans ce dépôt public (décision de la session
 * principale, 08/10/2026), comme celle de la Grèce (scripts/seed-gr-register.ts).
 *
 * Par défaut, les chargeurs écrivent sous docs/internal/, que .gitignore écarte
 * ("Private internal reports", jamais publié). Un chemin choisi par la variable
 * `EE_REGISTER_PATH` ou `ME_REGISTER_PATH` peut être ailleurs. Un chemin situé
 * dans un dépôt git n'est accepté que si git l'ignore : le contrôle est fait par
 * `git check-ignore`, pas par une règle écrite ici.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Le dossier privé par défaut des deux fichiers (ignoré par git). */
export const PRIVATE_REGISTERS_DIR = resolve(here, '../docs/internal/registres-ee-me-2026-10-08');

/** Le chemin où écrire : la variable d'environnement, sinon le dossier privé par défaut. */
export function privateRegisterPath(variable: string, fileName: string): string {
  return process.env[variable] || join(PRIVATE_REGISTERS_DIR, fileName);
}

/** Le dossier git qui contient ce chemin, ou null. */
export function enclosingRepository(path: string): string | null {
  let dir = dirname(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Refuse un chemin relatif, qui n'est pas du JSON, ou que git suivrait dans un dépôt. */
export function assertPrivateRegisterPath(path: string): void {
  if (!isAbsolute(path) || !path.endsWith('.json')) {
    throw new Error('Chemin JSON privé absolu requis');
  }
  const repository = enclosingRepository(path);
  if (!repository) return;
  // Sortie 0 : ignoré. 1 : suivi ou à suivre. 128 : git ne répond pas. Seul 0 passe.
  const verdict = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd: repository });
  if (verdict.status !== 0) {
    throw new Error(
      `Refus : ${path} est dans un dépôt git (${repository}) et .gitignore ne l'écarte pas : la table n'y entre pas`,
    );
  }
}
