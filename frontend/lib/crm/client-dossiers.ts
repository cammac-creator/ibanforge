import { INTERNAL_RE, type ActivationClientRow, type KeyRow, type MessageRow, type ProspectRow } from './build-contacts';
import { chipForStatus, type BusinessChip } from './business';
import { heatFromFacts, type Heat } from './heat';

/** One row of /v1/admin/client-profiles. Mirrors ClientProfile in src/lib/stats.ts. */
export interface ClientProfileRow {
  key_prefix: string;
  first_seen: string | null;
  last_seen: string | null;
  total: number;
  ok: number;
  paywall: number;
  bad_input: number;
  auth_or_quota: number;
  server_error: number;
  avg_ms: number;
  p95_ms: number;
  last_success_at: string | null;
  last_refusal_at: string | null;
  endpoints: Array<{ path: string; count: number }>;
  countries: Array<{ code: string; count: number }>;
  user_agents: Array<{ ua: string; count: number }>;
  client_kinds: Array<{ kind: string; count: number }>;
  distinct_ips: number;
  hours: number[];
  days: Array<{ day: string; count: number; bad?: number }>;
  reject_reasons: Array<{ reason: string; count: number }>;
}

/** One row of /v1/admin/company-profiles — the enrichment radar's identity
 *  table for signups the prospecting list never knew (19/08/2026). */
export interface CompanyProfileRow {
  email: string;
  company: string | null;
  website: string | null;
  country: string | null;
  what_they_do: string | null;
  source: string;
}

export interface DossierInput {
  keys: KeyRow[];
  prospects: ProspectRow[];
  messages: MessageRow[];
  profiles: Record<string, ClientProfileRow>;
  monthsByKey: Record<string, Array<{ month: string; count: number }>>;
  quotaWarnedByKey: Record<string, string[]>;
  /** Fallback identity behind the richer prospect rows; optional. */
  companyProfiles?: Record<string, CompanyProfileRow>;
  now: Date;
  /** Profile window in days — every windowed figure and label follows it. */
  windowDays?: number;
  /**
   * The per-email activation verdicts (same payload the Contacts page joins).
   * Optional: without it the page degrades to window-only facts — but the
   * unbounded first_call_at is what lets "depuis le…" stop lying about
   * customers older than the profile window.
   */
  activation?: ActivationClientRow[];
}

/**
 * What this customer is, in one word, ordered by which fact matters most.
 *
 * `blocked` outranks `dormant` deliberately: both look like silence on a chart,
 * but one of them is silence we caused and can undo. A real customer once sat
 * dormant for days and nobody knew it was because they had hit the wall.
 */
export type Verdict = 'blocked' | 'struggling' | 'dormant' | 'rising' | 'active' | 'former' | 'silent';

export interface DossierKey {
  prefix: string;
  createdAt: string;
  active: boolean;
  plan: 'credits' | 'paid' | 'free';
  monthlyLimit: number | null;
  usedThisMonth: number;
  creditsRemaining: number | null;
  creditsTotal: number | null;
  quotaWarnedMonths: string[];
  months: Array<{ month: string; count: number }>;
}

export interface ClientDossier {
  id: string;
  email: string;
  company: string | null;
  website: string | null;
  country: string | null;
  whatTheyDo: string | null;
  signedUpAt: string;
  keys: DossierKey[];
  requests: number;
  ok: number;
  paywall: number;
  badInput: number;
  authOrQuota: number;
  serverError: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
  daysSinceLastCall: number | null;
  avgMs: number;
  p95Ms: number;
  lastSuccessAt: string | null;
  lastRefusalAt: string | null;
  distinctIps: number;
  endpoints: Array<{ path: string; count: number }>;
  countries: Array<{ code: string; count: number }>;
  userAgents: Array<{ ua: string; count: number }>;
  clientKinds: Array<{ kind: string; count: number }>;
  rejectReasons: Array<{ reason: string; count: number }>;
  hours: number[];
  days: Array<{ day: string; count: number; bad?: number }>;
  mails: {
    sent: number;
    received: number;
    hasDraft: boolean;
    lastAt: string | null;
    lastSubject: string | null;
  };
  quotaWarned: boolean;
  verdict: Verdict;
  /** Sum of the keys' all-time counters — what the 90-day window cannot see. */
  usedAllTime: number;
  /** Unbounded first call, from the activation join; null when unknown. */
  firstCallEver: string | null;
  /** The activation row for this address, when the join succeeded. */
  activation: ActivationClientRow | null;
}

