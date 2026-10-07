/**
 * The Monday bulletin (Claude-Alain's approval of 28.09.2026, step A1): one private,
 * read-only answer that gathers what already runs, for one Swiss week.
 *
 * ## Nothing is measured twice
 *
 * Every block reads a source that already exists and says where it comes from:
 *
 * - the numbers are a row of the door board (`getDoorBoard`, the function the
 *   Monday Telegram summary reads), taken by its week key, with the row before it
 *   for the comparison;
 * - what went live is GitHub's list of merged pull requests (`bulletin-github.ts`);
 * - the signs of life and the open alerts are the `kv_state` keys that
 *   `ops-alert.ts` writes, read and never written;
 * - the age of the directory sources is `getSourceFreshness`, the function behind
 *   `/health`'s `bic_sources`, called in-process;
 * - the BIC codes asked for without an answer come from `operations`;
 * - the new forum threads come from `forum_threads.first_seen`;
 * - (step A2, 07.10.2026) the week's alert history comes from `ops_alert_log`, which
 *   `ops-alert.ts` writes at its two transitions; what the Monday veilles deposited
 *   comes from `bulletin_feed` (`bulletin-feed.ts`); the proposals and their answers
 *   from `bulletin-decisions.ts`, whose rules are computed here and never written.
 *
 * ## Why `operations` and not `request_log` for the missing BIC codes
 *
 * `request_log` stores `/v1/bic/:code`, never the code (`normalizeRequestPath`), and
 * a well-formed BIC we do not hold answers 200 with `found: false`, not 404. Read
 * there, the block would be empty by construction. `operations` keeps, per lookup,
 * the date, `success = 0` for a miss, the BIC's country and the BIC itself in
 * `error_detail`; a malformed input is a rejection (`reject_reason`), left out.
 *
 * ## Unread is not zero
 *
 * Each block is guarded on its own: a block that cannot be read answers
 * `{ state: 'unread', reason }` and the others still render. A zero is only ever a
 * zero that was read.
 */
import type DatabaseType from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { getSourceFreshness, type SourceFreshness } from './bic-lookup.js';
import {
  DOOR_BOARD_MAX_WEEKS,
  getDoorBoard,
  isExternalKeyRow,
  weekTitle,
  type AutomatedLine,
} from './door-board.js';
import { HEARTBEATS, RADAR_BEATS } from './ops-alert.js';
import { mergedPullsOfWeek, type MergedPullsRead } from './bulletin-github.js';
import { readFeed, type BulletinFeed } from './bulletin-feed.js';
import { readDecisions, type BulletinDecisions } from './bulletin-decisions.js';
import {
  parseDbUtc,
  sqliteUtc,
  swissWeekOf,
  swissWeekShift,
  zurichDayTime,
  zurichLocalToUtcMs,
  type SwissWeek,
} from './swiss-week.js';

export const BULLETIN_VERSION = 1;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const HOUR_MS = 3_600_000;

/**
 * The oldest week a bulletin can be asked for: the door board shows at most 52
 * weeks, the current one included, so 51 complete weeks back is its last row.
 */
export const BULLETIN_MAX_WEEKS_BACK = DOOR_BOARD_MAX_WEEKS - 1;

/**
 * The home-page door (`site-home`) is written since PR 278 went live, on
 * 27.09.2026 at 10:49 Swiss time. Before that instant a key taken from the home
 * page carried another door, so a zero there would mean "not measured yet".
 */
export const SITE_HOME_DOOR = 'site-home';
export const SITE_HOME_DOOR_SINCE = '2026-09-27 08:49:01';

/** How many countries the "searched without finding" block names. */
export const MISSING_BICS_TOP = 5;

/**
 * An alert whose last failure is older than this is set apart (`stale`): nothing
 * has written it since, and no success will close it. The slowest check that
 * rewrites a lasting failure is the hourly probe, far inside a week.
 */
export const ALERT_STALE_DAYS = 7;

// ─── The week ─────────────────────────────────────────────────────────────────

const WEEK_LABEL = /^(\d{4})-W(\d{2})$/;

/**
 * The Swiss week an ISO label (`AAAA-Wss`) names, or null when it names none.
 * The label must survive the round trip, which refuses a week 53 in a year that
 * has only 52.
 */
export function swissWeekFromLabel(label: string): SwissWeek | null {
  const m = WEEK_LABEL.exec(label);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || n > 53) return null;
  // ISO week 1 is the week that holds 4 January.
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const monday = new Date(jan4 - jan4Weekday * DAY_MS + (n - 1) * WEEK_MS);
  const noon = zurichLocalToUtcMs(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    12,
  );
  const week = swissWeekOf(noon);
  return week.label === label ? week : null;
}

export interface ResolvedWeek {
  week: SwissWeek;
  /** 1 for the last complete week, 2 for the one before, and so on. */
  weeksBack: number;
}

