import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

/**
 * The institutional correspondents: read the register, add one to it.
 *
 * Calqued on email-aliases, which is the closest motif in this folder: one
 * `forward` holding the authentication, the configuration check and the shared
 * secret, and two thin verbs on top of it. The secret never leaves the server,
 * and no rule about what a correspondent is lives here — the API owns the
 * upsert, the validation and the 400.
 *
 * Deleting one is its own directory rather than a `?action=` on this route,
 * mirroring the upstream path 1:1 the way orphan-resolve does. Nothing in this
 * app has ever routed on a query parameter, and a destructive verb hidden in a
 * query string is the kind of thing a copied URL fires by accident.
 */
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

async function forward(init: RequestInit): Promise<NextResponse> {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  try {
    const r = await fetch(`${API_URL}/v1/admin/institutional-contacts`, {
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

/** Upsert by email. The API answers `{ contacts }`, or 400 invalid_input. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return forward({ method: 'POST', body });
}
