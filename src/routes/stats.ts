import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import {
  getStats,
  getStatsHistory,
  getHourlyStats,
  getErrorStats,
  getPatternStats,
  getStatusByPath,
  getBusinessFunnel,
  getSourceStats,
  getRejectionStats,
  getCohortFootprint,
  getTrafficTrend,
} from '../lib/stats.js';
import { getEvents } from '../lib/events.js';
import { getEntryCount } from '../lib/bic-lookup.js';

const stats = new Hono();

/**
 * Stats endpoints are protected by a bearer token (STATS_TOKEN env var).
 * The frontend dashboard passes this token when fetching stats.
 * If STATS_TOKEN is not set, stats are disabled (returns 403).
 *
 * Constant-time compare: a plain `===` short-circuits on the first differing
 * byte and leaks the token's length. This file was the only one of the four
 * STATS_TOKEN guards using `===` (admin-business/-scanners/-revenue already
 * used timingSafeEqual), and /stats is exempt from the rate limiter, so it
 * was the softest of the group. Mirror the others.
 */
function checkAuth(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(authHeader);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/**
 * 🚨 The window ceiling, and why it is a refusal rather than a clamp.
 *
 * Audit 2026-09-01, findings PERF-01 and PERF-06: these aggregates run on a
 * SYNCHRONOUS SQLite handle in a single-instance process, so their cost is paid
 * by every client at once. On a 1 000 000-row projection of the 12-month
 * retention, /stats/status-by-path over 90 days measured 2 895 ms of frozen
 * event loop. 90 days is what the dashboard actually offers (7 / 30 / 90);
 * anything past it was never a feature, only an unbounded scan waiting to be
 * typed into a URL bar.
 */
const MAX_PERIOD_DAYS = 90;

/**
 * 🚨 PERF-13: `?days=` used to be ignored in silence.
 *
 * Every route here read `period` only, so `/stats/history?days=90` answered a
 * confident 200 computed over the 7-day default. The auditor measured the
 * endpoint's own cost through that trap and got a number 6× too low before
 * noticing. A measurement tool that silently substitutes a different question
 * is worse than one that refuses to answer.
 *
 * So: `days` is now an accepted alias, and any OTHER query parameter is a 400.
 * A typo is a stated error, never a default served as if it were the answer.
 * `/stats/rejections` spells its window `days` for historical reasons; both
 * names work everywhere now, which is what makes that inconsistency harmless.
 *
 * Deliberately NOT covered: an unparseable value of a KNOWN parameter
 * (`?period=abc`) keeps falling back to the route's default. That behaviour is
 * older than this endpoint family and is asserted by tests dating from before
 * the audit; the trap being closed here is the parameter that is not read at
 * all, not the value that cannot be parsed.
 */
const WINDOW_PARAMS = new Set(['period', 'days']);

type WindowRead = { ok: true; days: number } | { ok: false; error: string; message: string };

function readWindow(
  query: Record<string, string>,
  fallback: number,
  max: number = MAX_PERIOD_DAYS,
): WindowRead {
  const unknown = Object.keys(query).filter((k) => !WINDOW_PARAMS.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: 'unknown_parameter',
      message: `Unknown query parameter(s): ${unknown.join(', ')}. This endpoint accepts only 'period' (alias: 'days'), a window in days between 1 and ${max}.`,
    };
  }

  const raw = query.period ?? query.days;
  if (raw === undefined) return { ok: true, days: fallback };

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return { ok: true, days: fallback };
  if (parsed > max) {
    return {
      ok: false,
      error: 'period_too_long',
      message: `The window is capped at ${max} days (asked for ${parsed}). Longer windows scan the whole request log and block every other caller while they run.`,
    };
  }
  return { ok: true, days: Math.max(1, parsed) };
}

/**
 * For the two routes that have NO window: they aggregate all of history by
 * design, so `?period=30` on them is the PERF-13 trap in its purest form — a
 * caller believing they scoped a figure that was never scoped. Refuse instead.
 */
function rejectAnyQuery(query: Record<string, string>): { error: string; message: string } | null {
  const keys = Object.keys(query);
  if (keys.length === 0) return null;
  return {
    error: 'unknown_parameter',
    message: `Unknown query parameter(s): ${keys.join(', ')}. This endpoint takes no parameters and always reports all of history.`,
  };
}

