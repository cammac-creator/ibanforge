import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * The orphan queue as the API serves it, resolved rows included on request.
 *
 * The overview page reads the pending rows server side; this route exists for
 * the one thing that page cannot show at render time, the rows already dealt
 * with — "what did I file yesterday?" — which the panel fetches on demand.
 * `all` and `limit` are passed through unchanged; the API caps `limit` itself.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET)
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const q = new URLSearchParams();
  const all = req.nextUrl.searchParams.get('all');
  const limit = req.nextUrl.searchParams.get('limit');
  if (all === '1') q.set('all', '1');
  if (limit && /^\d{1,4}$/.test(limit)) q.set('limit', limit);
  try {
    const r = await fetch(`${API_URL}/v1/admin/orphan-mail${q.size ? `?${q}` : ''}`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
