/**
 * Le retard de la boucle d'événements et la durée des tâches de fond (C18, ARCH-01#1,
 * 10.11.2026).
 *
 * ## Pourquoi
 *
 * Tout passe par un seul fil : l'API payante, GET /stats qui balaie request_log, la fusion
 * de la surcouche privée dans le minuteur de dix minutes, l'audit de fichier dans sa
 * requête. Quand l'un d'eux occupe la boucle, chaque client attend, et rien ne le mesurait.
 * Ce module MESURE, il ne réorganise rien : aucun fil d'exécution en plus, aucun travail
 * déplacé hors du fil principal.
 *
 * ## Ce qui est mesuré
 *
 * `perf_hooks.monitorEventLoopDelay` arme un minuteur libuv toutes les
 * LOOP_LAG_RESOLUTION_MS et note l'intervalle réel entre deux passages. Au repos il vaut à
 * peu près la résolution (environ 10 ms) ; une boucle gelée N ms donne un intervalle d'au
 * moins N ms, puisque le passage suivant ne peut pas avoir lieu pendant le gel. Ce sont ces
 * intervalles, en millisecondes, que GET /health rend (`event_loop.p99_ms` et `max_ms`).
 *
 * ## La fenêtre de mesure et sa remise à zéro
 *
 * Un maximum compté depuis le démarrage ne dit plus rien au bout d'une semaine. Les chiffres
 * portent donc sur une fenêtre de LOOP_LAG_WINDOW_MS (60 s), relevée toutes les
 * LOOP_LAG_ROTATE_MS (30 s) : deux histogrammes décalés d'un relevé, et à chaque relevé
 * celui qui a couvert une fenêtre entière est lu puis remis à zéro pendant que l'autre
 * continue. Pourquoi deux : Node jette le premier intervalle qui suit un `reset()` (il ne
 * fait que reposer son horloge), si bien qu'un gel à cheval sur une remise à zéro
 * échapperait à un histogramme seul ; l'autre, remis à zéro un relevé plus tôt ou plus tard,
 * le voit. Conséquence voulue : un même gel apparaît dans deux relevés consécutifs.
 *
 * GET /health rend le dernier relevé, et `window_s` dit la durée qu'il couvre. Avant le
 * premier relevé, c'est l'histogramme en cours depuis le démarrage de la mesure. Sans mesure
 * démarrée (les tests, et tout processus qui n'est pas src/index.ts), les trois valeurs sont
 * `null`.
 *
 * ## La durée des tâches de fond
 *
 * `timeBackgroundTask` chronomètre un rappel SYNCHRONE de src/index.ts (surcouche, rétention,
 * registre d'essai, purge des rapports d'audit) : pour du code synchrone, la durée murale est
 * exactement le temps pris à la boucle. Au-delà de BACKGROUND_TASK_LOG_MS, une ligne au
 * journal ; la plus longue de la fenêtre est nommée dans l'alerte. Jamais dans /health, qui
 * ne rend que des nombres. Une tâche asynchrone (les radars, Search Console) n'est pas
 * chronométrée ainsi : sa durée compterait l'attente du réseau, pas le blocage.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { opsFail, opsOk } from './ops-alert.js';

/**
 * Un échantillon toutes les 10 ms, la valeur par défaut de Node : assez fin pour voir un
 * gel de quelques dizaines de millisecondes, et un minuteur libuv toutes les 10 ms ne coûte
 * rien au service.
 */
export const LOOP_LAG_RESOLUTION_MS = 10;

/** Un relevé toutes les 30 s ; chacun couvre les 60 s qui précèdent (deux histogrammes). */
export const LOOP_LAG_ROTATE_MS = 30_000;
export const LOOP_LAG_WINDOW_MS = 2 * LOOP_LAG_ROTATE_MS;

/**
 * Le seuil : une seconde de boucle gelée. Une validation d'IBAN répond en quelques
 * millisecondes ; une seconde de gel, c'est chaque requête en vol, payante comprise, qui
 * attend au moins autant. C'est aussi l'ordre de grandeur que PERF-01 projetait pour
 * GET /stats à douze mois (2,1 s) : l'alerte verra ce scénario arriver.
 */
export const LOOP_BLOCK_ALERT_MS = 1_000;

/**
 * La durée : cinq minutes de gels répétés. Un gel isolé (ouverture du tableau de bord,
 * rechargement de la surcouche, un audit de fichier) est attendu et n'apparaît que dans
 * deux relevés : il ne doit réveiller personne. Des gels d'au moins une seconde chaque
 * minute pendant cinq minutes ne sont plus un accident, c'est l'état du service.
 */
export const LOOP_BLOCK_ALERT_AFTER_MS = 5 * 60_000;

/** La durée exprimée en relevés consécutifs, le seuil d'`opsFail`. */
export const LOOP_BLOCK_ALERT_SNAPSHOTS = LOOP_BLOCK_ALERT_AFTER_MS / LOOP_LAG_ROTATE_MS;

export const LOOP_BLOCK_ALERT_KEY = 'loop:blocked';

/** Une tâche de fond qui garde la boucle plus de 100 ms est écrite au journal. */
export const BACKGROUND_TASK_LOG_MS = 100;

/** Ce que l'histogramme de Node offre, et ce qu'un test remplace. Valeurs en nanosecondes. */
export interface LoopHistogram {
  readonly count: number;
  readonly max: number;
  percentile(p: number): number;
  reset(): void;
  enable(): unknown;
  disable(): unknown;
}

export interface LoopLagSnapshot {
  p99_ms: number | null;
  max_ms: number | null;
  window_s: number | null;
}

interface SlowTask {
  name: string;
  ms: number;
}