function weeksBetween(later: SwissWeek, earlier: SwissWeek): number {
  return Math.round(
    (Date.parse(`${later.monday}T00:00:00Z`) - Date.parse(`${earlier.monday}T00:00:00Z`)) / WEEK_MS,
  );
}

/**
 * The week a request names, or the last COMPLETE Swiss week when it names none,
 * names a week still running or to come, or one further back than the door board
 * goes. Like `/v1/admin/doors`, an unusable value falls back to the default and
 * the answer says what was asked (`requested`).
 */
export function resolveBulletinWeek(raw: string | null | undefined, nowMs: number): ResolvedWeek {
  const current = swissWeekOf(nowMs);
  const fallback: ResolvedWeek = { week: swissWeekShift(current, 1), weeksBack: 1 };
  if (!raw) return fallback;
  const week = swissWeekFromLabel(raw);
  if (!week) return fallback;
  const weeksBack = weeksBetween(current, week);
  if (weeksBack < 1 || weeksBack > BULLETIN_MAX_WEEKS_BACK) return fallback;
  return { week, weeksBack };
}

// ─── The shape of the answer ─────────────────────────────────────────────────

export interface Unread {
  state: 'unread';
  reason: string;
}

export interface WeekTotals {
  created: number;
  first_success: number;
  nudged: number;
  called_after_nudge: number;
  followup_pending: number;
  paid: number;
}

export interface BulletinNumbers {
  state: 'read';
  /** People only: the automated creations are never in these totals. */
  totals: WeekTotals;
  /**
   * The week's automated creations (a crawler's keys that never served), the
   * door board's separate line, named in full and never dropped.
   */
  automated: AutomatedLine;
  /** The week before, for the comparison; null when the door board does not show it. */
  previous: {
    week: string;
    created: number;
    first_success: number;
    paid: number;
    automated: number;
  } | null;
  /**
   * Free users active at 200 a month, in PEOPLE, over the 30 days ending on the
   * Sunday. The door board counts them for the last complete week only; any other
   * week answers null rather than a number computed on another window.
   */
  free_active: {
    people: number;
    keys: number;
    threshold: number;
    window: { from: string; to: string };
    crossed: boolean;
  } | null;
  site_home: {
    /** UTC instant from which the door is written. */
    since: string;
    /** Whether the door was written during the whole week, part of it, or not at all. */
    coverage: 'full' | 'partial' | 'none';
    created: number | null;
    first_success: number | null;
    paid: number | null;
  };
  /** The doors of the week, most keys first, as the door board sorts them. */
  doors: Array<{
    door: string;
    label: string;
    created: number;
    first_success: number;
    paid: number;
  }>;
  /** The Monday summary's sentence, for the last complete week only. */
  sentence: string | null;
}

export type HeartbeatState = 'on_time' | 'late' | 'never' | 'unreadable';

export interface HeartbeatView {
  kind: 'cron' | 'radar';
  name: string;
  label: string;
  /**
   * The last beat recorded, UTC. For a GitHub cron this can be the day the probe
   * started watching: a missing beat is written by the probe at its first check.
   */
  last_beat_at: string | null;
  age_hours: number | null;
  max_age_hours: number;
  state: HeartbeatState;
  /** The ops alert on this heartbeat is open (its message left and it is not closed). */
  alert_open: boolean;
}

export interface BulletinHeartbeats {
  state: 'read';
  items: HeartbeatView[];
  on_time: number;
  late: number;
  never: number;
}

export interface AlertView {
  /**
   * The alert key without the identifier some keys carry (`x402:purchase-confirm:<id>`,
   * `audit:<status>:<session hash>`): the two first segments. Keys of the same name
   * in the same state are counted together (`cases`).
   */
  name: string;
  /** The heartbeat's label when the alert is a heartbeat's, null otherwise. */
  label: string | null;
  /** How many keys of that name are in that state (one per purchase for the per-purchase keys). */
  cases: number;
  fails: number;
  /** When the alert message left, UTC; the latest of the name; null when none has left. */
  opened_at: string | null;
  /** The last write of the alert's state, which is its last failure seen, UTC. */
  last_failure_at: string | null;
}

export interface BulletinAlerts {
  state: 'read';
  /** Open alerts: their message left, and no success has closed them yet. */
  open: AlertView[];
  /** Failing keys whose message has not left (below the threshold, storm gate, channel down). */
  failing: AlertView[];
  /**
   * Open or failing states whose last failure is older than `ALERT_STALE_DAYS`. A
   * failure that lasts rewrites its state at every pass; an event that never came
   * back (a payment rejection, a purchase since settled) leaves its key as it was,
   * and no success ever closes it. Shown apart, never in the machinery's colour.
   */
  stale: AlertView[];
}

