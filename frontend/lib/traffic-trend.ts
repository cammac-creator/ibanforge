/**
 * The shape of the day-by-day traffic trend, and everything the card computes
 * from it that a test can own.
 *
 * The chart component keeps only the drawing; the arithmetic lives here
 * because the questions it answers are the ones we get wrong by eye — "is the
 * 404 line eating the browser band", "does the window really cover 7 days" —
 * and those deserve assertions rather than a squint at a screenshot.
 */

/** One row of GET /stats/traffic-trend. Mirrors the route's payload 1:1. */
export interface TrafficTrendDay {
  date: string;
  total: number;
  with_key: number;
  agent: number;
  declared_bot: number;
  browser: number;
  anonymous_api: number;
  internal: number;
  not_found: number;
  paywall: number;
  server_error: number;
  distinct_ips: number;
}

/**
 * The six mutually exclusive natures, in stacking order (customers at the
 * bottom, our own test traffic at the top where it reads as an appendix).
 *
 * Exclusive is the whole point: every request falls in exactly one of them and
 * their sum is `total`, which is why they can be stacked into a bar whose
 * height IS the day's traffic. `not_found`, `paywall` and `server_error` are
 * NOT in this list — they cut across the six (a 404 was already counted as a
 * browser or an agent) and stacking them would double-count the day.
 */
export const NATURE_KEYS = [
  'with_key',
  'agent',
  'declared_bot',
  'browser',
  'anonymous_api',
  'internal',
] as const;

export type NatureKey = (typeof NATURE_KEYS)[number];

/** The keyless natures: the bot population this tab is actually about. */
export const KEYLESS_KEYS: readonly NatureKey[] = ['agent', 'declared_bot', 'browser', 'anonymous_api'];

export const TREND_PERIODS = [7, 30, 90] as const;
export type TrendPeriod = (typeof TREND_PERIODS)[number];

const DAY_MS = 86_400_000;

const dayKeyUTC = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** The six exclusive natures summed. Should equal `total`; see mismatchDays. */
export function naturesTotal(day: TrafficTrendDay): number {
  let sum = 0;
  for (const k of NATURE_KEYS) sum += day[k];
  return sum;
}

/**
 * The tail of the series covering the last `period` days.
 *
 * Cut by calendar date counted back from today, never by taking the last N
 * rows: the route omits days with no traffic at all, so index slicing would
 * quietly reach further and further back the quieter the server gets — and it
 * would hand "7 jours" a window three weeks wide without saying so. If nothing
 * has been served for three days, the short window must look short.
 */
export function sliceToPeriod(
  days: TrafficTrendDay[],
  period: number,
  now: Date = new Date(),
): TrafficTrendDay[] {
  const floor = dayKeyUTC(now.getTime() - (period - 1) * DAY_MS);
  return days.filter((d) => d.date >= floor).sort((a, b) => a.date.localeCompare(b.date));
}

export interface TrendSummary {
  total: number;
  /** Everything without an API key — the four keyless natures. */
  keyless: number;
  byNature: Record<NatureKey, number>;
  notFound: number;
  paywall: number;
  serverError: number;
  /** Busiest day of the window, all natures included. */
  peak: { date: string; total: number } | null;
  /** The day the 404s peaked — a scanner's signature, and rarely the same day. */
  notFoundPeak: { date: string; count: number } | null;
  /**
   * Days whose six natures do not add up to their own `total`. Expected to be
   * zero; surfaced rather than swallowed, because a silent gap here would make
   * every bar shorter than the traffic it claims to draw.
   */
  mismatchDays: number;
}

export function summariseTrend(days: TrafficTrendDay[]): TrendSummary {
  const byNature = Object.fromEntries(NATURE_KEYS.map((k) => [k, 0])) as Record<NatureKey, number>;
  const s: TrendSummary = {
    total: 0,
    keyless: 0,
    byNature,
    notFound: 0,
    paywall: 0,
    serverError: 0,
    peak: null,
    notFoundPeak: null,
    mismatchDays: 0,
  };
  for (const d of days) {
    s.total += d.total;
    for (const k of NATURE_KEYS) byNature[k] += d[k];
    for (const k of KEYLESS_KEYS) s.keyless += d[k];
    s.notFound += d.not_found;
    s.paywall += d.paywall;
    s.serverError += d.server_error;
    if (naturesTotal(d) !== d.total) s.mismatchDays++;
    // Strict >, so the earliest day wins a tie: a peak that keeps hopping
    // forward between equal days is impossible to point at in conversation.
    if (s.peak === null || d.total > s.peak.total) s.peak = { date: d.date, total: d.total };
    if (s.notFoundPeak === null || d.not_found > s.notFoundPeak.count) {
      s.notFoundPeak = { date: d.date, count: d.not_found };
    }
  }
  if (s.notFoundPeak !== null && s.notFoundPeak.count === 0) s.notFoundPeak = null;
  return s;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Turn the route's JSON into rows, or null if it is not that at all.
 *
 * Deliberately forgiving on the numbers and strict on the date: a field the
 * route renames or forgets costs one flat band, whereas a row without a date
 * lands on a nameless x tick and makes the whole axis lie. This is also the
 * seam that keeps a drifting payload from throwing inside a chart — the card
 * shows its "unavailable" message instead of taking the tab down with it.
 */
export function parseTrafficTrend(raw: unknown): TrafficTrendDay[] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const days = (raw as { days?: unknown }).days;
  if (!Array.isArray(days)) return null;
  const out: TrafficTrendDay[] = [];
  for (const entry of days) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.date !== 'string' || r.date === '') continue;
    out.push({
      date: r.date.slice(0, 10),
      total: num(r.total),
      with_key: num(r.with_key),
      agent: num(r.agent),
      declared_bot: num(r.declared_bot),
      browser: num(r.browser),
      anonymous_api: num(r.anonymous_api),
      internal: num(r.internal),
      not_found: num(r.not_found),
      paywall: num(r.paywall),
      server_error: num(r.server_error),
      distinct_ips: num(r.distinct_ips),
    });
  }
  return out;
}

/**
 * Why the card has nothing to draw, in the caller's words rather than an HTTP
 * number. A missing STATS_TOKEN and an unreachable API look identical to a
 * reader staring at an empty panel, and one of the two is fixed in a minute.
 */
export type TrendFailure = 'no-token' | 'unreachable' | 'http' | 'malformed';

export type TrafficTrendResult =
  | { ok: true; days: TrafficTrendDay[] }
  | { ok: false; reason: TrendFailure; status: number };

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';

/**
 * Fetched server-side, once, for the widest window the selector offers.
 *
 * The 7/30/90 switch then slices in the browser instead of reloading the page:
 * a day's row does not depend on the window it was asked for, and the tab this
 * card sits on also loads ninety days of bot profiles plus the whole CRM to
 * render — paying all of that again to narrow a chart to one week would make
 * the cheapest control on the page the slowest.
 */
export async function fetchTrafficTrend(period = 90): Promise<TrafficTrendResult> {
  if (!STATS_TOKEN) return { ok: false, reason: 'no-token', status: 0 };
  const r = await fetch(`${API_URL}/stats/traffic-trend?period=${period}`, {
    headers: { Authorization: `Bearer ${STATS_TOKEN}` },
    cache: 'no-store',
  }).catch(() => null);
  if (r === null) return { ok: false, reason: 'unreachable', status: 0 };
  if (!r.ok) return { ok: false, reason: 'http', status: r.status };
  const days = parseTrafficTrend(await r.json().catch(() => null));
  if (days === null) return { ok: false, reason: 'malformed', status: r.status };
  return { ok: true, days };
}
