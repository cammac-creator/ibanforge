/**
 * Le dépôt des veilles du lundi dans le bulletin (étapes A2 et B, 07.10.2026).
 *
 * Les deux veilles du lundi (`weekly-veille`, `weekly-reco-baseline`) partaient
 * seulement sur Telegram : le bulletin ne pouvait rien en montrer. Elles déposent
 * désormais, en plus de leur message, un résumé STRICTEMENT structuré :
 *
 *  - au plus trois lignes de texte brut, deux cents caractères chacune au plus,
 *    caractères de contrôle et de direction retirés, espaces resserrés ;
 *  - pour la mesure des IA seulement, un score entier (`value` sur `out_of`, et
 *    `errors` requêtes en erreur : un score avec erreurs est partiel) ;
 *  - rien d'autre : un champ inconnu fait refuser le dépôt entier.
 *
 * La page rend ces lignes en texte (React échappe) : jamais de HTML, jamais de lien
 * cliquable. La semaine n'est pas choisie par l'appelant : c'est la dernière semaine
 * suisse close à la réception, celle du bulletin que le lundi publie. Un second dépôt
 * de la même source la même semaine remplace le premier : les trois essais du
 * workflow ne font qu'une ligne.
 */
import { getStatsDB } from './db.js';
import { swissWeekOf, swissWeekShift, type SwissWeek } from './swiss-week.js';

export const FEED_SOURCES = [
  { source: 'weekly-veille', label: 'La veille marché' },
  { source: 'weekly-reco-baseline', label: 'Le score des IA' },
] as const;

export type FeedSource = (typeof FEED_SOURCES)[number]['source'];

export function isFeedSource(value: string): value is FeedSource {
  return FEED_SOURCES.some((s) => s.source === value);
}

/** La source dont la charge porte un score ; l'autre n'en porte jamais. */
const SCORED: ReadonlySet<FeedSource> = new Set<FeedSource>(['weekly-reco-baseline']);

export const FEED_MAX_LINES = 3;
export const FEED_LINE_MAX = 200;
/** Le corps entier : trois lignes de deux cents caractères et un score tiennent loin dessous. */
export const FEED_BODY_MAX_BYTES = 4096;
export const FEED_SCORE_MAX = 100;

export interface FeedScore {
  value: number;
  out_of: number;
  errors: number;
}

export interface FeedPayload {
  lines: string[];
  score: FeedScore | null;
}

export type FeedValidation = { ok: true; payload: FeedPayload } | { ok: false; error: string };

/**
 * Caractères de contrôle (C0, DEL, C1), séparateurs de ligne et de paragraphe, et
 * marques de direction : rien de tout cela n'a sa place dans une ligne de texte
 * brut, et les marques de direction peuvent faire lire une ligne à l'envers.
 */
/* eslint-disable no-control-regex -- the control characters are what this removes */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/* eslint-enable no-control-regex */