export interface SourceView {
  source: string;
  entries: number;
  last_updated: string | null;
  age_days: number | null;
  source_as_of: string | null;
  stale: boolean;
  stale_reason: SourceFreshness['stale_reason'];
}

export interface BulletinSources {
  state: 'read';
  sources: SourceView[];
  fresh: number;
  total: number;
}

export interface MissingBicCountry {
  country: string;
  lookups: number;
  distinct_codes: number;
}

export interface BulletinMissingBics {
  state: 'read';
  source: 'operations';
  total_lookups: number;
  total_countries: number;
  top: MissingBicCountry[];
  /** Lookups by our own internal, test or probe keys, left out. */
  excluded_internal: number;
}

export interface BulletinForumThreads {
  state: 'read';
  /** Threads the forum radar entered during the week (hand-added ones left out). */
  found: number;
  /** Of those, the ones still untouched (status `new`). */
  still_new: number;
}

export interface AlertOpenedGroup {
  /** The alert key without its identifier, as in the current-state block. */
  name: string;
  label: string | null;
  /** How many alerts of that name opened (their message left) during the week. */
  cases: number;
  /** The first opening of the week, UTC. */
  first_opened_at: string;
  /** Of those, how many are still open now. */
  still_open: number;
}

export interface AlertClosedGroup {
  name: string;
  label: string | null;
  /** How many alerts of that name closed during the week. */
  cases: number;
  /** The last closing of the week, UTC. */
  last_closed_at: string;
  /** The longest of those episodes, in hours; null when none has a known opening. */
  longest_hours: number | null;
  /** Closed during the week, opened before the history was kept: their opening is unknown. */
  opened_before_history: number;
}

export interface BulletinAlertHistory {
  state: 'read';
  /** When the history started being kept, UTC; null when the marker cannot be read. */
  kept_since: string | null;
  /** Whether the history covers the whole week, part of it, or none of it. */
  coverage: 'full' | 'partial' | 'none';
  opened: AlertOpenedGroup[];
  closed: AlertClosedGroup[];
}

export interface NotYetBlock {
  key: string;
  title: string;
  reason: string;
}

export interface Bulletin {
  version: typeof BULLETIN_VERSION;
  observed_at: string;
  observed_at_zurich: string;
  week: {
    label: string;
    title: string;
    monday: string;
    sunday: string;
    start_utc: string;
    end_utc: string;
    last_complete: boolean;
    previous: string | null;
    next: string | null;
  };
  requested: { week: string | null };
  numbers: BulletinNumbers | Unread;
  /** Step A2: at most three proposals, with the answers Oui / Plus tard / Non. */
  decisions: BulletinDecisions | Unread;
  moved: {
    merged_pulls: MergedPullsRead;
    /** The state NOW, not the week's. */
    heartbeats: BulletinHeartbeats | Unread;
    alerts: BulletinAlerts | Unread;
    /** Step A2: the alerts opened and closed DURING the week. */
    alert_history: BulletinAlertHistory | Unread;
    sources: BulletinSources | Unread;
  };
  needs: {
    missing_bics: BulletinMissingBics | Unread;
    forum_threads: BulletinForumThreads | Unread;
  };
  /** Step B: what the two Monday veilles deposited for this week. */
  veille: BulletinFeed | Unread;
  not_yet: NotYetBlock[];
  definitions: Record<string, string>;
}

/**
 * The blocks of the approved mock-up that have no data today. The page lists
 * them so that an empty place is never read as "nothing happened".
 */
export const BULLETIN_NOT_YET: readonly NotYetBlock[] = [
  {
    key: 'iban_by_country',
    title: 'Les IBAN cherchés par pays',
    reason:
      'Le journal des requêtes ne garde aucun IBAN : le décompte par pays hors couverture reste à construire.',
  },
];

