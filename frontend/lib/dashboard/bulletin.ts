/**
 * The Monday bulletin, site side: the shape `GET /v1/admin/bulletin` returns, a
 * guard that refuses any other shape, and the French phrases the page draws from it.
 *
 * Nothing is recomputed here: every figure is the API's, and the API names its
 * source for each block (`src/lib/bulletin.ts`). A block the API could not read
 * arrives as `{ state: 'unread' }` and is said so, never drawn as zeros.
 *
 * No `Intl`, no `toLocale*` (rule 8): numbers go through `format-grouped`, instants
 * through `crm/zurich`, dates are spelled out by hand.
 */
import { formatGrouped } from '@/lib/format-grouped';
import { toZurich } from '@/lib/crm/zurich';

export const BULLETIN_VERSION = 1;

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
  totals: WeekTotals;
  previous: { week: string; created: number; first_success: number; paid: number } | null;
  free_active: {
    people: number;
    keys: number;
    threshold: number;
    window: { from: string; to: string };
    crossed: boolean;
  } | null;
  site_home: {
    since: string;
    coverage: 'full' | 'partial' | 'none';
    created: number | null;
    first_success: number | null;
    paid: number | null;
  };
  doors: Array<{ door: string; label: string; created: number; first_success: number; paid: number }>;
  sentence: string | null;
}

export interface MergedPull {
  number: number;
  title: string;
  merged_at: string;
  url: string;
}

export type MergedPullsRead =
  | { state: 'read'; source: 'github'; repo: string; fetched_at: string; pulls: MergedPull[] }
  | { state: 'unread'; source: 'github'; repo: string; fetched_at: string; reason: string };

export type HeartbeatState = 'on_time' | 'late' | 'never' | 'unreadable';

export interface HeartbeatView {
  kind: 'cron' | 'radar';
  name: string;
  label: string;
  last_beat_at: string | null;
  age_hours: number | null;
  max_age_hours: number;
  state: HeartbeatState;
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
  key: string;
  label: string | null;
  fails: number;
  opened_at: string | null;
  last_failure_at: string | null;
}

export interface BulletinAlerts {
  state: 'read';
  open: AlertView[];
  failing: AlertView[];
}

export interface SourceView {
  source: string;
  entries: number;
  last_updated: string | null;
  age_days: number | null;
  source_as_of: string | null;
  stale: boolean;
  stale_reason: 'import_overdue' | 'source_frozen' | null;
}

export interface BulletinSources {
  state: 'read';
  sources: SourceView[];
  fresh: number;
  total: number;
}

export interface BulletinMissingBics {
  state: 'read';
  source: 'operations';
  total_lookups: number;
  total_countries: number;
  top: Array<{ country: string; lookups: number; distinct_codes: number }>;
  excluded_internal: number;
}

export interface BulletinForumThreads {
  state: 'read';
  found: number;
  still_new: number;
}

export interface BulletinPayload {
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
  moved: {
    merged_pulls: MergedPullsRead;
    heartbeats: BulletinHeartbeats | Unread;
    alerts: BulletinAlerts | Unread;
    sources: BulletinSources | Unread;
  };
  needs: {
    missing_bics: BulletinMissingBics | Unread;
    forum_threads: BulletinForumThreads | Unread;
  };
  not_yet: Array<{ key: string; title: string; reason: string }>;
  definitions: Record<string, string>;
}

// ─── The guard ───────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isBlock = (v: unknown): boolean =>
  isObj(v) && (v.state === 'read' || (v.state === 'unread' && typeof v.reason === 'string'));

const WEEK_LABEL = /^\d{4}-W\d{2}$/;
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
/** The only links the page makes clickable: this repository's pull requests. */
const PULL_URL = /^https:\/\/github\.com\/cammac-creator\/ibanforge\/pull\/\d+$/;

/**
 * The payload when it has the shape this page knows, null otherwise. An API of
 * another version, or a body missing a block, renders "unavailable" rather than
 * a page of zeros (the rule of `service-usage.ts`).
 */
