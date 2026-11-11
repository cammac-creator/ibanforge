/**
 * Les alertes d'exploitation des entrées d'administration (C10, audit SEC-01#3,
 * version réduite retenue par le contradicteur, 11.11.2026).
 *
 * Appelées par le journal (`src/lib/admin-journal.ts`) à chaque passage à la porte
 * et à chaque réponse d'une route d'administration. Quatre signaux, et rien
 * d'autre :
 *
 *  - une clé d'API CRÉÉE ou IMPORTÉE par l'administration (`POST /v1/admin/keys`,
 *    `POST /v1/admin/keys/import`, réponse 2xx) ;
 *  - un plafond mensuel RELEVÉ (`POST /v1/admin/keys/raise-limit`, 2xx) ;
 *  - une SAUVEGARDE de l'état payant lancée hors de sa plage horaire habituelle ;
 *  - une RAFALE de refus (401 ou 403) depuis une même source : un seul `opsFail`
 *    par épisode, refermé par `opsOk` quand la source se tait.
 *
 * Aucune alerte ne porte d'adresse (ni IP, ni e-mail, ni empreinte), de nom, ni
 * de valeur ou de préfixe de clé : la route, le nom de la variable qui a ouvert,
 * des heures et des nombres. Le détail est dans le journal `admin_calls`.
 *
 * Jamais de compteur qui verrouille (écarté par l'audit : risque de fermer son
 * propre tableau de bord). Une alerte ne refuse rien et ne jette jamais.
 *
 * ## La plage horaire de la sauvegarde, apprise et non inventée
 *
 * L'heure du passage nocturne vit hors de ce dépôt. Elle est donc LUE dans le
 * journal : une sauvegarde est « habituelle » quand au moins trois sauvegardes
 * réussies des trente derniers jours ont eu lieu à une heure de la journée
 * proche d'une heure et demie au plus (le passage d'une heure d'été à une heure
 * d'hiver déplace d'une heure, en temps universel, une tâche réglée à l'heure
 * suisse). Moins de trois sauvegardes connues : rien n'est
 * jugé (les premières nuits après la mise en ligne, le journal apprend). Une
 * sauvegarde lancée à la main à une autre heure alerte : c'est le but.
 */
import { BACKUP_ROUTE, type AdminGateCall, type AdminKeyName } from './admin-auth.js';
import { getStatsDB } from './db.js';
import { LOGIN_ALERT_CAPPED } from './admin-site-caps.js';
import { notifyOps, opsFail, opsOk } from './ops-alert.js';

// ─── Rafale de refus ─────────────────────────────────────────────────────────

/** Dix refus d'une même source en dix minutes : une rafale. */
export const REFUSAL_BURST_THRESHOLD = 10;
export const REFUSAL_BURST_WINDOW_MS = 10 * 60_000;
export const REFUSAL_BURST_ALERT = 'admin:refusal-burst';
/** Au-delà, les sources les plus anciennes sortent : la mémoire reste bornée. */
const MAX_TRACKED_SOURCES = 5_000;

interface SourceState {
  /** Les instants des derniers refus, au plus `REFUSAL_BURST_THRESHOLD`. */
  times: number[];
  /** Vrai quand cette source a déjà donné son `opsFail` pour l'épisode en cours. */
  alerted: boolean;
}

const sources = new Map<string, SourceState>();
let episodeOpen = false;

/** Oublie les sources muettes depuis une fenêtre ; referme l'épisode s'il n'en reste aucune en rafale. */
function sweepSources(now: number): void {
  for (const [source, state] of sources) {
    const last = state.times[state.times.length - 1] ?? 0;
    if (now - last > REFUSAL_BURST_WINDOW_MS) sources.delete(source);
  }
  if (episodeOpen && ![...sources.values()].some((s) => s.alerted)) {
    episodeOpen = false;
    void opsOk(
      REFUSAL_BURST_ALERT,
      `Aucune source en rafale de refus depuis ${REFUSAL_BURST_WINDOW_MS / 60_000} minutes.`,
    );
  }
}

/**
 * Un passage à la porte : chaque refus compte pour sa source (l'empreinte salée de
 * son adresse ; une source inconnue ne compte pas). Le dixième refus en dix
 * minutes lève UN `opsFail` ; les suivants de la même rafale se taisent.
 *
 * Rend si la ligne de ce passage doit être écrite dans `admin_calls` (11.11.2026) :
 * non pour un refus d'une source qui en compte déjà REFUSAL_BURST_THRESHOLD dans
 * la fenêtre. Les refus jusqu'au seuil sont écrits, l'alerte part, et la table ne
 * grossit plus sous une rafale qui dure : au plus REFUSAL_BURST_THRESHOLD lignes
 * de refus par source et par fenêtre.
 */
