/**
 * « À toi de décider » : les propositions du bulletin du lundi et leurs réponses
 * Oui / Plus tard / Non (accord de Claude-Alain du 28.09.2026, étape A2).
 *
 * ## D'où viennent les propositions
 *
 *  - de la session principale, par `POST /v1/admin/bulletin/proposals` : elles sont
 *    écrites (`bulletin_proposals`) et attendent une réponse d'une semaine à l'autre ;
 *  - de règles sans modèle, CALCULÉES à la lecture et jamais écrites (la lecture du
 *    bulletin n'écrit rien) :
 *      · un pays dont les BIC cherchés restent introuvables au-delà d'un seuil dans
 *        la semaine (`regle:bic-introuvable:<pays>`) ;
 *      · une veille qui a déposé chacune des quatre dernières semaines sans qu'aucune
 *        proposition née d'elle ait reçu un Oui (`regle:veille-sans-oui:<source>`) :
 *        « une veille sans décision pendant quatre semaines s'arrête ».
 *
 * Une clé de règle est stable d'une semaine à l'autre : c'est elle qui porte la
 * réponse. Oui et Non ne reviennent pas ; Plus tard revient vingt-huit jours après
 * la réponse. Au plus trois propositions sont montrées ; les autres sont comptées.
 *
 * Les propositions ne se calculent que pour la dernière semaine close, celle du
 * lundi : une semaine passée montre les réponses données ce lundi-là, sans refaire
 * des règles sur un état d'aujourd'hui.
 *
 * Écart avec le plan du 28.09, dit ici : la règle « PR étiquetée
 * `integrateur:attente-claude-alain` » n'est pas posée. Elle demanderait une seconde
 * lecture de GitHub sur les soixante appels par heure que l'API partage sans jeton ;
 * l'intégrateur prévient déjà Telegram pour une PR qui attend sa décision.
 */
import { getStatsDB } from './db.js';
import {
  FEED_SOURCES,
  cleanFeedLine,
  feedWeeks,
  isFeedSource,
  type FeedSource,
} from './bulletin-feed.js';
import { parseDbUtc, sqliteUtc, swissWeekShift, type SwissWeek } from './swiss-week.js';

export const ANSWERS = ['oui', 'plus_tard', 'non'] as const;
export type Answer = (typeof ANSWERS)[number];

export function isAnswer(value: unknown): value is Answer {
  return typeof value === 'string' && (ANSWERS as readonly string[]).includes(value);
}

/** « Plus tard » revient ce nombre de jours après la réponse. */
export const SNOOZE_DAYS = 28;
/** Au plus ce nombre de propositions par bulletin. */
export const DECISIONS_SHOWN_MAX = 3;
/** Un pays est proposé à partir de ce nombre de recherches sans réponse dans la semaine… */
export const BIC_PROPOSAL_MIN_LOOKUPS = 10;
/** …portant sur au moins ce nombre de codes différents (un seul code répété n'est pas un trou). */
export const BIC_PROPOSAL_MIN_CODES = 3;
/** Une veille sans Oui pendant ce nombre de semaines de dépôts est proposée à l'arrêt. */
export const VEILLE_SILENT_WEEKS = 4;

export const PROPOSAL_TITLE_MAX = 140;
export const PROPOSAL_DETAIL_MAX = 400;

const DAY_MS = 86_400_000;

export type ProposalKind = 'session' | 'bic_introuvable' | 'veille_sans_oui';

export interface Proposal {
  /** `session:<id>`, `regle:bic-introuvable:<pays>`, `regle:veille-sans-oui:<source>`. */
  key: string;
  kind: ProposalKind;
  title: string;
  detail: string | null;
  /** La veille dont la proposition est née, ou null. */
  origin: FeedSource | null;
  /** Pays ISO pour `bic_introuvable`, sinon null : la page écrit son nom. */
  country: string | null;
}

export interface AnswerView {
  key: string;
  answer: Answer;
  /** Le libellé de la proposition au moment de la réponse. */
  label: string;
  /** La semaine du bulletin où la réponse a été donnée. */
  week: string;
  answered_at: string;
}

export interface ProposalView extends Proposal {
  /** La réponse donnée à ce bulletin, ou null quand la proposition attend. */
  answer: AnswerView | null;
  /** Revenue après un « Plus tard » : la date de ce report. */
  postponed_at: string | null;
}

export interface BulletinDecisions {
  state: 'read';
  /** false pour une semaine passée : les règles ne sont pas refaites sur l'état d'aujourd'hui. */
  computed: boolean;
  shown: ProposalView[];
  /** Les propositions en attente au-delà des trois montrées. */
  more: number;
  /** Les réponses données au bulletin de cette semaine (la dernière par clé). */
  answered: AnswerView[];
}

