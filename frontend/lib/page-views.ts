/**
 * The visit counter of the site, on the site's side (decision of 19 November 2026, "Le compteur,
 * et deux phrases"): one page, one day, one number, no cookie, no identifier.
 *
 * ## Why it lives here and not in a call to the API
 *
 * The browser reports a view to the SITE, on the site's own origin (`POST /api/pv`,
 * app/api/pv/route.ts). A direct call from every visitor's browser to the API would put the
 * visitor's address in the API's request log (twelve months) and in the journal of the API's
 * host. Here the address is read only to apply a small in-memory rate limit and is never
 * kept, written or logged; nothing is written to disk.
 *
 * ## What is kept, in memory, and what travels
 *
 * A path is filed under a TEMPLATE of the closed list below (`/blz/37040044` becomes
 * `/blz/:code`, anything unknown becomes `autre`), and `{template, locale}` is counted in a
 * map in memory. Every 45 seconds the map is sent to the API in ONE call, server to server:
 * `POST /v1/admin/page-views` with `{items: [{page, locale, count}]}` and the site's key
 * (`siteAdminKey()`). That call carries no address, no user agent and no header of any
 * visitor: the headers are the key and the content type, nothing is copied from the request.
 * The batch in memory is lost when the server restarts, and dropped when the API does not
 * answer and the total waiting passes `MAX_PENDING`: a few views fewer, never a queue that
 * grows without end. Robots, Do Not Track and Global Privacy Control are dropped before
 * anything is counted.
 *
 * The list of templates is the API's `PAGE_TEMPLATES` (src/lib/page-views.ts), which checks
 * every batch against it; `src/lib/page-views.test.ts` holds the two lists equal, and
 * `page-views.test.ts` here compares this one with the routes on disk.
 */
import { siteAdminKey } from '@/lib/admin-key';

export const PAGE_TEMPLATES = [
  '/',
  '/account',
  '/agents',
  '/alternatives',
  '/alternatives/:vendor',
  '/at',
  '/at/:code',
  '/audit',
  '/audit/done',
  '/be',
  '/be/:code',
  '/blog',
  '/blog/:slug',
  '/blz',
  '/blz/:code',
  '/changelog',
  '/clearing-calendar/:year',
  '/compare',
  '/device',
  '/docs',
  '/docs/:slug',
  '/iban',
  '/iban/:cc',
  '/iban-api-deutschland',
  '/iban-validation-api',
  '/iban-welche-bank',
  '/iid',
  '/iid/:iid',
  '/it',
  '/it/:code',
  '/legal',
  '/legal/:slug',
  '/openapi',
  '/playground',
  '/pricing',
  '/sheets',
  '/sk',
  '/sk/:code',
  '/sm',
  '/sm/:code',
  '/sources',
  '/status',
  '/tools',
  '/tools/qr-bill',
  '/tools/test-iban',
  '/trust',
  '/vendors',
] as const;

export const OTHER_PAGE = 'autre';
export const LOCALES = ['en', 'fr', 'de'] as const;

/** A pathname as `location.pathname` writes it: no query, no fragment, short. */
const PATHNAME = /^\/[A-Za-z0-9._~\-/%]{0,119}$/;
const SEGMENT = /^[^/]+$/;

/**
 * The template of a path, or `autre`. The locale prefix (`/fr`, `/de`; English has none) is
 * dropped first. A path that is not a plain pathname (a query, a fragment, odd characters) is
 * `autre`, whatever follows.
 */
export function pageTemplate(path: string): string {
  if (!PATHNAME.test(path)) return OTHER_PAGE;
  const parts = path.split('/').slice(1);
  if (parts.length > 0 && (LOCALES as readonly string[]).includes(parts[0]!)) parts.shift();
  // a trailing slash names the same page
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  if (parts.some((p) => p === '')) return OTHER_PAGE;
  for (const template of PAGE_TEMPLATES) {
    const want = template === '/' ? [] : template.split('/').slice(1);
    if (want.length !== parts.length) continue;
    if (want.every((w, i) => (w.startsWith(':') ? SEGMENT.test(parts[i]!) : w === parts[i]))) {
      return template;
    }
  }
  return OTHER_PAGE;
}

export interface PageView {
  page: string;
  locale: string;
}

/** The browser's body: a pathname and a locale are read, nothing else. Null when malformed. */
export function parseView(raw: unknown): PageView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const locale = typeof o.locale === 'string' ? o.locale.trim() : '';
  const page = typeof o.page === 'string' ? o.page.trim() : '';
  if (!(LOCALES as readonly string[]).includes(locale) || !PATHNAME.test(page)) return null;
  return { page: pageTemplate(page), locale };
}