export function noteGatePassage(call: AdminGateCall, source: string | null, now: number): boolean {
  sweepSources(now);
  const refused = call.decision === 'none' || call.decision === 'out_of_scope';
  if (!refused || !source) return true;
  let state = sources.get(source);
  if (!state) {
    while (sources.size >= MAX_TRACKED_SOURCES) {
      const oldest = sources.keys().next().value;
      if (oldest === undefined) break;
      sources.delete(oldest);
    }
    state = { times: [], alerted: false };
    sources.set(source, state);
  }
  const recent = state.times.filter((t) => now - t <= REFUSAL_BURST_WINDOW_MS);
  const write = recent.length < REFUSAL_BURST_THRESHOLD;
  state.times = [...recent, now].slice(-REFUSAL_BURST_THRESHOLD);
  if (state.alerted || state.times.length < REFUSAL_BURST_THRESHOLD) return write;
  state.alerted = true;
  episodeOpen = true;
  void opsFail(
    REFUSAL_BURST_ALERT,
    `${REFUSAL_BURST_THRESHOLD} refus d’administration (401 ou 403) en moins de ` +
      `${REFUSAL_BURST_WINDOW_MS / 60_000} minutes depuis une même source. ` +
      `Dernière route refusée : ${call.method} ${call.route}. ` +
      'La source est dans le journal admin_calls (empreinte), jamais dans ce message ; ' +
      'tant que la rafale dure, ses refus suivants n’y sont plus écrits. ' +
      'Rien n’est verrouillé : le limiteur de débit reste la seule borne.',
  );
  return write;
}

// ─── Alertes d'événement ─────────────────────────────────────────────────────

/** Au plus cinq messages par heure et par sorte : une rafale de créations ne noie pas le canal. */
export const EVENT_ALERTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

interface EventState {
  windowStart: number;
  sent: number;
  suppressed: number;
}
const events = new Map<string, EventState>();

/**
 * Un événement d'administration à dire tout de suite sur le canal d'exploitation.
 * Pas un `opsFail` : un événement n'est pas une panne qui se referme, et une clé
 * d'alerte restée ouverte ferait taire le suivant. Borné à `EVENT_ALERTS_PER_HOUR`
 * messages par sorte ; le message suivant dit combien ont été tus.
 */
export function adminEventAlert(kind: string, text: string, now: number = Date.now()): void {
  try {
    const prev = events.get(kind);
    const state: EventState =
      !prev || now - prev.windowStart >= HOUR_MS
        ? { windowStart: now, sent: 0, suppressed: prev?.suppressed ?? 0 }
        : prev;
    events.set(kind, state);
    if (state.sent >= EVENT_ALERTS_PER_HOUR) {
      state.suppressed += 1;
      console.warn(`[admin-alerts] ${kind} : alerte tue (plafond de l’heure atteint)`);
      return;
    }
    state.sent += 1;
    const tail = state.suppressed
      ? `\n(${state.suppressed} alerte(s) du même type tue(s) avant celle-ci : voir le journal admin_calls.)`
      : '';
    state.suppressed = 0;
    void notifyOps(text + tail);
  } catch (err) {
    console.error('[admin-alerts] alerte non envoyée :', err instanceof Error ? err.message : err);
  }
}

/** Le nom de ce qui a ouvert, tel que l'alerte le dit : un nom de variable, jamais une valeur. */
export function openerLabel(key: AdminKeyName | null): string {
  if (key === 'full') return 'le secret complet (ADMIN_SECRET)';
  return key ?? 'aucune clé reconnue';
}

const IF_NOT_YOU =
  'Si ce n’est pas vous : changer la clé qui a ouvert et lire le journal admin_calls.';

// ─── La sauvegarde hors de sa plage ──────────────────────────────────────────

export const BACKUP_USUAL_MIN_SAMPLES = 3;
export const BACKUP_USUAL_TOLERANCE_MIN = 90;
export const BACKUP_USUAL_LOOKBACK_DAYS = 30;

function minuteOfDay(sqlUtc: string): number {
  return Number(sqlUtc.slice(11, 13)) * 60 + Number(sqlUtc.slice(14, 16));
}

/**
 * La sauvegarde lancée à `at` est-elle hors de sa plage habituelle ? `null` quand le
 * journal ne connaît pas encore assez de sauvegardes pour en juger. `exceptId` est
 * la ligne de la sauvegarde en cours.
 */
