import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieConfig, passwordsMatch } from '@/lib/auth';
import {
  networkHint,
  notifyDashboardOwner,
  type DashboardLoginAlert,
} from '@/lib/dashboard-login-alert';

// Best-effort in-memory rate limit. On Vercel Lambdas this is per-instance,
// not global — an attacker can re-roll a different cold start. Acceptable
// for a single-user dashboard, but if the dashboard becomes multi-user or
// the threat model changes, swap this for an Upstash Redis (or similar) store.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/*
 * WEB-01 (audit 2026-11-10): the limiter above counts per address, never in
 * total, so a guess spread over many addresses was only slowed, never stopped.
 * This ceiling counts the WRONG PASSWORDS of every address together.
 *
 * Why 60 an hour. One address cannot fail more than MAX_ATTEMPTS per
 * WINDOW_MS, so about twenty times an hour; the owner mistyping on two
 * networks at once (phone and office) stays under fifty. Sixty is out of his
 * reach, and within reach of any guess spread over three addresses or more.
 *
 * Why one hour, counted from the window's first failure. Once the ceiling is
 * reached every login is refused, the right password included (otherwise the
 * ceiling would still answer the one guess that matters), and refused
 * requests are not counted: nothing can push the window's end further, so
 * the dashboard is never closed for more than GLOBAL_WINDOW_MS. A determined
 * guesser can close it again the next hour; the alert, sent once per window,
 * is what tells the owner. Like the limiter above, the count lives in memory
 * and starts again at each deployment.
 */
export const GLOBAL_MAX_FAILURES = 60;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface GlobalWindow {
  startedAt: number;
  failures: number;
  /** Distinct limiter keys behind the failures; only their count leaves this file. */
  addresses: Set<string>;
  alerted: boolean;
}

let globalWindow: GlobalWindow | null = null;

/** The open window, or null once its hour has passed (which lifts the ceiling). */
function currentGlobalWindow(now: number): GlobalWindow | null {
  if (globalWindow && now - globalWindow.startedAt >= GLOBAL_WINDOW_MS) globalWindow = null;
  return globalWindow;
}

function globalCeilingReached(now: number): boolean {
  const w = currentGlobalWindow(now);
  return w !== null && w.failures >= GLOBAL_MAX_FAILURES;
}

/** Counts one wrong password; returns the alert when this one reaches the ceiling. */
function recordGlobalFailure(ip: string, now: number): DashboardLoginAlert | null {
  let w = currentGlobalWindow(now);
  if (!w) {
    w = { startedAt: now, failures: 0, addresses: new Set(), alerted: false };
    globalWindow = w;
  }
  w.failures++;
  w.addresses.add(ip);
  if (w.failures < GLOBAL_MAX_FAILURES || w.alerted) return null;
  w.alerted = true;
  return {
    event: 'global_cap',
    at: new Date(now).toISOString(),
    until: new Date(w.startedAt + GLOBAL_WINDOW_MS).toISOString(),
    failures: w.failures,
    addresses: w.addresses.size,
  };
}

/**
 * Sends the alert without holding the answer: the promise is left to run (the
 * site is a long-lived Node server, not a lambda frozen after the response).
 * `notifyDashboardOwner` never rejects; the catch is there for the day it does.
 */
function alertOwner(alert: DashboardLoginAlert): void {
  void notifyDashboardOwner(alert).catch(() => undefined);
}

function checkBruteForce(ip: string): boolean {
  const now = Date.now();
  /*
   * FRT-05 (audit 2026-09-01): the map used to shed an entry only when that
   * same IP came back, so a spray across many addresses left one entry per
   * address for the life of the lambda instance. Sweeping the expired ones on
   * each call keeps it bounded by the number of IPs seen in the last window.
   */
  for (const [key, record] of loginAttempts) {
    if (now > record.resetAt) loginAttempts.delete(key);
  }
  const record = loginAttempts.get(ip);
  if (!record) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}

// Constant-time per request: avoid leaking via response timing whether the
// password env was set, even if the rate limiter or password were checked.
async function constantTimeDelay() {
  await new Promise((r) => setTimeout(r, 200));
}

/**
 * The address the limiter counts. The FIRST x-forwarded-for segment is the one
 * the client writes, so keying on it let a caller re-roll the window with a
 * header (adversarial review of 07/09/2026, M1). Vercel sets x-real-ip and
 * x-vercel-forwarded-for itself; the last x-forwarded-for segment is the hop
 * the platform appended. The client-controlled segment is never used.
 */
export function limiterKey(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const vercel = headers.get('x-vercel-forwarded-for')?.trim();
  if (vercel) return vercel;
  const parts = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = limiterKey(req.headers);

  /*
   * FRT-05: the 429 used to return immediately while every other answer paid
   * the 200 ms delay, so response time alone told an attacker "you are being
   * throttled" versus "that password is wrong" — the exact signal the delay
   * exists to hide. Pay the same toll before answering. The global ceiling
   * (WEB-01) answers the same 429, after the same delay.
   */
  if (!checkBruteForce(ip) || globalCeilingReached(Date.now())) {
    await constantTimeDelay();
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429 },
    );
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    await constantTimeDelay();
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const password =
    body && typeof body === 'object' && 'password' in body
      ? String((body as { password: unknown }).password ?? '')
      : '';

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    await constantTimeDelay();
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (!passwordsMatch(password, expected)) {
    const ceiling = recordGlobalFailure(ip, Date.now());
    if (ceiling) alertOwner(ceiling);
    await constantTimeDelay();
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const config = getSessionCookieConfig();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(config);
  // WEB-01: every successful login tells the owner when, and from which
  // network (masked). Never the password, the cookie, nor the full address.
  alertOwner({ event: 'login_ok', at: new Date().toISOString(), network: networkHint(ip) });
  return response;
}