/**
 * SQLite writes 'YYYY-MM-DD HH:MM:SS' with no zone, and it means UTC. Handing
 * that straight to `new Date` reads it as local time, which silently shifts
 * every freshness figure by the server's offset.
 */
export function parseUtc(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(/[Z+]|-\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;

/**
 * Calendar days between two instants, in the operator's timezone. A sliding
 * 24 h window is NOT what "aujourd'hui" means: a call made yesterday at 23:00
 * stayed labelled "aujourd'hui" until 23:00 tonight. Freshness labels follow
 * the wall calendar in Europe/Zurich, whatever timezone the server runs in.
 */
const ZURICH_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function calendarDaysSince(from: Date, now: Date): number {
  return Math.round((Date.parse(ZURICH_DAY.format(now)) - Date.parse(ZURICH_DAY.format(from))) / DAY_MS);
}

/** The most recent of a set of instants. Compared PARSED: the stored strings
 * mix the SQL and ISO shapes, and 'T' versus ' ' is not a time ordering. */
function latest(values: Array<string | null>): string | null {
  const present = values.filter((v): v is string => v != null);
  if (!present.length) return null;
  return present.reduce((a, b) => ((parseUtc(a)?.getTime() ?? 0) >= (parseUtc(b)?.getTime() ?? 0) ? a : b));
}

/**
 * A continuous run of `span` days ending today, gaps filled with zero.
 *
 * The API returns only the days a customer called. Drawing those directly means
 * a customer with three active days gets three bars each a third of the chart
 * wide, which reads as constant heavy use — the opposite of the truth. A dense
 * axis makes a burst look like a burst.
 */
export function denseDays(
  days: Array<{ day: string; count: number; bad?: number }>,
  now: Date,
  span = 90,
): Array<{ day: string; count: number; bad?: number }> {
  const known = new Map(days.map((d) => [d.day, d]));
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: Array<{ day: string; count: number; bad?: number }> = [];
  for (let i = span - 1; i >= 0; i--) {
    const day = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    const k = known.get(day);
    out.push({ day, count: k?.count ?? 0, ...(k?.bad != null ? { bad: k.bad } : {}) });
  }
  return out;
}

function mergeCounts<T extends string>(
  lists: Array<Array<Record<string, unknown>>>,
  labelKey: T,
): Array<{ count: number } & Record<T, string>> {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const row of list) {
      const label = String(row[labelKey]);
      totals.set(label, (totals.get(label) ?? 0) + Number(row.count ?? 0));
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ [labelKey]: label, count }) as { count: number } & Record<T, string>);
}

/** Calls inside the window ending at `now`, `offsetDays` windows back. */
function windowTotal(days: Array<{ day: string; count: number }>, now: Date, offsetDays: number): number {
  const end = now.getTime() - offsetDays * 7 * DAY_MS;
  const start = end - 7 * DAY_MS;
  let sum = 0;
  for (const d of days) {
    const t = parseUtc(d.day)?.getTime();
    if (t != null && t > start && t <= end) sum += d.count;
  }
  return sum;
}

