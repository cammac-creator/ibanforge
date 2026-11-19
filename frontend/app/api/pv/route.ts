import { NextRequest, NextResponse } from 'next/server';
import { clientAddress } from '@/lib/register-page-limit';
import { countView, parseView, shouldSkipView, withinViewLimit } from '@/lib/page-views';

/**
 * POST /api/pv — one page view, on the site's own origin (frontend/lib/page-views.ts says why).
 *
 * The browser posts `{page, locale}` with `sendBeacon`; the answer is always 204 for a body
 * that parses and 400 otherwise, whether the view was counted or not: there is nothing to
 * tell a browser. This handler reads the headers (Do Not Track, Global Privacy Control, the
 * agent, the address for the rate limit) and keeps NONE of them: no log line, nothing on
 * disk, nothing passed on. What it keeps in memory is a template, a locale and a number.
 */
export const runtime = 'nodejs';

const MAX_BODY = 1024;

export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > MAX_BODY) return new NextResponse(null, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const view = parseView(raw);
  if (!view) return NextResponse.json({ error: 'invalid_view' }, { status: 400 });
  if (shouldSkipView(req.headers)) return new NextResponse(null, { status: 204 });
  if (!withinViewLimit(clientAddress(req.headers) ?? 'unknown')) return new NextResponse(null, { status: 429 });
  countView(view);
  return new NextResponse(null, { status: 204 });
}
