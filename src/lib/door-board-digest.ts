/**
 * Le résumé du lundi du tableau des portes : quatre nombres et une phrase, sur
 * le canal Telegram d'exploitation, sans que personne ne le déclenche.
 *
 * ## Les règles, et d'où elles viennent
 *
 * - **Une fois par semaine ISO, jamais deux.** Une ligne par lundi dans
 *   `door_board_digest`, table de ce module (créée ici, `IF NOT EXISTS`), dans
 *   `stats.sqlite`, donc sur le volume : elle survit aux redémarrages et aux
 *   déploiements. Le départ est RÉSERVÉ par un UPDATE conditionnel avant
 *   l'envoi : deux processus qui se chevauchent pendant un déploiement ne
 *   peuvent pas partir tous les deux.
 * - **Jamais à une minute ronde** (règle de Claude-Alain du 22.09.2026, précisée
 *   le même soir : ni xx:00, ni xx:30, ni un multiple de dix). Ici plus strict :
 *   jamais sur un multiple de cinq. Le premier départ est tiré au hasard le lundi
 *   entre 08:00 et 10:59, heure suisse, secondes comprises entre 5 et 50, et
 *   c'est l'heure de DÉPART qui compte : une minuterie attend l'instant tiré, au
 *   lieu d'un pas fixe qui enverrait « ce qui est échu » à son propre rythme.
 * - **La minute tirée est écrite en base avant d'armer la minuterie** : un
 *   redémarrage reprend la même minute. Un processus qui démarre après elle
 *   part en retard, 61 à 240 secondes plus tard, à une minute non ronde, et
 *   jamais à 17:00 ou après : passé cette heure, le lundi est manqué et le dit.
 * - **Rien n'est réservé tant que le message ne peut pas partir** : interrupteur
 *   coupé, alertes d'exploitation coupées, jeton ou canal Telegram absent. La
 *   ligne garde la raison, la page l'affiche, et le lundi finit « sauté ».
 * - **Une nouvelle tentative seulement après un refus explicite** : Telegram a
 *   RÉPONDU, par un statut d'erreur, donc rien n'est parti. Une erreur réseau
 *   ou un délai dépassé ne dit pas si le message est arrivé (la coupure a pu
 *   survenir après son départ) : jamais retenté, pour ne jamais envoyer deux
 *   fois. Trois tentatives au plus, toujours avant 17:00.
 * - **Un envoi interrompu** (processus tué entre la réservation et la réponse)
 *   n'est jamais renvoyé : la ligne passe à `interrupted`, visible sur la page.
 *
 * Interrupteur : `DOOR_BOARD_DIGEST_DISABLED=1`. Absent, le résumé est allumé.
 * `OPS_ALERTS_DISABLED=1` le coupe aussi, puisqu'il passe par ce canal.
 *
 * Le message ne porte que des agrégats : aucune adresse, aucune clé. Telegram
 * n'est pas un sous-traitant déclaré (même règle que `ops-alert.ts`).
 */
import type DatabaseType from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { sendOpsMessage, type OpsSendResult } from './ops-alert.js';
import { getDoorBoard, type DoorBoard } from './door-board.js';
import {
  parseDbUtc,
  sqliteUtc,
  swissWeekOf,
  swissWeekShift,
  zurichDayTime,
  zurichLocalToUtcMs,
  zurichParts,
} from './swiss-week.js';

/** Premier départ tiré dans [08:00, 11:00[, heure suisse. */
export const DIGEST_FIRST_HOUR = 8;
export const DIGEST_LAST_HOUR = 11;
/** Aucun départ à 17:00 ou après, heure suisse : la fin des heures de bureau. */
export const DIGEST_DEADLINE_HOUR = 17;
export const DIGEST_MAX_ATTEMPTS = 3;
/** Une réservation plus vieille que ça sans réponse : le processus est mort en route. */
export const DIGEST_STUCK_MS = 10 * 60_000;

export const DOORS_PAGE_URL = 'https://ibanforge.com/dashboard/portes';

const TICK_MS = 5 * 60_000;
/**
 * Le premier battement, huit minutes après le démarrage, puis toutes les cinq
 * minutes à partir de lui (l'intervalle n'est armé qu'au premier battement :
 * armé dès le démarrage, il battrait d'abord à cinq minutes).
 */
const BOOT_DELAY_MS = 8 * 60_000;

export type DigestStatus =
  'planned' | 'sending' | 'sent' | 'failed' | 'interrupted' | 'missed' | 'skipped';

