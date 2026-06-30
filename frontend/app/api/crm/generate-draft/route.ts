import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const TABORNIO_URL = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
const SECRET = process.env.CRM_DRAFT_SECRET || '';

/**
 * Thin authenticated proxy: the dashboard button posts the client brief here,
 * we add the shared secret and forward to the tabornio VPS endpoint that
 * generates (Anthropic) + deposits (IMAP) the draft. Keeps the secret server-side.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SECRET) {
    return NextResponse.json({ error: 'not_configured', message: 'CRM_DRAFT_SECRET manquant côté serveur' }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const r = await fetch(`${TABORNIO_URL}/api/crm/generate-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed', message: 'Endpoint VPS injoignable (déployé ?)' }, { status: 502 });
  }
}