function decideVerdict(d: ClientDossier, now: Date): Verdict {
  // Nothing in the window is two different truths: a customer who called
  // before the window is a FORMER customer, not someone who never existed —
  // eight real addresses (two at their full 200 calls) read as "Muet ·
  // jamais" until this branch.
  if (d.requests === 0) return d.usedAllTime > 0 ? 'former' : 'silent';
  // The last thing that happened to them was being turned away, and nothing
  // has gone right since. Deliberately NOT "their quota is full right now":
  // raising a customer's quota clears that condition without telling the
  // customer anything, which is exactly how a blocked customer once sat
  // unnoticed for days. The wall they walked away from is the fact that
  // matters, and only a successful call of their own can clear it.
  if (
    d.lastRefusalAt &&
    (!d.lastSuccessAt ||
      (parseUtc(d.lastRefusalAt)?.getTime() ?? 0) >= (parseUtc(d.lastSuccessAt)?.getTime() ?? 0))
  )
    return 'blocked';
  if (d.requests >= 20 && d.badInput / d.requests > 0.3) return 'struggling';
  if (d.daysSinceLastCall != null && d.daysSinceLastCall > 14) return 'dormant';
  const last7 = windowTotal(d.days, now, 0);
  const prev7 = windowTotal(d.days, now, 1);
  if (last7 >= 10 && last7 > prev7 * 1.5) return 'rising';
  return 'active';
}