/** Ce que les règles lisent dans le bloc des BIC introuvables, déjà calculé. */
export interface MissingBicsInput {
  top: Array<{ country: string; lookups: number; distinct_codes: number }>;
}

interface LatestAnswer {
  key: string;
  answer: Answer;
  week: string;
  origin: string | null;
  label: string;
  answered_at: string;
}

function latestAnswers(): Map<string, LatestAnswer> {
  const rows = getStatsDB()
    .prepare(
      `SELECT a.proposal_key AS key, a.answer, a.week, a.origin, a.label, a.answered_at
         FROM bulletin_answers a
         JOIN (SELECT proposal_key, MAX(id) AS id FROM bulletin_answers GROUP BY proposal_key) l
           ON l.id = a.id`,
    )
    .all() as LatestAnswer[];
  return new Map(rows.map((r) => [r.key, r]));
}

function sessionProposals(week: SwissWeek): Proposal[] {
  // `AAAA-Wss` se trie comme il se lit : les propositions posées jusqu'à cette semaine.
  const rows = getStatsDB()
    .prepare(`SELECT id, origin, title, detail FROM bulletin_proposals WHERE week <= ? ORDER BY id`)
    .all(week.label) as Array<{
    id: number;
    origin: string | null;
    title: string;
    detail: string | null;
  }>;
  return rows.map((r) => ({
    key: `session:${r.id}`,
    kind: 'session',
    title: r.title,
    detail: r.detail,
    origin: r.origin && isFeedSource(r.origin) ? r.origin : null,
    country: null,
  }));
}

function veilleProposals(week: SwissWeek): Proposal[] {
  const weeks: SwissWeek[] = [];
  for (let i = 0; i < VEILLE_SILENT_WEEKS; i++) weeks.push(swissWeekShift(week, i));
  const firstStart = weeks[weeks.length - 1].startMs;
  // Un Oui à une proposition née de la veille, donné depuis le début de la fenêtre.
  const yesSince = getStatsDB()
    .prepare(
      `SELECT DISTINCT origin FROM bulletin_answers
        WHERE answer = 'oui' AND origin IS NOT NULL AND answered_at >= ?`,
    )
    .all(sqliteUtc(firstStart)) as Array<{
    origin: string;
  }>;
  const hadYes = new Set(yesSince.map((r) => r.origin));
  const out: Proposal[] = [];
  for (const { source, label } of FEED_SOURCES) {
    const deposited = feedWeeks(
      source,
      weeks.map((w) => w.label),
    );
    if (deposited.size < VEILLE_SILENT_WEEKS || hadYes.has(source)) continue;
    out.push({
      key: `regle:veille-sans-oui:${source}`,
      kind: 'veille_sans_oui',
      title: `${label} n’a mené à aucun Oui depuis quatre semaines : l’arrêter ?`,
      detail:
        'Oui : la session principale arrête cette veille (son message du lundi et son dépôt). ' +
        'Non : elle continue, et la question ne revient pas.',
      origin: source,
      country: null,
    });
  }
  return out;
}

function bicProposals(week: SwissWeek, bics: MissingBicsInput | null): Proposal[] {
  if (!bics) return [];
  return bics.top
    .filter(
      (c) =>
        /^[A-Z]{2}$/.test(c.country) &&
        c.lookups >= BIC_PROPOSAL_MIN_LOOKUPS &&
        c.distinct_codes >= BIC_PROPOSAL_MIN_CODES,
    )
    .map((c) => ({
      key: `regle:bic-introuvable:${c.country}`,
      kind: 'bic_introuvable' as const,
      title: `Chercher une source pour les BIC du pays ${c.country}`,
      detail:
        `${c.lookups} recherches de BIC sans réponse la semaine ${week.label.slice(-2)}, ` +
        `sur ${c.distinct_codes} codes différents.`,
      origin: null,
      country: c.country,
    }));
}

/** Toutes les propositions candidates d'une semaine, dans l'ordre de priorité. */
function candidates(week: SwissWeek, bics: MissingBicsInput | null): Proposal[] {
  return [...sessionProposals(week), ...veilleProposals(week), ...bicProposals(week, bics)];
}

function answerView(a: LatestAnswer): AnswerView {
  return { key: a.key, answer: a.answer, label: a.label, week: a.week, answered_at: a.answered_at };
}

/**
 * Ce qu'une proposition devient, selon la dernière réponse à sa clé : montrée en
 * attente, montrée avec la réponse donnée à ce bulletin, ou cachée.
 */
