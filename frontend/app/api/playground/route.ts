import { NextRequest, NextResponse } from 'next/server';

// API_URL: prefer server-side var, fallback to public var, then localhost
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
// Internal API key for playground (server-side only, never exposed to client)
const PLAYGROUND_API_KEY = process.env.PLAYGROUND_API_KEY || '';

/*
 * FRT-01 (audit 2026-09-01): this route is an authenticated relay to four
 * endpoints that are behind the x402 paywall, carrying the owner's server key.
 * Before this change it was open: a curl from `Origin: https://evil.example`
 * got a full paid answer, and a loop would have drained the key's quota until
 * the public playground answered `playground_unavailable` to everyone.
 *
 * Two guards, in order of cheapness:
 *   1. the request must come from one of our own pages (Origin, or Referer as
 *      a fallback for the browsers that omit Origin on same-site POSTs);
 *   2. a per-IP sliding window, so even a legitimate origin cannot loop.
 *
 * Neither is a wall — Origin is trivially forged by a non-browser client, and
 * the window is per lambda instance. They raise the cost of casual abuse and
 * make the honest path work; a Vercel Firewall rate rule on this path is the
 * real ceiling and belongs on the platform, not here.
 */
const ALLOWED_ORIGINS = new Set(['https://ibanforge.com', 'https://www.ibanforge.com']);

function isAllowedCaller(req: NextRequest): boolean {
  // Referer only when Origin is absent. Both absent is the audit's curl case:
  // treat "no origin at all" as refused rather than as same-origin.
  const raw = req.headers.get('origin') ?? req.headers.get('referer');
  if (!raw) return false;

  let host: string;
  let protocol: string;
  try {
    const url = new URL(raw);
    host = url.host;
    protocol = url.protocol;
  } catch {
    return false;
  }

  if (ALLOWED_ORIGINS.has(`${protocol}//${host}`)) return true;

  /*
   * Preview deployments. A blanket `*.vercel.app` allowance would let anybody
   * who can deploy a page onto Vercel use this relay, so the preview host must
   * be the very host serving this request: the visitor is then on our own
   * preview page, not on someone else's.
   */
  const self = req.headers.get('host');
  if (self && host === self && host.endsWith('.vercel.app')) return true;

  if (process.env.NODE_ENV !== 'production') {
    const name = host.split(':')[0];
    if (name === 'localhost' || name === '127.0.0.1' || name === '[::1]') return true;
  }

  return false;
}

/*
 * Sized against honest use, not against the abuser: the page offers fourteen
 * example chips across its four tabs, and a curious visitor who tries them all
 * and types a few IBANs of their own stays well under thirty. A loop, which is
 * what this exists to stop, passes thirty in a second.
 */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
// Above this many tracked callers, sweep the whole map instead of only the
// current caller's entry. Without a sweep the map grows for the life of the
// lambda instance, which is the same leak FRT-05 flagged on the login route.
const SWEEP_ABOVE = 500;

const recentHits = new Map<string, number[]>();

function withinRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  if (recentHits.size > SWEEP_ABOVE) {
    for (const [key, stamps] of recentHits) {
      const kept = stamps.filter((t) => t > cutoff);
      if (kept.length === 0) recentHits.delete(key);
      else recentHits.set(key, kept);
    }
  }

  const mine = (recentHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (mine.length >= RATE_LIMIT_MAX) {
    recentHits.set(ip, mine);
    return false;
  }
  mine.push(now);
  recentHits.set(ip, mine);
  return true;
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Exported for tests only: a shared window across test cases would make them order-dependent. */
export function __resetRateLimitForTests(): void {
  recentHits.clear();
}

export async function POST(req: NextRequest) {
  if (!isAllowedCaller(req)) {
    /*
     * `message` is deliberate: app/[locale]/playground/page.tsx maps only the
     * `playground_unavailable` code to a translated string, then falls back to
     * `data.message` before showing a raw `data.error` token. Until the two new
     * codes get their own message keys, a sentence is what the visitor sees
     * rather than the word "forbidden_origin".
     */
    return NextResponse.json(
      { error: 'forbidden_origin', message: 'This playground only answers calls made from ibanforge.com.' },
      { status: 403 },
    );
  }

  const ip = clientIp(req);
  if (!withinRateLimit(ip)) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many playground calls from this address. Please try again in a few minutes.' },
      { status: 429 },
    );
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { type, value } =
    parsed && typeof parsed === 'object'
      ? (parsed as { type?: unknown; value?: unknown })
      : { type: undefined, value: undefined };

  let apiPath: string;
  let fetchOptions: RequestInit;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PLAYGROUND_API_KEY) {
    headers['Authorization'] = `Bearer ${PLAYGROUND_API_KEY}`;
  }
  /*
   * FRT-04, partial: the backend rate limiter counts per IP and, through this
   * relay, sees only the Vercel egress IP — so one abuser and every honest
   * visitor share a bucket. This header hands it the visitor's IP.
   *
   * It is INFORMATIVE ONLY and must never be trusted as an identity: anything
   * that can reach this route can set x-forwarded-for. A distinct header name
   * (not X-Forwarded-For) keeps it out of the backend's own trusted-hop chain
   * until the backend decides what to do with it.
   */
  headers['X-Playground-Client-Ip'] = ip;

  if (type === 'iban') {
    apiPath = '/v1/iban/validate';
    fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({ iban: value }),
    };
  } else if (type === 'compliance') {
    apiPath = '/v1/iban/compliance';
    fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({ iban: value }),
    };
  } else if (type === 'bic') {
    apiPath = `/v1/bic/${encodeURIComponent(String(value))}`;
    fetchOptions = { method: 'GET', headers };
  } else if (type === 'clearing') {
    apiPath = `/v1/ch/clearing/${encodeURIComponent(String(value))}`;
    fetchOptions = { method: 'GET', headers };
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    const url = `${API_URL}${apiPath}`;
    const start = Date.now();
    const res = await fetch(url, fetchOptions);
    const ms = Date.now() - start;
    const data = await res.json();

    // A 402 here means OUR server-side key was absent, revoked or out of
    // quota — never something the visitor can fix. Serve a translatable code
    // (the page maps it), and put the diagnosis where it belongs: the logs.
    // This exact failure once surfaced as a raw English sentence on the FR
    // page, with nothing anywhere saying whether the key was dead or missing.
    if (res.status === 402) {
      console.error(
        `[playground] 402 from ${apiPath} — key ${PLAYGROUND_API_KEY ? 'set' : 'MISSING'}` +
          `${res.headers.get('X-API-Key-Invalid') === 'true' ? ', REJECTED as invalid (revoked?)' : ''}` +
          `${res.headers.get('X-Quota-Remaining') === '0' ? ', quota exhausted' : ''}`,
      );
      return NextResponse.json({
        error: 'playground_unavailable',
        _playground_ms: ms,
      });
    }

    return NextResponse.json({ ...data, _playground_ms: ms });
  } catch {
    return NextResponse.json({ error: 'API unreachable' }, { status: 502 });
  }
}