export function buildDossiers(input: DossierInput): ClientDossier[] {
  const { now } = input;
  // Sparkbars stay readable: past 90 days a bar per day is noise, so the
  // drawn span caps while the counters keep the true window.
  const drawnSpan = Math.min(input.windowDays ?? 90, 90);

  const activationByEmail = new Map<string, ActivationClientRow>();
  for (const a of input.activation ?? []) activationByEmail.set(a.email.toLowerCase(), a);

  const prospectByEmail = new Map<string, ProspectRow>();
  for (const p of input.prospects) {
    const id = p.contact_email?.toLowerCase();
    if (id && !prospectByEmail.has(id)) prospectByEmail.set(id, p);
  }

  const threads = new Map<string, MessageRow[]>();
  for (const m of input.messages) {
    const id = m.customer_email.toLowerCase();
    const arr = threads.get(id);
    if (arr) arr.push(m);
    else threads.set(id, [m]);
  }

  const byAddress = new Map<string, KeyRow[]>();
  for (const k of input.keys) {
    if (INTERNAL_RE.test(k.email)) continue;
    const id = k.email.toLowerCase();
    const arr = byAddress.get(id);
    if (arr) arr.push(k);
    else byAddress.set(id, [k]);
  }

  const out: ClientDossier[] = [];
  for (const [id, keys] of byAddress) {
    const profiles = keys.map((k) => input.profiles[k.key_prefix]).filter((p): p is ClientProfileRow => p != null);
    const sum = (pick: (p: ClientProfileRow) => number) => profiles.reduce((s, p) => s + pick(p), 0);

    const seen = profiles.map((p) => parseUtc(p.last_seen)).filter((d): d is Date => d != null);
    const started = profiles.map((p) => parseUtc(p.first_seen)).filter((d): d is Date => d != null);
    const lastCall = seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null;
    const firstCall = started.length ? new Date(Math.min(...started.map((d) => d.getTime()))) : null;

    const thread = (threads.get(id) ?? []).slice();
    const correspondence = thread
      .filter((m) => m.direction !== 'draft')
      .sort((a, b) => (parseUtc(a.msg_date)?.getTime() ?? 0) - (parseUtc(b.msg_date)?.getTime() ?? 0));
    const newest = correspondence[correspondence.length - 1];

    // Weighted latency: a key that made 900 calls should not be averaged flat
    // against one that made 3.
    const weighted = profiles.reduce((s, p) => s + p.avg_ms * p.total, 0);
    const totalReq = sum((p) => p.total);

    const hours = Array(24).fill(0) as number[];
    for (const p of profiles) for (let h = 0; h < 24; h++) hours[h] += p.hours?.[h] ?? 0;

    // Identity: the prospect row wins field by field (it was researched by a
    // person), the enriched company profile fills every hole — an empty
    // string counts as a hole, several prospect rows carry them.
    const prospect = prospectByEmail.get(id);
    const enriched = input.companyProfiles?.[id];
    const pick = (...vals: Array<string | null | undefined>): string | null => {
      for (const v of vals) if (v != null && v.trim() !== '') return v;
      return null;
    };
    const dossier: ClientDossier = {
      id,
      email: keys[0].email,
      company: pick(prospect?.company, enriched?.company),
      website: pick(prospect?.website, enriched?.website),
      country: pick(prospect?.country, enriched?.country),
      whatTheyDo: pick(prospect?.what_they_do, enriched?.what_they_do),
      // Ordered on parsed instants, not on raw strings: created_at mixes the
      // SQL and ISO shapes in production (one pilot holds both), and a bare
      // string sort ranks 'T' against ' ' instead of time against time.
      signedUpAt: keys
        .map((k) => k.created_at)
        .sort((a, b) => (parseUtc(a)?.getTime() ?? 0) - (parseUtc(b)?.getTime() ?? 0))[0],
      keys: keys.map((k) => ({
        prefix: k.key_prefix,
        createdAt: k.created_at,
        active: k.active === 1,
        plan: k.credits_total != null ? 'credits' : k.paid ? 'paid' : 'free',
        monthlyLimit: k.monthly_limit,
        usedThisMonth: k.used,
        creditsRemaining: k.credits_remaining,
        creditsTotal: k.credits_total,
        quotaWarnedMonths: input.quotaWarnedByKey[k.key_prefix] ?? [],
        months: input.monthsByKey[k.key_prefix] ?? [],
      })),
      requests: totalReq,
      ok: sum((p) => p.ok),
      paywall: sum((p) => p.paywall),
      badInput: sum((p) => p.bad_input),
      authOrQuota: sum((p) => p.auth_or_quota),
      serverError: sum((p) => p.server_error),
      firstCallAt: firstCall ? firstCall.toISOString() : null,
      lastCallAt: lastCall ? lastCall.toISOString() : null,
      daysSinceLastCall: lastCall ? calendarDaysSince(lastCall, now) : null,
      avgMs: totalReq > 0 ? Math.round(weighted / totalReq) : 0,
      p95Ms: profiles.reduce((m, p) => Math.max(m, p.p95_ms), 0),
      lastSuccessAt: latest(profiles.map((p) => p.last_success_at)),
      lastRefusalAt: latest(profiles.map((p) => p.last_refusal_at)),
      distinctIps: sum((p) => p.distinct_ips),
      endpoints: mergeCounts(profiles.map((p) => p.endpoints ?? []), 'path'),
      countries: mergeCounts(profiles.map((p) => p.countries ?? []), 'code'),
      userAgents: mergeCounts(profiles.map((p) => p.user_agents ?? []), 'ua'),
      clientKinds: mergeCounts(profiles.map((p) => p.client_kinds ?? []), 'kind'),
      rejectReasons: mergeCounts(profiles.map((p) => p.reject_reasons ?? []), 'reason'),
      hours,
      days: denseDays(
        (() => {
          const byDay = new Map<string, { count: number; bad: number }>();
          for (const p of profiles)
            for (const x of p.days ?? []) {
              const cur = byDay.get(x.day) ?? { count: 0, bad: 0 };
              cur.count += x.count;
              cur.bad += x.bad ?? 0;
              byDay.set(x.day, cur);
            }
          return [...byDay.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([day, v]) => ({ day, count: v.count, bad: v.bad }));
        })(),
        now,
        drawnSpan,
      ),
      mails: {
        sent: thread.filter((m) => m.direction === 'out').length,
        received: thread.filter((m) => m.direction === 'in').length,
        hasDraft: thread.some((m) => m.direction === 'draft'),
        lastAt: newest?.msg_date ?? null,
        lastSubject: newest?.subject ?? null,
      },
      quotaWarned: keys.some((k) => (input.quotaWarnedByKey[k.key_prefix] ?? []).length > 0),
      verdict: 'silent',
      usedAllTime: keys.reduce((s2, k) => s2 + (k.used_all_time ?? 0), 0),
      firstCallEver: activationByEmail.get(id)?.first_call_at ?? null,
      activation: activationByEmail.get(id) ?? null,
    };
    dossier.verdict = decideVerdict(dossier, now);
    out.push(dossier);
  }
  return out;
}

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

