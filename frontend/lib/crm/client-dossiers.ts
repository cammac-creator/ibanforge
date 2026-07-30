import { INTERNAL_RE, type KeyRow, type MessageRow, type ProspectRow } from './build-contacts';

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
  days: Array<{ day: string; count: number }>;
  reject_reasons: Array<{ reason: string; count: number }>;
}

export interface DossierInput {
  keys: KeyRow[];
  prospects: ProspectRow[];
  messages: MessageRow[];
  profiles: Record<string, ClientProfileRow>;
  monthsByKey: Record<string, Array<{ month: string; count: number }>>;
  quotaWarnedByKey: Record<string, string[]>;
  now: Date;
}

/**
 * What this customer is, in one word, ordered by which fact matters most.
 *
 * `blocked` outranks `dormant` deliberately: both look like silence on a chart,
 * but one of them is silence we caused and can undo. Raison.finance was dormant
 * for a week on 30/07/2026 and nobody knew it was because they had hit the wall.
 */
export type Verdict = 'blocked' | 'struggling' | 'dormant' | 'rising' | 'active' | 'silent';

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
  days: Array<{ day: string; count: number }>;
  mails: {
    sent: number;
    received: number;
    hasDraft: boolean;
    lastAt: string | null;
    lastSubject: string | null;
  };
  quotaWarned: boolean;
  verdict: Verdict;
}

/**
 * SQLite writes 'YYYY-MM-DD HH:MM:SS' with no zone, and it means UTC. Handing
 * that straight to `new Date` reads it as local time, which silently shifts
 * every freshness figure by the server's offset.
 */
function parseUtc(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(/[Z+]|-\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;

/** The most recent of a set of SQLite instants, comparable as strings. */
function latest(values: Array<string | null>): string | null {
  const present = values.filter((v): v is string => v != null);
  return present.length ? present.reduce((a, b) => (a >= b ? a : b)) : null;
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
  days: Array<{ day: string; count: number }>,
  now: Date,
  span = 90,
): Array<{ day: string; count: number }> {
  const known = new Map(days.map((d) => [d.day, d.count]));
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: Array<{ day: string; count: number }> = [];
  for (let i = span - 1; i >= 0; i--) {
    const day = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    out.push({ day, count: known.get(day) ?? 0 });
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
  if (d.requests === 0) return 'silent';
  // The last thing that happened to them was being turned away, and nothing
  // has gone right since. Deliberately NOT "their quota is full right now":
  // raising a customer's quota clears that condition without telling the
  // customer anything, which is exactly how Raison.finance sat unnoticed for a
  // week in July 2026. The wall they walked away from is the fact that matters,
  // and only a successful call of their own can clear it.
  if (d.lastRefusalAt && (!d.lastSuccessAt || d.lastRefusalAt >= d.lastSuccessAt)) return 'blocked';
  if (d.requests >= 20 && d.badInput / d.requests > 0.3) return 'struggling';
  if (d.daysSinceLastCall != null && d.daysSinceLastCall > 14) return 'dormant';
  const last7 = windowTotal(d.days, now, 0);
  const prev7 = windowTotal(d.days, now, 1);
  if (last7 >= 10 && last7 > prev7 * 1.5) return 'rising';
  return 'active';
}

export function buildDossiers(input: DossierInput): ClientDossier[] {
  const { now } = input;

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

    const dossier: ClientDossier = {
      id,
      email: keys[0].email,
      company: prospectByEmail.get(id)?.company ?? null,
      website: prospectByEmail.get(id)?.website ?? null,
      country: prospectByEmail.get(id)?.country ?? null,
      whatTheyDo: prospectByEmail.get(id)?.what_they_do ?? null,
      signedUpAt: keys.map((k) => k.created_at).sort()[0],
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
      daysSinceLastCall: lastCall ? Math.floor((now.getTime() - lastCall.getTime()) / DAY_MS) : null,
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
      days: denseDays(mergeCounts(profiles.map((p) => p.days ?? []), 'day'), now),
      mails: {
        sent: thread.filter((m) => m.direction === 'out').length,
        received: thread.filter((m) => m.direction === 'in').length,
        hasDraft: thread.some((m) => m.direction === 'draft'),
        lastAt: newest?.msg_date ?? null,
        lastSubject: newest?.subject ?? null,
      },
      quotaWarned: keys.some((k) => (input.quotaWarnedByKey[k.key_prefix] ?? []).length > 0),
      verdict: 'silent',
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

export type SortKey = 'requests' | 'freshness' | 'name';

/** Returns a new array: the caller's list order is the React key order. */
export function sortDossiers(list: ClientDossier[], key: SortKey): ClientDossier[] {
  const copy = [...list];
  if (key === 'requests') return copy.sort((a, b) => b.requests - a.requests || a.email.localeCompare(b.email));
  if (key === 'name') return copy.sort((a, b) => (a.company ?? a.email).localeCompare(b.company ?? b.email));
  // Freshness: most recent first. Never-called addresses go last rather than
  // first, which is what sorting a null as 0 would have done.
  return copy.sort((a, b) => {
    const at = a.lastCallAt ? Date.parse(a.lastCallAt) : -Infinity;
    const bt = b.lastCallAt ? Date.parse(b.lastCallAt) : -Infinity;
    return bt - at || a.email.localeCompare(b.email);
  });
}
