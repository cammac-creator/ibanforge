import type { ActivationClientRow } from '@/components/dashboard/clients-table';
import type { StatusByPathRow } from '@/components/dashboard/status-by-path-table';
import type { Fetched } from '@/components/dashboard/overview/fetching';
import { SEEDED_PILOT_RE } from '@/lib/crm/build-contacts';

/**
 * The derivations behind the overview cockpit, as pure functions.
 *
 * The overview was rebuilt on 2026-09-01 from an audit (ENS-01..ENS-24) that
 * found it to be a chronological stack of 22 blocks rather than a cockpit: the
 * money was 1 700 px down, what was broken 5 300 px down, and the follow-up
 * queue was a number with no button. The page now answers five morning
 * questions in order, and every figure those sections show is computed HERE
 * rather than inline in JSX — a number computed in a component is a number no
 * test can hold still, and three of the numbers this page used to show were
 * wrong for exactly that reason.
 *
 * Nothing in this file reads the clock on its own: `now` is always an argument,
 * so a section rendered on the server and read in a browser two hours away
 * cannot disagree with itself, and every case below is reproducible under test.
 */

const DAY_MS = 86_400_000;

/**
 * Parse the API's SQL datetime ("YYYY-MM-DD HH:MM:SS", always UTC).
 *
 * Written defensively on purpose: appending a second "Z" to a string that
 * already carries one yields an Invalid Date, which is the exact shape of the
 * bug that put production at 500 on 12/08/2026. A value we cannot read gives
 * null, and every caller below treats null as "unknown", never as zero.
 */
export function parseSqlUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw.replace(' ', 'T') : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days between an API timestamp and `now`, or null when unreadable. */
export function daysSince(value: string | null | undefined, now: Date): number | null {
  const d = parseSqlUtc(value);
  if (!d) return null;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS));
}

// ---------------------------------------------------------------- population

/**
 * The external client rows, seeded outreach pilots removed.
 *
 * The same filter the page has always applied, named once so the money, the
 * follow-up queue and the podium cannot each apply their own and then disagree
 * about how many customers exist.
 */
export function externalClients(clients: ActivationClientRow[]): ActivationClientRow[] {
  return clients.filter((c) => !SEEDED_PILOT_RE.test(c.email));
}

// ---------------------------------------------------------------- ENS-08 markers

export interface OverviewMarker {
  date: string;
  label: string;
  kind: string;
}

/**
 * Event markers, deduplicated so a marker means something again (ENS-08).
 *
 * The backend deduplicates by label AND by six-hour slot, so up to four
 * identical release markers survive a single day, and the charts concatenated
 * every one of them: the page carried a wall of five or six near-identical
 * version lines under TWO charts, and a dotted line on nearly every day, which
 * is the same as no marker at all.
 *
 * Two rules, in order:
 *   1. one label per day, first occurrence wins;
 *   2. an automatic label (a release) only marks the FIRST day it appears — a
 *      version deployed four times in three days is one event, not four. A
 *      `manual` note is never folded away: it was written by hand precisely
 *      because that day deserved a line.
 */