export function backupOffHours(
  at: Date,
  exceptId: number | null,
): { usualHour: number; samples: number } | null {
  const sql = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
  const since = new Date(at.getTime() - BACKUP_USUAL_LOOKBACK_DAYS * 24 * HOUR_MS);
  const rows = getStatsDB()
    .prepare(
      `SELECT created_at FROM admin_calls
        WHERE route = ? AND method = 'GET' AND status BETWEEN 200 AND 299
          AND created_at >= ? AND created_at <= ? AND id != ?`,
    )
    .all(BACKUP_ROUTE, sql(since), sql(at), exceptId ?? -1) as Array<{ created_at: string }>;
  if (rows.length < BACKUP_USUAL_MIN_SAMPLES) return null;
  const nowMin = at.getUTCHours() * 60 + at.getUTCMinutes();
  const minutes = rows.map((r) => minuteOfDay(r.created_at));
  const near = minutes.filter((m) => {
    const d = Math.abs(m - nowMin);
    return Math.min(d, 1440 - d) <= BACKUP_USUAL_TOLERANCE_MIN;
  }).length;
  if (near >= BACKUP_USUAL_MIN_SAMPLES) return null;
  // L'heure la plus fréquente des sauvegardes connues : ce que le message appelle « habituel ».
  const byHour = new Map<number, number>();
  for (const m of minutes)
    byHour.set(Math.floor(m / 60), (byHour.get(Math.floor(m / 60)) ?? 0) + 1);
  const usualHour = [...byHour].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return { usualHour, samples: rows.length };
}

// ─── Les réponses des routes qui comptent ────────────────────────────────────

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Une réponse d'administration vient d'être posée. Lève l'alerte d'événement des
 * routes qui créent une clé, en importent une, relèvent un plafond ou exportent
 * l'état payant hors de sa plage, sur une réponse 2xx seulement.
 */
export function noteAdminResponse(
  call: AdminGateCall,
  status: number,
  at: Date,
  rowId: number | null,
): void {
  if (status < 200 || status > 299) return;
  const route = `${call.method} ${call.route}`;
  const by = openerLabel(call.key);
  if (route === 'POST /v1/admin/keys') {
    adminEventAlert(
      'admin:key-created',
      `🔑 IBANforge — clé d’API créée par l’administration (${route}), ouverte par ${by}.\n${IF_NOT_YOU}`,
    );
  } else if (route === 'POST /v1/admin/keys/import') {
    adminEventAlert(
      'admin:key-imported',
      `🔑 IBANforge — clé d’API importée par l’administration (${route}), ouverte par ${by}.\n${IF_NOT_YOU}`,
    );
  } else if (route === 'POST /v1/admin/keys/raise-limit') {
    adminEventAlert(
      'admin:limit-raised',
      `📈 IBANforge — plafond mensuel d’une clé relevé (${route}), ouvert par ${by}.\n${IF_NOT_YOU}`,
    );
  } else if (route === `GET ${BACKUP_ROUTE}`) {
    const off = backupOffHours(at, rowId);
    if (!off) return;
    adminEventAlert(
      'admin:backup-off-hours',
      `💾 IBANforge — sauvegarde de l’état payant lancée à ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC, ` +
        `hors de sa plage habituelle (vers ${two(off.usualHour)} h UTC, ${off.samples} sauvegardes ` +
        `sur ${BACKUP_USUAL_LOOKBACK_DAYS} jours), ouverte par ${by}.\n${IF_NOT_YOU}`,
    );
  }
}

/**
 * Au démarrage : referme les deux alertes d'épisode de ce lot. Leur épisode vit en
 * mémoire (les sources en rafale, la fenêtre plafonnée), alors que l'état
 * « ouverte » d'une alerte vit dans `kv_state` et survit au redémarrage : sans
 * cette fermeture, un redéploiement au milieu d'une rafale laisserait l'alerte
 * ouverte pour toujours, et la rafale suivante se tairait. Même règle que
 * `reportScopedKeyConflicts` (src/lib/admin-auth-ops.ts) : le premier démarrage
 * referme. Appelée par src/index.ts, jamais à l'import (aucune lecture de la base
 * au chargement d'un module). `opsOk` ne dit rien d'une alerte qui n'était pas
 * ouverte.
 */
export function closeAdminAlertEpisodesAtBoot(): void {
  const why = 'Épisode refermé au redémarrage du service : le compte repart de zéro.';
  void opsOk(REFUSAL_BURST_ALERT, why);
  void opsOk(LOGIN_ALERT_CAPPED, why);
}

/** Pour les tests : oublie les rafales et les plafonds de l'heure. */
export function resetAdminAlerts(): void {
  sources.clear();
  events.clear();
  episodeOpen = false;
}
