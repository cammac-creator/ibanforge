import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { siteAdminKey } from '@/lib/admin-key';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_KEY = siteAdminKey();

/**
 * Kick a radar scan. The backend answers immediately (fire-and-forget) and
 * the tab polls the list endpoint, whose payload carries scanning state and
 * the last persisted report.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const body = await req.text();
  try {
    const r = await fetch(`${API_URL}/v1/admin/forum-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_KEY },
      body: body || '{}',
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
