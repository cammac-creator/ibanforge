import { calendarDaysSince, denseDays } from './client-dossiers';

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
  /**
   * The rows this one stands for, when it is a group. Absent on a lone agent.
   *
   * A group is a real BotDossier carrying summed counters, so every reader of
   * this type keeps working unchanged and the table draws a group exactly as it
   * draws an agent. The versions are kept here rather than thrown away: which
   * release of a client is calling is the useful half of the detail, it just
   * has no business being forty lines of the list (audit TABS-05 and TABS-14).
   */
  members?: BotDossier[];
}


function parseUtc(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(/[Z+]|-\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A UA that announces itself as a browser engine rather than as a product. */
export function isGenericBrowser(ua: string): boolean {
  return /^Mozilla\/5\.0/i.test(ua);
}

/**
 * What a plausible product token looks like: it starts with a letter and holds
 * nothing but the characters a version string is made of.
 *
 * The reason it exists is that the user agent is attacker-controlled TEXT, and
 * this list is the one screen that prints it back. Two rows of the production
 * list were injection probes rather than agents, and their raw payloads were
 * displayed verbatim as if they were the names of two crawlers (audit TABS-05,
 * 2026-09-01). Nothing about them is a name, so nothing about them should read
 * as one.
 *
 * A whitelist and not a blacklist: the shapes a probe can take are unbounded,
 * the shape of a product name is not.
 */
const PRODUCT_TOKEN = /^[A-Za-z][A-Za-z0-9._+/-]*$/;

/** What an unreadable user agent is called instead of being printed. */
export const UNREADABLE_LABEL = 'UA illisible';

/**
 * "SentinelOracle/0.1 (+https://…; liveness)" → "SentinelOracle/0.1".
 * A browser UA has no useful head, so it keeps a readable prefix instead of a
 * meaningless "Mozilla/5.0".
 */
export function botLabel(ua: string): string {
  if (isGenericBrowser(ua)) {
    const inner = /\(([^)]+)\)/.exec(ua)?.[1];
    return inner ? `Navigateur — ${inner.split(';')[0].trim()}` : 'Navigateur';
  }
  const head = ua.split(/[\s(]/)[0] || ua;
  return PRODUCT_TOKEN.test(head) ? head : UNREADABLE_LABEL;
}

/**
 * The product behind a user agent, versions dropped.
 *
 * `Python-urllib/3.11` and `Python-urllib/3.9` are one caller that upgraded, not
 * two callers (audit TABS-14, 2026-09-01): before this, a version bump minted a
 * fresh dossier and left the old one to age into `parti`, so the page reported a
 * departure and an arrival every time somebody ran `pip install -U`.
 */
export function botProduct(ua: string): string {
  if (isGenericBrowser(ua)) return BROWSER_GROUP;
  const head = ua.split(/[\s(]/)[0] || ua;
  if (!PRODUCT_TOKEN.test(head)) return UNREADABLE_LABEL;
  return head.split('/')[0] || head;
}

/** The single line every generic browser and scanner folds into. */
export const BROWSER_GROUP = 'Navigateurs';

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
      daysSinceLastCall: last ? calendarDaysSince(last, now) : null,
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

/** Sum two count lists on their key, heaviest first. */
function mergeCounts<K extends string>(
  lists: Array<Array<Record<K, string> & { count: number }>>,
  key: K,
): Array<Record<K, string> & { count: number }> {
  const by = new Map<string, number>();
  for (const list of lists) for (const item of list) by.set(item[key], (by.get(item[key]) ?? 0) + item.count);
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, count]) => ({ [key]: k, count }) as Record<K, string> & { count: number });
}