export interface ProfilesPayload {
  profiles: Record<string, ClientProfileRow>;
  monthsByKey: Record<string, Array<{ month: string; count: number }>>;
  quotaWarnedByKey: Record<string, string[]>;
}

/**
 * Its own call rather than a sixth entry in fetchCrmData: the Contacts page
 * renders on every mail action and has no use for latency percentiles or
 * per-country counts, and this query is the heaviest of the admin set.
 */
export async function fetchClientProfiles(days = 90): Promise<ProfilesPayload> {
  const empty: ProfilesPayload = { profiles: {}, monthsByKey: {}, quotaWarnedByKey: {} };
  if (!ADMIN_SECRET) return empty;
  const r = await fetch(`${API_URL}/v1/admin/client-profiles?days=${days}`, {
    headers: { 'X-Admin-Secret': ADMIN_SECRET },
    cache: 'no-store',
  }).catch(() => null);
  if (!r?.ok) return empty;
  const j = (await r.json().catch(() => null)) as {
    profiles?: Record<string, ClientProfileRow>;
    months_by_key?: Record<string, Array<{ month: string; count: number }>>;
    quota_warned_by_key?: Record<string, string[]>;
  } | null;
  if (!j) return empty;
  return {
    profiles: j.profiles ?? {},
    monthsByKey: j.months_by_key ?? {},
    quotaWarnedByKey: j.quota_warned_by_key ?? {},
  };
}

/**
 * The same chip the Contacts list wears, derived from the dossier's joined
 * activation row — one table, two pages, no second truth.
 */
/** The enrichment radar's identity table, keyed by lowercase email. */
export async function fetchCompanyProfiles(): Promise<Record<string, CompanyProfileRow>> {
  if (!ADMIN_SECRET) return {};
  const r = await fetch(`${API_URL}/v1/admin/company-profiles`, {
    headers: { 'X-Admin-Secret': ADMIN_SECRET },
    cache: 'no-store',
  }).catch(() => null);
  if (!r?.ok) return {};
  const j = (await r.json().catch(() => null)) as { profiles?: Record<string, CompanyProfileRow> } | null;
  return j?.profiles ?? {};
}

export function chipOfDossier(d: ClientDossier): BusinessChip | null {
  const a = d.activation;
  if (a?.status === 'paying') return chipForStatus('paying');
  if (a?.status === 'dormant') return chipForStatus('dormant');
  if (a?.status === 'at-limit') return chipForStatus('at-limit');
  if (d.keys.some((k) => k.plan === 'free' && (k.monthlyLimit ?? 0) >= 5000)) return chipForStatus('pilot');
  return null;
}

/**
 * The dossier's heat, through the shared arithmetic. The conversation terms
 * are fed from the mail counters this page holds; silence and ball-in-court
 * belong to the Contacts page's situation and stay out rather than being
 * approximated into disagreement.
 */
export function heatOfDossier(d: ClientDossier, now: Date): Heat {
  const dayAt = (offset: number) => new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
  const inWindow = (from: number, to: number) => {
    const a = dayAt(from);
    const b = dayAt(to);
    return d.days.reduce((s2, x) => (x.day >= a && x.day < b ? s2 + x.count : s2), 0);
  };
  return heatFromFacts({
    packs: d.keys.filter((k) => k.plan === 'credits').length,
    dormant: d.activation?.status === 'dormant',
    atLimit: d.activation?.status === 'at-limit',
    last7: inWindow(7, 0),
    prev7: inWindow(14, 7),
    messageCount: d.mails.sent + d.mails.received,
    silenceDays: null,
    ballWithUs: false,
  });
}

