/**
 * La surcouche privée vue par l'exploitation : le journal et les alertes du
 * démarrage et de la veille.
 *
 * Séparé de `src/index.ts` pour être éprouvé par des tests (relecture de la
 * PR 252, R9) : deux clés d'alerte restaient « ouvertes » à jamais, et la panne
 * suivante sur la même clé se taisait (`opsFail` ne dit rien tant qu'une clé est
 * ouverte, et l'état survit aux redémarrages dans `kv_state`).
 *
 * Les clés :
 * - `overlay:<base>` : ce qui est servi au démarrage ou après un rechargement.
 *   Rouge quand le fichier de la variable n'est pas servi en entier (refus,
 *   refus partiel, ou dernière surcouche acceptée servie à sa place). Jamais
 *   rouge pour `kept_public` : un public plus récent est servi, c'est voulu.
 * - `overlay:<base>:reload` : un nouveau fichier refusé par la veille. Fermée par
 *   un rechargement réussi, ET par un démarrage qui sert le fichier de la
 *   variable (sinon un bon dépôt suivi d'un redémarrage la laissait ouverte).
 * - `overlay:reload` : une exception pendant le rechargement. Fermée par le
 *   premier rechargement qui aboutit.
 */
import { opsFail, opsOk } from './ops-alert.js';
import {
  describeOverlayStatus,
  reloadRestrictedOverlays,
  restrictedOverlaysChanged,
  restrictedOverlayStatus,
  servesOverlay,
  type OverlayStatus,
} from './restricted-overlay-runtime.js';

function refusedMembers(status: OverlayStatus): string {
  return status.members
    .filter((m) => m.state === 'refused')
    .map((m) => `${m.id} (${m.reason ?? '?'})`)
    .join(', ');
}

/** Ce que l'API sert d'une base, dit en une phrase pour l'alerte. */
function servingSentence(status: OverlayStatus): string {
  if (status.fallback) return 'la dernière surcouche acceptée est servie';
  if (servesOverlay(status.state)) return 'la surcouche précédente reste servie';
  return 'base publique seule, les données manquantes répondent « non consulté »';
}

/** Journal et alerte `overlay:<base>` pour des états servis. */
export function reportRestrictedOverlays(statuses: OverlayStatus[]): void {
  for (const status of statuses) {
    // L'entretien des fichiers : sans copie acceptée gardée, un fichier refusé au
    // prochain démarrage ne serait plus remplacé par la dernière surcouche.
    if (status.housekeeping_error)
      void opsFail(
        `overlay:${status.kind}:files`,
        `Surcouche privée ${status.kind} : entretien des fichiers en échec (${status.housekeeping_error}). ` +
          'Ce qui est servi est intact ; la copie acceptée peut manquer.',
      );
    else void opsOk(`overlay:${status.kind}:files`);
    const line = describeOverlayStatus(status);
    const key = `overlay:${status.kind}`;
    const whole =
      !status.fallback &&
      (status.state === 'applied' || status.state === 'kept_public' || status.state === 'off');
    if (whole) {
      console.log(line);
      void opsOk(key, status.state === 'off' ? '' : 'surcouche privée servie');
      continue;
    }
    console.error(line);
    const what = status.fallback
      ? `fichier de la variable refusé (${status.error ?? '?'}) : la dernière surcouche acceptée est servie à sa place`
      : status.state === 'partial'
        ? `servie en partie ; membres refusés : ${refusedMembers(status)}. Ils répondent depuis la base publique, ou « non consulté » s'ils n'y sont plus`
        : `NON servie (${status.error ?? '?'}) : base publique seule, les données manquantes répondent « non consulté »`;
    void opsFail(key, `Surcouche privée ${status.kind} ${what}.`);
  }
}

/** Au démarrage, après l'ouverture des deux bases. */
export function reportBootOverlays(): void {
  const statuses = restrictedOverlayStatus();
  reportRestrictedOverlays(statuses);
  // Le fichier de la variable est servi : un refus signalé avant ce démarrage
  // n'a plus cours (R9). Pas quand la copie acceptée le remplace : le fichier
  // de la variable est encore refusé.
  for (const s of statuses)
    if (s.state !== 'refused' && !s.fallback)
      void opsOk(`overlay:${s.kind}:reload`, 'surcouche du démarrage servie');
}

/**
 * Un passage de la veille : ne recharge que les bases dont le fichier a changé
 * depuis le dernier vu, qu'il ait été accepté ou refusé (R1, R5).
 */
export function overlayWatchTick(): void {
  try {
    const changed = restrictedOverlaysChanged();
    if (changed.length === 0) return;
    for (const outcome of reloadRestrictedOverlays(changed)) {
      if (outcome.rejected) {
        const reason =
          outcome.rejected.error ??
          (refusedMembers(outcome.rejected) || 'un membre servi aujourd’hui serait perdu');
        const serving = servingSentence(outcome.status);
        console.error(`${describeOverlayStatus(outcome.rejected)} — ${serving}`);
        void opsFail(
          `overlay:${outcome.kind}:reload`,
          `Nouvelle surcouche ${outcome.kind} refusée (${reason}) : ${serving}.`,
        );
      } else if (outcome.changed) {
        reportRestrictedOverlays([outcome.status]);
        void opsOk(`overlay:${outcome.kind}:reload`, 'surcouche rechargée');
      }
    }
    // Seulement après un rechargement revenu sans exception (R9).
    void opsOk('overlay:reload');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Restricted overlay reload failed:', msg);
    void opsFail('overlay:reload', `Rechargement de la surcouche en échec : ${msg}`);
  }
}
