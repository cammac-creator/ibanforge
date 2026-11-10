import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { siteAdminKey } from '@/lib/admin-key';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_KEY = siteAdminKey();

// Each call names its full admin path: the API's site key opens exactly the
// routes this site calls, and src/lib/admin-auth.site.test.ts reads them here.
async function forward(path: string, init: RequestInit): Promise<NextResponse> {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_KEY)
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  try {
    const r = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_KEY },
      signal: AbortSignal.timeout(8000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}

export async function GET() {
  return forward('/v1/admin/email-aliases', { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return forward('/v1/admin/email-aliases', { method: 'POST', body });
}

// Undo: DELETE with { alias } in the body. The API takes it as a POST on
// /delete (its convention for every removal), so the dashboard can offer the
// way back without a second route file.
export async function DELETE(req: NextRequest) {
  const body = await req.text();
  return forward('/v1/admin/email-aliases/delete', { method: 'POST', body });
}
