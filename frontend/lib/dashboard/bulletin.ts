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
  /** The alert key without the identifier some keys carry (a purchase, a session). */
  name: string;
  label: string | null;
  /** How many keys of that name are in that state. */
  cases: number;
  fails: number;
  opened_at: string | null;
  last_failure_at: string | null;
}

export interface BulletinAlerts {
  state: 'read';
  open: AlertView[];
  failing: AlertView[];
  /** No failure written for more than 7 days, and nothing closes them: shown apart, never in the pill. */
  stale: AlertView[];
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

// ─── Step A2 and B (07.10.2026): optional blocks ─────────────────────────────
//
// Railway (the API) and Vercel (this site) do not go live at the same instant, and
// the production domain is promoted by hand: this page must render an API that does
// not send these blocks yet. Each one is OPTIONAL here; a missing or malformed one
// is simply left out (the API's own `not_yet` list then says it is not there yet),
// never the whole page.

export type Answer = 'oui' | 'plus_tard' | 'non';
export const ANSWERS: readonly Answer[] = ['oui', 'plus_tard', 'non'];

export interface AnswerView {
  key: string;
  answer: Answer;
  label: string;
  week: string;
  answered_at: string;
}

export interface ProposalView {
  key: string;
  kind: 'session' | 'bic_introuvable' | 'veille_sans_oui';
  title: string;
  detail: string | null;
  origin: string | null;
  country: string | null;
  answer: AnswerView | null;
  postponed_at: string | null;
}

export interface BulletinDecisions {
  state: 'read';
  computed: boolean;
  shown: ProposalView[];
  more: number;
  answered: AnswerView[];
}

export interface FeedScore {
  value: number;
  out_of: number;
  errors: number;
}

export type FeedView =
  | {
      source: string;
      label: string;
      state: 'read';
      received_at: string;
      lines: string[];
      score: FeedScore | null;
    }
  | { source: string; label: string; state: 'none' };

export interface BulletinFeed {
  state: 'read';
  sources: FeedView[];
}

export interface BulletinAlertHistory {
  state: 'read';
  kept_since: string | null;
  coverage: 'full' | 'partial' | 'none';
  opened: Array<{
    name: string;
    label: string | null;
    cases: number;
    first_opened_at: string;
    still_open: number;
  }>;
  closed: Array<{
    name: string;
    label: string | null;
    cases: number;
    last_closed_at: string;
    longest_hours: number | null;
    opened_before_history: number;
  }>;
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
  /** Step A2; absent from an API that predates it. */
  decisions?: BulletinDecisions | Unread;
  moved: {
    merged_pulls: MergedPullsRead;
    heartbeats: BulletinHeartbeats | Unread;
    alerts: BulletinAlerts | Unread;
    /** Step A2; absent from an API that predates it. */
    alert_history?: BulletinAlertHistory | Unread;
    sources: BulletinSources | Unread;
  };
  needs: {
    missing_bics: BulletinMissingBics | Unread;
    forum_threads: BulletinForumThreads | Unread;
  };
  /** Step B; absent from an API that predates it. */
  veille?: BulletinFeed | Unread;
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
  if (!Array.isArray(not_yet) || !isObj(definitions)) return null;
  let blocks: Obj = moved;
  // A link that leaves this repository spoils its own block only: the list of
  // pull requests says "unread", every other block of the week still shows.
  const pulls = moved.merged_pulls as Obj;
  if (pulls.state === 'read') {
    const clean =
      Array.isArray(pulls.pulls) &&
      pulls.pulls.every((p) => isObj(p) && typeof p.url === 'string' && PULL_URL.test(p.url));
    if (!clean) {
      blocks = {
        ...blocks,
        merged_pulls: {
          state: 'unread',
          source: 'github',
          repo: typeof pulls.repo === 'string' ? pulls.repo : '',
          fetched_at:
            typeof pulls.fetched_at === 'string' ? pulls.fetched_at : payload.observed_at,
          reason: 'foreign_link',
        },
      };
    }
  }
  const alerts = moved.alerts as Obj;
  if (alerts.state === 'read') {
    if (!Array.isArray(alerts.open) || !Array.isArray(alerts.failing)) return null;
    if (alerts.stale !== undefined && !Array.isArray(alerts.stale)) return null;
    blocks = { ...blocks, alerts: { ...alerts, stale: alerts.stale ?? [] } };
  }
  blocks = { ...blocks, alert_history: optionalBlock(moved.alert_history, isAlertHistory) };
  return {
    ...payload,
    moved: blocks,
    decisions: optionalBlock(payload.decisions, isDecisions),
    veille: optionalBlock(payload.veille, isFeed),
  } as unknown as BulletinPayload;
}

/** An optional block: kept when it has its shape (or says `unread`), dropped otherwise. */
function optionalBlock(value: unknown, isRead: (v: Obj) => boolean): unknown {
  if (!isBlock(value)) return undefined;
  const v = value as Obj;
  if (v.state === 'unread') return v;
  return isRead(v) ? v : undefined;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNat = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v);

/** The keys the answer form may send: the API's three shapes, nothing else. */
export const PROPOSAL_KEY = /^(session:\d{1,9}|regle:bic-introuvable:[A-Z]{2}|regle:veille-sans-oui:[a-z-]{1,40})$/;

function isAnswerView(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.key) &&
    (ANSWERS as readonly unknown[]).includes(v.answer) &&
    isStr(v.label) &&
    isStr(v.week) &&
    isStr(v.answered_at)
  );
}