export function readBulletin(payload: unknown): BulletinPayload | null {
  if (!isObj(payload) || payload.version !== BULLETIN_VERSION) return null;
  const { week, numbers, moved, needs, not_yet, definitions } = payload;
  if (!isObj(week) || typeof week.label !== 'string' || !WEEK_LABEL.test(week.label)) return null;
  if (typeof week.monday !== 'string' || !CIVIL.test(week.monday)) return null;
  if (typeof week.sunday !== 'string' || !CIVIL.test(week.sunday)) return null;
  if (typeof payload.observed_at !== 'string' || typeof payload.observed_at_zurich !== 'string') {
    return null;
  }
  if (!isBlock(numbers) || !isObj(moved) || !isObj(needs)) return null;
  for (const block of ['merged_pulls', 'heartbeats', 'alerts', 'sources']) {
    if (!isBlock(moved[block])) return null;
  }
  for (const block of ['missing_bics', 'forum_threads']) {
    if (!isBlock(needs[block])) return null;
  }
  const pulls = moved.merged_pulls as Obj;
  if (pulls.state === 'read') {
    if (!Array.isArray(pulls.pulls)) return null;
    for (const p of pulls.pulls) {
      if (!isObj(p) || typeof p.url !== 'string' || !PULL_URL.test(p.url)) return null;
    }
  }
  if (!Array.isArray(not_yet) || !isObj(definitions)) return null;
  return payload as unknown as BulletinPayload;
}

// ─── Numbers and words ───────────────────────────────────────────────────────

/** A count, grouped the French way, identical on the server and in any browser. */
export function fmt(n: number): string {
  return formatGrouped(n, 'fr');
}

/** A number and its noun agreed: 0 and 1 singular, as in French. */
export function count(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n <= 1 ? one : many}`;
}

/** The change from the week before: `+3`, `−2` or `=`. */
export function delta(current: number, previous: number): string {
  const d = current - previous;
  if (d === 0) return '=';
  return d > 0 ? `+${fmt(d)}` : `−${fmt(-d)}`;
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function civilParts(civil: string): { y: number; m: number; d: number } {
  return { y: Number(civil.slice(0, 4)), m: Number(civil.slice(5, 7)), d: Number(civil.slice(8, 10)) };
}

/** `lundi 5 octobre`, from a civil date `AAAA-MM-JJ`. */
export function civilLong(civil: string): string {
  const { y, m, d } = civilParts(civil);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d === 1 ? '1er' : d} ${MONTHS[m - 1]}`;
}

/** The Monday the bulletin of a week is published: the day after its Sunday. */
export function publicationDay(sunday: string): string {
  const { y, m, d } = civilParts(sunday);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return civilLong(next.toISOString().slice(0, 10));
}

/** `du 21 au 27 septembre`, `du 28 septembre au 4 octobre`, years when they differ. */
export function weekSpan(monday: string, sunday: string): string {
  const a = civilParts(monday);
  const b = civilParts(sunday);
  const day = (n: number) => (n === 1 ? '1er' : String(n));
  if (a.y !== b.y) {
    return `du ${day(a.d)} ${MONTHS[a.m - 1]} ${a.y} au ${day(b.d)} ${MONTHS[b.m - 1]} ${b.y}`;
  }
  if (a.m !== b.m) return `du ${day(a.d)} ${MONTHS[a.m - 1]} au ${day(b.d)} ${MONTHS[b.m - 1]}`;
  return `du ${day(a.d)} au ${day(b.d)} ${MONTHS[b.m - 1]}`;
}

/** `JJ.MM à HH:MM`, Swiss time, from a UTC stamp of the API. */
export function swissDayTime(utc: string): string {
  const local = toZurich(utc);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) return utc;
  return `${local.slice(8, 10)}.${local.slice(5, 7)} à ${local.slice(11, 16)}`;
}

/** `JJ.MM`, Swiss day, from a UTC stamp of the API. */
export function swissDay(utc: string): string {
  const local = toZurich(utc);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(local)) return utc;
  return `${local.slice(8, 10)}.${local.slice(5, 7)}`;
}

/** An age given by the API in hours, in words. */
export function ageText(hours: number): string {
  if (hours < 1) return 'il y a moins d’une heure';
  if (hours < 48) return `il y a ${fmt(Math.round(hours))} h`;
  return `il y a ${fmt(Math.floor(hours / 24))} j`;
}