export type ChannelBlock = 'kill_switch' | 'ops_alerts_disabled' | 'telegram_not_configured';

export interface DigestNumbers {
  week: string;
  created: number;
  first_success: number;
  paid: number;
  /** Utilisateurs gratuits actifs : des personnes, le nombre que lit le seuil. */
  free_active: number;
  /** Les clés derrière ces personnes. */
  free_active_keys: number;
}

interface DigestDbRow {
  week: string;
  summary_week: string;
  planned_at: string;
  next_attempt_at: string;
  deadline_at: string;
  status: DigestStatus;
  attempts: number;
  claimed_at: string | null;
  sent_at: string | null;
  skip_reason: string | null;
  last_error: string | null;
  numbers_json: string | null;
  message: string | null;
}

// ─── L'interrupteur et le canal ─────────────────────────────────────────────

export function isDigestDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.DOOR_BOARD_DIGEST_DISABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Ce qui empêche le message de partir, lu AVANT toute réservation. */
export function channelBlock(env: NodeJS.ProcessEnv = process.env): ChannelBlock | null {
  if (isDigestDisabled(env)) return 'kill_switch';
  if (env.OPS_ALERTS_DISABLED === '1') return 'ops_alerts_disabled';
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return 'telegram_not_configured';
  return null;
}

// ─── Les minutes ────────────────────────────────────────────────────────────

/**
 * Une minute « ronde » : un multiple de cinq. L'heure suisse est décalée d'un
 * nombre entier d'heures sur UTC, donc la minute est la même dans les deux.
 */
export function isRoundMinute(minute: number): boolean {
  return minute % 5 === 0;
}

function randomInt(rng: () => number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
}

/**
 * Le premier départ d'un lundi : une minute non ronde tirée entre 08:00 et
 * 10:59, heure suisse, et une seconde entre 5 et 50 (une minuterie en retard de
 * quelques millisecondes reste ainsi dans la minute tirée).
 */
export function drawFirstDeparture(monday: string, rng: () => number = Math.random): number {
  const minutes: number[] = [];
  for (let h = DIGEST_FIRST_HOUR; h < DIGEST_LAST_HOUR; h++) {
    for (let m = 0; m < 60; m++) if (!isRoundMinute(m)) minutes.push(h * 60 + m);
  }
  const pick = minutes[randomInt(rng, minutes.length)];
  const second = 5 + randomInt(rng, 46);
  const [y, mo, d] = monday.split('-').map(Number);
  return zurichLocalToUtcMs(y, mo, d, Math.floor(pick / 60), pick % 60, second);
}

/**
 * Un départ entre `minDelayMs` et `maxDelayMs` après `fromMs`, à une minute non
 * ronde et à une seconde entre 5 et 50. Sert au départ en retard (61 à 240 s)
 * et à la nouvelle tentative (17 à 43 min).
 */
export function nextNonRoundDeparture(
  fromMs: number,
  minDelayMs: number,
  maxDelayMs: number,
  rng: () => number = Math.random,
): number {
  const target = fromMs + minDelayMs + randomInt(rng, maxDelayMs - minDelayMs + 1);
  const second = 5 + randomInt(rng, 46);
  let minuteStart = Math.floor(target / 60_000) * 60_000;
  let candidate = minuteStart + second * 1000;
  while (candidate < fromMs + minDelayMs || isRoundMinute(new Date(candidate).getUTCMinutes())) {
    minuteStart += 60_000;
    candidate = minuteStart + second * 1000;
  }
  return candidate;
}

// ─── La table ───────────────────────────────────────────────────────────────

const ENSURED = new WeakSet<object>();