function visibility(
  p: Proposal,
  latest: LatestAnswer | undefined,
  week: SwissWeek,
  nowMs: number,
): ProposalView | null {
  if (!latest) return { ...p, answer: null, postponed_at: null };
  if (latest.week === week.label) return { ...p, answer: answerView(latest), postponed_at: null };
  if (latest.answer === 'plus_tard') {
    const at = parseDbUtc(latest.answered_at);
    if (at !== null && nowMs - at >= SNOOZE_DAYS * DAY_MS) {
      return { ...p, answer: null, postponed_at: latest.answered_at };
    }
  }
  return null;
}

/** Les propositions visibles d'une semaine, avant le plafond de trois. */
export function visibleProposals(
  week: SwissWeek,
  bics: MissingBicsInput | null,
  nowMs: number,
): ProposalView[] {
  const answers = latestAnswers();
  const out: ProposalView[] = [];
  for (const p of candidates(week, bics)) {
    const v = visibility(p, answers.get(p.key), week, nowMs);
    if (v) out.push(v);
  }
  return out;
}

/** Le bloc « À toi de décider » d'une semaine. */
export function readDecisions(
  week: SwissWeek,
  lastComplete: boolean,
  bics: MissingBicsInput | null,
  nowMs: number,
): BulletinDecisions {
  const answered = [...latestAnswers().values()]
    .filter((a) => a.week === week.label)
    .sort((a, b) => a.answered_at.localeCompare(b.answered_at))
    .map(answerView);
  if (!lastComplete) return { state: 'read', computed: false, shown: [], more: 0, answered };
  const visible = visibleProposals(week, bics, nowMs);
  return {
    state: 'read',
    computed: true,
    shown: visible.slice(0, DECISIONS_SHOWN_MAX),
    more: Math.max(0, visible.length - DECISIONS_SHOWN_MAX),
    answered,
  };
}

export type RecordAnswerResult =
  | { ok: true; key: string; answer: Answer; week: string }
  | { ok: false; error: 'unknown_proposal' };

/**
 * Enregistre une réponse. La clé doit être une proposition MONTRÉE en ce moment par
 * le bulletin de la dernière semaine close (dans les trois) : on ne répond pas à une
 * proposition qu'on ne voit pas. Le libellé gardé est celui de l'API.
 */
export function recordAnswer(
  key: string,
  answer: Answer,
  week: SwissWeek,
  bics: MissingBicsInput | null,
  nowMs: number,
): RecordAnswerResult {
  const shown = visibleProposals(week, bics, nowMs).slice(0, DECISIONS_SHOWN_MAX);
  const p = shown.find((s) => s.key === key);
  if (!p) return { ok: false, error: 'unknown_proposal' };
  getStatsDB()
    .prepare(
      `INSERT INTO bulletin_answers (proposal_key, week, answer, origin, label)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(p.key, week.label, answer, p.origin, p.title);
  return { ok: true, key: p.key, answer, week: week.label };
}

export type AddProposalResult =
  | { ok: true; key: string; week: string }
  | { ok: false; error: 'invalid_body' | 'invalid_title' | 'invalid_detail' | 'invalid_origin' };

/**
 * Une proposition de la session principale, rattachée au bulletin de la dernière
 * semaine close : elle paraît dès ce lundi, et attend sa réponse les lundis suivants.
 * Texte brut seulement, nettoyé comme les lignes des veilles.
 */
export function addSessionProposal(raw: unknown, week: SwissWeek): AddProposalResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_body' };
  }
  const body = raw as Record<string, unknown>;
  for (const k of Object.keys(body)) {
    if (k !== 'title' && k !== 'detail' && k !== 'origin')
      return { ok: false, error: 'invalid_body' };
  }
  const title = typeof body.title === 'string' ? cleanFeedLine(body.title) : '';
  if (title.length < 1 || [...title].length > PROPOSAL_TITLE_MAX) {
    return { ok: false, error: 'invalid_title' };
  }
  let detail: string | null = null;
  if (body.detail !== undefined && body.detail !== null) {
    if (typeof body.detail !== 'string') return { ok: false, error: 'invalid_detail' };
    detail = cleanFeedLine(body.detail) || null;
    if (detail !== null && [...detail].length > PROPOSAL_DETAIL_MAX) {
      return { ok: false, error: 'invalid_detail' };
    }
  }
  let origin: FeedSource | null = null;
  if (body.origin !== undefined && body.origin !== null) {
    if (typeof body.origin !== 'string' || !isFeedSource(body.origin)) {
      return { ok: false, error: 'invalid_origin' };
    }
    origin = body.origin;
  }
  const info = getStatsDB()
    .prepare(`INSERT INTO bulletin_proposals (week, origin, title, detail) VALUES (?, ?, ?, ?)`)
    .run(week.label, origin, title, detail);
  return { ok: true, key: `session:${Number(info.lastInsertRowid)}`, week: week.label };
}
