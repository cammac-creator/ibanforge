import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/** Authenticated proxy for the operator's dated contact notes. */
async function forward(req: NextRequest, init: RequestInit, qs: string): Promise<NextResponse> {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  try {
    const r = await fetch(`${API_URL}/v1/admin/contact-notes${qs}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      signal: AbortSignal.timeout(8000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? '';
  return forward(req, { method: 'GET' }, `?email=${encodeURIComponent(email)}`);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forward(req, { method: 'POST', body }, '');
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  return forward(req, { method: 'DELETE' }, `?id=${encodeURIComponent(id)}`);
}