export const BULLETIN_DEFINITIONS: Readonly<Record<string, string>> = {
  semaine: 'Du lundi 00:00 au dimanche 23:59, heure suisse, comme le tableau des portes.',
  chiffres:
    'La ligne de la semaine dans le tableau des portes, calculée par la même fonction que le ' +
    'résumé du lundi : des clés externes, jamais des requêtes. Les utilisateurs gratuits actifs ' +
    'ne sont comptés que pour la dernière semaine close. Les créations automatiques d’un robot ' +
    'd’exploration (clés anonymes sans navigateur, jamais servies, prises à trois ou plus depuis ' +
    'un même réseau en sept jours) n’y sont pas : elles ont leur ligne à part.',
  accueil:
    'La porte « Accueil du site » compte les clés prises depuis la page d’accueil. Elle est ' +
    'écrite depuis la mise en ligne de l’accueil neuf, le 27.09.2026 à 10:49.',
  mises_en_ligne:
    'Les PR fusionnées dans main pendant la semaine, lues sur l’API publique de GitHub et ' +
    'gardées une heure. Une fusion dans main met l’API en ligne.',
  signes_de_vie:
    'Le dernier battement enregistré de chaque automatisation, en ce moment. Pour un relevé ' +
    'lancé par GitHub, un battement absent est posé par la sonde à sa première lecture : la ' +
    'date peut être le début de la surveillance, pas une exécution.',
  alertes:
    'L’état courant des alertes d’exploitation : ouvertes (le message est parti, aucun succès ' +
    'ne les a refermées) ou en échec sans message parti. Une alerte sans nouvel échec depuis ' +
    'plus de 7 jours est rangée à part : rien ne la referme toute seule. Les alertes propres à ' +
    'un achat ou à une session sont comptées sous leur nom, sans leur identifiant.',
  historique_alertes:
    'Les alertes ouvertes pendant la semaine (leur message est parti) et celles refermées ' +
    'pendant la semaine, écrites par les alertes elles-mêmes à ces deux moments. ' +
    'L’historique est tenu depuis la mise en ligne de l’étape A2 : une semaine d’avant ' +
    'le dit, elle ne montre pas zéro.',
  decisions:
    'Au plus trois propositions : celles de la session principale, puis deux règles sans ' +
    'modèle (une veille qui a déposé quatre semaines sans qu’aucune proposition née d’elle ' +
    'reçoive un Oui ; un pays aux BIC introuvables, au moins 10 recherches sur 3 codes ' +
    'différents dans la semaine). Oui et Non ne reviennent pas ; Plus tard revient 28 jours ' +
    'après la réponse. Une semaine passée montre les réponses données ce lundi-là.',
  veille:
    'Ce que les deux veilles du lundi ont déposé pour la semaine, en plus de leur message ' +
    'Telegram : trois lignes de la veille marché (les portes qui s’ouvrent), et le score des ' +
    'IA (requêtes de référence où une recherche web fait apparaître IBANforge, détecté par ' +
    'le script, jamais jugé par le modèle). Rien de déposé : la page le dit.',
  sources: 'L’âge des sources de l’annuaire BIC, celui que sert /health, en ce moment.',
  bic_introuvables:
    'Les recherches de BIC bien formés sans réponse dans l’annuaire, par pays (5e et 6e ' +
    'lettres du BIC). Lu dans le registre des opérations : le journal des requêtes ne garde ' +
    'pas le code cherché. Nos clés internes, de test ou de sonde sont écartées ; les appels ' +
    'payés sans clé comptent. Un BIC à 8 et à 11 caractères de la même banque compte pour un ' +
    'seul code.',
  forums:
    'Les fils entrés dans le radar des forums pendant la semaine, et ceux qui n’ont pas ' +
    'encore été regardés. Un fil ajouté à la main sans source ne compte pas.',
};

// ─── The blocks ──────────────────────────────────────────────────────────────

function hoursSince(ms: number, nowMs: number): number {
  return Math.round((nowMs - ms) / (HOUR_MS / 10)) / 10;
}

function readNumbers(resolved: ResolvedWeek, nowMs: number): BulletinNumbers {
  const board = getDoorBoard({
    weeks: Math.min(resolved.weeksBack + 2, DOOR_BOARD_MAX_WEEKS),
    now: nowMs,
  });
  const index = board.weeks.findIndex((w) => w.key === resolved.week.label);
  if (index < 0) throw new Error(`week ${resolved.week.label} is not on the door board`);
  const row = board.weeks[index];
  const before = board.weeks[index + 1];
  const isLast = board.last_week.week === resolved.week.label;

  const since = parseDbUtc(SITE_HOME_DOOR_SINCE) as number;
  const coverage: BulletinNumbers['site_home']['coverage'] =
    resolved.week.endMs <= since ? 'none' : resolved.week.startMs >= since ? 'full' : 'partial';
  const home = row.doors.find((d) => d.door === SITE_HOME_DOOR);
  const free = board.free_users;

  return {
    state: 'read',
    totals: {
      created: row.totals.created,
      first_success: row.totals.first_success,
      nudged: row.totals.nudged,
      called_after_nudge: row.totals.called_after_nudge,
      followup_pending: row.totals.followup_pending,
      paid: row.totals.paid,
    },
    automated: { label: row.automated.label, created: row.automated.created },
    previous:
      before && before.kind === 'complete'
        ? {
            week: before.key,
            created: before.totals.created,
            first_success: before.totals.first_success,
            paid: before.totals.paid,
            automated: before.automated.created,
          }
        : null,
    free_active: isLast
      ? {
          people: free.active_people,
          keys: free.active_keys,
          threshold: free.threshold,
          window: free.window,
          crossed: free.crossed,
        }
      : null,
    site_home: {
      since: SITE_HOME_DOOR_SINCE,
      coverage,
      created: coverage === 'none' ? null : (home?.created ?? 0),
      first_success: coverage === 'none' ? null : (home?.first_success ?? 0),
      paid: coverage === 'none' ? null : (home?.paid ?? 0),
    },
    doors: row.doors.map((d) => ({
      door: d.door,
      label: d.label,
      created: d.created,
      first_success: d.first_success,
      paid: d.paid,
    })),
    sentence: isLast ? board.last_week.sentence : null,
  };
}