/**
 * A request that must not be counted: the browser asks not to be tracked (`DNT: 1`, the Global
 * Privacy Control `Sec-GPC: 1`), or it is a script or a crawler that says so, or it names no
 * agent at all. The agent is read to decide and thrown away.
 */
const AUTOMATED_AGENT =
  /bot|crawl|spider|slurp|headless|lighthouse|phantom|selenium|playwright|puppeteer|curl\/|wget|python|node-fetch|undici|axios|go-http|java\/|libwww|okhttp|httpclient|ibanforge-outil/i;

export function shouldSkipView(headers: Headers): boolean {
  if (headers.get('dnt') === '1' || headers.get('sec-gpc') === '1') return true;
  const ua = headers.get('user-agent') ?? '';
  return ua === '' || AUTOMATED_AGENT.test(ua);
}

/** Sixty views per ten minutes and address: the pace of a person opening pages. In memory only. */
export const VIEWS_PER_WINDOW = 60;
const WINDOW_MS = 10 * 60 * 1000;
const SWEEP_ABOVE = 5_000; // also the ceiling of the table
const recent = new Map<string, number[]>();

/**
 * `ok`: counted against this address. `limited`: this address passed its sixty. `full`: the table
 * holds `MAX_ADDRESSES` live addresses and this one is new: it is not tracked and its view is not
 * counted, rather than growing the table (a falsified address header would otherwise grow it for
 * ten minutes). Past `SWEEP_ABOVE` addresses, the expired ones are purged first.
 */
export type ViewLimit = 'ok' | 'limited' | 'full';
export const MAX_ADDRESSES = SWEEP_ABOVE;

export function viewLimit(ip: string, now: number = Date.now()): ViewLimit {
  if (recent.size >= SWEEP_ABOVE) {
    for (const [k, v] of recent) if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
  }
  const known = recent.get(ip);
  if (!known && recent.size >= MAX_ADDRESSES) return 'full';
  const stamps = (known ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= VIEWS_PER_WINDOW) {
    recent.set(ip, stamps);
    return 'limited';
  }
  stamps.push(now);
  recent.set(ip, stamps);
  return 'ok';
}

/** How often the counts in memory go to the API. */
export const FLUSH_MS = 45_000;
/** Most views kept in memory when the API does not answer: past it, the batch is dropped. */
export const MAX_PENDING = 10_000;
const SEND_TIMEOUT_MS = 5_000;

let pending = new Map<string, number>();
let pendingTotal = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function key(v: PageView): string {
  return `${v.locale}\u0000${v.page}`;
}

/** Count one view in memory and make sure a send is planned. Never throws, never logs. */
export function countView(view: PageView): void {
  if (pendingTotal >= MAX_PENDING) return;
  pending.set(key(view), (pending.get(key(view)) ?? 0) + 1);
  pendingTotal += 1;
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      void flushViews();
    }, FLUSH_MS);
    // never keeps the process alive on its own
    timer.unref?.();
  }
}

/**
 * Send what is in memory, now. The call is server to server and carries only the key and the
 * batch. On any failure the batch is put back if the total stays under `MAX_PENDING`, and
 * dropped otherwise. Rendered for the tests; the route plans it by `countView`.
 */
export async function flushViews(): Promise<boolean> {
  if (pending.size === 0) return true;
  const batch = pending;
  const batchTotal = pendingTotal;
  pending = new Map();
  pendingTotal = 0;
  const base = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
  const adminKey = siteAdminKey();
  let ok = false;
  if (base && adminKey) {
    try {
      const items = [...batch].map(([k, count]) => {
        const [locale, page] = k.split('\u0000');
        return { page, locale, count };
      });
      const res = await fetch(`${base}/v1/admin/page-views`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminKey },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        cache: 'no-store',
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
  }
  if (!ok && pendingTotal + batchTotal <= MAX_PENDING) {
    for (const [k, count] of batch) pending.set(k, (pending.get(k) ?? 0) + count);
    pendingTotal += batchTotal;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        void flushViews();
      }, FLUSH_MS);
      timer.unref?.();
    }
  }
  return ok;
}

/** For tests only. */
export function __resetPageViewsForTests(): void {
  recent.clear();
  pending = new Map();
  pendingTotal = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** For tests only: what waits in memory. */
export function __pendingForTests(): { total: number; cells: Array<{ page: string; locale: string; count: number }> } {
  return {
    total: pendingTotal,
    cells: [...pending].map(([k, count]) => {
      const [locale, page] = k.split('\u0000');
      return { page: page!, locale: locale!, count };
    }),
  };
}
