import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const CRM_URL = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
const CRM_SECRET = process.env.CRM_DRAFT_SECRET || '';

/**
 * The full French translation of one orphan mail (03/09/2026), through the
 * VPS translator the sync already uses for foreign customer messages
 * (`/api/crm/translate`: detects the language, returns the French). Written
 * once on the orphan row; the dashboard only asks for a row that has none.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!CRM_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  let body: { id?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const text = (body.text ?? '').trim();
  if (!body.id || !text) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  try {
    const gen = await fetch(`${CRM_URL}/api/crm/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': CRM_SECRET },
      body: JSON.stringify({ text: text.slice(0, 6000) }),
      signal: AbortSignal.timeout(40000),
    });
    if (!gen.ok)
      return NextResponse.json({ error: 'translator_failed', status: gen.status }, { status: 502 });
    const data = (await gen.json()) as { lang?: string; fr?: string };
    const fr = (data.fr ?? '').trim();
    if (!fr) return NextResponse.json({ error: 'translator_empty' }, { status: 502 });
    if (API_URL && ADMIN_SECRET) {
      await fetch(`${API_URL}/v1/admin/orphan-mail/translation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
        body: JSON.stringify({ id: body.id, body_fr: fr }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }
    return NextResponse.json({ lang: data.lang ?? null, body_fr: fr });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