/** Une ligne de texte brut, nettoyée ; chaîne vide quand il ne reste rien. */
export function cleanFeedLine(raw: string): string {
  return raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * La charge d'un dépôt, refusée entière à la moindre forme inattendue. Une ligne
 * trop longue est refusée, pas coupée : c'est au script de la couper, ici on ne
 * réécrit pas ce qu'on reçoit.
 */
export function validateFeedPayload(source: FeedSource, raw: unknown): FeedValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_body' };
  }
  const body = raw as Record<string, unknown>;
  for (const k of Object.keys(body)) {
    if (k !== 'lines' && k !== 'score') return { ok: false, error: 'unknown_field' };
  }
  const { lines, score } = body;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > FEED_MAX_LINES) {
    return { ok: false, error: 'invalid_lines' };
  }
  const clean: string[] = [];
  for (const line of lines) {
    if (typeof line !== 'string') return { ok: false, error: 'invalid_lines' };
    const c = cleanFeedLine(line);
    if (c.length < 1 || [...c].length > FEED_LINE_MAX) {
      return { ok: false, error: 'invalid_lines' };
    }
    clean.push(c);
  }

  if (!SCORED.has(source)) {
    if (score !== undefined && score !== null) return { ok: false, error: 'unexpected_score' };
    return { ok: true, payload: { lines: clean, score: null } };
  }
  if (!score || typeof score !== 'object' || Array.isArray(score)) {
    return { ok: false, error: 'invalid_score' };
  }
  const s = score as Record<string, unknown>;
  for (const k of Object.keys(s)) {
    if (k !== 'value' && k !== 'out_of' && k !== 'errors') {
      return { ok: false, error: 'invalid_score' };
    }
  }
  const errors = s.errors ?? 0;
  if (
    !isInt(s.value) ||
    !isInt(s.out_of) ||
    !isInt(errors) ||
    s.out_of < 1 ||
    s.out_of > FEED_SCORE_MAX ||
    s.value < 0 ||
    s.value > s.out_of ||
    errors < 0 ||
    errors > s.out_of
  ) {
    return { ok: false, error: 'invalid_score' };
  }
  return {
    ok: true,
    payload: { lines: clean, score: { value: s.value, out_of: s.out_of, errors } },
  };
}

/** La semaine d'un dépôt reçu à cet instant : la dernière semaine suisse close. */
export function feedWeekAt(nowMs: number): SwissWeek {
  return swissWeekShift(swissWeekOf(nowMs), 1);
}

/** Écrit (ou remplace) le dépôt d'une source pour une semaine. */
export function writeFeed(source: FeedSource, week: string, payload: FeedPayload): void {
  getStatsDB()
    .prepare(
      `INSERT INTO bulletin_feed (source, week, payload, received_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(source, week) DO UPDATE SET payload = excluded.payload,
                                               received_at = excluded.received_at`,
    )
    .run(source, week, JSON.stringify(payload));
}

export type FeedView =
  | {
      source: FeedSource;
      label: string;
      state: 'read';
      received_at: string;
      lines: string[];
      score: FeedScore | null;
    }
  | { source: FeedSource; label: string; state: 'none' };

export interface BulletinFeed {
  state: 'read';
  sources: FeedView[];
}

/**
 * Les dépôts d'une semaine, source par source. Une source sans dépôt dit `none` :
 * la page l'écrit (« rien de déposé »), elle n'invente ni ligne ni zéro. Une charge
 * stockée qui ne se relit plus est traitée comme absente, jamais à moitié montrée.
 */
export function readFeed(week: string): BulletinFeed {
  const rows = getStatsDB()
    .prepare(`SELECT source, payload, received_at FROM bulletin_feed WHERE week = ?`)
    .all(week) as Array<{ source: string; payload: string; received_at: string }>;
  const bySource = new Map(rows.map((r) => [r.source, r]));
  const sources: FeedView[] = FEED_SOURCES.map(({ source, label }) => {
    const row = bySource.get(source);
    if (!row) return { source, label, state: 'none' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      return { source, label, state: 'none' };
    }
    const valid = validateFeedPayload(source, parsed);
    if (!valid.ok) return { source, label, state: 'none' };
    return {
      source,
      label,
      state: 'read',
      received_at: row.received_at,
      lines: valid.payload.lines,
      score: valid.payload.score,
    };
  });
  return { state: 'read', sources };
}

/** Les semaines (libellés) où une source a déposé, parmi celles données. */
export function feedWeeks(source: FeedSource, weeks: string[]): Set<string> {
  if (weeks.length === 0) return new Set();
  const rows = getStatsDB()
    .prepare(
      `SELECT week FROM bulletin_feed WHERE source = ? AND week IN (${weeks.map(() => '?').join(', ')})`,
    )
    .all(source, ...weeks) as Array<{ week: string }>;
  return new Set(rows.map((r) => r.week));
}
