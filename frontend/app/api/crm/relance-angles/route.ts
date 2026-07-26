import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const TABORNIO_URL = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
const SECRET = process.env.CRM_DRAFT_SECRET || '';

/**
 * Thin authenticated proxy: the composer posts `{ contact, thread }` here, we
 * add the shared secret and forward to the tabornio VPS endpoint that proposes
 * two or three follow-up angles (Anthropic). Same shape as the generate-draft
 * proxy beside it, and for the same reason: the secret never reaches a browser.
 *
 * The upstream answers `{ angles: [{ key, title, hint }] }` with two or three
 * entries, and refuses below two with a 502 carrying `detail`. Both are
 * forwarded verbatim at the upstream status, so the composer can tell "no
 * angles this time" from "the VPS is down" and degrade to writing without one.
 *
 * Shorter timeout than generate-draft's 45s, deliberately: this is a small
 * Haiku call standing between the operator and the button they just pressed,
 * and it is optional by construction. Waiting three quarters of a minute to be
 * told there are no angles is worse than being told sooner.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SECRET) {
    return NextResponse.json(
      { error: 'not_configured', message: 'CRM_DRAFT_SECRET manquant côté serveur' },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const r = await fetch(`${TABORNIO_URL}/api/crm/relance-angles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json(
      { error: 'upstream_failed', message: 'Endpoint VPS injoignable (déployé ?)' },
      { status: 502 },
    );
  }
}
