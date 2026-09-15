/**
 * Le disjoncteur global de création de clés (chantier « clé sans e-mail », lot 5).
 *
 * Il compte les créations de clés TOUTES IP CONFONDUES sur une fenêtre
 * glissante. Au-delà du seuil, et seulement si ces créations viennent d'assez
 * de réseaux distincts, il ARME une alerte : toute clé neuve qui n'a pas prouvé
 * une boîte naît alors avec un plafond réduit, sans recharge le 1er. Quand le
 * calme revient, il désarme et les clés de l'épisode remontent d'elles-mêmes.
 *
 * 🚨 IL DÉGRADE, IL NE REFUSE JAMAIS. Aucun code HTTP nouveau, jamais de 429 ni
 * de 503 : un blocage global serait un levier de déni de service (dix requêtes
 * et plus personne ne s'inscrit). C'est la raison d'être de tout le module.
 *
 * Pourquoi un fichier neuf et pas un ajout à `key-creation-guard.ts` : ce
 * dernier est le garde PAR RÉSEAU et son en-tête le dit. Le disjoncteur compte
 * l'inverse, toutes IP confondues. Les mélanger produirait un fichier dont
 * l'en-tête mentirait.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI TIENT L'ARMEMENT, ET POURQUOI CHAQUE CLAUSE EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  - LE VOLUME NE SUFFIT PAS. Il faut aussi `BREAKER_MIN_DISTINCT_SOURCES`
 *    `ip_hash` distincts. Sans cette clause, le disjoncteur est un déni de
 *    service à cinq adresses : le plafond par réseau autorise trois clés par
 *    24 h, donc cinq machines posent quinze créations, arment l'alerte, et
 *    toute clé honnête de l'heure suivante naît dégradée — POUR LA VIE DE LA
 *    CLÉ, puisque `no_recredit` se mesure tous mois confondus. Un pic honnête,
 *    lui, est diversifié par construction.
 *
 *  - LA SENTINELLE `unknown` NE COMPTE PAS COMME UN RÉSEAU. C'est le seau
 *    partagé par tous les chemins de frappe sans empreinte : la compter dans la
 *    diversité permettrait à une seule source d'emprunter un chemin sans
 *    empreinte pour gonfler le nombre de réseaux. Elle compte dans le VOLUME
 *    (c'est là tout l'intérêt de la ligne de naissance inconditionnelle),
 *    jamais dans la diversité.
 *
 *  - UN ÉPISODE EST BORNÉ DANS LE TEMPS (`BREAKER_EPISODE_MAX_HOURS`). Au-delà
 *    il se désarme quoi qu'il arrive, même si le dépassement continue. Motif :
 *    une ferme qui accepte d'armer le bouclier en permanence se moque du seuil,
 *    donc l'état armé est le cas NORMAL et non l'exception ; un état normal qui
 *    dégrade tous les nouveaux venus sans borne de durée est un déni de service
 *    que l'attaquant entretient pour le prix de quelques créations par heure.
 *
 *  - LE DÉSARMEMENT REND LES QUOTAS. Sans la remontée, un épisode entretenu à
 *    quelques créations par heure suffirait à détruire le palier de départ pour
 *    toute clé honnête née pendant ce temps.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE SEUIL EST FIXE DANS CETTE LIVRAISON
 * ────────────────────────────────────────────────────────────────────────────
 * Le tirage aléatoire du seuil entre deux bornes, que la spec décrit, part en
 * extension : il ne gêne que la ferme qui veut rester SILENCIEUSE, et la
 * stratégie dominante au-delà de quelques centaines d'adresses est la bruyante.
 * Le seuil de 10 par heure est calibré sur une ligne de base relevée à part :
 * plusieurs fois au-dessus de toute heure honnête observée, et très en dessous
 * de la rafale qui a motivé le chantier. 🚨 Si un nouveau relevé déplace la
 * ligne de base, c'est le seuil qui bouge, pas la clause de diversité.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * L'ÉTAT : SEPT CHAÎNES NUES DANS `kv_state`, AUCUN JSON
 * ────────────────────────────────────────────────────────────────────────────
 * Les trois premières sont le CONTRAT avec `shield-state.ts` (lot 6), qui les
 * lit sans jamais les écrire ; leurs noms sont importés de là, jamais retapés
 * — un nom qui dérive d'un caractère laisserait le radar visiblement en
 * cadence de paix, sans erreur nulle part. Les quatre autres appartiennent à ce
 * module et suivent le même préfixe et la même forme.
 *
 * Pourquoi pas un objet JSON unique : une chaîne nue se lit sans `JSON.parse`,
 * donc un état corrompu ne fait jamais jeter un lecteur, et chaque clé se pose
 * ou se retire seule dans un test.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LES DATES : DEUX FORMES, ET UNE SEULE FRONTIÈRE
 * ────────────────────────────────────────────────────────────────────────────
 * 🚨 `datetime('now')` écrit « YYYY-MM-DD HH:MM:SS » en UTC, SANS ZONE. Lue par
 * `new Date()` telle quelle, cette chaîne est interprétée en heure LOCALE et
 * toute fenêtre glissante qui la lit glisse du décalage de la machine — sans
 * qu'aucun test ne rougisse, et en armant ou désarmant au mauvais moment.
 *
 * Ce module ne franchit cette frontière qu'à UN endroit, et dans le sens
 * inverse : la borne basse de la fenêtre est calculée en JS depuis le `now`
 * injecté, puis rendue au format exact de SQLite par `toSqliteUtc`
 * (`src/lib/cohort-radar.ts`, le pendant de `creationMs`). La comparaison se
 * fait donc entre deux chaînes UTC, et l'heure qui décide est celle que
 * l'appelant a injectée — ce qui rend le rejeu d'un incident reproductible.
 * Tout le reste de l'état est en ISO 8601 (`toISOString()`), forme qui porte sa
 * zone et que `Date.parse` lit sans ambiguïté.
 */

