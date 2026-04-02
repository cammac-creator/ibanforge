import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieConfig } from '@/lib/auth';

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

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  if (!checkBruteForce(ip)) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429 },
    );
  }

  const { password } = await req.json();

  if (!process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }

  const config = getSessionCookieConfig();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(config);
  return response;
}
