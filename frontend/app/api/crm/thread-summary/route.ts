import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const CRM_URL = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
const CRM_SECRET = process.env.CRM_DRAFT_SECRET || '';

/**
 * The pinned "où on en est" summary, cache-first.
 *
 * GET  ?email&key      → the cached summary when its thread_key matches, else null.
 * POST {email, key, company, messages} → generate via the VPS writer, store in
 * the API cache, return. The client only POSTs after a GET miss, and the key
 * fingerprints the thread state (count + last date), so generation happens
 * once per new message — never once per page view.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!API_URL || !ADMIN_SECRET) return NextResponse.json({ summary: null });
  const email = req.nextUrl.searchParams.get('email') ?? '';
  const key = req.nextUrl.searchParams.get('key') ?? '';
  try {
    const r = await fetch(
      `${API_URL}/v1/admin/thread-summary?email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}`,
      { headers: { 'X-Admin-Secret': ADMIN_SECRET }, signal: AbortSignal.timeout(8000), cache: 'no-store' },
    );
    if (!r.ok) return NextResponse.json({ summary: null });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ summary: null });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!CRM_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  let body: { email?: string; key?: string; company?: string; messages?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.email || !body.key || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  try {
    const gen = await fetch(`${CRM_URL}/api/crm/summarize-thread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': CRM_SECRET },
      body: JSON.stringify({ messages: body.messages, company: body.company ?? '' }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!gen.ok) return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
    const { summary_fr } = (await gen.json()) as { summary_fr?: string };
    if (!summary_fr) return NextResponse.json({ error: 'empty_summary' }, { status: 502 });
    // Best-effort cache write: a summary that fails to store is still shown.
    if (API_URL && ADMIN_SECRET) {
      await fetch(`${API_URL}/v1/admin/thread-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
        body: JSON.stringify({ email: body.email, thread_key: body.key, summary_fr }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }
    return NextResponse.json({ summary: { summary_fr } });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