import { getStatsDB } from './db.js';
import { kvGet, kvSet } from './forum-radar-server.js';
import { notifyOps } from './ops-alert.js';
import {
  BREAKER_MIN_DISTINCT_SOURCES,
  BREAKER_WINDOW_MINUTES,
  UNKNOWN_SOURCE,
  toSqliteUtc,
} from './cohort-radar.js';
import { KV_SHIELD_ARMED, KV_SHIELD_ARMED_AT, KV_SHIELD_EPISODE_ID } from './shield-state.js';
import { SHIELD_MONTHLY_LIMIT } from './tiers.js';
import { undegradeEpisode } from './api-keys.js';
import { bumpTrialDayShieldMinutes } from './daily-ip-ledger.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * Créations, toutes IP confondues, qui arment l'alerte dans la fenêtre.
 *
 * La seule constante du disjoncteur qui lui appartienne : la fenêtre et le
 * seuil de diversité sont déclarés par `cohort-radar.ts`, qui en a besoin pour
 * borner le rayon de sa rafale, et sont IMPORTÉS ici. Deux autorités sur un
 * seuil de sécurité, c'est une divergence silencieuse programmée.
 */
export const BREAKER_THRESHOLD = 10;

/**
 * Minutes sans dépassement avant le désarmement.
 *
 * Volontairement ÉGALE à la fenêtre du compteur, et ce n'est pas une
 * coïncidence à « factoriser » plus tard : la fenêtre est exactement la mémoire
 * du compteur. Une fois `BREAKER_WINDOW_MINUTES` écoulées sans dépassement, la
 * rafale a entièrement quitté la fenêtre — le calme constaté est donc le même
 * fait que « le compteur est redescendu », pas un second réglage.
 */
export const BREAKER_CALM_MINUTES = BREAKER_WINDOW_MINUTES;

/**
 * Durée maximale d'un épisode, en heures. Au-delà, désarmement forcé.
 *
 * 3 h et non 6 h : 6 h est le seuil de la sonde `breaker:stuck`, qui doit
 * rester le témoin d'une BORNE QUI N'A PAS FONCTIONNÉ (tick mort, `kv_state`
 * figé), jamais la borne elle-même.
 */
export const BREAKER_EPISODE_MAX_HOURS = 3;

/** Heures d'armement au-delà desquelles la sonde `breaker:stuck` crie. */
export const BREAKER_STUCK_HOURS = 6;

/** Échecs consécutifs de mesure au-delà desquels `breaker:blind` crie. */
export const BREAKER_BLIND_STREAK = 3;

/** Le nom de l'interrupteur de crise, exporté pour que les tests ne le retapent pas. */
export const BREAKER_DISABLED_ENV = 'IBANFORGE_BREAKER_DISABLED';

/** Le nom de l'opt-in de révocation (lot 6), pour la route d'administration. */
export const REVOCATION_ENABLED_ENV = 'IBANFORGE_REVOCATION_ENABLED';

