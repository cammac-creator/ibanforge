import { getStatsDB } from './db.js';

/**
 * Where a signup came from.
 *
 * Until 02/09/2026 the only attribution was a campaign tag (`?src=`) that our
 * own outbound links carry, and it was empty on every external key ever
 * issued. A decision about where to invest acquisition effort needs three
 * more things a browser knows on arrival: the landing page, the referring
 * site, and the utm_* labels. All three are sent by the key dialog, none is
 * personal data, and none is ever the reason a key is refused: a malformed
 * value becomes NULL, a missing object means the key was minted without a
 * browser (curl, an SDK, an agent) and is recorded as such.
 */
export interface Attribution {
  landing?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

const LANDING = /^\/[A-Za-z0-9._~\-/%]{0,119}$/;
const HOST = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const UTM = /^[a-z0-9][a-z0-9_.-]{0,59}$/;

/** The dialog's shape, validated field by field; anything else is dropped. */
export function parseAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const text = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const out: Attribution = {};
  const landing = text('landing');
  if (LANDING.test(landing)) out.landing = landing;
  const referrer = text('referrer').toLowerCase();
  if (HOST.test(referrer)) out.referrer = referrer;
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
    const v = text(k).toLowerCase();
    if (UTM.test(v)) out[k] = v;
  }
  return out;
}

export function recordSignupAttribution(
  keyPrefix: string,
  source: string | null | undefined,
  attribution: Attribution | null,
): void {
  getStatsDB()
    .prepare(
      `INSERT OR REPLACE INTO signup_attribution
        (key_prefix, src, client, landing, referrer, utm_source, utm_medium, utm_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      keyPrefix,
      source ?? null,
      attribution ? 'web' : 'api',
      attribution?.landing ?? null,
      attribution?.referrer ?? null,
      attribution?.utm_source ?? null,
      attribution?.utm_medium ?? null,
      attribution?.utm_campaign ?? null,
    );
}

export interface SignupSources {
  period_days: number;
  /** First day the table holds a row: keys created before it carry no origin. */
  since: string | null;
  total: number;
  channels: Array<{ channel: string; n: number }>;
  landings: Array<{ path: string; n: number }>;
  referrers: Array<{ host: string; n: number }>;
  campaigns: Array<{ utm_source: string; utm_medium: string | null; utm_campaign: string | null; n: number }>;
}

interface Row {
  src: string | null;
  client: string;
  landing: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

/**
 * One channel per signup, most specific first: a campaign label names the
 * effort that produced the visit, a source tag names our own outbound link,
 * a referrer names the site that sent them, and what is left is either a
 * browser with no trace (typed, bookmarked, or a referrer stripped by the
 * sender) or no browser at all.
 */
export function channelOf(r: Row): string {
  if (r.utm_source) return `utm:${r.utm_source}`;
  if (r.src) return `src:${r.src}`;
  if (r.referrer) return `ref:${r.referrer}`;
  return r.client === 'web' ? 'direct' : 'api';
}

function count<T extends string>(values: T[]): Array<{ value: T; n: number }> {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || String(a.value).localeCompare(String(b.value)));
}

export function signupSources(days: number): SignupSources {
  const db = getStatsDB();
  const since = (db.prepare('SELECT min(created_at) AS t FROM signup_attribution').get() as { t: string | null }).t;
  // Farm keys relabelled into .invalid, our own addresses and the signup probes
  // are not signups, so they do not count here either.
  const rows = db
    .prepare(
      `SELECT a.src, a.client, a.landing, a.referrer, a.utm_source, a.utm_medium, a.utm_campaign
         FROM signup_attribution a
         LEFT JOIN api_keys k ON k.key_prefix = a.key_prefix
        WHERE a.created_at >= datetime('now', ?)
          AND (k.email IS NULL OR (
            k.email NOT LIKE '%.invalid' AND k.email NOT LIKE '%@ibanforge.com' AND k.email NOT LIKE '%+ibf-test-%'
            AND k.email NOT LIKE '%@ibanforge.internal'))`,
    )
    .all(`-${Math.max(1, Math.min(365, Math.floor(days)))} days`) as Row[];
  const camp = new Map<string, { utm_source: string; utm_medium: string | null; utm_campaign: string | null; n: number }>();
  for (const r of rows) {
    if (!r.utm_source) continue;
    const k = `${r.utm_source}|${r.utm_medium ?? ''}|${r.utm_campaign ?? ''}`;
    const cur = camp.get(k) ?? { utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign, n: 0 };
    cur.n += 1;
    camp.set(k, cur);
  }
  return {
    period_days: days,
    since: since ? since.slice(0, 10) : null,
    total: rows.length,
    channels: count(rows.map(channelOf)).map(({ value, n }) => ({ channel: value, n })),
    landings: count(rows.map((r) => r.landing).filter((v): v is string => Boolean(v))).map(({ value, n }) => ({ path: value, n })),
    referrers: count(rows.map((r) => r.referrer).filter((v): v is string => Boolean(v))).map(({ value, n }) => ({ host: value, n })),
    campaigns: [...camp.values()].sort((a, b) => b.n - a.n),
  };
}