/**
 * `ops-alert.ts` keeps these three key shapes private (`K_BEAT`, `K_STATE`,
 * `K_SENT`). They are read here, never written; `bulletin.test.ts` pins them
 * through that module's own writers, `heartbeat()` and `opsFail()`.
 */
const BEAT_PREFIX = 'ops:beat:';
const STATE_PREFIX = 'ops:state:';
const SENT_PREFIX = 'ops:sent:';

interface AlertStateRow {
  fails: number;
  firing: boolean;
  updated_at: string | null;
}

interface OpsKv {
  /** Raw values of the heartbeat and radar keys, by kv key. */
  beats: Map<string, string>;
  /** Alert states, by alert key. */
  states: Map<string, AlertStateRow>;
  /** When each alert message left, in milliseconds, by alert key. */
  sent: Map<string, number>;
}

/**
 * Everything the bulletin reads from `kv_state`, in one query. A plain read: the
 * table is not created here (`kvGet` would), and a database where nothing was
 * ever written simply has no alert and no beat.
 */
function readOpsKv(): OpsKv {
  const db = getStatsDB();
  const out: OpsKv = { beats: new Map(), states: new Map(), sent: new Map() };
  const table = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv_state'`)
    .get();
  if (!table) return out;
  const beatKeys = [
    ...HEARTBEATS.map((h) => `${BEAT_PREFIX}${h.name}`),
    ...RADAR_BEATS.map((r) => r.key),
  ];
  // A prefix as a key range, so the primary key serves it: every key that starts
  // with `ops:state:` sorts at or after it and before `ops:state;` (`;` follows `:`).
  const upTo = (prefix: string): string => `${prefix.slice(0, -1)};`;
  const rows = db
    .prepare(
      `SELECT key, value, updated_at FROM kv_state
        WHERE key IN (${beatKeys.map(() => '?').join(', ')})
           OR (key >= ? AND key < ?) OR (key >= ? AND key < ?)`,
    )
    .all(...beatKeys, STATE_PREFIX, upTo(STATE_PREFIX), SENT_PREFIX, upTo(SENT_PREFIX)) as Array<{
    key: string;
    value: string;
    updated_at: string | null;
  }>;
  for (const r of rows) {
    if (r.key.startsWith(SENT_PREFIX)) {
      const ms = Number(r.value);
      if (Number.isFinite(ms) && ms > 0) out.sent.set(r.key.slice(SENT_PREFIX.length), ms);
    } else if (r.key.startsWith(STATE_PREFIX)) {
      try {
        const parsed = JSON.parse(r.value) as { fails?: unknown; firing?: unknown };
        out.states.set(r.key.slice(STATE_PREFIX.length), {
          fails: Number(parsed.fails ?? 0) || 0,
          firing: Boolean(parsed.firing),
          updated_at: r.updated_at,
        });
      } catch {
        // `ops-alert.ts` reads an unparsable state as "no failure": so does this.
      }
    } else {
      out.beats.set(r.key, r.value);
    }
  }
  return out;
}

function readHeartbeats(nowMs: number, kv: OpsKv): BulletinHeartbeats {
  const view = (
    kind: HeartbeatView['kind'],
    name: string,
    label: string,
    maxAgeMs: number,
    last: number | null | 'unreadable',
  ): HeartbeatView => {
    const known = typeof last === 'number';
    const state: HeartbeatState =
      last === 'unreadable'
        ? 'unreadable'
        : last === null
          ? 'never'
          : nowMs - last > maxAgeMs
            ? 'late'
            : 'on_time';
    return {
      kind,
      name,
      label,
      last_beat_at: known ? sqliteUtc(last) : null,
      age_hours: known ? hoursSince(last, nowMs) : null,
      max_age_hours: Math.round(maxAgeMs / HOUR_MS),
      state,
      alert_open: kv.states.get(`heartbeat:${name}`)?.firing ?? false,
    };
  };

  const items: HeartbeatView[] = [];
  for (const h of HEARTBEATS) {
    const raw = kv.beats.get(`${BEAT_PREFIX}${h.name}`);
    const ms = raw === undefined ? null : Number(raw);
    items.push(
      view(
        'cron',
        h.name,
        h.label,
        h.maxAgeMs,
        ms === null || Number.isFinite(ms) ? ms : 'unreadable',
      ),
    );
  }
  for (const r of RADAR_BEATS) {
    const raw = kv.beats.get(r.key);
    let last: number | null | 'unreadable' = null;
    if (raw !== undefined) {
      try {
        const parsed = r.parse(raw);
        // `null` is a state without a finished run, which `ops-alert.ts` does not
        // judge either; a date that does not parse is unreadable.
        last = parsed === null ? null : Number.isFinite(parsed) ? parsed : 'unreadable';
      } catch {
        last = 'unreadable';
      }
    }
    items.push(view('radar', r.key, r.label, r.maxAgeMs, last));
  }
  return {
    state: 'read',
    items,
    on_time: items.filter((i) => i.state === 'on_time').length,
    late: items.filter((i) => i.state === 'late').length,
    never: items.filter((i) => i.state === 'never').length,
  };
}

