/**
 * The per-visitor cap on the /at, /be and /sm code pages, for the self-hosted
 * site (decision of 29/09/2026, "plafonner"; move off Vercel of 07/10/2026).
 *
 * On Vercel the cap is a firewall rule evaluated at the edge
 * (`firewall/register-pages-rate-limit.json`): a counter in memory could not
 * work there, because the cached page never runs our code and the instances
 * are many. On the VPS both objections fall: middleware runs before the page
 * cache on every request, and there is exactly one server process, so one
 * counter in memory sees every visitor. This module is that counter, with the
 * numbers and the path read from the same JSON rule, so the two can never
 * disagree.
 *
 * It does nothing on Vercel (`VERCEL` is set there, at build and at run time):
 * the firewall rule keeps doing the job, and a second, per-isolate counter
 * would only add noise. It never counts the search engines the live firewall
 * rule exempts, by user agent, as that rule does.
 *
 * Client address: Caddy sets X-Real-IP to the TCP peer and replaces any
 * X-Forwarded-For sent by the client (proved on the candidate server on
 * 07/10/2026: thirty forged addresses still shared one bucket). Without either
 * header, every request shares the bucket "unknown": cautious, never open.
 */
import rule from '@/firewall/register-pages-rate-limit.json';

const PATH = new RegExp(rule.value.conditionGroup[0].conditions[0].value);
const WINDOW_MS = rule.value.action.mitigate.rateLimit.window * 1000;
const LIMIT = rule.value.action.mitigate.rateLimit.limit;
/** Same list as the user-agent exemption of the live Vercel rule (07/10/2026). */
export const EXEMPT_BOTS = /Googlebot|bingbot|Applebot|DuckDuckBot|YandexBot/;
/** Above this many tracked addresses, sweep the whole map (the leak FRT-05 named). */
const SWEEP_ABOVE = 5_000;

interface Bucket {
  start: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export interface LimitInput {
  pathname: string;
  ip: string | null;
  userAgent: string | null;
  now?: number;
  env?: Record<string, string | undefined>;
}

export interface LimitVerdict {
  limited: boolean;
  /** Seconds until the window of this address closes, when limited. */
  retryAfter?: number;
}

/** Whether a request to this path is counted at all (the register code pages). */
export function isCountedPath(pathname: string): boolean {
  return PATH.test(pathname);
}

/**
 * Counts the request and says whether it is over the cap. Fixed window per
 * address, as the firewall rule: the first request of an address opens a
 * window of `window` seconds; the 61st inside it is refused until it closes.
 */
export function checkRegisterPageLimit(input: LimitInput): LimitVerdict {
  const env = input.env ?? process.env;
  if (env.VERCEL) return { limited: false };
  if (!isCountedPath(input.pathname)) return { limited: false };
  if (input.userAgent && EXEMPT_BOTS.test(input.userAgent)) return { limited: false };

  const now = input.now ?? Date.now();
  const key = input.ip?.trim() || 'unknown';

  if (buckets.size > SWEEP_ABOVE) {
    for (const [k, b] of buckets) if (now - b.start >= WINDOW_MS) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return { limited: false };
  }
  bucket.count += 1;
  if (bucket.count > LIMIT) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((bucket.start + WINDOW_MS - now) / 1000)) };
  }
  return { limited: false };
}

/** The client address as the reverse proxy hands it over. */
export function clientAddress(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || null;
}

/** Exported for tests only. */
export function __resetRegisterPageLimitForTests(): void {
  buckets.clear();
}

export const REGISTER_PAGE_LIMIT = { windowSeconds: WINDOW_MS / 1000, limit: LIMIT } as const;
