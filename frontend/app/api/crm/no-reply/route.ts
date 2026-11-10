import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { siteAdminKey } from '@/lib/admin-key';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_KEY = siteAdminKey();

/**
 * Authenticated proxy: mark one inbound message as needing no answer, or take
 * the mark back. Keeps the admin key server-side.
 *
 * Same shape as prospect-status beside it, deliberately down to the error
 * slugs: the body is forwarded verbatim rather than re-validated here, because
 * the upstream WHERE is the only place that can decide what is markable (an
 * outbound and a draft are refused there), and a second copy of that rule in a
 * proxy would be free to drift from it.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!API_URL || !ADMIN_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const r = await fetch(`${API_URL}/v1/admin/email-messages/no-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
