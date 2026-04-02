import { cookies } from 'next/headers';
import { createHmac } from 'crypto';

const SESSION_COOKIE = 'ibanforge_session';

function getSecret(): string {
  return process.env.DASHBOARD_PASSWORD || 'default-secret';
}

function signToken(value: string): string {
  return createHmac('sha256', getSecret()).update(value).digest('hex');
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const expected = signToken('authenticated');
  return token === expected;
}

export function getSessionCookieConfig() {
  return {
    name: SESSION_COOKIE,
    value: signToken('authenticated'),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  };
}
