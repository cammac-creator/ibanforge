import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Removes one correspondent from the register, by address. Answers
 * `{ deleted, contacts }`.
 *
 * A POST and its own path, mirroring the upstream endpoint exactly, as
 * orphan-resolve does for the orphan queue. It unregisters the address; it does
 * not touch a single message, so the thread stays in `email_messages` and comes
 * back the moment the address is registered again.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const body = await req.text();
  try {
    const r = await fetch(`${API_URL}/v1/admin/institutional-contacts/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body,
      signal: AbortSignal.timeout(8000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
