/**
 * Le `user_code` du device grant (RFC 8628) et ce que la page d'approbation
 * doit faire d'un refus de l'API.
 *
 * Tenu HORS du composant pour la même raison que `lib/api-key-failure.ts` :
 * ces trois décisions (ce qu'on garde d'une frappe, comment on l'affiche, où
 * mène chaque statut HTTP) sont exactement ce qui se casse en silence, et
 * `vitest.config.ts` tourne en `environment: 'node'` sur `lib/**` — donc ici
 * elles se testent, dans le composant elles ne se testeraient pas.
 */

/**
 * RFC 8628 §6.1, repris par la spec du module : base de 20 caractères, sans
 * voyelle (aucun mot involontaire) et sans chiffre (donc aucune confusion
 * 0/O ni 1/I/L). Le serveur tire dans cet alphabet, la page n'accepte que lui.
 */
export const DEVICE_USER_CODE_CHARSET = 'BCDFGHJKLMNPQRSTVWXZ';

/** Huit caractères, affichés `XXXX-XXXX` (exemple : `WDJB-MJHT`). */
export const DEVICE_USER_CODE_LENGTH = 8;

/** Là où le tiret d'affichage se pose. */
const GROUP = DEVICE_USER_CODE_LENGTH / 2;

const ALLOWED = new Set(DEVICE_USER_CODE_CHARSET.split(''));

/**
 * Ce qu'on garde d'une frappe ou d'un collage.
 *
 * 🚨 On RETIRE ce qui n'est pas dans l'alphabet, on ne le TRADUIT pas. La
 * tentation est de transformer `0` en `O` et `1` en `I` « pour aider » : ces
 * lettres n'existent pas dans la base, donc la correspondance serait inventée,
 * et un code juste pourrait devenir un autre code juste appartenant à
 * quelqu'un d'autre. Le tiret d'affichage, les espaces d'un copier-coller et
 * la casse partent ; le reste part aussi.
 */
export function normalizeUserCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (!ALLOWED.has(ch)) continue;
    out += ch;
    if (out.length === DEVICE_USER_CODE_LENGTH) break;
  }
  return out;
}

/**
 * La forme lisible, y compris pendant la frappe : `WDJ`, `WDJB`, `WDJB-M`,
 * `WDJB-MJHT`. Le tiret n'apparaît qu'une fois le premier groupe rempli, sinon
 * le champ afficherait `WDJB-` à un moment où l'humain n'a encore rien tapé du
 * second groupe.
 */
export function formatUserCode(code: string): string {
  const clean = normalizeUserCode(code);
  if (clean.length <= GROUP) return clean;
  return `${clean.slice(0, GROUP)}-${clean.slice(GROUP)}`;
}

/** Vrai quand le code est complet, donc quand `lookup` a un sens. */
export function isCompleteUserCode(code: string): boolean {
  return normalizeUserCode(code).length === DEVICE_USER_CODE_LENGTH;
}

/**
 * Le décompte, en deux morceaux de TEXTE.
 *
 * 🚨 Des chaînes, pas des nombres, et aucun `Intl` : un nombre passé à
 * next-intl est mis en forme par `Intl.NumberFormat`, qui ne rend pas la même
 * chose dans WebKit et dans Node — React casse alors sur la différence
 * d'hydratation et efface la classe de `<html>` (règle 8 du dépôt). Les
 * secondes sont complétées à deux chiffres pour que la ligne ne change pas de
 * largeur à chaque battement.
 */
export function countdownParts(totalSeconds: number): { minutes: string; seconds: string } {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return { minutes: String(minutes), seconds: seconds < 10 ? `0${seconds}` : String(seconds) };
}

/**
 * Où mène un refus de `/v1/keys/device/{lookup,approve,deny}`.
 *
 * `screen` est l'écran visé ; `'stay'` veut dire « on ne bouge pas, on affiche
 * seulement l'avertissement », ce qui est le cas des refus que l'humain peut
 * corriger sur place (une adresse jetable, un code à six chiffres faux).
 *
 * 🚨 `stale` n'est pas un écran : c'est l'ordre de relancer `lookup` UNE fois
 * puis de rejouer le geste (§4.4). L'écran `tokenStale` n'arrive qu'au second
 * échec, et c'est l'appelant qui en décide, pas cette table.
 *
 * 🚨 Le 404 est volontairement uniforme côté API (inconnu, expiré et déjà
 * tranché rendent le même corps) : la page ne peut donc PAS dire « expiré »
 * sur un 404 sans mentir une fois sur trois. Elle dit « pas valide », et garde
 * l'écran `expired` pour le seul cas où elle sait : son propre décompte est
 * tombé à zéro sous ses yeux.
 */
export type DeviceFailureRoute =
  | { screen: 'invalid' }
  | { screen: 'stale' }
  | { screen: 'stay'; notice: 'keyRateLimited' }
  | { screen: 'stay'; notice: 'apiMessage' };

export function routeDeviceFailure(status: number, error: unknown): DeviceFailureRoute {
  const kind = typeof error === 'string' ? error : '';

  // Code inconnu, périmé, ou déjà approuvé / refusé : un seul corps, un seul écran.
  if (kind === 'invalid_or_expired' || status === 404) return { screen: 'invalid' };

  // Jeton absent, inconnu, expiré, ou périmé par un `lookup` plus récent
  // (deuxième onglet). Rattrapable sans rien dire à l'humain.
  if (kind === 'approval_token_required') return { screen: 'stale' };

  // Une clé par adresse et par jour : le bouton d'à côté marche, et c'est le
  // seul refus du lot où l'écran doit reproposer l'issue immédiate.
  if (kind === 'key_rate_limited') return { screen: 'stay', notice: 'keyRateLimited' };

  // Tout le reste (adresse jetable ou injoignable, plafond d'envoi de codes,
  // code faux, relais de courrier en panne, 415, inconnu) : on reste où on est
  // et on montre le `message` de l'API, écrit pour être actionnable. Aucun
  // texte de notre cru : la spec ne nous en donne pas pour ces cas.
  return { screen: 'stay', notice: 'apiMessage' };
}
