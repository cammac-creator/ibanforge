import { denseDays } from './client-dossiers';

/** One row of /v1/admin/bot-profiles. Mirrors BotProfile in src/lib/stats.ts. */
export interface BotProfileRow {
  user_agent: string;
  client_kind: string | null;
  homepage: string | null;
  first_seen: string | null;
  last_seen: string | null;
  total: number;
  ok: number;
  paywall: number;
  bad_input: number;
  not_found: number;
  server_error: number;
  billable_ok: number;
  avg_ms: number;
  distinct_ips: number;
  endpoints: Array<{ path: string; count: number }>;
  not_found_paths: Array<{ path: string; count: number }>;
  hours: number[];
  days: Array<{ day: string; count: number }>;
}

/**
 * What an unauthenticated caller is, in one word.
 *
 * Not the same vocabulary as a customer's, because the questions are not the
 * same. For a customer the question is "are we losing them". For a machine it
 * is "is this one worth anything to us, and are we failing it".
 *
 * - `servi`    the paywall let a priced call through without a key
 * - `perdu`    most of what it asks for does not exist here
 * - `parti`    a fortnight with nothing, which for a directory is a delisting
 * - `sonde`    refused over and over, comes back anyway, pays nothing
 * - `annuaire` a declared crawler we serve properly
 * - `visiteur` everything else
 *
 * ⚠️ `servi` is deliberately NOT called "payeur". A 2xx on a priced endpoint
 * with no key can be an accepted x402 settlement OR a call served for free, and
 * request_log does not record which. Checked against the on-chain receipts,
 * the calls served this way outnumber the ones actually paid for by more than
 * an order of magnitude, so treating them all as payments would grossly
 * overstate revenue.
 */
export type BotVerdict = 'servi' | 'perdu' | 'parti' | 'sonde' | 'annuaire' | 'visiteur';

export interface BotDossier {
  id: string;
  userAgent: string;
  /** The product name at the head of the UA, which is what reads as a name. */
  label: string;
  homepage: string | null;
  clientKind: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  daysSinceLastCall: number | null;
  requests: number;
  ok: number;
  paywall: number;
  badInput: number;
  notFound: number;
  serverError: number;
  billableOk: number;
  avgMs: number;
  distinctIps: number;
  endpoints: Array<{ path: string; count: number }>;
  notFoundPaths: Array<{ path: string; count: number }>;
  hours: number[];
  days: Array<{ day: string; count: number }>;
  verdict: BotVerdict;
}

const DAY_MS = 86_400_000;

function parseUtc(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(/[Z+]|-\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "SentinelOracle/0.1 (+https://…; liveness)" → "SentinelOracle/0.1".
 * A browser UA has no useful head, so it keeps a readable prefix instead of a
 * meaningless "Mozilla/5.0".
 */
export function botLabel(ua: string): string {
  if (/^Mozilla\/5\.0/i.test(ua)) {
    const inner = /\(([^)]+)\)/.exec(ua)?.[1];
    return inner ? `Navigateur — ${inner.split(';')[0].trim()}` : 'Navigateur';
  }
  return ua.split(/[\s(]/)[0] || ua;
}

function decideVerdict(b: BotDossier): BotVerdict {
  if (b.billableOk > 0) return 'servi';
  if (b.requests >= 20 && b.notFound / b.requests > 0.5) return 'perdu';
  if (b.daysSinceLastCall != null && b.daysSinceLastCall > 14) return 'parti';
  if (b.requests >= 20 && (b.paywall + b.badInput) / b.requests > 0.3) return 'sonde';
  if (b.homepage || b.clientKind === 'bot' || b.clientKind === 'mcp_http') return 'annuaire';
  return 'visiteur';
}

export function buildBots(profiles: Record<string, BotProfileRow>, now: Date): BotDossier[] {
  return Object.values(profiles).map((p) => {
    const last = parseUtc(p.last_seen);
    const first = parseUtc(p.first_seen);
    const b: BotDossier = {
      id: p.user_agent,
      userAgent: p.user_agent,
      label: botLabel(p.user_agent),
      homepage: p.homepage,
      clientKind: p.client_kind,
      firstSeenAt: first ? first.toISOString() : null,
      lastSeenAt: last ? last.toISOString() : null,
      daysSinceLastCall: last ? Math.floor((now.getTime() - last.getTime()) / DAY_MS) : null,
      requests: p.total,
      ok: p.ok,
      paywall: p.paywall,
      badInput: p.bad_input,
      notFound: p.not_found,
      serverError: p.server_error,
      billableOk: p.billable_ok,
      avgMs: p.avg_ms,
      distinctIps: p.distinct_ips,
      endpoints: p.endpoints ?? [],
      notFoundPaths: p.not_found_paths ?? [],
      hours: p.hours ?? Array(24).fill(0),
      days: denseDays(p.days ?? [], now),
      verdict: 'visiteur',
    };
    b.verdict = decideVerdict(b);
    return b;
  });
}

export type BotSortKey = 'requests' | 'freshness' | 'name';

/** Returns a new array: the caller's order is the React key order. */
export function sortBots(list: BotDossier[], key: BotSortKey): BotDossier[] {
  const copy = [...list];
  if (key === 'requests') return copy.sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label));
  if (key === 'name') return copy.sort((a, b) => a.label.localeCompare(b.label));
  return copy.sort((a, b) => {
    const at = a.lastSeenAt ? Date.parse(a.lastSeenAt) : -Infinity;
    const bt = b.lastSeenAt ? Date.parse(b.lastSeenAt) : -Infinity;
    return bt - at || a.label.localeCompare(b.label);
  });
}

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

export async function fetchBotProfiles(days = 90, min = 5): Promise<Record<string, BotProfileRow>> {
  if (!ADMIN_SECRET) return {};
  const r = await fetch(`${API_URL}/v1/admin/bot-profiles?days=${days}&min=${min}`, {
    headers: { 'X-Admin-Secret': ADMIN_SECRET },
    cache: 'no-store',
  }).catch(() => null);
  if (!r?.ok) return {};
  const j = (await r.json().catch(() => null)) as { bots?: Record<string, BotProfileRow> } | null;
  return j?.bots ?? {};
}
