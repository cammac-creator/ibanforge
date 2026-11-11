/**
 * La garde des exports publics (audit du 10.11.2026, OPS-31#1).
 *
 * `npm run pages:export`, `npm run pages:export-countries` et
 * `scripts/capture-fold-response.ts` écrivent sous `frontend/` des réponses de
 * l'API calculées en mémoire, et ces fichiers sont commités dans ce dépôt public
 * puis copiés dans l'image publique du site. Lancés sur une machine où une
 * variable désigne une donnée privée (la surcouche de la famille sous conditions,
 * `src/lib/restricted-family.ts`, ou un registre servi depuis un fichier privé
 * comme `GR_REGISTER_PATH`), ils ouvriraient la base fusionnée (`src/lib/db.ts`)
 * et recopieraient ces lignes dans un fichier public, sans qu'aucun test ne
 * rougisse. Ils refusent donc de tourner tant qu'une de ces variables est posée.
 *
 * Posée veut dire non vide : c'est la règle de l'API elle-même
 * (`restricted-overlay-runtime.ts`, `process.env[…] || null`). Seul le NOM de la
 * variable est imprimé, jamais sa valeur.
 *
 * Ce module n'importe que `restricted-family.ts`, qui n'importe rien : il peut
 * être chargé avant tout module de l'API.
 */
import { OVERLAY_ENV } from '../src/lib/restricted-family.js';

/** Les variables de la surcouche, présentes et à venir (`RESTRICTED_BIC_OVERLAY_PATH`…). */
const OVERLAY_NAME = /^RESTRICTED_[A-Z0-9_]*OVERLAY_PATH$/;

/**
 * Les registres servis depuis un fichier privé, un par pays (`GR_REGISTER_PATH`,
 * `LU_REGISTER_PATH`, `EE_REGISTER_PATH`, `ME_REGISTER_PATH`, `RS_REGISTER_PATH`) :
 * leurs permissions couvrent les réponses de l'API, jamais un export ni une page.
 */
const PRIVATE_REGISTER_NAME = /^[A-Z]{2}_REGISTER_PATH$/;

/** Les variables de données privées posées dans `env`, triées, sans leur valeur. */
export function privateDataVariables(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = new Set<string>(Object.values(OVERLAY_ENV));
  for (const name of Object.keys(env)) {
    if (OVERLAY_NAME.test(name) || PRIVATE_REGISTER_NAME.test(name)) names.add(name);
  }
  return [...names].filter((name) => (env[name] ?? '') !== '').sort();
}

/**
 * Arrête le script (code 1) quand une donnée privée est désignée. À appeler avant
 * tout `import` de l'API : la base n'est ouverte qu'au premier appel, mais rien
 * ne doit être chargé dans un environnement refusé.
 */
export function refusePrivateData(script: string, env: NodeJS.ProcessEnv = process.env): void {
  const names = privateDataVariables(env);
  if (names.length === 0) return;
  console.error(
    `${script}: refused, ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} set. ` +
      'This export writes public files from the public databases only: unset ' +
      `${names.length === 1 ? 'it' : 'them'} and run it again.`,
  );
  process.exit(1);
}