/**
 * Bad-input share, this week against the one before, from the per-day bad
 * counts the profiles now carry. Null when either window has fewer than 5
 * calls: a ratio on three calls is noise wearing a percent sign.
 */
export function qualityTrend(
  d: ClientDossier,
  now: Date,
): { thisWeekPct: number; prevWeekPct: number; topReason: string | null } | null {
  const dayAt = (offset: number) => new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
  const win = (from: number, to: number) => {
    const a = dayAt(from);
    const b = dayAt(to);
    let calls = 0;
    let bad = 0;
    for (const x of d.days) {
      if (x.day >= a && x.day < b) {
        calls += x.count;
        bad += x.bad ?? 0;
      }
    }
    return { calls, bad };
  };
  const cur = win(7, 0);
  const prev = win(14, 7);
  if (cur.calls < 5 || prev.calls < 5) return null;
  return {
    thisWeekPct: Math.round((cur.bad / cur.calls) * 100),
    prevWeekPct: Math.round((prev.bad / prev.calls) * 100),
    topReason: d.rejectReasons[0]?.reason ?? null,
  };
}

/** Every column of the Clients table sorts; these are their keys. */
export type SortKey = 'name' | 'state' | 'requests' | 'last30' | 'freshness' | 'countries' | 'mails';
export type SortDir = 'asc' | 'desc';

/** What the FIRST click on a header means: the reading a person wants first. */
export const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  state: 'asc', // gravity first: blocked before silent
  requests: 'desc',
  last30: 'desc',
  freshness: 'desc', // most recent first
  countries: 'desc',
  mails: 'desc',
};

/** Verdict gravity, the order the old filter pills stood in. */
const VERDICT_RANK: Record<Verdict, number> = {
  blocked: 0,
  struggling: 1,
  rising: 2,
  active: 3,
  dormant: 4,
  former: 5,
  silent: 6,
};

/** Calls over the last 30 drawn days — the column the mini sparkline shows. */
export function last30Of(d: ClientDossier): number {
  return d.days.slice(-30).reduce((s, x) => s + x.count, 0);
}

/**
 * Returns a new array: the caller's list order is the React key order.
 * `dir` flips the column's natural ascending order; addresses that never
 * called sort last under `freshness` in BOTH directions — "jamais" is an
 * absence, not a very old date that inverting should promote.
 */
export function sortDossiers(list: ClientDossier[], key: SortKey, dir: SortDir = SORT_DEFAULT_DIR[key]): ClientDossier[] {
  const asc = (a: ClientDossier, b: ClientDossier): number => {
    switch (key) {
      case 'name':
        return (a.company ?? a.email).localeCompare(b.company ?? b.email);
      case 'state':
        return VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
      case 'requests':
        return a.requests - b.requests;
      case 'last30':
        return last30Of(a) - last30Of(b);
      case 'freshness':
        return (a.lastCallAt ? Date.parse(a.lastCallAt) : 0) - (b.lastCallAt ? Date.parse(b.lastCallAt) : 0);
      case 'countries':
        return a.countries.length - b.countries.length;
      case 'mails':
        return a.mails.sent + a.mails.received - (b.mails.sent + b.mails.received);
    }
  };
  const sign = dir === 'desc' ? -1 : 1;
  const called = key === 'freshness' ? list.filter((d) => d.lastCallAt != null) : [...list];
  const never = key === 'freshness' ? list.filter((d) => d.lastCallAt == null) : [];
  called.sort((a, b) => sign * asc(a, b) || a.email.localeCompare(b.email));
  never.sort((a, b) => a.email.localeCompare(b.email));
  return [...called, ...never];
}