function table(db: DatabaseType.Database): DatabaseType.Database {
  if (ENSURED.has(db)) return db;
  // Pas de contre-apostrophe ni de point d'interrogation dans ces commentaires
  // SQL : ils vivent dans un gabarit JS.
  db.exec(`
    CREATE TABLE IF NOT EXISTS door_board_digest (
      -- La semaine ISO suisse du lundi d'envoi, par exemple 2026-W41.
      week            TEXT PRIMARY KEY,
      -- La semaine résumée : celle qui finit la veille.
      summary_week    TEXT NOT NULL,
      -- Instants UTC au format de datetime(now).
      planned_at      TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL,
      deadline_at     TEXT NOT NULL,
      status          TEXT NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      -- Le départ réel de la dernière tentative réservée.
      claimed_at      TEXT,
      sent_at         TEXT,
      skip_reason     TEXT,
      last_error      TEXT,
      -- Les quatre nombres envoyés, et le message : des agrégats seulement.
      numbers_json    TEXT,
      message         TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ENSURED.add(db);
  return db;
}

function readRow(db: DatabaseType.Database, week: string): DigestDbRow | undefined {
  return table(db).prepare('SELECT * FROM door_board_digest WHERE week = ?').get(week) as
    DigestDbRow | undefined;
}

// ─── Le message ─────────────────────────────────────────────────────────────

/**
 * Le message, depuis le tableau calculé par la MÊME fonction que la page.
 * Un titre qui ne se confond pas avec « Le point de la semaine » (le résumé
 * rédigé du lundi, qui compte autrement), quatre nombres, la phrase, le lien.
 */
export function buildDigestMessage(board: DoorBoard): { text: string; numbers: DigestNumbers } {
  const week = board.last_week;
  const n = week.numbers;
  const text = [
    `IBANforge · Portes du lundi · ${week.title.replace(/^Semaine/, 'semaine')}`,
    `Clés créées : ${n.created}`,
    `Premier appel réussi : ${n.first_success}`,
    `Ont payé : ${n.paid}`,
    // Le seuil compte des personnes (décision du 22.09 : « utilisateurs ») ; le
    // nombre de clés est donné à côté, pour la comparaison avec l'audit.
    `Gratuits actifs à 200/mois sur 30 jours : ${n.free_active} ${n.free_active <= 1 ? 'personne' : 'personnes'}, ` +
      `${n.free_active_keys} ${n.free_active_keys <= 1 ? 'clé' : 'clés'} (seuil : plus de ${board.free_users.threshold} personnes)`,
    week.sentence,
    DOORS_PAGE_URL,
  ].join('\n');
  return { text, numbers: { week: week.week, ...n } };
}

// ─── Le passage ─────────────────────────────────────────────────────────────

export interface DigestDeps {
  now: () => number;
  /** L'envoi, et ce qu'il a constaté : `httpStatus` nul quand Telegram n'a pas répondu. */
  send: (text: string) => Promise<OpsSendResult>;
  rng: () => number;
  env: NodeJS.ProcessEnv;
  board: (now: number) => DoorBoard;
}

function defaultDeps(): DigestDeps {
  return {
    now: () => Date.now(),
    send: (text) => sendOpsMessage(text),
    rng: Math.random,
    env: process.env,
    board: (now) => getDoorBoard({ now }),
  };
}

export type TickOutcome =
  | { action: 'arm'; week: string; dueMs: number }
  | {
      action: 'idle';
      reason: 'not_monday' | 'done' | 'blocked' | 'in_flight' | 'closed';
    };

/**
 * Ferme ce qui ne peut plus partir : un lundi passé son heure limite (manqué,
 * ou sauté s'il était bloqué), et une réservation restée sans réponse (le
 * processus est mort en route : interrompu, jamais renvoyé).
 */
function closeStale(db: DatabaseType.Database, now: number): void {
  const at = sqliteUtc(now);
  table(db)
    .prepare(
      `UPDATE door_board_digest
          SET status = CASE WHEN skip_reason IS NOT NULL THEN 'skipped' ELSE 'missed' END,
              updated_at = ?
        WHERE status = 'planned' AND deadline_at <= ?`,
    )
    .run(at, at);
  db.prepare(
    `UPDATE door_board_digest
        SET status = 'interrupted', last_error = COALESCE(last_error, 'process_stopped_mid_send'),
            updated_at = ?
      WHERE status = 'sending' AND claimed_at <= ?`,
  ).run(at, sqliteUtc(now - DIGEST_STUCK_MS));
}

/**
 * Un battement : planifie le lundi (la minute tirée, écrite AVANT toute
 * minuterie), ferme ce qui est périmé, et dit quand partir. Ne jette jamais
 * sur une base saine ; l'appelant l'enrobe quand même.
 */
export function digestTick(deps: DigestDeps = defaultDeps()): TickOutcome {
  const db = table(getStatsDB());
  const now = deps.now();
  closeStale(db, now);

  const local = zurichParts(now);
  if (local.weekday !== 1) return { action: 'idle', reason: 'not_monday' };

  const week = swissWeekOf(now);
  const planned = drawFirstDeparture(week.monday, deps.rng);
  const [y, m, d] = week.monday.split('-').map(Number);
  const deadline = zurichLocalToUtcMs(y, m, d, DIGEST_DEADLINE_HOUR, 0, 0);
  // INSERT OR IGNORE : le premier tirage gagne pour toujours, un redémarrage ne
  // retire jamais la minute.
  db.prepare(
    `INSERT OR IGNORE INTO door_board_digest
       (week, summary_week, planned_at, next_attempt_at, deadline_at, status)
     VALUES (?, ?, ?, ?, ?, 'planned')`,
  ).run(
    week.label,
    swissWeekShift(week, 1).label,
    sqliteUtc(planned),
    sqliteUtc(planned),
    sqliteUtc(deadline),
  );
  closeStale(db, now);

  const row = readRow(db, week.label);
  if (!row) return { action: 'idle', reason: 'closed' };
  if (row.status === 'sending') return { action: 'idle', reason: 'in_flight' };
  if (row.status !== 'planned') return { action: 'idle', reason: 'done' };

  const block = channelBlock(deps.env);
  if (block) {
    if (row.skip_reason !== block) {
      db.prepare(
        `UPDATE door_board_digest SET skip_reason = ?, updated_at = ? WHERE week = ? AND status = 'planned'`,
      ).run(block, sqliteUtc(now), row.week);
    }
    return { action: 'idle', reason: 'blocked' };
  }
  if (row.skip_reason !== null) {
    db.prepare(
      `UPDATE door_board_digest SET skip_reason = NULL, updated_at = ? WHERE week = ? AND status = 'planned'`,
    ).run(sqliteUtc(now), row.week);
  }

  let due = parseDbUtc(row.next_attempt_at) ?? planned;
  // Déjà passé de plus d'une seconde : le processus dormait à la minute tirée.
  // Un départ en retard, à une minute non ronde, et jamais après l'heure limite.
  if (due < now - 1000) {
    const late = nextNonRoundDeparture(now, 61_000, 240_000, deps.rng);
    if (late >= deadline) {
      db.prepare(
        `UPDATE door_board_digest SET status = 'missed', updated_at = ? WHERE week = ? AND status = 'planned'`,
      ).run(sqliteUtc(now), row.week);
      return { action: 'idle', reason: 'closed' };
    }
    const moved = db
      .prepare(
        `UPDATE door_board_digest SET next_attempt_at = ?, updated_at = ?
          WHERE week = ? AND status = 'planned' AND next_attempt_at = ?`,
      )
      .run(sqliteUtc(late), sqliteUtc(now), row.week, row.next_attempt_at);
    if (moved.changes === 0) return { action: 'idle', reason: 'in_flight' };
    due = late;
  }
  return { action: 'arm', week: row.week, dueMs: due };
}

export type AttemptOutcome =
  | { result: 'sent'; departedAt: number }
  | { result: 'retry'; nextMs: number }
  | { result: 'failed'; error: string }
  | { result: 'not_claimed' }
  | { result: 'blocked'; reason: ChannelBlock }
  | { result: 'too_early' }
  | { result: 'late' };

/**
 * La marge de retard d'une minuterie. Les secondes tirées vont de 5 à 50 : un
 * départ au plus cinq secondes après l'instant tiré reste dans la minute tirée.
 * Au-delà, la minute a pu changer (et tomber ronde) : la tentative ne part pas,
 * le battement suivant replanifie un départ en retard, non rond.
 */
export const DIGEST_TIMER_TOLERANCE_MS = 5_000;

/**
 * Une tentative, à l'instant tiré : réserve le départ, calcule le tableau par
 * la même fonction que la page, envoie, et consigne. Ne jette jamais.
 */
export async function attemptDigest(
  week: string,
  dueMs: number,
  deps: DigestDeps = defaultDeps(),
): Promise<AttemptOutcome> {
  const db = table(getStatsDB());
  const now = deps.now();
  // Cette tentative est-elle encore la bonne : même lundi, même instant, rien
  // de parti ni de réservé entre-temps ?
  const row = readRow(db, week);
  if (!row || row.status !== 'planned' || row.next_attempt_at !== sqliteUtc(dueMs)) {
    return { result: 'not_claimed' };
  }
  if (now < dueMs - 1000) return { result: 'too_early' };
  if (now > dueMs + DIGEST_TIMER_TOLERANCE_MS) return { result: 'late' };
  const block = channelBlock(deps.env);
  if (block) {
    db.prepare(
      `UPDATE door_board_digest SET skip_reason = ?, updated_at = ? WHERE week = ? AND status = 'planned'`,
    ).run(block, sqliteUtc(now), week);
    return { result: 'blocked', reason: block };
  }
  const deadline = parseDbUtc(row.deadline_at) ?? 0;
  if (now >= deadline) return { result: 'not_claimed' };

  // 🚨 La réservation, AVANT l'envoi : un seul UPDATE conditionnel peut la
  // prendre, même entre deux processus qui se chevauchent au déploiement.
  const claim = db
    .prepare(
      `UPDATE door_board_digest
          SET status = 'sending', attempts = attempts + 1, claimed_at = ?, updated_at = ?
        WHERE week = ? AND status = 'planned' AND next_attempt_at = ?`,
    )
    .run(sqliteUtc(now), sqliteUtc(now), week, row.next_attempt_at);
  if (claim.changes !== 1) return { result: 'not_claimed' };
  const attempts = row.attempts + 1;

  let text: string;
  let numbers: DigestNumbers;
  try {
    const board = deps.board(now);
    if (board.last_week.week !== row.summary_week) {
      throw new Error(`week_mismatch ${board.last_week.week} ${row.summary_week}`);
    }
    ({ text, numbers } = buildDigestMessage(board));
  } catch (err) {
    // Rien n'est parti : une nouvelle tentative ne peut rien doubler.
    return settleFailure(db, week, attempts, now, deadline, deps, errorText(err), true);
  }

  let result: OpsSendResult;
  try {
    result = await deps.send(text);
  } catch {
    // `sendOpsMessage` ne jette jamais ; un envoi qui jetterait quand même n'a
    // rien dit de l'arrivée du message, donc il compte comme non confirmé.
    result = { sent: false, httpStatus: null };
  }
  const ended = deps.now();
  if (result.sent) {
    db.prepare(
      `UPDATE door_board_digest
          SET status = 'sent', sent_at = ?, numbers_json = ?, message = ?, last_error = NULL,
              skip_reason = NULL, updated_at = ?
        WHERE week = ? AND status = 'sending'`,
    ).run(sqliteUtc(ended), JSON.stringify(numbers), text, sqliteUtc(ended), week);
    return { result: 'sent', departedAt: now };
  }
  // Telegram a répondu par un refus : rien n'est parti, une nouvelle tentative
  // ne peut rien doubler. Pas de réponse du tout (coupure, délai dépassé) : le
  // message a pu arriver, donc jamais de second essai.
  const refused = result.httpStatus !== null;
  return settleFailure(
    db,
    week,
    attempts,
    ended,
    deadline,
    deps,
    refused ? `telegram_refused_${result.httpStatus}` : 'send_unconfirmed',
    refused,
  );
}

function settleFailure(
  db: DatabaseType.Database,
  week: string,
  attempts: number,
  now: number,
  deadline: number,
  deps: DigestDeps,
  error: string,
  retryable: boolean,
): AttemptOutcome {
  const next = nextNonRoundDeparture(now, 17 * 60_000, 43 * 60_000, deps.rng);
  if (retryable && attempts < DIGEST_MAX_ATTEMPTS && next < deadline) {
    db.prepare(
      `UPDATE door_board_digest
          SET status = 'planned', next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE week = ? AND status = 'sending'`,
    ).run(sqliteUtc(next), error.slice(0, 200), sqliteUtc(now), week);
    return { result: 'retry', nextMs: next };
  }
  db.prepare(
    `UPDATE door_board_digest SET status = 'failed', last_error = ?, updated_at = ?
      WHERE week = ? AND status = 'sending'`,
  ).run(error.slice(0, 200), sqliteUtc(now), week);
  return { result: 'failed', error };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Ce que la page en montre ───────────────────────────────────────────────

export interface DigestView {
  week: string;
  summary_week: string;
  status: DigestStatus;
  attempts: number;
  /** `JJ.MM à HH:MM`, heure suisse. */
  planned_at: string;
  next_attempt_at: string;
  departed_at: string | null;
  sent_at: string | null;
  skip_reason: string | null;
  last_error: string | null;
  numbers: DigestNumbers | null;
}

export interface DigestState {
  enabled: boolean;
  blocked: ChannelBlock | null;
  window: { first: string; last: string; deadline: string };
  /**
   * Le lundi de la semaine en cours, et s'il est déjà passé son heure limite.
   * Sans ligne pour ce lundi et passé l'heure limite, l'API ne tournait pas ce
   * lundi-là : la page le dit, au lieu d'annoncer un « prochain résumé ».
   */
  this_monday: { week: string; monday: string; deadline_passed: boolean };
  recent: DigestView[];
  /**
   * Les nombres du dernier résumé envoyé, comparés à ceux que la page calcule
   * pour la même semaine : `null` tant qu'aucun résumé de cette semaine n'est parti.
   */
  latest_matches_page: boolean | null;
}

function parseNumbers(json: string | null): DigestNumbers | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as DigestNumbers;
  } catch {
    return null;
  }
}

function dayTime(raw: string | null): string | null {
  const ms = parseDbUtc(raw);
  return ms === null ? null : zurichDayTime(ms);
}

export function readDigestState(
  board: DoorBoard,
  limit = 6,
  env: NodeJS.ProcessEnv = process.env,
): DigestState {
  const rows = table(getStatsDB())
    .prepare('SELECT * FROM door_board_digest ORDER BY week DESC LIMIT ?')
    .all(Math.max(1, Math.min(52, limit))) as DigestDbRow[];
  const recent: DigestView[] = rows.map((r) => {
    const numbers = parseNumbers(r.numbers_json);
    return {
      week: r.week,
      summary_week: r.summary_week,
      status: r.status,
      attempts: r.attempts,
      planned_at: dayTime(r.planned_at) ?? r.planned_at,
      next_attempt_at: dayTime(r.next_attempt_at) ?? r.next_attempt_at,
      departed_at: r.status === 'sent' ? dayTime(r.claimed_at) : null,
      sent_at: dayTime(r.sent_at),
      skip_reason: r.skip_reason,
      last_error: r.last_error,
      numbers,
    };
  });
  const latestSent = recent.find(
    (r) => r.status === 'sent' && r.summary_week === board.last_week.week,
  );
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
  // La semaine en cours, à l'heure même où le tableau a été lu.
  const observed = parseDbUtc(board.observed_at) ?? Date.now();
  const current = swissWeekOf(observed);
  const [y, m, d] = current.monday.split('-').map(Number);
  const deadline = zurichLocalToUtcMs(y, m, d, DIGEST_DEADLINE_HOUR, 0, 0);
  const sent = latestSent?.numbers;
  const page = board.last_week.numbers;
  return {
    enabled: !isDigestDisabled(env),
    blocked: channelBlock(env),
    window: {
      first: pad(DIGEST_FIRST_HOUR),
      last: `${String(DIGEST_LAST_HOUR - 1).padStart(2, '0')}:59`,
      deadline: pad(DIGEST_DEADLINE_HOUR),
    },
    this_monday: {
      week: current.label,
      monday: current.monday,
      deadline_passed: observed >= deadline,
    },
    recent,
    latest_matches_page: sent
      ? sent.created === page.created &&
        sent.first_success === page.first_success &&
        sent.paid === page.paid &&
        sent.free_active === page.free_active &&
        sent.free_active_keys === page.free_active_keys
      : null,
  };
}

// ─── La minuterie, dans le processus de l'API ───────────────────────────────

let armed: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
let ticking = false;

function runTick(): void {
  if (ticking) return;
  ticking = true;
  try {
    const outcome = digestTick();
    if (outcome.action !== 'arm') return;
    const key = `${outcome.week}|${outcome.dueMs}`;
    if (armed?.key === key) return;
    if (armed) clearTimeout(armed.timer);
    const delay = Math.max(0, outcome.dueMs - Date.now());
    const timer = setTimeout(() => {
      armed = null;
      void attemptDigest(outcome.week, outcome.dueMs)
        .then((result) => {
          if (result.result === 'failed') {
            console.error('[door-board-digest] résumé du lundi non envoyé :', result.error);
          }
          // Une nouvelle tentative, ou un départ en retard à replanifier, se
          // réarme tout de suite, sans attendre le battement.
          if (result.result === 'retry' || result.result === 'late') runTick();
        })
        .catch((err) => console.error('[door-board-digest] tentative en échec :', errorText(err)));
    }, delay);
    timer.unref?.();
    armed = { key, timer };
  } catch (err) {
    console.error('[door-board-digest] battement en échec :', errorText(err));
  } finally {
    ticking = false;
  }
}

/**
 * Le premier battement huit minutes après le démarrage, puis toutes les cinq
 * minutes à partir de lui ; le départ, lui, suit la minute tirée.
 */
export function startDoorBoardDigest(): void {
  setTimeout(() => {
    runTick();
    setInterval(runTick, TICK_MS).unref();
  }, BOOT_DELAY_MS).unref();
}