stats.get('/stats', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const rejected = rejectAnyQuery(c.req.query());
    if (rejected) return c.json({ error: rejected.error, message: rejected.message }, 400);
    const overview = getStats();
    const bicEntries = getEntryCount();
    return c.json({ ...overview, bic_database_entries: bicEntries });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/history', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 7);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    const history = getStatsHistory(days);
    return c.json(history);
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/hourly', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 7);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json(getHourlyStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/errors', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 30);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json(getErrorStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

/**
 * Pourquoi un endpoint à part : un rejet de format n'est jamais une opération
 * (la requête n'atteint pas le service), il vit dans une voie séparée de la
 * table `operations` que toutes les autres agrégations excluent. C'est la
 * lecture qui décidera de la phase 2 — si le volume est surtout
 * `placeholder_literal`, le problème est dans la spec OpenAPI, pas dans la
 * tolérance des gardes.
 *
 * Le paramètre est `days` (et non `period` comme les routes voisines) : c'est
 * celui que lit la procédure de dépouillement de la phase 2. Depuis le
 * correctif PERF-13 (01/09/2026) les deux noms marchent partout, donc cette
 * divergence historique ne piège plus personne.
 *
 * ⚠️ Les catégories n'ont pas toutes le même dénominateur. Toutes sont
 * comptées par la garde de format, AVANT les middlewares clé d'API et x402
 * — sauf `invalid_bic_shape`, seule à être enregistrée par la route, donc
 * APRÈS eux : elle ne voit que les requêtes qui ont payé ou présenté une clé.
 * Son compte est tiré d'une population plus petite que les autres et n'est pas
 * directement comparable — un petit chiffre ne veut PAS dire « la forme de
 * l'identifiant n'est pas un problème ».
 */
stats.get('/stats/rejections', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 30);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json({ period_days: days, rows: getRejectionStats(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/business-funnel', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 30);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json({ period_days: days, rows: getBusinessFunnel(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

/**
 * Study view of the regrouped signup cohorts: what the two known bursts did to
 * every indicator, read from the rows the business views exclude. Off the public
 * page on purpose — surfaced only in the dashboard's discreet case-study panel.
 */
stats.get('/stats/cohort-footprint', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }
  try {
    const rejected = rejectAnyQuery(c.req.query());
    if (rejected) return c.json({ error: rejected.error, message: rejected.message }, 400);
    return c.json(getCohortFootprint());
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/status-by-path', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 30);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json({ period_days: days, rows: getStatusByPath(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/patterns', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 30);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json(getPatternStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

// Chart annotations: deploys recorded at boot plus manual notes posted via
// /v1/admin/events. Same bearer as the other /stats/* routes — the dashboard
// fetches them alongside the history they annotate.
//
// ⚠️ NARROWED from 365 days to 90 on 01/09/2026, and NOT for the reason the
// other routes were: this one reads the small `events` table, not
// `request_log`, and it was measured at 11 ms — it has none of the cost that
// justifies the ceiling elsewhere. The cap is here so the whole /stats/* family
// answers `period` the same way; annotations past 90 days would in any case be
// drawn outside a history chart that stops at 90. One line to undo
// (`readWindow(c.req.query(), 90, 365)`) if that uniformity is not worth the
// capability.
stats.get('/stats/events', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }
  try {
    const window = readWindow(c.req.query(), 90, 90);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json({ period_days: days, events: getEvents(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/sources', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }
  try {
    const window = readWindow(c.req.query(), 30);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json(getSourceStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

/**
 * Daily traffic split by caller nature, with the status series that qualify it.
 *
 * ⚠️ `days[].not_found`, `.paywall` and `.server_error` cut ACROSS the six
 * natures; only the natures add up to `total`. That is not a detail of the
 * payload but the point of the endpoint: `browser` read alone is misleading,
 * because a vulnerability scanner declares a Chrome user agent and is stored
 * as `web`. Its 404 series is what tells it apart from a human — so any view
 * fed by this route must render not_found beside the natures.
 */
stats.get('/stats/traffic-trend', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }

  try {
    const window = readWindow(c.req.query(), 30);
    if (!window.ok) return c.json({ error: window.error, message: window.message }, 400);
    const days = window.days;
    return c.json({ period_days: days, days: getTrafficTrend(days) });
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

export { stats };
