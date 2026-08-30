import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Authenticated proxy: the standing rule that goes with the gesture — every
 * FUTURE message from this address arrives already marked « rien à répondre ».
 * Keeps ADMIN_SECRET server-side.
 *
 * Its own route rather than a mode of the one next door, for the reason that
 * decided the UI as well: marking one message and silencing a correspondent
 * for good are two different acts, and the second one is dangerous. An address
 * ruled by mistake buries an authority's future letters, so it must never be a
 * flag on somebody else's request — one gesture, one endpoint, one refusal
 * possible at a time.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!API_URL || !ADMIN_SECRET) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const r = await fetch(`${API_URL}/v1/admin/no-reply-senders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