function heartbeatLabel(alertKey: string): string | null {
  if (!alertKey.startsWith('heartbeat:')) return null;
  const name = alertKey.slice('heartbeat:'.length);
  return (
    HEARTBEATS.find((h) => h.name === name)?.label ??
    RADAR_BEATS.find((r) => r.key === name)?.label ??
    null
  );
}

/** The alert key without its identifier, if it carries one: its two first segments. */
export function alertName(key: string): string {
  return key.split(':').slice(0, 2).join(':');
}

/** The later of two UTC stamps (`AAAA-MM-JJ HH:MM:SS` sorts as it reads). */
function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

function readAlerts(kv: OpsKv, nowMs: number): BulletinAlerts {
  const buckets = {
    open: new Map<string, AlertView>(),
    failing: new Map<string, AlertView>(),
    stale: new Map<string, AlertView>(),
  };
  for (const [key, s] of kv.states) {
    if (!s.firing && s.fails <= 0) continue;
    const sentMs = kv.sent.get(key);
    const updated = parseDbUtc(s.updated_at);
    const openedAt = s.firing && sentMs !== undefined ? sqliteUtc(sentMs) : null;
    const lastFailureAt = updated !== null ? sqliteUtc(updated) : null;
    // A state without a readable date cannot be judged old: it stays where it is.
    const bucket =
      updated !== null && nowMs - updated > ALERT_STALE_DAYS * DAY_MS
        ? buckets.stale
        : s.firing
          ? buckets.open
          : buckets.failing;
    const name = alertName(key);
    const seen = bucket.get(name);
    if (seen) {
      seen.cases += 1;
      seen.fails += s.fails;
      seen.opened_at = later(seen.opened_at, openedAt);
      seen.last_failure_at = later(seen.last_failure_at, lastFailureAt);
    } else {
      bucket.set(name, {
        name,
        label: heartbeatLabel(key),
        cases: 1,
        fails: s.fails,
        opened_at: openedAt,
        last_failure_at: lastFailureAt,
      });
    }
  }
  const newestFirst = (a: AlertView, b: AlertView): number =>
    (b.opened_at ?? b.last_failure_at ?? '').localeCompare(
      a.opened_at ?? a.last_failure_at ?? '',
    ) || a.name.localeCompare(b.name);
  const sorted = (m: Map<string, AlertView>): AlertView[] => [...m.values()].sort(newestFirst);
  return {
    state: 'read',
    open: sorted(buckets.open),
    failing: sorted(buckets.failing),
    stale: sorted(buckets.stale),
  };
}

/**
 * The alerts opened and closed DURING the week, from `ops_alert_log` (step A2).
 *
 * 🚨 Opened in the week, closed in the week: never "open at some point of the week".
 * Several keys never close (`x402:facilitator`, the per-purchase keys, see the
 * current-state block): read as "overlapping", they would show in every week
 * forever. The current state, with its stale bucket, already says what is open now.
 */
