/**
 * L'état du bouclier, lu par ceux qui n'en sont pas propriétaires.
 *
 * Module FEUILLE : il ne lit que `kv_state`, n'écrit rien, et ne dépend que du
 * magasin clé-valeur. Il existe parce que le radar de cohortes (lot 6) a besoin
 * de savoir si une alerte court — pour sa cadence et pour la borne de son rayon
 * — alors que le disjoncteur qui la décide (`creation-breaker.ts`, lot 5) n'est
 * pas encore écrit. Sans ce module, le lot 6 importerait un fichier absent, ou
 * pire, redéclarerait sa propre lecture de l'état et les deux dériveraient.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONTRAT AVEC LE LOT 5 — trois clés `kv_state`, toutes des CHAÎNES NUES
 * ────────────────────────────────────────────────────────────────────────────
 *
 *   creation_breaker:armed       '1' quand une alerte court, toute autre valeur
 *                                (ou l'absence de la clé) veut dire « en paix ».
 *   creation_breaker:armed_at    l'instant d'armement de l'épisode en cours, en
 *                                ISO 8601 (`new Date().toISOString()`). Absente
 *                                hors épisode.
 *   creation_breaker:episode_id  l'identifiant de l'épisode en cours, tel qu'il
 *                                est écrit dans `api_keys.shield_episode` et
 *                                dans `key_revocations.episode_id`. Absente
 *                                hors épisode.
 *
 * 🚨 C'est le BRIEF du chantier qui tranche cette forme, pas la spec 02. La
 * spec 02 §3.7 nommait une clé unique `key_breaker_state` portant un objet JSON
 * `{ armed, episode_id, armed_at, ... }`. Trois chaînes nues ont été retenues :
 * elles se lisent sans `JSON.parse`, donc un état corrompu ne fait jamais jeter
 * un lecteur, et chacune se pose ou se retire seule dans un test.
 *
 * 🚨 AUCUN repli n'est lu sur `key_breaker_state`, et c'est délibéré. Un
 * double-lecteur masquerait silencieusement une rupture de ce contrat au moment
 * exact où deux lots sont coordonnés à la main : si le lot 5 écrit l'autre
 * forme, le radar doit rester visiblement en cadence de paix, pas deviner.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TANT QUE LE LOT 5 N'EST PAS LIVRÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Les trois clés sont absentes, donc `isShieldArmed()` rend `false`,
 * `shieldArmedAtMs()` et `shieldEpisodeId()` rendent `null`. Conséquences, toutes
 * voulues et toutes sûres : le radar tourne à la cadence de paix, sa passe
 * anonyme observe et rapporte `skipped_reason: 'not_armed'`, et la seconde borne
 * de son rayon (`armed_at - BREAKER_WINDOW_MINUTES`) ne s'applique pas — la
 * borne de la fenêtre de rafale, elle, s'applique toujours.
 */

import { kvGet } from './forum-radar-server.js';

/** Préfixe commun, pour qu'un `grep` retrouve les trois clés d'un coup. */
const KV_PREFIX = 'creation_breaker:';
export const KV_SHIELD_ARMED = `${KV_PREFIX}armed`;
export const KV_SHIELD_ARMED_AT = `${KV_PREFIX}armed_at`;
export const KV_SHIELD_EPISODE_ID = `${KV_PREFIX}episode_id`;

/**
 * Une alerte court-elle ?
 *
 * Ne jette jamais : une base illisible rend `false`, c'est-à-dire « en paix ».
 * Le sens de ce repli est le bon : en paix, le radar observe et ne coupe rien.
 * L'inverse (« armé » par défaut) ferait dégrader les clés de tout le monde sur
 * une lecture ratée.
 */
export function isShieldArmed(): boolean {
  try {
    return kvGet(KV_SHIELD_ARMED) === '1';
  } catch {
    return false;
  }
}

/**
 * L'instant d'armement de l'épisode en cours, en millisecondes, ou `null`.
 *
 * `null` couvre les trois cas que l'appelant doit traiter de la même façon :
 * hors épisode, clé absente, valeur illisible. Un appelant qui a besoin de la
 * borne `armed_at - fenêtre` ne l'applique alors pas, au lieu de la calculer sur
 * une date inventée.
 */
export function shieldArmedAtMs(): number | null {
  try {
    const raw = kvGet(KV_SHIELD_ARMED_AT);
    if (!raw) return null;
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/** L'identifiant de l'épisode en cours, ou `null` hors épisode. */
export function shieldEpisodeId(): string | null {
  try {
    return kvGet(KV_SHIELD_EPISODE_ID) ?? null;
  } catch {
    return null;
  }
}
