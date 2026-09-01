import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { isAuthenticated } from '@/lib/auth';

/** Read per call, never captured at module load: see send/route.ts. */
function env() {
  return {
    apiUrl: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '',
    adminSecret: process.env.ADMIN_SECRET || '',
  };
}

/**
 * CRM-native drafts: one draft per client, stored as an email_messages row
 * with direction 'draft'. The id is derived from the client email alone, so
 * saving again overwrites the previous draft (upsert) instead of piling up.
 */
function draftId(email: string): string {
  return `draft-${createHash('md5').update(email.trim().toLowerCase()).digest('hex')}`;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { apiUrl, adminSecret } = env();
  if (!apiUrl || !adminSecret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let body: { email?: string; subject?: string; body?: string; account?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.email || !body.subject) {
    return NextResponse.json({ error: 'invalid_body', message: 'email et subject requis' }, { status: 400 });
  }
  const text = body.body ?? '';
  const msg = {
    id: draftId(body.email),
    customer_email: body.email,
    direction: 'draft',
    msg_date: new Date().toISOString().slice(0, 16),
    subject: body.subject,
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 280),
    /**
     * 50k, the same ceiling the send path uses (audit TABS-10, 2026-09-01).
     *
     * 6000 here against 50000 there meant a long mail could be written, saved,
     * and come back amputated mid-sentence, with nothing on screen saying so
     * and the full text already gone from the composer. It is the exact defect
     * the send route's own comment records having fixed on its side; the draft
     * side was left behind. A draft past 50k is a different problem.
     *
     * ⚠️ This stops the FRONTEND being the one that cuts. The store clips the
     * column at 8000 of its own accord (src/routes/api-keys.ts, the POST
     * handler), so that is the real ceiling until it is raised there too.
     */
    body: text.slice(0, 50_000),
    counterparty: body.account ?? '',
  };
  try {
    const r = await fetch(`${apiUrl}/v1/admin/email-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ messages: [msg] }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(r.ok ? { saved: true, id: msg.id, ...data } : data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { apiUrl, adminSecret } = env();
  if (!apiUrl || !adminSecret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: 'invalid_body', message: 'id requis' }, { status: 400 });
  }
  try {
    const r = await fetch(`${apiUrl}/v1/admin/email-messages/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ id: body.id }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 });
  }
}