// ─── The blocks, in words ────────────────────────────────────────────────────

export type Tone = 'ok' | 'bad' | 'neutral';

/** Why a block could not be read, in words the reader can act on. */
export function unreadText(reason: string): string {
  if (reason === 'timeout') return 'GitHub n’a pas répondu à temps';
  if (reason === 'network') return 'GitHub était injoignable';
  if (reason === 'too_many_pages') return 'la semaine est trop ancienne pour la lecture de GitHub';
  if (reason === 'invalid_body') return 'la réponse de GitHub était illisible';
  if (reason === 'http_403' || reason === 'http_429') {
    return 'GitHub a refusé la lecture (sans doute la limite de 60 appels par heure)';
  }
  if (reason.startsWith('http_')) return `GitHub a répondu ${reason.slice(5)}`;
  return 'la lecture a échoué côté API';
}

/**
 * The colour of the signs of life: red when one is late or unreadable, grey when
 * some have never beaten yet, green only when every one is on time. A radar that
 * never ran is not "running", and a green dot beside "9 sur 11" would say so.
 */
export function heartbeatsTone(beats: BulletinHeartbeats): Tone {
  const unreadable = beats.items.filter((i) => i.state === 'unreadable').length;
  if (beats.late > 0 || unreadable > 0) return 'bad';
  return beats.on_time === beats.items.length ? 'ok' : 'neutral';
}

/** The state of the machinery NOW, in one pill: open alerts, then the signs of life. */
export function machineState(data: BulletinPayload): { tone: Tone; text: string } {
  const beats = data.moved.heartbeats;
  const alerts = data.moved.alerts;
  if (beats.state !== 'read' || alerts.state !== 'read') {
    return { tone: 'neutral', text: 'État des automatisations non lu' };
  }
  const unreadable = beats.items.filter((i) => i.state === 'unreadable').length;
  const problems: string[] = [];
  if (alerts.open.length > 0) {
    problems.push(count(alerts.open.length, 'alerte ouverte', 'alertes ouvertes'));
  }
  if (beats.late > 0) problems.push(count(beats.late, 'automatisation en retard', 'automatisations en retard'));
  if (unreadable > 0) problems.push(count(unreadable, 'date illisible', 'dates illisibles'));
  if (problems.length > 0) return { tone: 'bad', text: problems.join(', ') };
  if (beats.never > 0) {
    return {
      tone: 'neutral',
      text: `Rien en retard, ${count(beats.never, 'automatisation', 'automatisations')} sans battement encore`,
    };
  }
  return { tone: 'ok', text: 'Tout tourne en ce moment' };
}

/** What a heartbeat's state means, in a few words. */
export function heartbeatText(h: HeartbeatView): string {
  if (h.state === 'never') {
    return h.kind === 'radar' ? 'n’a encore jamais tourné' : 'aucun battement enregistré';
  }
  if (h.state === 'unreadable') return 'date illisible';
  const age = h.age_hours === null ? '' : ageText(h.age_hours);
  return h.state === 'late'
    ? `en retard : dernier battement ${age} (attendu toutes les ${fmt(h.max_age_hours)} h au plus)`
    : `dernier battement ${age}`;
}

/** The home-page door line, with what its coverage of the week allows to say. */
export function siteHomeText(home: BulletinNumbers['site_home']): { figure: string | null; note: string | null } {
  if (home.coverage === 'none' || home.created === null) {
    return {
      figure: null,
      note: `La porte de l’accueil n’existait pas encore cette semaine-là : elle compte depuis le ${swissDayTime(home.since)}.`,
    };
  }
  const figure = count(home.created, 'clé prise depuis l’accueil', 'clés prises depuis l’accueil');
  return {
    figure,
    note:
      home.coverage === 'partial'
        ? `Compté seulement depuis la mise en ligne de l’accueil neuf, le ${swissDayTime(home.since)}.`
        : null,
  };
}

const STALE_REASON: Record<NonNullable<SourceView['stale_reason']>, string> = {
  import_overdue: 'relevé en retard',
  source_frozen: 'source figée par son éditeur',
};

export function staleReasonText(reason: SourceView['stale_reason']): string {
  return reason ? STALE_REASON[reason] : 'à jour';
}
