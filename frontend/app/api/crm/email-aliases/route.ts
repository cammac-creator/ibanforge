import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

async function forward(init: RequestInit): Promise<NextResponse> {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  try {
    const r = await fetch(`${API_URL}/v1/admin/email-aliases`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      signal: AbortSignal.timeout(8000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}

export async function GET() {
  return forward({ method: 'GET' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forward({ method: 'POST', body });
}
