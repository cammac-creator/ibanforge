import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieConfig } from '@/lib/auth';

export async function POST(req: NextRequest) {
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