const KV_PREFIX = 'creation_breaker:';
/** Dernier dépassement constaté de l'épisode en cours, ISO. Absente hors épisode. */
export const KV_LAST_EXCEEDED_AT = `${KV_PREFIX}last_exceeded_at`;
/** Fin du dernier épisode, ISO. Gardée après le désarmement, pour la relecture. */
export const KV_DISARMED_AT = `${KV_PREFIX}disarmed_at`;
/** Échecs de mesure consécutifs, entier décimal. Absente = zéro. */
export const KV_BLIND_STREAK = `${KV_PREFIX}blind_streak`;
/** Dernier instant d'alerte déjà porté au registre de l'essai, ISO. */
export const KV_MINUTES_MARKED_AT = `${KV_PREFIX}minutes_marked_at`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ce que la mesure rend, et que la décision consomme. */
export interface BreakerReading {
  count: number;
  distinctSources: number;
}

export interface BreakerState {
  armed: boolean;
  episode_id: string | null;
  armed_at: string | null;
  last_exceeded_at: string | null;
  disarmed_at: string | null;
  blind_streak: number;
}

/**
 * Une bascule, en un seul mot.
 *
 * Le journal la range en DEUX colonnes (`direction` et `reason`) parce qu'un
 * opérateur filtre sur le sens et lit le motif ; le code, lui, manipule un
 * jeton unique, qui se lit d'un coup d'œil dans un test.
 */
export type BreakerTransition =
  'armed' | 'disarmed' | 'disarmed_capped' | 'disarmed_env' | 'disarmed_manual' | null;

export type BreakerDirection = 'armed' | 'disarmed';
export type BreakerReason = 'threshold' | 'calm' | 'capped' | 'env' | 'manual';

/** Ce qui a déclenché la bascule. `claims` et `trial` sont RÉSERVÉS, non écrits. */
export type BreakerTrigger = 'creations' | 'claims' | 'trial';

export interface BreakerTransitionRow {
  id: number;
  episode_id: string;
  direction: BreakerDirection;
  reason: BreakerReason;
  trigger: BreakerTrigger;
  creations_in_window: number;
  distinct_sources: number;
  threshold: number;
  window_minutes: number;
  undegraded: number;
  telegram_sent: number;
  created_at: string;
}

const EMPTY: BreakerState = {
  armed: false,
  episode_id: null,
  armed_at: null,
  last_exceeded_at: null,
  disarmed_at: null,
  blind_streak: 0,
};

// ---------------------------------------------------------------------------
// Les gardes d'environnement
// ---------------------------------------------------------------------------

/**
 * L'interrupteur de crise du disjoncteur, ET la garde qui l'empêche de s'armer
 * tout seul dans la CI.
 *
 * 🚨 Elle DÉSARME, elle ne se contente pas de rendre « non armé ». La nuance a
 * déjà coûté une panne de raisonnement : un lecteur qui rend `false` sans
 * écrire laisse `creation_breaker:armed` à `'1'` dans `kv_state`, donc
 * `isShieldArmed()` (lot 6, qu'on ne peut pas changer) continue de rendre vrai
 * indéfiniment, le radar reste en cadence d'alerte, et l'état devient
 * irréversible sauf appel d'administration. L'interrupteur nommé « sortie de
 * crise » aurait alors laissé tourner exactement ce qu'il devait arrêter.
 *
 * 🚨 Lue à CHAQUE décision, jamais au niveau du module : un drapeau lu à
 * l'import demanderait le redéploiement qu'il existe pour éviter.
 *
 * 🚨 Distincte de `IBANFORGE_REVOCATION_ENABLED` (lot 6) et de
 * `ANONYMOUS_TIER_DISABLED` (lot 3) : aucune de ces trois ne partage son nom
 * avec une autre. Les confondre allumerait la révocation en production le jour
 * où l'on désarme le disjoncteur en test.
 */
export function breakerDisabledByEnv(): boolean {
  return process.env[BREAKER_DISABLED_ENV] === '1';
}

/**
 * La révocation par rafale est-elle allumée ?
 *
 * Opt-in : absente, le radar détecte et rapporte sans rien couper. Un mécanisme
 * qui coupe des clés sur un déclencheur empoisonnable pour deux clés ne
 * s'active pas par défaut ; il s'arme sur une décision datée. Et
 * l'interrupteur de crise l'éteint aussi : sortir de crise ne peut pas laisser
 * tourner l'action la plus dangereuse du module.
 */
export function revocationEnabled(): boolean {
  return process.env[REVOCATION_ENABLED_ENV] === '1' && !breakerDisabledByEnv();
}