/**
 * One line per product, and one single line for every generic browser.
 *
 * Two thirds of what reaches this page is not an agent at all: browsers and
 * scanners announcing themselves as `Mozilla/5.0`, dozens of rows carrying the
 * strictly identical label, which pushed the crawlers that matter off the first
 * screen (audit TABS-05, 2026-09-01). And a product that ships a new version
 * used to arrive as a new dossier while the old one aged into `parti`
 * (TABS-14). Both are the same defect: the list was keyed on the raw user
 * agent, which is a build identifier, not a caller.
 *
 * A group of ONE is not a group: a lone agent is returned as itself, with no
 * members and no invented parent, so nothing that was already readable gains a
 * layer to click through.
 *
 * The verdict is decided on the merged totals rather than voted among members,
 * for the same reason the counters are summed: the question the page asks is
 * "is this caller worth anything to us and are we failing it", and that is a
 * question about the caller, not about one of its builds.
 */
export function groupBots(list: BotDossier[], now: Date): BotDossier[] {
  const byProduct = new Map<string, BotDossier[]>();
  for (const b of list) {
    const key = botProduct(b.userAgent);
    const arr = byProduct.get(key);
    if (arr) arr.push(b);
    else byProduct.set(key, [b]);
  }

  const out: BotDossier[] = [];
  for (const [product, members] of byProduct) {
    if (members.length === 1 && product !== BROWSER_GROUP) {
      out.push(members[0]);
      continue;
    }
    const sum = (pick: (b: BotDossier) => number) => members.reduce((s, b) => s + pick(b), 0);
    const requests = sum((b) => b.requests);
    const stamps = (pick: (b: BotDossier) => string | null) =>
      members.map(pick).filter((v): v is string => v != null).map((v) => Date.parse(v)).filter((t) => !Number.isNaN(t));
    const firsts = stamps((b) => b.firstSeenAt);
    const lasts = stamps((b) => b.lastSeenAt);
    const last = lasts.length ? new Date(Math.max(...lasts)) : null;
    // Heaviest member first: it names the group's homepage and its kind, and it
    // is the one whose user agent stands for the whole line.
    const lead = [...members].sort((a, b) => b.requests - a.requests)[0];
    const byDay = new Map<string, number>();
    for (const m of members) for (const d of m.days) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.count);
    const group: BotDossier = {
      id: `groupe:${product}`,
      userAgent: lead.userAgent,
      label: product === BROWSER_GROUP ? `${BROWSER_GROUP} (${members.length})` : product,
      homepage: members.find((m) => m.homepage)?.homepage ?? null,
      clientKind: members.find((m) => m.clientKind)?.clientKind ?? null,
      firstSeenAt: firsts.length ? new Date(Math.min(...firsts)).toISOString() : null,
      lastSeenAt: last ? last.toISOString() : null,
      daysSinceLastCall: last ? calendarDaysSince(last, now) : null,
      requests,
      ok: sum((b) => b.ok),
      paywall: sum((b) => b.paywall),
      badInput: sum((b) => b.badInput),
      notFound: sum((b) => b.notFound),
      serverError: sum((b) => b.serverError),
      billableOk: sum((b) => b.billableOk),
      // Weighted, so a build that made three calls does not drag the average of
      // one that made thirty thousand.
      avgMs: requests > 0 ? Math.round(sum((b) => b.avgMs * b.requests) / requests) : 0,
      // Summed, and an over-count on purpose: the same address calling under two
      // versions is counted twice. The alternative is to serve the raw addresses
      // to the browser, which this page has no reason to hold.
      distinctIps: sum((b) => b.distinctIps),
      endpoints: mergeCounts(members.map((m) => m.endpoints), 'path'),
      notFoundPaths: mergeCounts(members.map((m) => m.notFoundPaths), 'path'),
      hours: Array.from({ length: 24 }, (_, h) => sum((b) => b.hours[h] ?? 0)),
      days: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, count]) => ({ day, count })),
      verdict: 'visiteur',
      members: [...members].sort((a, b) => b.requests - a.requests),
    };
    group.verdict = decideVerdict(group);
    out.push(group);
  }
  return out;
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