function isDecisions(v: Obj): boolean {
  if (typeof v.computed !== 'boolean' || !isNat(v.more)) return false;
  if (!Array.isArray(v.shown) || !Array.isArray(v.answered)) return false;
  return (
    v.answered.every(isAnswerView) &&
    v.shown.every(
      (p) =>
        isObj(p) &&
        isStr(p.key) &&
        PROPOSAL_KEY.test(p.key) &&
        ['session', 'bic_introuvable', 'veille_sans_oui'].includes(p.kind as string) &&
        isStr(p.title) &&
        isStrOrNull(p.detail) &&
        isStrOrNull(p.origin) &&
        (p.country === null || (isStr(p.country) && /^[A-Z]{2}$/.test(p.country))) &&
        (p.answer === null || isAnswerView(p.answer)) &&
        isStrOrNull(p.postponed_at),
    )
  );
}

function isFeed(v: Obj): boolean {
  if (!Array.isArray(v.sources)) return false;
  return v.sources.every((s) => {
    if (!isObj(s) || !isStr(s.source) || !isStr(s.label)) return false;
    if (s.state === 'none') return true;
    if (s.state !== 'read' || !isStr(s.received_at)) return false;
    if (!Array.isArray(s.lines) || !s.lines.every(isStr)) return false;
    if (s.score === null) return true;
    const sc = s.score;
    return isObj(sc) && isNat(sc.value) && isNat(sc.out_of) && isNat(sc.errors) && sc.out_of > 0;
  });
}

function isAlertHistory(v: Obj): boolean {
  if (!['full', 'partial', 'none'].includes(v.coverage as string)) return false;
  if (!isStrOrNull(v.kept_since)) return false;
  if (!Array.isArray(v.opened) || !Array.isArray(v.closed)) return false;
  return (
    v.opened.every((g) => isObj(g) && isStr(g.name) && isNat(g.cases) && isStr(g.first_opened_at) && isNat(g.still_open)) &&
    v.closed.every(
      (g) =>
        isObj(g) &&
        isStr(g.name) &&
        isNat(g.cases) &&
        isStr(g.last_closed_at) &&
        (g.longest_hours === null || typeof g.longest_hours === 'number') &&
        isNat(g.opened_before_history),
    )
  );
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
  if (reason === 'foreign_link') return 'une PR menait hors du dépôt';
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

// ─── Step A2 and B, in words ─────────────────────────────────────────────────

const ANSWER_WORDS: Record<Answer, string> = { oui: 'Oui', plus_tard: 'Plus tard', non: 'Non' };

export function answerWord(a: Answer): string {
  return ANSWER_WORDS[a];
}

/** A duration given in hours, in words. */
export function durationText(hours: number): string {
  if (hours < 1) return 'moins d’une heure';
  if (hours < 48) return `${fmt(Math.round(hours))} h`;
  return `${fmt(Math.floor(hours / 24))} j`;
}

/** The AI score, said with its denominator, and partial when queries failed. */
export function scoreText(score: FeedScore): string {
  const base = `${fmt(score.value)} sur ${fmt(score.out_of)} ${score.out_of <= 1 ? 'requête' : 'requêtes'}`;
  return score.errors > 0
    ? `${base}, score partiel : ${count(score.errors, 'requête en erreur', 'requêtes en erreur')}`
    : base;
}
