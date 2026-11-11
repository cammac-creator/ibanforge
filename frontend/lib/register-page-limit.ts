/**
 * The per-visitor cap on the /at, /be and /sm code pages (decision of
 * 29/09/2026, "plafonner").
 *
 * Middleware runs before the page cache on every request, and the site is one
 * server process, so one counter in memory sees every visitor: this module is
 * that counter. Its numbers and its path are read from
 * `firewall/register-pages-rate-limit.json`, the rule the site's former host
 * applied at its edge until the move of 27/10/2026, kept as the one place they
 * are written. It never counts the search engines that rule exempted, by user
 * agent.
 *
 * It used to switch itself off when a `VERCEL` variable was set, the old host's
 * rule doing the job there. That host is gone, and a stray variable of that
 * name must not lift the cap (C24): the branch is removed.
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
/** The user-agent exemption of that rule, unchanged since 07/10/2026. */
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