function readAlertHistory(week: SwissWeek): BulletinAlertHistory {
  const db = getStatsDB();
  const sinceRow = db
    .prepare(`SELECT value FROM bulletin_meta WHERE key = 'ops_alert_log_since'`)
    .get() as { value: string } | undefined;
  const sinceMs = parseDbUtc(sinceRow?.value ?? null);
  const coverage: BulletinAlertHistory['coverage'] =
    sinceMs === null || week.endMs <= sinceMs
      ? 'none'
      : week.startMs >= sinceMs
        ? 'full'
        : 'partial';
  const from = sqliteUtc(week.startMs);
  const to = sqliteUtc(week.endMs);

  const openedRows = db
    .prepare(
      `SELECT alert_key, opened_at, closed_at FROM ops_alert_log
        WHERE opened_at >= ? AND opened_at < ?`,
    )
    .all(from, to) as Array<{ alert_key: string; opened_at: string; closed_at: string | null }>;
  const opened = new Map<string, AlertOpenedGroup>();
  for (const r of openedRows) {
    const name = alertName(r.alert_key);
    const at = sqliteUtc(parseDbUtc(r.opened_at) ?? 0);
    const g = opened.get(name);
    const open = r.closed_at === null ? 1 : 0;
    if (g) {
      g.cases += 1;
      g.still_open += open;
      if (at < g.first_opened_at) g.first_opened_at = at;
    } else {
      opened.set(name, {
        name,
        label: heartbeatLabel(r.alert_key),
        cases: 1,
        first_opened_at: at,
        still_open: open,
      });
    }
  }

  const closedRows = db
    .prepare(
      `SELECT alert_key, opened_at, closed_at FROM ops_alert_log
        WHERE closed_at >= ? AND closed_at < ?`,
    )
    .all(from, to) as Array<{ alert_key: string; opened_at: string | null; closed_at: string }>;
  const closed = new Map<string, AlertClosedGroup>();
  for (const r of closedRows) {
    const name = alertName(r.alert_key);
    const closedMs = parseDbUtc(r.closed_at) ?? 0;
    const openedMs = parseDbUtc(r.opened_at);
    const hours = openedMs === null ? null : hoursSince(openedMs, closedMs);
    const at = sqliteUtc(closedMs);
    const g = closed.get(name);
    if (g) {
      g.cases += 1;
      if (at > g.last_closed_at) g.last_closed_at = at;
      if (hours !== null) g.longest_hours = Math.max(g.longest_hours ?? 0, hours);
      if (openedMs === null) g.opened_before_history += 1;
    } else {
      closed.set(name, {
        name,
        label: heartbeatLabel(r.alert_key),
        cases: 1,
        last_closed_at: at,
        longest_hours: hours,
        opened_before_history: openedMs === null ? 1 : 0,
      });
    }
  }
  const byTime =
    <T>(key: (g: T) => string) =>
    (a: T, b: T) =>
      key(a).localeCompare(key(b));
  return {
    state: 'read',
    kept_since: sinceMs === null ? null : sqliteUtc(sinceMs),
    coverage,
    opened: [...opened.values()].sort(byTime((g) => g.first_opened_at)),
    closed: [...closed.values()].sort(byTime((g) => g.last_closed_at)),
  };
}

function readSources(nowMs: number): BulletinSources {
  const sources: SourceView[] = getSourceFreshness().map((s) => {
    const updated = parseDbUtc(s.last_updated);
    return {
      source: s.source,
      entries: s.entries,
      last_updated: updated !== null ? sqliteUtc(updated) : null,
      age_days: updated !== null ? Math.floor((nowMs - updated) / DAY_MS) : null,
      source_as_of: s.source_as_of,
      stale: s.stale,
      stale_reason: s.stale_reason,
    };
  });
  return {
    state: 'read',
    sources,
    fresh: sources.filter((s) => !s.stale).length,
    total: sources.length,
  };
}

/**
 * The missing BIC codes of a week, per country, per key prefix and per code.
 *
 * 🚨 Only the date can reach an index. The unary `+` keeps the planner off the
 * indexes on type, reject reason, key and country: an equality on the type would
 * walk every BIC lookup of the whole retention to test its date. On the date index
 * the scan is the week and nothing else. A test holds the plan.
 */
export const MISSING_BICS_SQL = `SELECT COALESCE(country_code, UPPER(SUBSTR(error_detail, 5, 2))) AS country,
          key_prefix, error_detail AS code, COUNT(*) AS lookups
     FROM operations
    WHERE created_at >= ? AND created_at < ?
      AND +operation_type = 'bic_lookup' AND +success = 0 AND +reject_reason IS NULL
    GROUP BY 1, 2, 3`;