// ---------------------------------------------------------------------------
// L'état
// ---------------------------------------------------------------------------

/** Une clé `kv_state` retirée. Absent veut dire quelque chose ; vide ne le dit pas. */
function kvClear(key: string): void {
  // `kvGet` garantit l'existence de la table avant le DELETE (`ensureKvTable`
  // n'est pas exporté, et un DELETE sur une table absente jette) et évite
  // l'écriture quand il n'y a rien à retirer.
  if (kvGet(key) === undefined) return;
  getStatsDB().prepare('DELETE FROM kv_state WHERE key = ?').run(key);
}

/**
 * L'état tel qu'il est écrit. Ne jette jamais : une base illisible rend l'état
 * vide, c'est-à-dire « en paix », qui est le repli sûr — l'inverse ferait
 * dégrader les clés de tout le monde sur une lecture ratée.
 */
export function readBreakerState(): BreakerState {
  try {
    const streak = Number.parseInt(kvGet(KV_BLIND_STREAK) ?? '0', 10);
    return {
      armed: kvGet(KV_SHIELD_ARMED) === '1',
      episode_id: kvGet(KV_SHIELD_EPISODE_ID) ?? null,
      armed_at: kvGet(KV_SHIELD_ARMED_AT) ?? null,
      last_exceeded_at: kvGet(KV_LAST_EXCEEDED_AT) ?? null,
      disarmed_at: kvGet(KV_DISARMED_AT) ?? null,
      blind_streak: Number.isFinite(streak) && streak > 0 ? streak : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Une alerte court-elle ?
 *
 * 🚨 Cette lecture ne porte AUCUNE garde d'environnement, et c'est délibéré :
 * ce qui doit être neutralisé, c'est l'ARMEMENT, jamais la lecture. Une lecture
 * gardée rendrait `armed` toujours faux là où la garde est posée, donc tout
 * rejeu d'incident qui arme l'état à la main échouerait sans rien dire.
 */
export function isBreakerArmed(): boolean {
  return readBreakerState().armed;
}

/**
 * Écrit l'état. Les clés d'un épisode terminé sont RETIRÉES, pas vidées : le
 * contrat de `shield-state.ts` dit « absente hors épisode », et une chaîne vide
 * ferait rendre `''` à `shieldEpisodeId()` là où le lot 6 attend `null`.
 */
function writeBreakerState(st: BreakerState): void {
  if (st.armed) {
    kvSet(KV_SHIELD_ARMED, '1');
    kvSet(KV_SHIELD_ARMED_AT, st.armed_at ?? '');
    kvSet(KV_SHIELD_EPISODE_ID, st.episode_id ?? '');
    if (st.last_exceeded_at) kvSet(KV_LAST_EXCEEDED_AT, st.last_exceeded_at);
  } else {
    kvClear(KV_SHIELD_ARMED);
    kvClear(KV_SHIELD_ARMED_AT);
    kvClear(KV_SHIELD_EPISODE_ID);
    kvClear(KV_LAST_EXCEEDED_AT);
    kvClear(KV_MINUTES_MARKED_AT);
    if (st.disarmed_at) kvSet(KV_DISARMED_AT, st.disarmed_at);
  }
  if (st.blind_streak > 0) kvSet(KV_BLIND_STREAK, String(st.blind_streak));
  else kvClear(KV_BLIND_STREAK);
}

// ---------------------------------------------------------------------------
// Le compteur
// ---------------------------------------------------------------------------

/**
 * La borne basse de la fenêtre, au format exact que `datetime('now')` écrit.
 *
 * Exportée pour être testée seule : c'est l'unique endroit du module où une
 * date JS devient une date SQLite, donc l'unique endroit où le fuseau de la
 * machine pourrait s'inviter. Un test de fuseau la pose contre une valeur
 * attendue en UTC.
 */
export function windowFloorSql(now: Date, minutes: number = BREAKER_WINDOW_MINUTES): string {
  return toSqliteUtc(now.getTime() - minutes * 60_000);
}

/**
 * Les créations de la fenêtre glissante, et le nombre de réseaux distincts qui
 * les ont faites.
 *
 * 🚨 UNE seule requête agrégée, pas deux. Deux requêtes séparées seraient lues
 * à deux instants et pourraient se contredire à la frontière de la fenêtre ; et
 * le chemin chaud (une inscription) n'a pas à payer deux balayages.
 *
 * `ip_hash <> 'unknown'` sur le seul COUNT DISTINCT : la sentinelle compte dans
 * le volume, jamais dans la diversité. Voir l'en-tête du fichier.
 *
 * Fenêtre glissante et non seau horaire : la borne haute est `now` et la
 * fonction est réévaluée à chaque création, donc il n'y a pas de remise à zéro
 * à l'heure ronde qu'une ferme pourrait chevaucher.
 */
export function readCreations(
  now: Date = new Date(),
  minutes: number = BREAKER_WINDOW_MINUTES,
): BreakerReading {
  const row = getStatsDB()
    .prepare(
      `SELECT COUNT(*) AS n,
              COUNT(DISTINCT CASE WHEN ip_hash <> ? THEN ip_hash END) AS s
         FROM key_creations
        WHERE created_at >= ?`,
    )
    .get(UNKNOWN_SOURCE, windowFloorSql(now, minutes)) as { n: number; s: number };
  return { count: row.n, distinctSources: row.s };
}

/** Le volume seul, pour les tests et la route d'administration. */
export function countRecentCreations(
  now: Date = new Date(),
  minutes: number = BREAKER_WINDOW_MINUTES,
): number {
  return readCreations(now, minutes).count;
}

// ---------------------------------------------------------------------------
// La décision, pure
// ---------------------------------------------------------------------------

/**
 * Que devient l'état, vu cette mesure et cette heure ?
 *
 * Pure et testable seule. `now` est injecté et jamais lu à l'horloge, pour que
 * le rejeu d'un incident soit reproductible.
 *
 * `changed` est RENDU par la décision, jamais deviné par une égalité de
 * référence : rester armé en repoussant la sortie est un changement d'état qui
 * doit être persisté, alors qu'aucune transition n'est franchie.
 */
export function decideBreaker(
  reading: BreakerReading,
  prev: BreakerState,
  now: Date,
): { next: BreakerState; transition: BreakerTransition; changed: boolean } {
  const exceeded =
    reading.count >= BREAKER_THRESHOLD && reading.distinctSources >= BREAKER_MIN_DISTINCT_SOURCES;
  const nowIso = now.toISOString();

  // La borne de durée passe AVANT tout le reste : un épisode capé se désarme
  // même si le dépassement continue. C'est ce qui interdit l'armement perpétuel.
  if (prev.armed && prev.armed_at) {
    const ageMs = now.getTime() - Date.parse(prev.armed_at);
    if (Number.isFinite(ageMs) && ageMs >= BREAKER_EPISODE_MAX_HOURS * 3_600_000) {
      return {
        next: { ...prev, armed: false, disarmed_at: nowIso },
        transition: 'disarmed_capped',
        changed: true,
      };
    }
  }

  if (exceeded) {
    // On reste armé et on repousse la sortie : la fenêtre de calme repart du
    // dernier dépassement, pas du début de l'épisode.
    if (prev.armed) {
      return { next: { ...prev, last_exceeded_at: nowIso }, transition: null, changed: true };
    }
    return {
      next: {
        ...prev,
        armed: true,
        // L'identifiant d'un épisode EST son instant d'armement : il est unique
        // par construction (un seul épisode court à la fois) et il se lit sans
        // table de correspondance dans `api_keys.shield_episode` comme dans
        // `key_revocations.episode_id`.
        episode_id: nowIso,
        armed_at: nowIso,
        last_exceeded_at: nowIso,
        disarmed_at: null,
      },
      transition: 'armed',
      changed: true,
    };
  }

  if (!prev.armed) return { next: prev, transition: null, changed: false };

  // 🚨 Un `last_exceeded_at` illisible vaut « calme », donc désarmement : un
  // état corrompu doit rendre la liberté, jamais l'enfermer. Même doctrine pour
  // `armed_at` illisible plus haut — la borne de durée ne s'applique pas, mais
  // la fenêtre de calme, elle, finit par désarmer.
  const since = prev.last_exceeded_at ? Date.parse(prev.last_exceeded_at) : Number.NaN;
  const calm = Number.isNaN(since) ? true : now.getTime() - since >= BREAKER_CALM_MINUTES * 60_000;
  if (!calm) return { next: prev, transition: null, changed: false };
  return {
    next: { ...prev, armed: false, disarmed_at: nowIso },
    transition: 'disarmed',
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// Le journal
// ---------------------------------------------------------------------------

function directionOf(t: Exclude<BreakerTransition, null>): BreakerDirection {
  return t === 'armed' ? 'armed' : 'disarmed';
}

function reasonOf(t: Exclude<BreakerTransition, null>): BreakerReason {
  switch (t) {
    case 'armed':
      return 'threshold';
    case 'disarmed':
      return 'calm';
    case 'disarmed_capped':
      return 'capped';
    case 'disarmed_env':
      return 'env';
    case 'disarmed_manual':
      return 'manual';
  }
}

/**
 * Journalise une bascule et rend l'identifiant de sa ligne.
 *
 * `threshold` et `window_minutes` sont consignés à chaque bascule : le jour où
 * ces bornes seront re-calées sur un nouveau relevé, les anciennes lignes
 * doivent rester lisibles avec les réglages qui avaient cours.
 *
 * 🚨 `"trigger"` est cité entre guillemets partout : c'est un mot-clé SQL, et
 * même si SQLite l'accepte nu comme nom de colonne, un lecteur qui recopie la
 * requête dans un autre moteur ne le saurait pas.
 */
export function recordTransition(p: {
  episodeId: string;
  transition: Exclude<BreakerTransition, null>;
  reading: BreakerReading;
  undegraded: number;
  trigger?: BreakerTrigger;
}): number {
  const res = getStatsDB()
    .prepare(
      `INSERT INTO breaker_transitions
         (episode_id, direction, reason, "trigger", creations_in_window, distinct_sources,
          threshold, window_minutes, undegraded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.episodeId,
      directionOf(p.transition),
      reasonOf(p.transition),
      p.trigger ?? 'creations',
      p.reading.count,
      p.reading.distinctSources,
      BREAKER_THRESHOLD,
      BREAKER_WINDOW_MINUTES,
      p.undegraded,
    );
  return Number(res.lastInsertRowid);
}

/** Le Telegram est parti : la ligne du journal le dit. */
export function markTransitionNotified(rowId: number): void {
  getStatsDB().prepare('UPDATE breaker_transitions SET telegram_sent = 1 WHERE id = ?').run(rowId);
}

export const TRANSITIONS_PAGE_DEFAULT = 200;
export const TRANSITIONS_PAGE_MAX = 1000;

/** Les dernières bascules, la plus récente d'abord. Ne jette jamais. */
export function listTransitions(limit: number = TRANSITIONS_PAGE_DEFAULT): BreakerTransitionRow[] {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 1, 1), TRANSITIONS_PAGE_MAX);
  try {
    return getStatsDB()
      .prepare(
        `SELECT id, episode_id, direction, reason, "trigger" AS trigger, creations_in_window,
                distinct_sources, threshold, window_minutes, undegraded, telegram_sent, created_at
           FROM breaker_transitions
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(bounded) as BreakerTransitionRow[];
  } catch (err) {
    console.error('[breaker] journal illisible:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/**
 * Le texte de la bascule, en français : le canal est francophone et le radar y
 * écrit déjà dans cette langue.
 *
 * Les nombres sont des valeurs de RUNTIME et des constantes du code, jamais des
 * chiffres d'activité réelle recopiés : le dépôt est public. Et aucune adresse
 * n'entre dans ce texte — Telegram n'est pas un sous-traitant déclaré.
 */
export function telegramFor(
  transition: Exclude<BreakerTransition, null>,
  reading: BreakerReading,
  st: BreakerState,
  undegraded: number,
  bornUnderShield: number,
): string {
  if (transition === 'armed') {
    return [
      'IBANforge · mode bouclier ARMÉ',
      `${reading.count} créations de clés en ${BREAKER_WINDOW_MINUTES} min depuis ` +
        `${reading.distinctSources} réseaux distincts (seuil : ${BREAKER_THRESHOLD}, ` +
        `diversité exigée : ${BREAKER_MIN_DISTINCT_SOURCES}).`,
      `Les clés neuves sans boîte prouvée naissent à ${SHIELD_MONTHLY_LIMIT} unités, ` +
        'sans recharge le 1er.',
      'Elles remonteront toutes seules au désarmement, sauf celles vues en cohorte.',
      `Épisode ${st.episode_id}, borné à ${BREAKER_EPISODE_MAX_HOURS} h.`,
      'État : GET /v1/admin/breaker.',
    ].join('\n');
  }
  const why: Record<Exclude<BreakerReason, 'threshold'>, string> = {
    calm: `${BREAKER_CALM_MINUTES} min sans dépassement`,
    capped: `borne de ${BREAKER_EPISODE_MAX_HOURS} h atteinte, le trafic peut continuer`,
    env: `interrupteur de crise ${BREAKER_DISABLED_ENV}=1`,
    manual: "geste d'administration",
  };
  return [
    'IBANforge · mode bouclier levé',
    `Motif : ${why[reasonOf(transition) as Exclude<BreakerReason, 'threshold'>]}.`,
    `Épisode ${st.episode_id} : ${bornUnderShield} clés nées sous alerte, ` +
      `${undegraded} remontées automatiquement.`,
    'Rattraper le reste : POST /v1/admin/breaker/undegrade ' +
      `{"episode_id":"${st.episode_id}","all":true}.`,
  ].join('\n');
}

/** Combien de clés portent encore cet épisode. Ne jette jamais. */
export function countEpisodeKeys(episodeId: string | null): number {
  if (!episodeId) return 0;
  try {
    const row = getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE shield_episode = ?')
      .get(episodeId) as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Les minutes sous alerte, pour la mesure
// ---------------------------------------------------------------------------

/**
 * Porte au registre de l'essai les minutes écoulées sous alerte depuis le
 * dernier passage.
 *
 * 🚨 Cette ligne est la ligne de base sur laquelle une décision encore ouverte
 * sera prise (le plafond de l'essai sous alerte). Une ligne EMPOISONNÉE est
 * donc pire qu'une ligne manquante : d'où la borne haute — un seul crédit ne
 * peut jamais dépasser la durée maximale d'un épisode — et le repli à zéro dès
 * que le repère est illisible. Le repère avance de ce qui a été crédité, jamais
 * de plus : un arrondi ne doit pas fuir d'un passage au suivant.
 */
function markShieldMinutes(st: BreakerState, now: Date): void {
  if (!st.armed) return;
  const marked = kvGet(KV_MINUTES_MARKED_AT) ?? st.armed_at;
  const fromMs = marked ? Date.parse(marked) : Number.NaN;
  if (!Number.isFinite(fromMs)) {
    // Repère illisible : on repart de maintenant et on ne crédite rien. Une
    // durée calculée depuis NaN n'a pas de valeur plausible.
    kvSet(KV_MINUTES_MARKED_AT, now.toISOString());
    return;
  }
  const elapsed = Math.floor((now.getTime() - fromMs) / 60_000);
  const minutes = Math.min(Math.max(elapsed, 0), BREAKER_EPISODE_MAX_HOURS * 60);
  if (minutes < 1) return;
  bumpTrialDayShieldMinutes(now.toISOString().slice(0, 10), minutes);
  kvSet(KV_MINUTES_MARKED_AT, new Date(fromMs + minutes * 60_000).toISOString());
}

// ---------------------------------------------------------------------------
// Les bascules
// ---------------------------------------------------------------------------

/**
 * Persiste une bascule : l'état, la remontée des quotas, le journal, le
 * Telegram — dans cet ordre.
 *
 * 🚨 L'ÉTAT AVANT LE TELEGRAM. L'envoi peut jeter ou traîner, et une bascule
 * dont la trace partirait après l'envoi serait perdue exactement le jour où
 * elle compte. Le Telegram n'est pas attendu : une inscription ne doit pas
 * dépendre de la disponibilité d'un canal d'alerte.
 */
function applyTransition(
  prev: BreakerState,
  next: BreakerState,
  transition: Exclude<BreakerTransition, null>,
  reading: BreakerReading,
): BreakerState {
  const episodeId = transition === 'armed' ? next.episode_id : prev.episode_id;
  // La remontée fait partie du désarmement, pas d'un geste de réparation.
  const bornUnderShield = transition === 'armed' ? 0 : countEpisodeKeys(episodeId);
  const undegraded = transition !== 'armed' && episodeId ? undegradeEpisode(episodeId) : 0;

  writeBreakerState({ ...next, blind_streak: 0 });

  if (transition === 'armed') {
    // 🚨 AUCUN scan de cohortes lancé ici. Le pilote SQLite est SYNCHRONE : le
    // corps d'une passe de radar ne rend la main à personne avant son premier
    // `await`, donc un `void` devant un appel synchrone ne diffère RIEN — les
    // centaines de transactions de la passe s'exécuteraient dans le handler de
    // l'inscription, pendant que l'inscrivant attend. On pose un drapeau ; le
    // tick du radar le consomme et le remet à zéro AVANT son scan.
    kvSet('cohort_scan_due', '1');
  }

  const rowId = episodeId ? recordTransition({ episodeId, transition, reading, undegraded }) : null;
  void notifyOps(
    telegramFor(
      transition,
      reading,
      { ...next, episode_id: episodeId },
      undegraded,
      bornUnderShield,
    ),
  )
    .then((sent) => {
      if (sent && rowId !== null) markTransitionNotified(rowId);
    })
    .catch((err) => console.error('[breaker] telegram:', err instanceof Error ? err.message : err));
  return next;
}

/**
 * Désarmement immédiat, partagé par l'interrupteur de crise et par un geste
 * d'administration. Sans effet si aucune alerte ne court.
 */
export function forceDisarm(
  transition: 'disarmed_env' | 'disarmed_manual',
  now: Date = new Date(),
): BreakerState {
  const prev = readBreakerState();
  if (!prev.armed) {
    // Rien à désarmer. On en profite pour purger un état résiduel : si les trois
    // clés de contrat traînaient sans `armed`, le radar les lirait encore.
    writeBreakerState(prev);
    return prev;
  }
  markShieldMinutes(prev, now);
  const next: BreakerState = { ...prev, armed: false, disarmed_at: now.toISOString() };
  return applyTransition(prev, next, transition, readCreationsSafely(now));
}

/** La mesure, mais un échec ne doit pas empêcher un désarmement. */
function readCreationsSafely(now: Date): BreakerReading {
  try {
    return readCreations(now);
  } catch {
    return { count: 0, distinctSources: 0 };
  }
}

/**
 * Le chemin chaud : appelé par `POST /v1/keys/generate` AVANT la frappe de la
 * clé, donc avant que la ligne de naissance ne soit écrite. Le compteur porte
 * ainsi sur les créations PRÉCÉDENTES, et la première clé au-delà du seuil est
 * la première dégradée.
 *
 * Ne jette jamais : une base occupée doit coûter une mesure, jamais une
 * inscription.
 */
export function evaluateBreakerOnCreation(now: Date = new Date()): BreakerState {
  // L'interrupteur de crise DÉSARME : voir `breakerDisabledByEnv`.
  if (breakerDisabledByEnv()) {
    try {
      return forceDisarm('disarmed_env', now);
    } catch (err) {
      console.error('[breaker] désarmement de crise:', err instanceof Error ? err.message : err);
      return { ...EMPTY };
    }
  }
  try {
    const reading = readCreations(now);
    const prev = readBreakerState();
    const { next, transition, changed } = decideBreaker(reading, prev, now);
    if (transition) return applyTransition(prev, next, transition, reading);
    if (!changed && prev.blind_streak === 0) return next;
    writeBreakerState({ ...next, blind_streak: 0 });
    return next;
  } catch (err) {
    // 🚨 « Ne pas dégrader sur une panne de mesure » ne veut PAS dire
    // « désarmer ». Rendre un état vide ferait naître à plein tarif, en plein
    // épisode armé, la clé de l'instant où une lecture échoue — et personne ne
    // pourrait distinguer cet échec d'une heure calme. On rend l'état
    // PERSISTANT, et on compte l'échec pour que la sonde puisse crier.
    console.error('[breaker] mesure en échec:', err instanceof Error ? err.message : err);
    const st = readBreakerState();
    try {
      kvSet(KV_BLIND_STREAK, String(st.blind_streak + 1));
    } catch {
      /* la base ne répond plus du tout : on ne peut rien compter de plus */
    }
    return st;
  }
}

/**
 * Le balayage, appelé par le tick du radar.
 *
 * 🚨 Indispensable : sans lui, un épisode armé par la DERNIÈRE création d'une
 * ferme ne se désarmerait qu'à la création suivante, c'est-à-dire
 * potentiellement jamais, et la borne de durée ne s'appliquerait jamais non
 * plus. Le tick du radar est le seul battement qui existe déjà et qui ne dépend
 * d'aucun trafic.
 *
 * Il porte l'interrupteur de crise comme un DÉSARMEMENT, jamais comme une
 * inertie : sous interrupteur, c'est précisément lui qui doit pouvoir rendre la
 * liberté à un épisode en cours.
 */
export function sweepBreaker(now: Date = new Date()): BreakerState {
  try {
    if (breakerDisabledByEnv()) return forceDisarm('disarmed_env', now);
    const prev = readBreakerState();
    if (!prev.armed) return prev;
    markShieldMinutes(prev, now);
    const reading = readCreations(now);
    const { next, transition, changed } = decideBreaker(reading, prev, now);
    if (transition) return applyTransition(prev, next, transition, reading);
    if (changed) writeBreakerState({ ...next, blind_streak: 0 });
    return next;
  } catch (err) {
    console.error('[breaker] balayage en échec:', err instanceof Error ? err.message : err);
    return readBreakerState();
  }
}
