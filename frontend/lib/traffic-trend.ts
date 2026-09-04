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
export const KEYLESS_KEYS: readonly NatureKey[] = [
  'agent',
  'declared_bot',
  'browser',
  'anonymous_api',
];

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

/** A day nobody called on: drawn, at zero, rather than skipped. */
function emptyDay(date: string): TrafficTrendDay {
  return {
    date,
    total: 0,
    with_key: 0,
    agent: 0,
    declared_bot: 0,
    browser: 0,
    anonymous_api: 0,
    internal: 0,
    not_found: 0,
    paywall: 0,
    server_error: 0,
    distinct_ips: 0,
  };
}

/**
 * The last `period` days, ONE ROW PER CALENDAR DAY, quiet days included.
 *
 * Two rules in one function, and the second is the load-bearing one.
 *
 * Cut by calendar date counted back from today, never by taking the last N
 * rows: the route omits days with no traffic at all, so index slicing would
 * quietly reach further and further back the quieter the server gets — and it
 * would hand "7 jours" a window three weeks wide without saying so.
 *
 * Then FILL. The route's series is sparse by design (see getTrafficTrend),
 * recharts' X axis is categorical, and a categorical axis gives one equal slot
 * per row it receives — so two rows ten days apart are drawn side by side, and
 * the 404 line slopes gently between them across a stretch nothing ever
 * measured. Measured on the real series: a 90-day window held barely a third
 * as many rows as days, one pair of neighbouring bars sat nine days apart, and
 * the line drew a falling 404 trend through the gap. That is this card's own
 * lie, inverted: it exists so an isolated sweep cannot read as a wave of
 * visitors, and a sparse axis made an isolated sweep read as a gradual climb.
 *
 * Filling here rather than in the route keeps the payload small and leaves
 * getStatsHistory's shape untouched; filling here rather than in the component
 * means the summary tiles, the peak and the chart all see the same days.
 */
export function sliceToPeriod(
  days: TrafficTrendDay[],
  period: number,
  now: Date = new Date(),
): TrafficTrendDay[] {
  const todayKey = dayKeyUTC(now.getTime());
  const floor = dayKeyUTC(now.getTime() - (period - 1) * DAY_MS);
  const known = new Map<string, TrafficTrendDay>();
  for (const d of days) {
    // A day beyond today is a clock disagreement, not data: keep it rather
    // than drop it, so the anomaly stays visible instead of vanishing.
    if (d.date >= floor) known.set(d.date, d);
  }
  const out: TrafficTrendDay[] = [];
  for (let i = 0; i < period; i++) {
    const key = dayKeyUTC(now.getTime() - (period - 1 - i) * DAY_MS);
    out.push(known.get(key) ?? emptyDay(key));
    known.delete(key);
  }
  // Anything left is dated after today. Appended rather than discarded, for
  // the reason above.
  for (const d of known.values()) if (d.date > todayKey) out.push(d);
  return out.sort((a, b) => a.date.localeCompare(b.date));
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
  { ok: true; days: TrafficTrendDay[] } | { ok: false; reason: TrendFailure; status: number };

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

/* ------------------------------------------------------------------------- */
/* Reading the trend: what the premium card draws besides the bars.          */
/* ------------------------------------------------------------------------- */

/** Digits grouped with a narrow no-break space: the same string on the
 *  server and in the browser, which toLocaleString is not (ICU differs). */
export function fmtInt(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `-${grouped}` : grouped;
}

/** DD.MM from a YYYY-MM-DD key, string work only. */
export function shortDay(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

/** Saturday or Sunday, decided in UTC from the digits, so both sides agree. */
export function isWeekend(date: string): boolean {
  const d = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
  );
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

/** Trailing moving average of the daily totals over `window` days, aligned on the input. */
export function movingAverage(days: TrafficTrendDay[], window = 7): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < days.length; i++) {
    sum += days[i].total;
    if (i >= window) sum -= days[i - window].total;
    out.push(Math.round(sum / Math.min(i + 1, window)));
  }
  return out;
}

/** Percentage change from `previous` to `current`; null when there is nothing to compare to. */
export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * The window asked for and the one just before it, same length, so every
 * figure of the card can say « contre la période précédente ». The previous
 * window is null when the fetched history does not reach back far enough —
 * a comparison against an empty window would read as +∞ growth.
 */
export function comparePeriods(
  all: TrafficTrendDay[],
  period: number,
  now: Date,
): { current: TrafficTrendDay[]; previous: TrafficTrendDay[] | null } {
  const current = sliceToPeriod(all, period, now);
  const earliest = all.reduce<string | null>(
    (m, d) => (m === null || d.date < m ? d.date : m),
    null,
  );
  const prevEnd = new Date(now.getTime() - period * DAY_MS);
  const prevFloor = dayKeyUTC(prevEnd.getTime() - (period - 1) * DAY_MS);
  if (earliest === null || earliest > prevFloor) return { current, previous: null };
  return { current, previous: sliceToPeriod(all, period, prevEnd) };
}

function median(values: number[]): number {
  // Zeros included: most days have no 404 at all, and a median that ignored
  // them would make every sweep look ordinary.
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

export interface TrendEvent {
  date: string;
  /** A day far above the window's usual volume, or a 404 sweep. */
  kind: 'peak' | 'sweep';
  total: number;
  notFound: number;
  /** How many times the median the figure reached. */
  factor: number;
}

/**
 * The days worth a sentence: a total past twice the window's median, and a
 * 404 count past three times the median 404s that also makes up a third of
 * the day — the signature of a scanner, which is what the red line is for.
 * Today is left out: a partial day is neither a peak nor a collapse.
 */
export function trendEvents(days: TrafficTrendDay[], todayKey: string): TrendEvent[] {
  const done = days.filter((d) => d.date !== todayKey);
  const medTotal = median(done.map((d) => d.total));
  const medNotFound = median(done.map((d) => d.not_found));
  const out: TrendEvent[] = [];
  for (const d of done) {
    const sweep =
      d.not_found >= Math.max(50, medNotFound * 3) && d.total > 0 && d.not_found / d.total >= 0.3;
    if (sweep) {
      out.push({
        date: d.date,
        kind: 'sweep',
        total: d.total,
        notFound: d.not_found,
        factor: medNotFound > 0 ? Math.round((d.not_found / medNotFound) * 10) / 10 : 0,
      });
      continue;
    }
    if (medTotal > 0 && d.total >= medTotal * 2) {
      out.push({
        date: d.date,
        kind: 'peak',
        total: d.total,
        notFound: d.not_found,
        factor: Math.round((d.total / medTotal) * 10) / 10,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
