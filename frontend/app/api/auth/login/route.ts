import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieConfig, passwordsMatch } from '@/lib/auth';

// Best-effort in-memory rate limit. On Vercel Lambdas this is per-instance,
// not global — an attacker can re-roll a different cold start. Acceptable
// for a single-user dashboard, but if the dashboard becomes multi-user or
// the threat model changes, swap this for an Upstash Redis (or similar) store.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkBruteForce(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
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

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  if (!checkBruteForce(ip)) {
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
    await constantTimeDelay();
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const config = getSessionCookieConfig();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(config);
  return response;
}
