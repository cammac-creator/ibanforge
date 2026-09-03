import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const CRM_URL = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
const CRM_SECRET = process.env.CRM_DRAFT_SECRET || '';

/**
 * The French gist of one orphan mail (03/09/2026).
 *
 * The queue is read by a French speaker and nearly everything in it is
 * English: directory listings, DMARC reports, cold outreach, the odd real
 * reply. Deciding what to do with a message starts with understanding it, so
 * each row gets two or three French sentences from the same VPS writer that
 * pins the "où on en est" summary above a thread (same prompt family, same
 * anti-invention rules, same secret). One message in, one gist out.
 *
 * Generated once: the API keeps the gist on the orphan row, and this route is
 * only called for a row that has none yet.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!CRM_SECRET) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  let body: {
    id?: string;
    sender?: string;
    subject?: string | null;
    snippet?: string | null;
    msg_date?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.id || !body.sender || (!body.subject && !body.snippet)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const domain = body.sender.split('@')[1] ?? body.sender;
  try {
    const gen = await fetch(`${CRM_URL}/api/crm/summarize-thread`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': CRM_SECRET },
      body: JSON.stringify({
        company: domain,
        messages: [
          {
            direction: 'in',
            date: body.msg_date ?? '',
            subject: body.subject ?? '',
            snippet: (body.snippet ?? '').slice(0, 1200),
          },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!gen.ok)
      return NextResponse.json({ error: 'writer_failed', status: gen.status }, { status: 502 });
    const data = (await gen.json()) as { summary_fr?: string };
    const gist = (data.summary_fr ?? '').trim();
    if (!gist) return NextResponse.json({ error: 'writer_empty' }, { status: 502 });
    if (API_URL && ADMIN_SECRET) {
      await fetch(`${API_URL}/v1/admin/orphan-mail/gist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
        body: JSON.stringify({ id: body.id, gist_fr: gist }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }
    return NextResponse.json({ gist_fr: gist });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
