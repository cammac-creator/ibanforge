import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { isAuthenticated } from '@/lib/auth';

const TABORNIO_URL = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
const SECRET = process.env.CRM_DRAFT_SECRET || '';
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Record the just-sent message into the CRM immediately so it shows in the
 * timeline on the next refresh — no waiting for the IMAP "Sent" sync. The id
 * matches sync-sent.py's scheme (md5 of email|out|date|subject) so the later
 * IMAP sync upserts the same row instead of creating a duplicate.
 */
async function recordSent(to: string, subject: string, body: string, account: string) {
  if (!API_URL || !ADMIN_SECRET) return;
  const date = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const id = createHash('md5').update(`${to}|out|${date}|${subject}`).digest('hex');
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 280);
  const msg = {
    id,
    customer_email: to,
    direction: 'out',
    msg_date: date,
    subject,
    snippet,
    // 50k, not 6k. The cap existed to keep the row small, but it silently
    // amputated the longest mails ever sent from here: measured 29/07/2026,
    // several were stored at exactly 6000 characters, cut mid-sentence. The
    // send itself was never truncated, so the loss was invisible until the
    // record was read back. A mail past 50k is a different problem.
    body: body.slice(0, 50_000),
    counterparty: account,
  };
  try {
    await fetch(`${API_URL}/v1/admin/email-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
      body: JSON.stringify({ messages: [msg] }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // best-effort: the IMAP sync will pick it up later anyway
  }
}

/** Authenticated proxy: send the email from the CRM via the tabornio SMTP endpoint. */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SECRET) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const r = await fetch(`${TABORNIO_URL}/api/crm/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    // On a confirmed send, record it into the timeline immediately.
    if (r.ok && data && (data as { sent?: boolean }).sent && body && typeof body === 'object') {
      const b = body as { to?: string; subject?: string; body?: string; account?: string };
      if (b.to && b.subject) {
        await recordSent(b.to, b.subject, b.body ?? '', b.account ?? '');
      }
    }
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed', message: 'Endpoint VPS injoignable' }, { status: 502 });
  }
}
