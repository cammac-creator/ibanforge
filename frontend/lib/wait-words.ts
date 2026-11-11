/**
 * Une attente rendue par l'API (`retry_after` dans le corps, ou l'en-tête
 * `Retry-After`), en secondes, dite en mots : l'unité et le nombre, à passer au
 * message `common.wait` (« environ 25 minutes », « about 3 hours »).
 *
 * Pas d'`Intl` ni de pluriel ICU ici : ces textes s'affichent dans des
 * composants client (règle 8 d'`AGENTS.md`). Le nombre traverse en chaîne et
 * l'unité choisit sa forme par un `select` du message.
 *
 * Arrondi vers le HAUT, et toujours précédé de « environ » dans le message :
 * l'attente dite n'est jamais plus courte que celle de l'API. En minutes
 * jusqu'à deux heures (« environ 61 minutes » plutôt que « environ 2 heures »),
 * en heures au-delà.
 *
 * `null` quand la valeur n'est pas une attente utilisable (absente, vide, pas un
 * nombre, nulle ou négative) : l'appelant garde alors son texte sans délai.
 */
export type WaitUnit = 'minute' | 'minutes' | 'hours';

export interface WaitParts {
  unit: WaitUnit;
  count: string;
}

export function waitParts(retryAfter: unknown): WaitParts | null {
  const seconds =
    typeof retryAfter === 'number'
      ? retryAfter
      : typeof retryAfter === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(retryAfter)
        ? Number(retryAfter)
        : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return { unit: 'minute', count: '1' };
  if (minutes < 120) return { unit: 'minutes', count: String(minutes) };
  const hours = Math.ceil(seconds / 3600);
  return { unit: 'hours', count: String(hours) };
}