export function dedupeMarkers(markers: readonly OverviewMarker[]): OverviewMarker[] {
  const sorted = [...markers].sort((a, z) => a.date.localeCompare(z.date));
  const seenPerDay = new Set<string>();
  const seenAutoLabel = new Set<string>();
  const out: OverviewMarker[] = [];
  for (const m of sorted) {
    const perDay = `${m.date}\u0000${m.label}`;
    if (seenPerDay.has(perDay)) continue;
    if (m.kind !== 'manual') {
      if (seenAutoLabel.has(m.label)) continue;
      seenAutoLabel.add(m.label);
    }
    seenPerDay.add(perDay);
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- section 1, money

export interface BuyerRow {
  email: string;
  packs: number;
  creditsTotal: number;
  creditsRemaining: number;
  status: ActivationClientRow['status'];
  /** Days since the account last called, null when it never has. */
  idleDays: number | null;
}

export interface MoneySummary {
  /** Clients holding at least one credit pack. */
  paying: number;
  /** Buyers whose key still calls: the retained half of the paying set. */
  payingActive: number;
  /** Elevated free quota granted for an evaluation. */
  pilots: number;
  /** Pilots that have called at least once. */
  activePilots: number;
  /** Packs sold, all buyers. */
  packs: number;
  /** Credits sold, all buyers. */
  creditsSold: number;
  /**
   * Credits sold and never consumed.
   *
   * THE figure the old page did not have anywhere: it existed line by line in
   * the clients table and was aggregated nowhere, so the break-after-purchase
   * measured on 30/08 could only be read by hand. Here it is one number that
   * moves day by day.
   */
  creditsUnused: number;
  /** Share of sold credits actually consumed, 0..100, or null with no sale. */
  consumedPct: number | null;
  /** Buyers, most recently active first, for the "who bought" line. */
  buyers: BuyerRow[];
}

export function moneySummary(clients: ActivationClientRow[], now: Date): MoneySummary {
  const rows = externalClients(clients);
  const buyerRows = rows.filter((c) => c.packs > 0);
  const pilots = rows.filter((c) => c.free_quota > 200);

  let packs = 0;
  let creditsSold = 0;
  let creditsUnused = 0;
  for (const c of buyerRows) {
    packs += c.packs;
    creditsSold += c.credits_total;
    creditsUnused += c.credits_remaining;
  }

  const buyers: BuyerRow[] = buyerRows
    .map((c) => ({
      email: c.email,
      packs: c.packs,
      creditsTotal: c.credits_total,
      creditsRemaining: c.credits_remaining,
      status: c.status,
      idleDays: daysSince(c.last_seen_at, now),
    }))
    // Nulls last: an account that never called is not "the most recent" one.
    .sort((a, z) => (a.idleDays ?? Number.MAX_SAFE_INTEGER) - (z.idleDays ?? Number.MAX_SAFE_INTEGER));

  return {
    paying: buyerRows.length,
    payingActive: buyerRows.filter((c) => c.status === 'paying').length,
    pilots: pilots.length,
    activePilots: pilots.filter((c) => c.first_call_at !== null).length,
    packs,
    creditsSold,
    creditsUnused,
    consumedPct: creditsSold > 0 ? Math.round(((creditsSold - creditsUnused) / creditsSold) * 100) : null,
    buyers,
  };
}

// ---------------------------------------------------------------- section 2, who to chase

/**
 * Why a row is in the queue. Codes, not sentences: the wording is translated in
 * the component, the ORDER is decided here and is what the tests hold.
 */
export type ChaseReason =
  | 'paid-dormant'
  | 'at-limit'
  | 'gone-quiet'
  | 'never-called';

export interface ChaseRow {
  email: string;
  reason: ChaseReason;
  /** Days since the fact the reason names. Null when it cannot be dated. */
  days: number | null;
  creditsRemaining: number;
  packs: number;
  status: ActivationClientRow['status'];
}

/**
 * Gravity order. A buyer who stopped calling is money already taken that is
 * about to be regretted; someone who hit the wall yesterday is the one moment
 * a free user is ready to pay; a customer who called and went quiet is a
 * retention signal; a signup that never called is the coldest of the four
 * (and the most numerous, which is why it must not lead).
 */
const REASON_RANK: Record<ChaseReason, number> = {
  'paid-dormant': 0,
  'at-limit': 1,
  'gone-quiet': 2,
  'never-called': 3,
};

/**
 * Classify a client row, or null when nothing is due.
 *
 * Reads the status the API already computed rather than re-deriving it, so the
 * queue can never name someone the Clients tab calls active. The one thing it
 * adds is the split the audit asked for (DASH-10): `silent` covers both "never
 * called" and "called then went quiet", and those two are not the same letter
 * to write.
 */
export function chaseReasonOf(c: ActivationClientRow): ChaseReason | null {
  if (c.status === 'dormant') return 'paid-dormant';
  if (c.status === 'at-limit') return 'at-limit';
  if (c.status === 'silent') return c.first_call_at === null ? 'never-called' : 'gone-quiet';
  return null;
}

/**
 * The morning work queue: who to write to, worst first, capped.
 *
 * Capped on purpose. The page used to print the count (a number with no verb)
 * and separately name eight of them in an amber banner with no button; a
 * queue longer than a screen is read as a wall and worked on never.
 */
export function chaseQueue(
  clients: ActivationClientRow[],
  now: Date,
  limit = 6,
): { rows: ChaseRow[]; total: number; byReason: Record<ChaseReason, number> } {
  const byReason: Record<ChaseReason, number> = {
    'paid-dormant': 0,
    'at-limit': 0,
    'gone-quiet': 0,
    'never-called': 0,
  };

  const all: ChaseRow[] = [];
  for (const c of externalClients(clients)) {
    const reason = chaseReasonOf(c);
    if (!reason) continue;
    byReason[reason] += 1;
    all.push({
      email: c.email,
      reason,
      // The date the reason is about: last call for anyone who called, signup
      // for a row that never did. Showing "signed up 40 days ago" beside "no
      // call for 40 days" would be two readings of one fact.
      days: daysSince(reason === 'never-called' ? c.signup_at : (c.last_seen_at ?? c.signup_at), now),
      creditsRemaining: c.credits_remaining,
      packs: c.packs,
      status: c.status,
    });
  }

  all.sort((a, z) => {
    const rank = REASON_RANK[a.reason] - REASON_RANK[z.reason];
    if (rank !== 0) return rank;
    // Within a reason: unused credits first (money at risk), then staleness.
    if (a.creditsRemaining !== z.creditsRemaining) return z.creditsRemaining - a.creditsRemaining;
    return (z.days ?? -1) - (a.days ?? -1);
  });

  return { rows: all.slice(0, limit), total: all.length, byReason };
}

// ---------------------------------------------------------------- section 4, what is new

export interface SignupRow {
  email: string;
  /** Days since signup, null when the date cannot be read. */
  days: number | null;
  called: boolean;
  status: ActivationClientRow['status'];
}

/**
 * Who signed up lately, newest first.
 *
 * The overview counted signups inside a funnel and named none of them. A name
 * with a date is what makes "someone arrived this morning" a thing to act on
 * the same day rather than a bar that moved.
 */
export function recentSignups(
  clients: ActivationClientRow[],
  now: Date,
  { withinDays = 7, limit = 5 }: { withinDays?: number; limit?: number } = {},
): { rows: SignupRow[]; total: number } {
  const fresh = externalClients(clients)
    .map((c) => ({
      email: c.email,
      days: daysSince(c.signup_at, now),
      called: c.first_call_at !== null,
      status: c.status,
    }))
    // A row we cannot date is not "recent": an unreadable date must not be
    // read as zero days old and pushed to the top of the list.
    .filter((r) => r.days !== null && r.days <= withinDays)
    .sort((a, z) => (a.days ?? 0) - (z.days ?? 0));

  return { rows: fresh.slice(0, limit), total: fresh.length };
}

// ---------------------------------------------------------------- section 3, what is broken

export interface ServerErrorPath {
  path: string;
  errors: number;
  total: number;
}

/**
 * The paths actually returning 5xx (ENS "nommer le path des 5xx").
 *
 * Monday's digest has said "N server errors this week" since August and the
 * page never said WHERE. The data was already on the page, buried in a table
 * 5 300 px down, coloured by HTTP class rather than by whether it mattered.
 */
export function serverErrorPaths(rows: readonly StatusByPathRow[]): ServerErrorPath[] {
  return rows
    .filter((r) => (r.s5xx ?? 0) > 0)
    .map((r) => ({ path: r.path, errors: r.s5xx, total: r.total }))
    .sort((a, z) => z.errors - a.errors);
}

export interface RefusalPath {
  path: string;
  refused: number;
  served: number;
  /** Share of the endpoint's traffic refused, 0..100. */
  ratio: number;
}

/**
 * Billable endpoints refused more often than they are served (ENS-21).
 *
 * The old table painted every 4xx amber because amber is what 4xx means in
 * HTTP. But a product whose business endpoints refuse the overwhelming
 * majority of their calls at the paywall is not "amber", and the ratio is the
 * only reading that says so. `minTotal` keeps a path with three calls out of a
 * ranking about volume.
 */
export function refusalPaths(
  rows: readonly StatusByPathRow[],
  { minTotal = 100, minRatio = 50, limit = 5 }: { minTotal?: number; minRatio?: number; limit?: number } = {},
): RefusalPath[] {
  return rows
    .filter((r) => r.total >= minTotal)
    .map((r) => ({
      path: r.path,
      refused: r.s4xx ?? 0,
      served: r.s2xx ?? 0,
      ratio: r.total > 0 ? Math.round(((r.s4xx ?? 0) / r.total) * 100) : 0,
    }))
    .filter((r) => r.ratio >= minRatio)
    .sort((a, z) => z.ratio - a.ratio || z.refused - a.refused)
    .slice(0, limit);
}

/**
 * The verdict the "what is broken" band renders as one line when all is well.
 *
 * `null` inputs mean "we could not read", never "there is nothing": the whole
 * point of the band is that a failed reader must be louder than a calm day,
 * not quieter.
 */
export type BrokenLevel = 'ok' | 'unknown' | 'warn' | 'alert';

export function brokenLevel(input: {
  serverErrors: number;
  staleSources: number;
  /** Readers that failed outright; each one makes the verdict unknowable. */
  unreadable: number;
}): BrokenLevel {
  if (input.serverErrors > 0) return 'alert';
  if (input.staleSources > 0) return 'warn';
  if (input.unreadable > 0) return 'unknown';
  return 'ok';
}

/**
 * NOTE, deliberately: massive 4xx refusal does NOT raise the verdict.
 *
 * The billable endpoints refuse the large majority of their calls at the
 * paywall, permanently and by design — that is the product charging for
 * itself. Wiring it into the verdict would light the band amber every single
 * day, and a lamp that is always on has stopped being a lamp; the band exists
 * to be green and one line long when nothing is wrong. ENS-21 asked for the
 * ratio to be READ correctly rather than painted by HTTP class, which is what
 * refusalPaths does; it did not ask for an alarm.
 */

/** Payload of GET /v1/admin/signup-sources (src/lib/signup-attribution.ts). */
export interface SignupSources {
  period_days: number;
  since: string | null;
  total: number;
  channels: Array<{ channel: string; n: number }>;
  landings: Array<{ path: string; n: number }>;
  referrers: Array<{ host: string; n: number }>;
  campaigns: Array<{ utm_source: string; utm_medium: string | null; utm_campaign: string | null; n: number }>;
}

/** GET /v1/admin/audit-stats: uploads and sales of the creditor-file audit. */
export interface AuditStats {
  period_days: number;
  since: string;
  uploads: number;
  sales: number;
  revenue_chf: number;
  last_sale_at: string | null;
  conversion: number | null;
  /** Each upload of the window, newest first (the API keeps the row count, a key prefix when one was sent, nothing else). */
  recent_uploads?: Array<{ at: string; rows: number | null; tier: string | null; key_prefix: string | null; internal: boolean }>;
  recent_sales?: Array<{ paid_at: string; rows: number; tier: string; price_chf: number }>;
}

/**
 * GET /v1/admin/web-events?days=N — what the landing page's visitors click
 * (src/lib/web-events.ts in the API). `since` is the SQLite `datetime('now')`
 * form, "YYYY-MM-DD HH:MM:SS", UTC.
 */
export interface WebEventsSummary {
  days: number;
  since: string | null;
  total: number;
  by_name: Array<{ name: string; count: number }>;
  by_page: Array<{ page: string; locale: string; count: number }>;
  by_referrer: Array<{ referrer: string; count: number }>;
  by_day: Array<{ day: string; count: number }>;
}

// ---------------------------------------------------------------- keyless trial

/**
 * The `page` value the API writes on its own rows (src/lib/web-events.ts,
 * `SERVER_EVENT_PAGE`). Nobody navigated there; the doors card drops it from
 * the by-page list, which groups by path and so cannot be filtered by name.
 */
export const SERVER_EVENT_PAGE = '/api';

/** Names written by the server, never by the page. Kept in step with SERVER_EVENTS in the API. */
const TRIAL_EVENT = 'api:trial';
const TRIAL_EXHAUSTED_EVENT = 'api:trial-exhausted';

/**
 * The signup channel a key born of the keyless trial carries.
 *
 * `POST /v1/keys/generate` stores `source` on the key, and `channelOf`
 * (src/lib/signup-attribution.ts) prefixes it with `src:` unless a utm_source
 * outranks it. So a trial signup that arrived through a campaign link would be
 * counted on the campaign instead — correct, and worth knowing before reading a
 * zero here as "the trial converts nobody".
 */
const TRIAL_SIGNUP_CHANNEL = 'src:api-trial';

/**
 * The keyless REST trial, end to end: tried → hit the ceiling → took a key.
 *
 * The first two are address-days, not calls (the API writes one row per address
 * per day, whatever the volume), so "12 tried" means twelve address-days and not
 * twelve requests. The third is the only one that is money: a free key minted
 * with `source=api-trial`.
 *
 * Missing readers give zero rather than null on purpose — the card already greys
 * the week column when its fetch failed, and a second unknown state on three
 * numbers would say less than it costs.
 */
export interface TrialFunnel {
  tried: number;
  exhausted: number;
  keys: number;
}

export function trialFunnel(events: WebEventsSummary | null, signups: SignupSources | null): TrialFunnel {
  const count = (name: string) => events?.by_name.find((r) => r.name === name)?.count ?? 0;
  return {
    tried: count(TRIAL_EVENT),
    exhausted: count(TRIAL_EXHAUSTED_EVENT),
    keys: signups?.channels.find((c) => c.channel === TRIAL_SIGNUP_CHANNEL)?.n ?? 0,
  };
}

// ---------------------------------------------------------------- Search Console

/** One complete Monday→Sunday week. `ctr` and `position` are null with no impression. */
export interface SearchConsoleWeek {
  start: string;
  end: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

/** A query as typed, or a page as a path relative to the site. */
export interface SearchConsoleRow {
  key: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

export interface SearchConsoleSitemap {
  path: string;
  submitted: number;
  indexed: number;
  last_submitted: string | null;
  last_downloaded: string | null;
  errors: number;
  warnings: number;
  is_pending: boolean;
}

/** Google's verdict folded to the three answers that call for different work. */
export type IndexState = 'indexed' | 'not-indexed' | 'unknown';

export interface SearchConsoleInspection {
  path: string;
  state: IndexState;
  coverage: string | null;
  last_crawled: string | null;
  error: string | null;
}

/**
 * GET /v1/admin/search-console (src/lib/search-console.ts in the API).
 *
 * `stale` is true when the payload is the last reading that landed rather than
 * one taken just now — it always travels with the 502 the route answers when
 * Google refuses, and `upstream_status` says which refusal.
 */
export interface SearchConsole {
  site: string;
  /** J-3: the last day Google is expected to have data for. */
  window_end: string;
  weeks: SearchConsoleWeek[];
  top_window: { start: string; end: string };
  queries: SearchConsoleRow[];
  pages: SearchConsoleRow[];
  sitemaps: SearchConsoleSitemap[];
  inspections: SearchConsoleInspection[];
  /** SQL datetime, UTC, of the reading itself — not of this request. */
  fetched_at: string;
  stale: boolean;
  upstream_status?: number;
}

/**
 * The one overview read that keeps the body of a failed response.
 *
 * `fetchJSON` drops `data` on any non-2xx, which is right for every other card
 * and wrong for this one: the route answers 502 WITH the last reading attached
 * precisely so a Google outage shows last week's figures rather than an empty
 * box. Thrown away here, that whole design would be dead code. The card then
 * branches on `status` — 503 is "not configured", 502 with data is a stale
 * reading, anything else is a failed read.
 *
 * URL and headers are arguments rather than module constants, like every other
 * derivation in this file: nothing here reads the environment on its own, so
 * the reader is testable without one.
 */
export async function fetchSearchConsole(
  apiUrl: string,
  headers: HeadersInit,
): Promise<Fetched<SearchConsole>> {
  try {
    const res = await fetch(`${apiUrl}/v1/admin/search-console`, { cache: 'no-store', headers });
    const body: unknown = await res.json().catch(() => null);
    // A summary is recognised by its weeks. `{ error: 'not_configured' }` and
    // an HTML error page from a proxy both come back as data: null, and the
    // status is what tells the card which of the two it is looking at.
    const data =
      body !== null && typeof body === 'object' && Array.isArray((body as SearchConsole).weeks)
        ? (body as SearchConsole)
        : null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
