import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/** Authenticated proxy for the Forums tab thread list and edits. */
async function forward(path: string, init: RequestInit): Promise<NextResponse> {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  try {
    const r = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return forward(`/v1/admin/forum-threads${qs}`, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forward('/v1/admin/forum-threads', { method: 'POST', body });
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const body = await req.text();
  return forward(`/v1/admin/forum-threads/${id}`, { method: 'PATCH', body });
}
