import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';

const SESSION_COOKIE = 'ibanforge_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface SessionPayload {
  iat: number;
  /** Session generation. See getSessionVersion(). */
  v: number;
}

/**
 * SESSION_VERSION is the revocation switch (audit FRT-03, 2026-09-01).
 *
 * The session is stateless: nothing server-side records which tokens are alive,
 * so /api/auth/logout can only delete the browser's copy. A token captured
 * beforehand stayed valid for its full seven days, and nothing short of
 * rotating SESSION_SECRET could cut it short.
 *
 * The version number is stamped into the signed payload and compared on every
 * verify. Bumping SESSION_VERSION in the environment invalidates every session
 * ever issued, immediately and without touching SESSION_SECRET — which matters
 * because rotating the secret is the heavier, more error-prone move.
 *
 * Default 1, so the variable can stay unset until it is needed. Deploying this
 * change invalidates the sessions signed before it (their payload has no `v`),
 * which means one extra login; that is the intended semantics, not a defect.
 *
 * The seven-day TTL is kept on purpose: this dashboard is used continuously,
 * and a shorter TTL would trade a real daily cost against a threat this switch
 * already answers.
 */
function getSessionVersion(): number {
  const raw = process.env.SESSION_VERSION;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    // Falling back silently would quietly re-validate the very sessions the
    // operator meant to cut. Say it out loud instead.
    console.warn('[auth] SESSION_VERSION must be a positive integer; falling back to 1');
    return 1;
  }
  return n;
}

/**
 * SESSION_SECRET is the HMAC key used to sign the session cookie. It MUST be
 * distinct from DASHBOARD_PASSWORD so that compromising the cookie does not
 * leak the password (and vice versa), and so the password can be rotated
 * without invalidating active sessions.
 *
 * Production requires SESSION_SECRET. Dev falls back to a static dev-only key
 * so local work doesn't need extra env config.
 */
function getSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET must be set in production to a random string >= 32 chars. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return 'dev-only-fallback-secret-not-for-production-use-32-chars';
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payload: SessionPayload): string {
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const mac = base64url(
    createHmac('sha256', getSessionSecret()).update(body).digest(),
  );
  return `${body}.${mac}`;
}

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function verify(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = base64url(
    createHmac('sha256', getSessionSecret()).update(body).digest(),
  );
  if (!safeEqualString(mac, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.iat !== 'number') return null;
    // A token signed under another generation is refused even though its MAC is
    // valid. Tokens issued before FRT-03 carry no `v` at all, so `undefined`
    // fails this comparison and they are refused too — that is the point.
    if (payload.v !== getSessionVersion()) return null;
    const ageSeconds = Math.floor(Date.now() / 1000) - payload.iat;
    if (ageSeconds < 0) return null;
    if (ageSeconds > SESSION_TTL_SECONDS) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verify(token) !== null;
}

export function getSessionCookieConfig() {
  return {
    name: SESSION_COOKIE,
    value: sign({ iat: Math.floor(Date.now() / 1000), v: getSessionVersion() }),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  };
}

/**
 * Timing-safe password comparison. Buffers of different lengths are detected
 * up-front (length leak is unavoidable) but the byte comparison itself is
 * constant-time.
 */
export function passwordsMatch(input: string, expected: string): boolean {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  if (input.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(input), Buffer.from(expected));
}