/** The prefixes, among those given, that belong to an internal, test or probe key. */
function internalPrefixes(db: DatabaseType.Database, prefixes: string[]): Set<string> {
  const out = new Set<string>();
  const unique = [...new Set(prefixes)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT key_prefix, email, issued_by_us FROM api_keys
          WHERE key_prefix IN (${chunk.map(() => '?').join(', ')})`,
      )
      .all(...chunk) as Array<{
      key_prefix: string;
      email: string | null;
      issued_by_us: number | null;
    }>;
    // One internal row is enough: a prefix was not unique in the inherited
    // database, and the doubt falls on the side of leaving it out, as in the
    // door board.
    for (const r of rows) if (!isExternalKeyRow(r)) out.add(r.key_prefix);
  }
  return out;
}

export function readMissingBics(week: SwissWeek): BulletinMissingBics {
  const db = getStatsDB();
  const rows = db
    .prepare(MISSING_BICS_SQL)
    .all(sqliteUtc(week.startMs), sqliteUtc(week.endMs)) as Array<{
    country: string | null;
    key_prefix: string | null;
    code: string | null;
    lookups: number;
  }>;
  const internal = internalPrefixes(
    db,
    rows.map((r) => r.key_prefix).filter((p): p is string => !!p),
  );
  const byCountry = new Map<string, { lookups: number; codes: Set<string> }>();
  let excluded = 0;
  let total = 0;
  for (const r of rows) {
    if (r.key_prefix && internal.has(r.key_prefix)) {
      excluded += r.lookups;
      continue;
    }
    const country = r.country && /^[A-Z]{2}$/.test(r.country) ? r.country : '??';
    let entry = byCountry.get(country);
    if (!entry) {
      entry = { lookups: 0, codes: new Set() };
      byCountry.set(country, entry);
    }
    entry.lookups += r.lookups;
    // A BIC of 8 and of 11 characters of the same bank name one bank: counted once.
    if (r.code) entry.codes.add(r.code.toUpperCase().slice(0, 8));
    total += r.lookups;
  }
  const ranked = [...byCountry.entries()]
    .map(([country, e]) => ({ country, lookups: e.lookups, distinct_codes: e.codes.size }))
    .sort(
      (a, b) =>
        b.lookups - a.lookups ||
        b.distinct_codes - a.distinct_codes ||
        a.country.localeCompare(b.country),
    );
  return {
    state: 'read',
    source: 'operations',
    total_lookups: total,
    total_countries: ranked.length,
    top: ranked.slice(0, MISSING_BICS_TOP),
    excluded_internal: excluded,
  };
}

function readForumThreads(week: SwissWeek): BulletinForumThreads {
  const row = getStatsDB()
    .prepare(
      `SELECT COUNT(*) AS found,
              COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS still_new
         FROM forum_threads
        WHERE first_seen >= ? AND first_seen < ? AND source <> 'manual'`,
    )
    .get(sqliteUtc(week.startMs), sqliteUtc(week.endMs)) as { found: number; still_new: number };
  return { state: 'read', found: row.found, still_new: row.still_new };
}

function guarded<T>(block: string, read: () => T): T | Unread {
  try {
    return read();
  } catch (err) {
    console.error(`[bulletin] ${block} unreadable:`, err instanceof Error ? err.message : err);
    return { state: 'unread', reason: 'read_failed' };
  }
}

// ─── The bulletin ────────────────────────────────────────────────────────────

export interface BulletinOptions {
  /** `AAAA-Wss`; the last complete week when absent or unusable. */
  week?: string | null;
  /** Injectable clock, for the tests. */
  now?: number;
}

export async function getBulletin(opts: BulletinOptions = {}): Promise<Bulletin> {
  const nowMs = opts.now ?? Date.now();
  const resolved = resolveBulletinWeek(opts.week, nowMs);
  const { week, weeksBack } = resolved;

  // GitHub first: its wait (up to 12 s when the cache is cold) runs while the
  // database is read below, instead of after it.
  const mergedPulls = mergedPullsOfWeek(week, nowMs);

  // One read of `kv_state` feeds the signs of life and the alerts; when it fails,
  // both blocks say so rather than showing "no alert" and "never beat".
  const kv = guarded('kv_state', () => readOpsKv());
  const numbers = guarded('numbers', () => readNumbers(resolved, nowMs));
  const heartbeats = 'beats' in kv ? guarded('heartbeats', () => readHeartbeats(nowMs, kv)) : kv;
  const alerts = 'beats' in kv ? guarded('alerts', () => readAlerts(kv, nowMs)) : kv;
  const sources = guarded('sources', () => readSources(nowMs));
  const missingBics = guarded('missing_bics', () => readMissingBics(week));
  const forumThreads = guarded('forum_threads', () => readForumThreads(week));
  const alertHistory = guarded('alert_history', () => readAlertHistory(week));
  const veille = guarded('veille', () => readFeed(week.label));
  // The rule on missing BIC codes reads the block above; unread, that rule is
  // simply not applied, and the other proposals still show.
  const decisions = guarded('decisions', () =>
    readDecisions(week, weeksBack === 1, missingBics.state === 'read' ? missingBics : null, nowMs),
  );

  return {
    version: BULLETIN_VERSION,
    observed_at: sqliteUtc(nowMs),
    observed_at_zurich: zurichDayTime(nowMs),
    week: {
      label: week.label,
      title: weekTitle(week),
      monday: week.monday,
      sunday: week.sunday,
      start_utc: sqliteUtc(week.startMs),
      end_utc: sqliteUtc(week.endMs),
      last_complete: weeksBack === 1,
      previous: weeksBack < BULLETIN_MAX_WEEKS_BACK ? swissWeekShift(week, 1).label : null,
      next: weeksBack > 1 ? swissWeekShift(week, -1).label : null,
    },
    requested: { week: opts.week ?? null },
    numbers,
    decisions,
    moved: {
      merged_pulls: await mergedPulls,
      heartbeats,
      alerts,
      alert_history: alertHistory,
      sources,
    },
    needs: { missing_bics: missingBics, forum_threads: forumThreads },
    veille,
    not_yet: BULLETIN_NOT_YET.map((b) => ({ ...b })),
    definitions: { ...BULLETIN_DEFINITIONS },
  };
}