interface Monitor {
  histograms: [LoopHistogram, LoopHistogram];
  resetAt: [number, number];
  /** La plus longue tâche de fond vue depuis la remise à zéro de chaque histogramme. */
  slowest: [SlowTask | null, SlowTask | null];
  /** L'histogramme lu au prochain relevé. */
  next: 0 | 1;
  last: LoopLagSnapshot | null;
  timer: ReturnType<typeof setInterval>;
  now: () => number;
}

let monitor: Monitor | null = null;

const EMPTY: LoopLagSnapshot = { p99_ms: null, max_ms: null, window_s: null };

/** Nanosecondes → millisecondes, au dixième. */
function toMs(ns: number): number {
  return Math.round(ns / 100_000) / 10;
}

function read(h: LoopHistogram, coveredMs: number): LoopLagSnapshot {
  const window_s = Math.round(coveredMs / 1000);
  // Un histogramme vide rend un percentile absurde : aucun chiffre plutôt qu'un faux.
  if (h.count === 0) return { p99_ms: null, max_ms: null, window_s };
  return { p99_ms: toMs(h.percentile(99)), max_ms: toMs(h.max), window_s };
}

function judge(snap: LoopLagSnapshot, slowest: SlowTask | null): void {
  // Aucun échantillon : aucune preuve dans un sens ni dans l'autre, le compte reste tel quel.
  if (snap.max_ms === null) return;
  if (snap.max_ms >= LOOP_BLOCK_ALERT_MS) {
    const task = slowest
      ? ` Tâche de fond la plus longue de la fenêtre : ${slowest.name}, ${Math.round(slowest.ms)} ms.`
      : ' Aucune tâche de fond chronométrée ne dépasse : une requête, sans doute (GET /stats, audit de fichier).';
    void opsFail(
      LOOP_BLOCK_ALERT_KEY,
      `Boucle d'événements gelée jusqu'à ${snap.max_ms} ms sur les ${snap.window_s} dernières ` +
        `secondes (p99 ${snap.p99_ms} ms), relevé après relevé depuis ` +
        `${LOOP_BLOCK_ALERT_AFTER_MS / 60_000} min : chaque client attend autant.${task}`,
      LOOP_BLOCK_ALERT_SNAPSHOTS,
    );
  } else {
    void opsOk(
      LOOP_BLOCK_ALERT_KEY,
      `Boucle d'événements revenue sous ${LOOP_BLOCK_ALERT_MS} ms (max ${snap.max_ms} ms sur ${snap.window_s} s).`,
    );
  }
}

/**
 * Un relevé : lit l'histogramme qui a couvert la fenêtre, le remet à zéro, garde le
 * résultat pour /health et juge l'alerte. Appelé par le minuteur ; exporté pour les tests.
 */
export function rotateLoopLagWindow(): LoopLagSnapshot | null {
  const m = monitor;
  if (!m) return null;
  const i = m.next;
  const now = m.now();
  const snap = read(m.histograms[i], now - m.resetAt[i]);
  const slowest = m.slowest[i];
  m.histograms[i].reset();
  m.resetAt[i] = now;
  m.slowest[i] = null;
  m.next = i === 0 ? 1 : 0;
  m.last = snap;
  judge(snap, slowest);
  return snap;
}

export interface LoopLagOptions {
  /** Pour les tests : un histogramme factice à la place de celui de Node. */
  createHistogram?: () => LoopHistogram;
  now?: () => number;
}

/**
 * Démarre la mesure. Appelé par src/index.ts seulement, jamais par `buildApp()` : un minuteur
 * de plus dans chaque suite de tests n'apporte rien. Le minuteur des relevés est `unref()` :
 * il ne retient pas le processus à l'arrêt.
 */
export function startLoopLagMonitor(options: LoopLagOptions = {}): void {
  stopLoopLagMonitor();
  const create =
    options.createHistogram ??
    ((): LoopHistogram => monitorEventLoopDelay({ resolution: LOOP_LAG_RESOLUTION_MS }));
  const now = options.now ?? ((): number => Date.now());
  const histograms: [LoopHistogram, LoopHistogram] = [create(), create()];
  for (const h of histograms) h.enable();
  const started = now();
  const timer = setInterval(rotateLoopLagWindow, LOOP_LAG_ROTATE_MS);
  timer.unref?.();
  monitor = {
    histograms,
    resetAt: [started, started],
    slowest: [null, null],
    next: 0,
    last: null,
    timer,
    now,
  };
}

export function stopLoopLagMonitor(): void {
  const m = monitor;
  if (!m) return;
  clearInterval(m.timer);
  for (const h of m.histograms) h.disable();
  monitor = null;
}

/** Le bloc `event_loop` de GET /health : trois nombres, ou trois `null` sans mesure. */
export function loopLagHealth(): LoopLagSnapshot {
  const m = monitor;
  if (!m) return { ...EMPTY };
  if (m.last) return { ...m.last };
  return read(m.histograms[0], m.now() - m.resetAt[0]);
}

/**
 * Chronomètre une tâche de fond SYNCHRONE et rend son résultat. Une exception passe
 * telle quelle ; la durée est notée dans tous les cas.
 */
export function timeBackgroundTask<T>(name: string, task: () => T): T {
  const started = performance.now();
  try {
    return task();
  } finally {
    const ms = performance.now() - started;
    if (ms >= BACKGROUND_TASK_LOG_MS) {
      console.warn(`[loop] tâche de fond ${name} : ${Math.round(ms)} ms sur le fil principal`);
    }
    const m = monitor;
    if (m) {
      for (const i of [0, 1] as const) {
        const seen = m.slowest[i];
        if (!seen || ms > seen.ms) m.slowest[i] = { name, ms };
      }
    }
  }
}
